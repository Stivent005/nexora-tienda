-- Revisar primero las definiciones instaladas con 10_diagnostico_entregas.sql.
begin;

-- Comprueba la restricción única requerida antes de instalar el trigger.
explain (costs off)
insert into public.pedido_entregas (pedido_id, producto_id, tipo, cantidad)
select null, null, 'fisico', 1 where false
on conflict (pedido_id, producto_id) do nothing;

create or replace function public.nexora_insertar_entregas_faltantes(p_pedido_id text)
returns integer
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_estado text;
  v_items jsonb;
  v_validas boolean;
  v_creadas integer;
begin
  select p.estado, p.datos->'items' into v_estado, v_items
  from public.pedidos as p
  where p.id = p_pedido_id
  for update;

  if not found or v_estado not in ('Nuevo', 'Pendiente', 'Pagado') then
    return 0;
  end if;

  if jsonb_typeof(v_items) is distinct from 'array' then
    raise exception 'El pedido % no contiene una lista de productos para la entrega.', p_pedido_id
      using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) not between 1 and 100 then
    raise exception 'El pedido % tiene una cantidad inválida de líneas de entrega.', p_pedido_id
      using errcode = '22023';
  end if;

  with lineas as (
    select producto.id as producto_id,
           coalesce(producto.datos->>'tipo', 'fisico') as tipo,
           case when item.value->>'q' ~ '^[1-9][0-9]{0,3}$'
                then (item.value->>'q')::integer end as cantidad
    from jsonb_array_elements(v_items) as item
    left join public.productos as producto on producto.id = item.value->>'id'
  ), validacion as (
    select bool_and(producto_id is not null and tipo in ('fisico', 'virtual')
                    and cantidad is not null) as valida
    from lineas
  ), creadas as (
    insert into public.pedido_entregas (pedido_id, producto_id, tipo, cantidad)
    select p_pedido_id, linea.producto_id,
           case when linea.tipo = 'virtual' then 'digital' else 'fisico' end,
           sum(linea.cantidad)::integer
    from lineas as linea
    where (select valida from validacion)
    group by linea.producto_id, linea.tipo
    on conflict (pedido_id, producto_id) do nothing
    returning id
  )
  select valida, (select count(*)::integer from creadas) into v_validas, v_creadas
  from validacion;

  if v_validas is not true then
    raise exception 'El pedido % tiene un producto, tipo o cantidad inválidos para la entrega.', p_pedido_id
      using errcode = '22023';
  end if;

  return v_creadas;
end;
$$;

create or replace function public.nexora_generar_entregas_al_insertar()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform public.nexora_insertar_entregas_faltantes(new.id);
  return new;
end;
$$;

revoke all on function public.nexora_insertar_entregas_faltantes(text),
  public.nexora_generar_entregas_al_insertar() from public, anon, authenticated;

-- Corre después de los triggers históricos de creación del pedido.
drop trigger if exists zz_nexora_generar_entregas on public.pedidos;
create trigger zz_nexora_generar_entregas after insert on public.pedidos
  for each row execute function public.nexora_generar_entregas_al_insertar();

-- Reparación acotada al pedido de prueba, usando el ID completo de la fila.
do $$
declare
  v_pedido_id text;
  v_coincidencias integer;
  v_estado text;
  v_total jsonb;
  v_items jsonb;
  v_cantidad integer;
  v_producto_id text;
  v_productos integer;
  v_creadas integer;
begin
  select min(p.id), count(*)::integer into v_pedido_id, v_coincidencias
  from public.pedidos as p
  where upper(right(p.id, 6)) = 'EB22D8';

  if v_coincidencias <> 1 then
    raise notice 'EB22D8: se esperaba un pedido único, se encontraron %.', v_coincidencias;
    return;
  end if;

  select p.estado, to_jsonb(p)->'total_validado', p.datos->'items'
  into v_estado, v_total, v_items
  from public.pedidos as p where p.id = v_pedido_id for update;

  if v_estado is distinct from 'Pagado' or v_total is distinct from '6000'::jsonb
     or jsonb_typeof(v_items) is distinct from 'array' then
    raise notice 'EB22D8: difieren el estado, el total validado o la lista de productos.';
    return;
  end if;

  select count(distinct producto.id)::integer,
         min(producto.id),
         coalesce(sum(case when item.value->>'q' ~ '^[1-9][0-9]{0,3}$'
                           then (item.value->>'q')::integer end), 0)::integer
    into v_productos, v_producto_id, v_cantidad
  from jsonb_array_elements(v_items) as item
  join public.productos as producto on producto.id = item.value->>'id'
  where lower(btrim(coalesce(producto.datos->>'name', ''))) = 'diamantes';

  if v_productos <> 1 or v_cantidad <> 2 or not exists (
    select 1 from public.productos as p
    where p.id = v_producto_id and p.datos->>'tipo' = 'virtual'
  ) then
    raise notice 'EB22D8: difiere el producto virtual o su cantidad.';
    return;
  end if;

  begin
    v_creadas := public.nexora_insertar_entregas_faltantes(v_pedido_id);
  exception when invalid_parameter_value then
    raise notice 'EB22D8: %', sqlerrm;
    return;
  end;
  raise notice 'EB22D8: entregas nuevas registradas: %.', v_creadas;
end;
$$;

commit;
