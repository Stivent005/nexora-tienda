-- Checkout Pro de Mercado Pago con confirmación exclusiva por webhook.
-- Aplicar después de 05_seguridad_compras_pagos.sql y 07_cuentas_cliente_historial.sql.
begin;

do $$
begin
  if to_regclass('public.pedidos') is null
     or to_regclass('public.pagos_abonos') is null
     or to_regclass('public.pedido_propietarios') is null
     or to_regclass('public.ajustes') is null
     or to_regprocedure('public.nexora_guardar_estado_pedido()') is null then
    raise exception 'NEXORA: aplica primero las migraciones 05 y 07 antes de configurar Mercado Pago.';
  end if;
end $$;

alter table public.pagos_abonos add column if not exists proveedor text;
alter table public.pagos_abonos add column if not exists proveedor_order_id text;
alter table public.pagos_abonos add column if not exists proveedor_payment_id text;
create unique index if not exists pagos_abonos_proveedor_order_uidx
  on public.pagos_abonos(proveedor,proveedor_order_id)
  where proveedor='mercadopago' and proveedor_order_id is not null;
create unique index if not exists pagos_abonos_proveedor_payment_uidx
  on public.pagos_abonos(proveedor,proveedor_payment_id)
  where proveedor='mercadopago' and proveedor_payment_id is not null;

-- Agrega el método apagado sin sustituir la configuración que ya tiene la tienda.
do $$
declare v_config jsonb; v_metodos jsonb;
begin
  select case when jsonb_typeof(valor)='object' then valor else '{}'::jsonb end
    into v_config from public.ajustes where clave='config' for update;
  if not found then return; end if;
  v_metodos:=case when jsonb_typeof(v_config->'metodos')='array' then v_config->'metodos' else '[]'::jsonb end;
  if not exists(select 1 from jsonb_array_elements(v_metodos) as m(value)
      where m.value->>'id'='mercadopago' or m.value->>'gateway'='mercadopago') then
    v_metodos:=v_metodos||jsonb_build_array(jsonb_build_object(
      'id','mercadopago','nombre','Mercado Pago','tipo','link','gateway','mercadopago',
      'activo',false,'enlace','https://www.mercadopago.com.co',
      'instr','Paga en Mercado Pago. Confirmaremos tu pago automáticamente.'
    ));
    update public.ajustes set valor=jsonb_set(v_config,'{metodos}',v_metodos,true) where clave='config';
  end if;
end $$;

create or replace function public.nexora_mp_ids_validos(p_pedido_id text,p_order_id text,p_external_reference text)
returns boolean
language sql immutable
set search_path = pg_catalog
as $$
  select p_pedido_id is not null and p_pedido_id ~ '^[A-Za-z0-9_-]{8,80}$'
    and p_external_reference=p_pedido_id
    and p_order_id is not null and p_order_id ~ '^[A-Za-z0-9_-]{8,100}$'
$$;

-- Los pedidos de este método siempre quedan identificados como automáticos,
-- aunque un navegador modificado intente adjuntar una referencia manual.
create or replace function public.nexora_marcar_abono_mercadopago()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_p public.pedidos%rowtype; v_metodo jsonb;
begin
  if tg_op='INSERT' then
    if new.proveedor is not null or new.proveedor_order_id is not null or new.proveedor_payment_id is not null then
      raise exception 'El proveedor del pago se asigna desde la integración segura.';
    end if;
    select * into v_p from public.pedidos where id=new.pedido_id;
    if not found then raise exception 'No existe el pedido del pago.'; end if;
    if v_p.datos->>'pagoId'='mercadopago' then
      select m.value into v_metodo
      from public.ajustes a, lateral jsonb_array_elements(a.valor->'metodos') as m(value)
      where a.clave='config' and m.value->>'id'='mercadopago'
        and m.value->>'gateway'='mercadopago'
        and lower(coalesce(m.value->>'activo','true'))<>'false'
      limit 1;
      if v_metodo is null then raise exception 'Mercado Pago no está activo y configurado para este pedido.'; end if;
      new.proveedor:='mercadopago';
      new.referencia:='NEXORA_MP_PENDING';
      new.comprobante:='';
    elsif new.referencia='NEXORA_MP_PENDING' then
      raise exception 'La referencia está reservada para el checkout automático.';
    end if;
    return new;
  end if;

  if (new.proveedor is distinct from old.proveedor
      or new.proveedor_order_id is distinct from old.proveedor_order_id
      or new.proveedor_payment_id is distinct from old.proveedor_payment_id
      or (old.proveedor='mercadopago' and new.estado='verificado' and old.estado is distinct from new.estado))
     and current_setting('nexora.mercadopago_rpc',true) is distinct from 'on' then
    raise exception 'Los pagos de Mercado Pago solo se confirman mediante la notificación segura.';
  end if;
  return new;
