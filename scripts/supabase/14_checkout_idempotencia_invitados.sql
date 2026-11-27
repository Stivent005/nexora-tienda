-- Mantiene el checkout seguro habilitado para invitados tras la migración 07.
-- Los invitados usan claves UUID únicas sin fila de idempotencia; las cuentas
-- conservan deduplicación ligada a auth.uid() y asociación de pedidos.
begin;

-- La RPC depende de esta huella para reintentos de cuentas autenticadas.
-- Se declara aquí también para que la migración sea autocontenida.
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
  if coalesce(auth.role(),'') not in ('anon','authenticated') then
    raise exception 'Sesion no permitida.';
  end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then
    raise exception 'Datos de pedido invalidos.';
  end if;

  v_clave:=btrim(coalesce(p_datos->>'idempotencyKey',p_datos->>'id',''));
  if v_clave !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Falta una clave de idempotencia valida.';
  end if;

  if v_user_id is not null and coalesce(auth.role(),'')='authenticated' then
    v_huella:=public.nexora_huella_pedido(p_datos);
    insert into public.pedido_idempotencia(user_id,clave,huella)
      values(v_user_id,v_clave,v_huella) on conflict(user_id,clave) do nothing;
    select huella,pedido_id into v_huella_existente,v_pedido_existente
      from public.pedido_idempotencia where user_id=v_user_id and clave=v_clave for update;
    if v_huella_existente<>v_huella then
      raise exception 'La referencia de checkout ya se uso con otros datos. Vuelve a iniciar el pedido.';
    end if;
    if v_pedido_existente is not null then
      select * into v_p from public.pedidos where id=v_pedido_existente;
      if not found then raise exception 'No se encontro el pedido asociado a esta referencia.'; end if;
      return jsonb_build_object('ok',true,'reutilizado',true,'id',v_p.id,'estado',v_p.estado,
        'total',v_p.total_validado,'subtotal',v_p.datos->'subtotal',
        'descuento',v_p.datos->'descuento','cupon',v_p.datos->'cupon',
        'items',v_p.datos->'items','creado',v_p.creado);
    end if;
  end if;

  perform set_config('nexora.checkout_cliente','on',true);
  insert into public.pedidos(id,estado,datos)
    values(v_id,'Pendiente',p_datos-'desc'-'idempotencyKey') returning * into v_p;

  if v_user_id is not null and coalesce(auth.role(),'')='authenticated' then
    insert into public.pedido_propietarios(pedido_id,user_id) values(v_p.id,v_user_id);
    update public.pedido_idempotencia set pedido_id=v_p.id where user_id=v_user_id and clave=v_clave;
  end if;

  return jsonb_build_object('ok',true,'id',v_p.id,'estado',v_p.estado,
    'total',v_p.total_validado,'subtotal',v_p.datos->'subtotal',
    'descuento',v_p.datos->'descuento','cupon',v_p.datos->'cupon',
    'items',v_p.datos->'items','creado',v_p.creado);
end $$;
revoke all on function public.crear_pedido_seguro(jsonb) from public,anon,authenticated;
grant execute on function public.crear_pedido_seguro(jsonb) to anon,authenticated;
notify pgrst,'reload schema';

commit;
