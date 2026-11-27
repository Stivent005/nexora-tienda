begin;

create function public.admin_listar_entregas_pedidos()
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if public.nexora_admin_permiso('manage_orders') is not true then
    raise exception 'No autorizado.';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', entrega.id,
      'pedido_id', entrega.pedido_id,
      'producto_id', entrega.producto_id,
      'tipo', entrega.tipo,
      'cantidad', entrega.cantidad,
      'estado', entrega.estado,
      'datos_entrega', entrega.datos_entrega
    ) order by entrega.id), '[]'::jsonb)
    from public.pedido_entregas as entrega
  );
end;
$$;

revoke all on function public.admin_listar_entregas_pedidos() from public, anon, authenticated;
grant execute on function public.admin_listar_entregas_pedidos() to authenticated;
notify pgrst, 'reload schema';

commit;