end $$;
revoke all on function public.nexora_marcar_abono_mercadopago() from public,anon,authenticated;
drop trigger if exists a_nexora_marcar_abono_mercadopago on public.pagos_abonos;
create trigger a_nexora_marcar_abono_mercadopago
  before insert or update on public.pagos_abonos
  for each row execute function public.nexora_marcar_abono_mercadopago();

-- El cliente autenticado solo obtiene el total server-side de sus pedidos.
create or replace function public.nexora_mercadopago_checkout(p_pedido_id text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_p public.pedidos%rowtype; v_email text; v_a public.pagos_abonos%rowtype;
begin
  if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' then
    raise exception 'Inicia sesión para pagar este pedido.';
  end if;
  if p_pedido_id is null or p_pedido_id !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'Pedido inválido.'; end if;
  select p.* into v_p from public.pedidos p
    join public.pedido_propietarios po on po.pedido_id=p.id
    where p.id=p_pedido_id and po.user_id=auth.uid();
  if not found then raise exception 'No encontramos un pedido tuyo con ese número.'; end if;
  if v_p.estado<>'Pendiente' or v_p.total_validado is null or v_p.total_validado<=0
     or v_p.datos->>'pagoId'<>'mercadopago' then raise exception 'El pedido no está disponible para pagar con Mercado Pago.'; end if;
  if not exists(
    select 1 from public.ajustes a, lateral jsonb_array_elements(a.valor->'metodos') as m(value)
    where a.clave='config' and m.value->>'id'='mercadopago' and m.value->>'gateway'='mercadopago'
      and m.value->>'tipo'='link' and lower(coalesce(m.value->>'activo','true'))<>'false'
  ) then raise exception 'Mercado Pago no está activo.'; end if;
  select * into v_a from public.pagos_abonos a
    where a.pedido_id=v_p.id and a.proveedor='mercadopago' and a.referencia='NEXORA_MP_PENDING'
      and a.estado='pendiente' order by a.id desc limit 1;
  if not found then raise exception 'No existe un registro automático pendiente para este pedido.'; end if;
  select u.email into v_email from auth.users u where u.id=auth.uid();
  return jsonb_build_object('id',v_p.id,'total',v_p.total_validado,'moneda','COP','email',v_email);
end $$;
revoke all on function public.nexora_mercadopago_checkout(text) from public,anon,authenticated;
grant execute on function public.nexora_mercadopago_checkout(text) to authenticated;

-- Solo el Worker valida la orden externa que devuelve Mercado Pago.
create or replace function public.nexora_vincular_orden_mercadopago(
  p_pedido_id text,p_order_id text,p_external_reference text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_p public.pedidos%rowtype; v_a public.pagos_abonos%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'No autorizado.'; end if;
  if not public.nexora_mp_ids_validos(p_pedido_id,p_order_id,p_external_reference) then
    raise exception 'Identificadores de Mercado Pago inválidos.';
  end if;
  select * into v_p from public.pedidos where id=p_pedido_id for update;
  if not found or v_p.estado<>'Pendiente' or v_p.datos->>'pagoId'<>'mercadopago' then
    raise exception 'El pedido ya no está pendiente de pago.';
  end if;
  select * into v_a from public.pagos_abonos where pedido_id=v_p.id
    and proveedor='mercadopago' and referencia='NEXORA_MP_PENDING' for update;
  if not found or v_a.estado<>'pendiente' then raise exception 'No existe un abono automático pendiente.'; end if;
  if v_a.proveedor_order_id is not null and v_a.proveedor_order_id<>p_order_id then
    raise exception 'El pedido ya está vinculado a otra orden de Mercado Pago.';
  end if;
  perform set_config('nexora.mercadopago_rpc','on',true);
  update public.pagos_abonos set proveedor_order_id=p_order_id where id=v_a.id;
  perform set_config('nexora.mercadopago_rpc','off',true);
  return jsonb_build_object('ok',true,'pedido_id',v_p.id);
end $$;

create or replace function public.nexora_confirmar_pago_mercadopago(
  p_pedido_id text,p_order_id text,p_payment_id text,p_monto numeric,p_moneda text,p_external_reference text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_p public.pedidos%rowtype; v_a public.pagos_abonos%rowtype; v_total_pagado numeric(14,2);
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'No autorizado.'; end if;
  if not public.nexora_mp_ids_validos(p_pedido_id,p_order_id,p_external_reference)
     or p_payment_id is null or p_payment_id !~ '^[A-Za-z0-9_-]{6,100}$'
     or p_monto is null or p_moneda<>'COP' then raise exception 'Datos del pago acreditado inválidos.'; end if;
  select * into v_p from public.pedidos where id=p_pedido_id for update;
  if not found or v_p.datos->>'pagoId'<>'mercadopago' or v_p.total_validado is null
     or round(p_monto,2)<>v_p.total_validado then raise exception 'El pago no coincide con el total validado del pedido.'; end if;
  select * into v_a from public.pagos_abonos where pedido_id=v_p.id
    and proveedor='mercadopago' and proveedor_order_id=p_order_id for update;
  if not found then raise exception 'La order de Mercado Pago no está vinculada a este pedido.'; end if;
  if v_a.estado='verificado' and v_a.proveedor_payment_id=p_payment_id
     and v_p.estado in ('Pagado','Entregado') then
    return jsonb_build_object('ok',true,'reutilizado',true,'estado',v_p.estado);
  end if;
  if v_a.estado<>'pendiente' or v_p.estado<>'Pendiente' or v_a.monto<>v_p.total_validado then
    raise exception 'El pedido o el registro de pago ya fue procesado.';
  end if;
  perform set_config('nexora.mercadopago_rpc','on',true);
  update public.pagos_abonos set estado='verificado',proveedor_payment_id=p_payment_id,
      referencia=p_order_id,verificado_en=now(),nota_admin='Confirmado automáticamente por webhook firmado de Mercado Pago.'
    where id=v_a.id;
  perform set_config('nexora.mercadopago_rpc','off',true);
  select coalesce(sum(a.monto) filter(where a.estado='verificado'),0)
    -coalesce((select sum(r.monto) from public.pagos_reintegros r
      join public.pagos_abonos x on x.id=r.abono_id where x.pedido_id=v_p.id and r.estado='verificado'),0)
    into v_total_pagado from public.pagos_abonos a where a.pedido_id=v_p.id;
  if v_total_pagado<v_p.total_validado then raise exception 'El saldo verificado no cubre el total del pedido.'; end if;
  perform set_config('nexora.order_rpc','on',true);
  update public.pedidos set estado='Pagado',datos=jsonb_set(datos,'{historial}',
    coalesce(case when jsonb_typeof(datos->'historial')='array' then datos->'historial' else '[]'::jsonb end,'[]'::jsonb)
    ||jsonb_build_array(jsonb_build_object('de',v_p.estado,'a','Pagado','fecha',floor(extract(epoch from clock_timestamp())*1000)::bigint)),true)
    where id=v_p.id;
  perform set_config('nexora.order_rpc','off',true);
  perform public.nexora_registrar_actividad('abono_verificado','abono',v_a.id::text,
    jsonb_build_object('pedido_id',v_p.id,'monto',v_a.monto,'proveedor','mercadopago'));
  return jsonb_build_object('ok',true,'estado','Pagado','pedido_id',v_p.id);
end $$;

revoke all on function public.nexora_mp_ids_validos(text,text,text) from public,anon,authenticated;
revoke all on function public.nexora_vincular_orden_mercadopago(text,text,text) from public,anon,authenticated;
revoke all on function public.nexora_confirmar_pago_mercadopago(text,text,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.nexora_vincular_orden_mercadopago(text,text,text) to service_role;
grant execute on function public.nexora_confirmar_pago_mercadopago(text,text,text,numeric,text,text) to service_role;

drop function if exists public.admin_listar_pagos_pedidos();
create function public.admin_listar_pagos_pedidos()
returns table(
  id bigint,pedido_id text,monto numeric,estado text,metodo text,referencia text,
  comprobante text,nota_admin text,creado timestamptz,proveedor text,
  proveedor_order_id text,proveedor_payment_id text
)
language plpgsql stable security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  if not public.nexora_admin_permiso('view_payments') then return; end if;
  return query select a.id,a.pedido_id,a.monto,a.estado,a.metodo,a.referencia,
    a.comprobante,a.nota_admin,a.creado,a.proveedor,a.proveedor_order_id,a.proveedor_payment_id
    from public.pagos_abonos a order by a.creado desc,a.id desc;
end $$;
revoke all on function public.admin_listar_pagos_pedidos() from public,anon,authenticated;
grant execute on function public.admin_listar_pagos_pedidos() to authenticated;

notify pgrst,'reload schema';
commit;
