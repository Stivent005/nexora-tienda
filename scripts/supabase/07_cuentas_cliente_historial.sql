-- NEXORA - cuentas cliente, historial privado y pedidos ligados al titular.
-- Dependencia: 05_seguridad_compras_pagos.sql aplicado y verificado en staging.
-- No ejecutar hasta confirmar que el proyecto remoto usa la linea de esquema 02 + 05.

begin;

do $$
begin
  if to_regclass('public.pedidos') is null
     or to_regprocedure('public.nexora_calcular_pedido(jsonb)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='pedidos' and column_name='total_validado'
     ) then
    raise exception 'NEXORA: falta el esquema seguro de pedidos de la migracion 05. No se aplicaron cambios.';
  end if;
end $$;

create table if not exists public.pedido_propietarios (
  pedido_id text primary key references public.pedidos(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  creado timestamptz not null default now()
);

create index if not exists pedido_propietarios_usuario_fecha_idx
  on public.pedido_propietarios(user_id,creado desc);

create table if not exists public.pedido_idempotencia (
  user_id uuid not null references auth.users(id) on delete restrict,
  clave text not null check (clave ~ '^[A-Za-z0-9_-]{8,80}$'),
  huella text not null check (huella ~ '^[0-9a-f]{32}$'),
  pedido_id text references public.pedidos(id) on delete restrict,
  creado timestamptz not null default now(),
  primary key(user_id,clave)
);
alter table public.pedido_idempotencia enable row level security;
revoke all on public.pedido_idempotencia from public,anon,authenticated;

create or replace function public.nexora_huella_pedido(p_datos jsonb)
returns text
language plpgsql immutable
set search_path = pg_catalog
as $$
declare v_datos jsonb; v_items jsonb;
begin
  v_datos:=coalesce(p_datos,'{}'::jsonb)-'id'-'fecha'-'historial';
  if jsonb_typeof(v_datos->'items')='array' then
    select coalesce(jsonb_agg(i.value-'lineId' order by i.value->>'id'),'[]'::jsonb)
      into v_items from jsonb_array_elements(v_datos->'items') as i(value);
    v_datos:=jsonb_set(v_datos,'{items}',v_items,true);
  end if;
  return md5(v_datos::text);
end $$;
revoke all on function public.nexora_huella_pedido(jsonb) from public,anon,authenticated;

alter table public.pedido_propietarios enable row level security;
revoke all on public.pedido_propietarios from public,anon,authenticated;
grant select on public.pedido_propietarios to authenticated;
drop policy if exists nexora_cliente_lee_sus_pedidos on public.pedido_propietarios;
create policy nexora_cliente_lee_sus_pedidos on public.pedido_propietarios
  for select to authenticated using (user_id=auth.uid());

-- Una cuenta solo recibe pedidos creados desde el checkout autenticado.
-- Los pedidos ingresados manualmente desde el panel no se atribuyen al admin.
create or replace function public.crear_pedido_seguro(p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_id text:=replace(gen_random_uuid()::text,'-','');
  v_p public.pedidos%rowtype;
  v_user_id uuid:=auth.uid();
  v_clave text;
  v_huella text;
  v_huella_existente text;
  v_pedido_existente text;
begin
  if v_user_id is null or coalesce(auth.role(),'')<>'authenticated' then
    raise exception 'Inicia sesion para crear un pedido.';
  end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then
    raise exception 'Datos de pedido invalidos.';
  end if;

  v_clave:=btrim(coalesce(p_datos->>'id',''));
  if v_clave !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'No se pudo validar la referencia segura del pedido.'; end if;
  v_huella:=public.nexora_huella_pedido(p_datos);
  insert into public.pedido_idempotencia(user_id,clave,huella)
    values(v_user_id,v_clave,v_huella) on conflict(user_id,clave) do nothing;
  select huella,pedido_id into v_huella_existente,v_pedido_existente
    from public.pedido_idempotencia where user_id=v_user_id and clave=v_clave for update;
  if v_huella_existente<>v_huella then raise exception 'La referencia de checkout ya se uso con otros datos. Vuelve a iniciar el pedido.'; end if;
  if v_pedido_existente is not null then
    select * into v_p from public.pedidos where id=v_pedido_existente;
    if not found then raise exception 'No se encontro el pedido asociado a esta referencia.'; end if;
    return jsonb_build_object('ok',true,'reutilizado',true,'id',v_p.id,'estado',v_p.estado,
      'total',v_p.total_validado,'subtotal',v_p.datos->'subtotal',
      'descuento',v_p.datos->'descuento','cupon',v_p.datos->'cupon',
      'items',v_p.datos->'items','creado',v_p.creado);
  end if;

  perform set_config('nexora.checkout_cliente','on',true);
  insert into public.pedidos(id,estado,datos)
    values(v_id,'Pendiente',p_datos-'desc') returning * into v_p;

  insert into public.pedido_propietarios(pedido_id,user_id)
    values(v_p.id,v_user_id);
  update public.pedido_idempotencia set pedido_id=v_p.id where user_id=v_user_id and clave=v_clave;

  return jsonb_build_object('ok',true,'id',v_p.id,'estado',v_p.estado,
    'total',v_p.total_validado,'subtotal',v_p.datos->'subtotal',
    'descuento',v_p.datos->'descuento','cupon',v_p.datos->'cupon',
    'items',v_p.datos->'items','creado',v_p.creado);
end $$;
revoke all on function public.crear_pedido_seguro(jsonb) from public,anon,authenticated;
grant execute on function public.crear_pedido_seguro(jsonb) to authenticated;

-- El cliente nunca lee pedidos directamente. Esta RPC devuelve solo los suyos
-- y omite la evidencia de pago y la referencia bancaria del recibo.
create or replace function public.mis_pedidos()
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' then
    raise exception 'Inicia sesion para consultar tus pedidos.';
  end if;

  select coalesce(jsonb_agg(q.item order by q.creado desc),'[]'::jsonb)
    into v_result
  from (
    select p.creado,
      jsonb_build_object(
        'id',p.id,
        'creado',p.creado,
        'estado',p.estado,
        'datos',p.datos-'comprobante'-'referencia'-'historial'
      ) as item
    from public.pedidos p
    join public.pedido_propietarios po on po.pedido_id=p.id
    where po.user_id=auth.uid()
    order by p.creado desc
    limit 200
  ) q;
  return coalesce(v_result,'[]'::jsonb);
end $$;
revoke all on function public.mis_pedidos() from public,anon,authenticated;
grant execute on function public.mis_pedidos() to authenticated;

-- Cierra las rutas anonimas heredadas; el checkout seguro ejecuta como definer.
drop policy if exists nexora_pedidos_anon_insert on public.pedidos;
drop policy if exists "clientes crean pedidos" on public.pedidos;
revoke insert on public.pedidos from anon;

notify pgrst,'reload schema';
commit;
