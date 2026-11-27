-- Restaura solo el guard de estado que instala 05_seguridad_compras_pagos.sql.
-- Usar cuando las tablas ya existen, pero nexora_guardar_estado_pedido() falta.
-- Aplicar antes de 20_mercadopago_checkout.sql.
begin;

do $$
declare v_faltantes text[]:=array[]::text[];
begin
  if to_regclass('public.pedidos') is null then
    v_faltantes:=array_append(v_faltantes,'public.pedidos');
  end if;
  if to_regclass('public.pagos_abonos') is null then
    v_faltantes:=array_append(v_faltantes,'public.pagos_abonos');
  end if;
  if to_regclass('public.pagos_reintegros') is null then
    v_faltantes:=array_append(v_faltantes,'public.pagos_reintegros');
  end if;
  if to_regclass('public.pedido_entregas') is null then
    v_faltantes:=array_append(v_faltantes,'public.pedido_entregas');
  end if;
  if to_regclass('public.cupones_ruleta') is null then
    v_faltantes:=array_append(v_faltantes,'public.cupones_ruleta');
  end if;
  if to_regclass('public.inventario_movimientos') is null then
    v_faltantes:=array_append(v_faltantes,'public.inventario_movimientos');
  end if;
  if to_regclass('public.productos') is null then
    v_faltantes:=array_append(v_faltantes,'public.productos');
  end if;
  if to_regprocedure('public.nexora_aplicar_inventario(text,jsonb,text)') is null then
    v_faltantes:=array_append(v_faltantes,'public.nexora_aplicar_inventario(text,jsonb,text) de la migración 05');
  end if;
  if cardinality(v_faltantes)>0 then
    raise exception 'NEXORA: no se reparó el estado del pedido. Primero completa la migración 05; faltan: %.',
      array_to_string(v_faltantes,', ');
  end if;
end $$;

-- Columnas que 05 necesita para comprobar pagos y cancelaciones históricas.
alter table public.pedidos add column if not exists total_validado numeric(14,2);
alter table public.pedidos add column if not exists precio_validado_en timestamptz;
alter table public.pedidos add column if not exists version_precios smallint;

create or replace function public.nexora_guardar_estado_pedido()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_verificado numeric(14,2); v_reintegrado numeric(14,2); v_total numeric(14,2); v_estado_anterior text:=old.estado;
begin
  if new.estado is not distinct from old.estado then return new; end if;
  if current_setting('nexora.order_rpc',true) is distinct from 'on' then
    raise exception 'Los estados de pedido solo se modifican mediante las funciones administrativas seguras.';
  end if;

  if new.estado='Pagado' then
    if v_estado_anterior not in ('Pendiente','Nuevo') then raise exception 'Transición de pago inválida.'; end if;
    if old.total_validado is null then raise exception 'Este pedido anterior necesita validación manual del total.'; end if;
    select
      coalesce((select sum(a.monto) from public.pagos_abonos a
        where a.pedido_id=old.id and a.estado='verificado'),0)
        -coalesce((select sum(r.monto) from public.pagos_reintegros r
          join public.pagos_abonos a on a.id=r.abono_id
          where a.pedido_id=old.id and r.estado='verificado'),0)
      into v_verificado;
    v_total:=old.total_validado;
    if v_verificado<v_total then raise exception 'Saldo pendiente: el pedido no se puede marcar pagado.'; end if;
    if old.datos#>>'{_nexora,fuente_cupon}'='ruleta' and coalesce(old.datos->>'cupon','')<>'' and not exists (
      select 1 from public.cupones_ruleta c where c.codigo=upper(old.datos->>'cupon')
        and not c.usado and c.reservado_pedido_id=old.id and c.vence>now()
    ) then raise exception 'El cupón no está reservado para este pedido.'; end if;
    perform public.nexora_aplicar_inventario(old.id,old.datos,'venta');
  elsif new.estado='Entregado' then
    if v_estado_anterior<>'Pagado' then raise exception 'Solo se entrega un pedido completamente pagado.'; end if;
    if not exists (select 1 from public.pedido_entregas d where d.pedido_id=old.id)
       or exists (select 1 from public.pedido_entregas d where d.pedido_id=old.id and d.estado<>'entregado') then
      raise exception 'Registra la entrega de todos los productos antes de cerrar el pedido.';
    end if;
  elsif new.estado='Cancelado' then
    if v_estado_anterior not in ('Pendiente','Nuevo','Pagado') then raise exception 'Transición de cancelación inválida.'; end if;
    select
      coalesce((select sum(a.monto) from public.pagos_abonos a
        where a.pedido_id=old.id and a.estado='verificado'),0),
      coalesce((select sum(r.monto) from public.pagos_reintegros r
        join public.pagos_abonos a on a.id=r.abono_id
        where a.pedido_id=old.id and r.estado='verificado'),0)
      into v_verificado,v_reintegrado;
    if v_verificado>v_reintegrado then
      raise exception 'Registra y verifica los reintegros antes de cancelar un pedido con abonos confirmados.';
    end if;
    if exists (select 1 from public.pagos_reintegros r join public.pagos_abonos a on a.id=r.abono_id
      where a.pedido_id=old.id and r.estado='pendiente') then
      raise exception 'Hay un reintegro pendiente de revisión para este pedido.';
    end if;
    if exists (select 1 from public.pedido_entregas d where d.pedido_id=old.id and d.estado in ('en_camino','entregado')) then
      raise exception 'No se puede cancelar: hay productos enviados o entregados.';
    end if;
    if v_estado_anterior='Pagado' then
      if old.version_precios is distinct from 1 then
        raise exception 'Revisa primero el total y el inventario de este pedido histórico.';
      end if;
      perform public.nexora_aplicar_inventario(old.id,old.datos,'devolucion_cancelacion');
    end if;
  else
    raise exception 'Estado de pedido no permitido.';
  end if;
  return new;
end $$;

revoke all on function public.nexora_guardar_estado_pedido() from public,anon,authenticated;
drop trigger if exists a_nexora_guardar_estado on public.pedidos;
create trigger a_nexora_guardar_estado before update of estado on public.pedidos
  for each row execute function public.nexora_guardar_estado_pedido();

notify pgrst,'reload schema';
commit;

-- Verificar:
-- select to_regprocedure('public.nexora_guardar_estado_pedido()');
-- select tgname from pg_trigger where tgrelid='public.pedidos'::regclass
--   and not tgisinternal and tgname='a_nexora_guardar_estado';
