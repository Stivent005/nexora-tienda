-- La migracion 15 reinstalo la validacion de pedidos seguros; la tabla remota
-- conserva la estructura legacy y carece de las columnas escritas por el trigger.
begin;

do $$
begin
  if to_regclass('public.pedidos') is null then
    raise exception 'NEXORA: falta public.pedidos; no se aplico la reparacion.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='pedidos'
      and column_name='datos' and data_type='jsonb'
  ) then
    raise exception 'NEXORA: public.pedidos no tiene datos jsonb; se detuvo sin cambios.';
  end if;
  if to_regprocedure('public.nexora_calcular_pedido(jsonb)') is null then
    raise exception 'NEXORA: falta public.nexora_calcular_pedido(jsonb); ejecuta primero la migracion 15.';
  end if;
end $$;

-- Los valores se calculan desde el catalogo del servidor y se escriben antes
-- del INSERT. Los pedidos antiguos conservan NULL para validacion manual.
alter table public.pedidos add column if not exists total_validado numeric(14,2);
alter table public.pedidos add column if not exists precio_validado_en timestamptz;
alter table public.pedidos add column if not exists version_precios smallint;

create or replace function public.nexora_validar_pedido_insert()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  new.datos:=public.nexora_calcular_pedido(new.datos);
  new.total_validado:=(new.datos->>'total')::numeric;
  new.precio_validado_en:=clock_timestamp();
  new.version_precios:=1;
  return new;
end $$;
revoke all on function public.nexora_validar_pedido_insert() from public,anon,authenticated;

drop trigger if exists a_nexora_validar_pedido on public.pedidos;
create trigger a_nexora_validar_pedido before insert on public.pedidos
  for each row execute function public.nexora_validar_pedido_insert();

notify pgrst,'reload schema';
commit;
