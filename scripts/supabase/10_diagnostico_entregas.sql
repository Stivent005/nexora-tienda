-- Consultas de solo lectura para el editor SQL de la base de NEXORA.
select t.tgname as trigger, t.tgenabled as habilitado,
       pg_get_triggerdef(t.oid) as definicion,
       pg_get_functiondef(t.tgfoid) as funcion
from pg_catalog.pg_trigger as t
where t.tgrelid = 'public.pedidos'::regclass and not t.tgisinternal
order by t.tgname;

select p.proname as funcion, pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_functiondef(p.oid) as definicion
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and p.proname in ('crear_pedido_seguro', 'admin_listar_entregas_pedidos', 'admin_actualizar_entrega')
order by p.proname, argumentos;

select policyname, roles, cmd, qual
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'pedido_entregas';

select pedido.id as pedido_id, pedido.estado as estado_pedido,
       to_jsonb(pedido)->>'total_validado' as total_validado,
       pedido.datos->>'total' as total_pedido, pedido.datos->>'pago' as metodo,
       item.value->>'id' as producto_id, item.value->>'n' as producto,
       item.value->>'q' as cantidad_pedido, item.value->'v' as virtual_en_pedido,
       producto.datos->>'tipo' as tipo_catalogo,
       entrega.id as entrega_id, entrega.tipo as tipo_entrega,
       entrega.cantidad as cantidad_entrega, entrega.estado as estado_entrega
from public.pedidos as pedido
left join lateral jsonb_array_elements(
  case when jsonb_typeof(pedido.datos->'items') = 'array' then pedido.datos->'items' else '[]'::jsonb end
) as item on true
left join public.productos as producto on producto.id = item.value->>'id'
left join public.pedido_entregas as entrega
  on entrega.pedido_id = pedido.id and entrega.producto_id = producto.id
where upper(right(pedido.id, 6)) = 'EB22D8'
order by pedido.id, producto.id;
