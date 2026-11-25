-- Repara la firma RPC de entregas que PostgREST no encuentra.
-- Reutiliza la lógica vigente de 05_seguridad_compras_pagos.sql sin cambiarla.
begin;

-- Completa columnas auxiliares que faltan en tablas de entregas heredadas.
alter table public.pedido_entregas
  add column if not exists datos_entrega jsonb not null default '{}'::jsonb;
alter table public.pedido_entregas
  add column if not exists actualizado_por uuid references auth.users(id) on delete set null;
alter table public.pedido_entregas
  add column if not exists creado timestamptz not null default now();
alter table public.pedido_entregas
  add column if not exists actualizado timestamptz not null default now();

-- Quita firmas antiguas para que la RPC no tenga overloads ambiguos.
drop function if exists public.admin_actualizar_entrega(bigint, text);
drop function if exists public.admin_actualizar_entrega(bigint, text, jsonb);

create function public.admin_actualizar_entrega(
  p_entrega_id bigint,
  p_estado text,
  p_datos_entrega jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_d public.pedido_entregas%rowtype;
  v_p public.pedidos%rowtype;
  v_confirmacion text;
begin
  if not public.nexora_admin_permiso('manage_deliveries') then
    return jsonb_build_object('error', 'No autorizado.');
  end if;
  if p_estado is null or p_estado not in ('preparacion', 'en_camino', 'entregado', 'fallo')
     or jsonb_typeof(coalesce(p_datos_entrega, '{}'::jsonb)) is distinct from 'object'
     or octet_length(coalesce(p_datos_entrega, '{}'::jsonb)::text) > 16000 then
    return jsonb_build_object('error', 'Datos o estado de entrega inválidos.');
  end if;

  select * into v_d from public.pedido_entregas where id = p_entrega_id for update;
  if not found then return jsonb_build_object('error', 'Entrega no encontrada.'); end if;
  select * into v_p from public.pedidos where id = v_d.pedido_id for update;
  if not found then return jsonb_build_object('error', 'Pedido no encontrado.'); end if;
  if v_p.estado not in ('Pagado', 'Entregado') then
    return jsonb_build_object('error', 'No se entrega ningún producto antes de cubrir el saldo del pedido.');
  end if;
  -- Algunas bases aún tienen el esquema anterior, sin la columna opcional
  -- total_validado. Usa el total validado cuando exista y, si no, el total
  -- que guarda el pedido en datos. Evita acceder directamente al campo ausente.
  if coalesce(
       nullif(to_jsonb(v_p)->>'total_validado', ''),
       nullif(v_p.datos->>'total', '')
     ) is null then
    return jsonb_build_object('error', 'Reconcilia primero el total del pedido histórico.');
  end if;
  if exists (
    select 1 from public.pagos_reintegros r
    join public.pagos_abonos a on a.id = r.abono_id
    where a.pedido_id = v_p.id and r.estado = 'pendiente'
  ) then
    return jsonb_build_object('error', 'El pedido tiene reintegros pendientes; completa su conciliación antes de entregar.');
  end if;
  if v_d.estado in ('cancelado', 'entregado') then
    return jsonb_build_object('error', 'La entrega ya está cerrada.');
  end if;

  v_confirmacion := btrim(coalesce(p_datos_entrega->>'confirmacion', ''));
  if p_estado = 'entregado' and v_d.tipo = 'digital' and char_length(v_confirmacion) < 3 then
    return jsonb_build_object('error', 'Registra la confirmación o referencia de entrega digital.');
  end if;

  update public.pedido_entregas
  set estado = p_estado,
      datos_entrega = coalesce(p_datos_entrega, '{}'::jsonb),
      actualizado = now(),
      actualizado_por = auth.uid()
  where id = p_entrega_id;

  perform public.nexora_registrar_actividad(
    'entrega_actualizada', 'entrega', p_entrega_id::text,
    jsonb_build_object('pedido_id', v_d.pedido_id, 'tipo', v_d.tipo, 'estado', p_estado)
  );

  if p_estado = 'entregado'
     and not exists (
       select 1 from public.pedido_entregas d
       where d.pedido_id = v_p.id and d.estado <> 'entregado'
     )
     and v_p.estado = 'Pagado' then
    perform set_config('nexora.order_rpc', 'on', true);
    update public.pedidos
    set estado = 'Entregado',
        datos = jsonb_set(
          datos, '{historial}',
          coalesce(
            case when jsonb_typeof(datos->'historial') = 'array' then datos->'historial' else '[]'::jsonb end,
            '[]'::jsonb
          ) || jsonb_build_array(jsonb_build_object(
            'de', 'Pagado', 'a', 'Entregado',
            'fecha', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          )),
          true
        )
    where id = v_p.id;
    perform set_config('nexora.order_rpc', 'off', true);
  end if;

  return jsonb_build_object('ok', true, 'estado', p_estado);
end
$$;

revoke all on function public.admin_actualizar_entrega(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_actualizar_entrega(bigint, text, jsonb) to authenticated;
notify pgrst, 'reload schema';

commit;
