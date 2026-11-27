-- Repara las dependencias de checkout seguro si la migración 07 quedó incompleta.
begin;

do $$
declare
  v_faltantes text[]:=array[]::text[];
begin
  if to_regclass('public.pedidos') is null then
    v_faltantes:=array_append(v_faltantes,'tabla public.pedidos');
  end if;
  if to_regclass('auth.users') is null then
    v_faltantes:=array_append(v_faltantes,'tabla auth.users');
  end if;
  if to_regclass('public.productos') is null then
    v_faltantes:=array_append(v_faltantes,'tabla public.productos');
  end if;
  if to_regclass('public.ajustes') is null then
    v_faltantes:=array_append(v_faltantes,'tabla public.ajustes');
  end if;
  if to_regclass('public.cupones_ruleta') is null then
    v_faltantes:=array_append(v_faltantes,'tabla public.cupones_ruleta');
  end if;
  if cardinality(v_faltantes)>0 then
    raise exception 'NEXORA: faltan dependencias base: %. No se aplico ningun cambio.',array_to_string(v_faltantes,', ');
  end if;
end $$;

-- Estas columnas son parte del esquema de precios seguros de la migracion 05.
-- La tabla legacy de schema.sql solo contiene id, creado, estado, datos e ip.
alter table public.pedidos add column if not exists total_validado numeric(14,2);
alter table public.pedidos add column if not exists precio_validado_en timestamptz;
alter table public.pedidos add column if not exists version_precios smallint;

create or replace function public.nexora_calcular_pedido(p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_datos jsonb:=p_datos; v_linea jsonb; v_items jsonb:='[]'::jsonb;
  v_producto jsonb; v_activo boolean; v_id text; v_nombre text;
  v_cantidad integer; v_tipo text; v_digital boolean; v_ilimitado boolean;
  v_digital_fields jsonb; v_digital_data jsonb; v_digital_field jsonb; v_digital_key text;
  v_digital_value text; v_digital_validation text; v_digital_max integer;
  v_player_id text; v_display_name text; v_checkout_cliente boolean:=coalesce(current_setting('nexora.checkout_cliente',true),'off')='on';
  v_hay_fisico boolean:=false; v_hay_digital boolean:=false; v_address jsonb; v_delivery text;
  v_methods jsonb; v_payment jsonb; v_payment_type text;
  v_base numeric; v_oferta numeric; v_precio numeric; v_subtotal numeric:=0;
  v_descuento numeric:=0; v_total numeric; v_codigo text; v_cupon record;
  v_conf jsonb; v_tipo_cupon text; v_valor_cupon numeric; v_fuente_cupon text; v_cupones_count integer;
  v_fecha_ms bigint;
begin
  if jsonb_typeof(v_datos) is distinct from 'object'
     or jsonb_typeof(v_datos->'items') is distinct from 'array'
     or jsonb_array_length(v_datos->'items') not between 1 and 100 then
    raise exception 'Pedido inválido: productos.';
  end if;

  for v_linea in
    select e.value from jsonb_array_elements(v_datos->'items') as e(value)
    order by e.value->>'id'
  loop
    v_id:=coalesce(v_linea->>'id','');
    if v_id !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'Producto inválido en el pedido.'; end if;
    begin v_cantidad:=(v_linea->>'q')::integer;
    exception when others then raise exception 'Cantidad inválida en el pedido.'; end;
    if v_cantidad not between 1 and 9999 then raise exception 'Cantidad fuera de rango.'; end if;

    select p.datos,p.activo into v_producto,v_activo
      from public.productos p where p.id=v_id for share;
    if not found or not v_activo then raise exception 'Un producto ya no está disponible.'; end if;
    v_nombre:=btrim(coalesce(v_producto->>'name',''));
    if char_length(v_nombre) not between 1 and 80 then raise exception 'El catálogo tiene un producto sin nombre válido.'; end if;
    v_tipo:=coalesce(v_producto->>'tipo','fisico');
    if v_tipo not in ('fisico','virtual') then raise exception 'Tipo de producto inválido en el catálogo.'; end if;
    v_digital:=v_tipo='virtual';
    v_hay_digital:=v_hay_digital or v_digital;
    v_hay_fisico:=v_hay_fisico or not v_digital;
    v_digital_fields:='[]'::jsonb; v_digital_data:='{}'::jsonb;
    if v_digital then
      v_digital_fields:=v_producto->'digital'->'fields';
      if jsonb_typeof(v_digital_fields) is distinct from 'array' then
        v_digital_fields:=jsonb_build_array(
          jsonb_build_object('key','playerId','label','ID del jugador o cuenta','required',true,'validation',coalesce(v_producto->'digital'->>'playerIdValidation','text'),'maxLength',80),
          jsonb_build_object('key','displayName','label',coalesce(v_producto->'digital'->>'displayNameLabel','Nombre visible de la cuenta'),'required',true,'validation','text','maxLength',80)
        );
      elsif jsonb_array_length(v_digital_fields)=0 then
        v_digital_fields:=jsonb_build_array(
          jsonb_build_object('key','playerId','label','ID del jugador o cuenta','required',true,'validation',coalesce(v_producto->'digital'->>'playerIdValidation','text'),'maxLength',80),
          jsonb_build_object('key','displayName','label',coalesce(v_producto->'digital'->>'displayNameLabel','Nombre visible de la cuenta'),'required',true,'validation','text','maxLength',80)
        );
      end if;
      if not exists(select 1 from jsonb_array_elements(v_digital_fields) as f(value) where f.value->>'key'='playerId') then
        v_digital_fields:=v_digital_fields||jsonb_build_array(jsonb_build_object('key','playerId','label','ID del jugador o cuenta','required',true,'validation',coalesce(v_producto->'digital'->>'playerIdValidation','text'),'maxLength',80));
      end if;
      if not exists(select 1 from jsonb_array_elements(v_digital_fields) as f(value) where f.value->>'key'='displayName') then
        v_digital_fields:=v_digital_fields||jsonb_build_array(jsonb_build_object('key','displayName','label',coalesce(v_producto->'digital'->>'displayNameLabel','Nombre visible de la cuenta'),'required',true,'validation','text','maxLength',80));
      end if;
      select jsonb_agg(case when f.value->>'key' in ('playerId','displayName') then f.value||jsonb_build_object('required',true) else f.value end order by f.ord)
        into v_digital_fields
      from jsonb_array_elements(v_digital_fields) with ordinality as f(value,ord);
      if jsonb_typeof(v_linea->'digitalData')='object' then
        for v_digital_field in select f.value from jsonb_array_elements(v_digital_fields) as f(value)
        loop
          v_digital_key:=coalesce(v_digital_field->>'key','');
          if v_digital_key not in ('playerId','displayName','region','server') then continue; end if;
          begin v_digital_max:=greatest(1,least(120,coalesce(nullif(v_digital_field->>'maxLength','')::integer,80)));
          exception when others then v_digital_max:=80; end;
          v_digital_value:=btrim(coalesce(v_linea->'digitalData'->>v_digital_key,''));
          v_digital_validation:=coalesce(v_digital_field->>'validation','text');
          if char_length(v_digital_value)>v_digital_max then raise exception 'Los datos de la cuenta digital superan el limite permitido.'; end if;
          if coalesce(lower(v_digital_field->>'required'),'true')<>'false' and v_digital_value='' then
            raise exception 'Completa el ID y el nombre de la cuenta digital.';
          end if;
          if v_digital_value<>'' and v_digital_validation='digits' and v_digital_value !~ '^[0-9]+$' then raise exception 'El ID digital solo debe contener numeros.'; end if;
          if v_digital_value<>'' and v_digital_validation='digits_6_15' and v_digital_value !~ '^[0-9]{6,15}$' then raise exception 'El ID digital debe tener entre 6 y 15 numeros.'; end if;
          if v_digital_value<>'' and v_digital_validation='alphanumeric' and v_digital_value !~ '^[A-Za-z0-9_-]+$' then raise exception 'El formato del ID digital no es valido.'; end if;
          if v_digital_value<>'' then v_digital_data:=v_digital_data||jsonb_build_object(v_digital_key,v_digital_value); end if;
        end loop;
      elsif v_checkout_cliente then
        raise exception 'Completa el ID y el nombre de la cuenta digital.';
      end if;
      if v_checkout_cliente then
        v_player_id:=btrim(coalesce(v_linea->'digitalData'->>'playerId',''));
        v_display_name:=btrim(coalesce(v_linea->'digitalData'->>'displayName',''));
        if v_player_id='' or v_display_name='' then raise exception 'Completa el ID y el nombre de la cuenta digital.'; end if;
        if char_length(v_player_id)>80 or char_length(v_display_name)>80 then raise exception 'El ID o nombre de la cuenta supera el limite permitido.'; end if;
        v_digital_data:=v_digital_data||jsonb_build_object('playerId',v_player_id,'displayName',v_display_name);
      end if;
    end if;
    v_ilimitado:=v_digital and coalesce((v_producto->>'ilimitado')::boolean,false);
    begin v_base:=nullif(v_producto->>'price','')::numeric;
    exception when others then raise exception 'Precio inválido en el catálogo.'; end;
    if v_base is null or v_base<0 or v_base>9999999999 then raise exception 'Precio de catálogo fuera de rango.'; end if;
    v_precio:=v_base;
    if coalesce((v_producto->>'offer')::boolean,false) then
      begin v_oferta:=nullif(v_producto->>'offerPrice','')::numeric;
      exception when others then v_oferta:=null; end;
      if v_oferta>0 and v_oferta<v_base then v_precio:=v_oferta; end if;
    end if;
    v_precio:=round(v_precio,2);
    v_subtotal:=v_subtotal+(v_precio*v_cantidad);
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'id',v_id,'n',v_nombre,'q',v_cantidad,'pr',v_precio,'v',v_digital,
      'ilimitado',v_ilimitado,'puntos',null,
      'digitalFields',case when v_digital then v_digital_fields else '[]'::jsonb end,
      'digitalData',case when v_digital then v_digital_data else '{}'::jsonb end
    ));
  end loop;
  if v_checkout_cliente then
    if v_hay_fisico then
      v_address:=v_datos->'direccion';
      v_delivery:=coalesce(v_address->>'method',case when btrim(coalesce(v_datos->>'punto',''))<>'' then 'pickup' else 'home' end);
      if v_delivery='pickup' then
        if char_length(btrim(coalesce(v_address->>'pickupPoint',v_datos->>'punto','')))<2 then raise exception 'Indica el punto de recogida.'; end if;
      elsif v_delivery='home' then
        if char_length(btrim(coalesce(v_address->>'street',v_datos->>'dir','')))<4
           or char_length(btrim(coalesce(v_address->>'city','')))<2
           or char_length(btrim(coalesce(v_address->>'department','')))<2 then
          raise exception 'Completa direccion, ciudad y departamento para el envio.';
        end if;
      else
        raise exception 'Selecciona domicilio o punto de recogida.';
      end if;
    end if;

    select a.valor->'metodos' into v_methods from public.ajustes a where a.clave='config' for share;
    if jsonb_typeof(v_methods) is distinct from 'array' then raise exception 'No hay formas de pago configuradas.'; end if;
    select m.value into v_payment from jsonb_array_elements(v_methods) as m(value)
      where m.value->>'id'=coalesce(v_datos->>'pagoId','')
        and lower(coalesce(m.value->>'activo','true'))<>'false'
      limit 1;
    if v_payment is null then raise exception 'Selecciona una forma de pago activa.'; end if;
    v_payment_type:=coalesce(v_payment->>'tipo','');
    if v_hay_digital and v_payment_type='efectivo' then raise exception 'Los productos digitales requieren pago anticipado.'; end if;
    if v_payment_type not in ('efectivo','transfer','link') then raise exception 'La forma de pago no esta configurada correctamente.'; end if;
    if v_payment_type='link' and coalesce(v_payment->>'enlace','') !~ '^https://[^[:space:]]+$' then raise exception 'El enlace de pago debe usar HTTPS.'; end if;
    if v_payment_type='transfer' and btrim(coalesce(v_payment->>'cuenta',''))='' and coalesce(v_payment->>'qr','') not like 'data:image/%' then raise exception 'La transferencia no esta configurada con cuenta o QR.'; end if;
    if v_payment_type<>'efectivo' and btrim(coalesce(v_datos->>'referencia',''))='' and btrim(coalesce(v_datos->>'comprobante',''))='' then
      raise exception 'Escribe la referencia o adjunta el comprobante del pago.';
    end if;
  end if;
  v_subtotal:=round(v_subtotal,2);
  if v_subtotal>9999999999.99 then raise exception 'Total del pedido fuera del límite admitido.'; end if;

  v_codigo:=upper(btrim(coalesce(v_datos->>'cupon','')));
  if v_codigo<>'' then
    if char_length(v_codigo)>40 then raise exception 'Código de cupón demasiado largo.'; end if;
    -- Primero conserva los cupones de tienda ya guardados en ajustes.config;
    -- si no existe uno activo, busca un premio de ruleta de un solo uso.
    select a.valor->'cupones' into v_conf from public.ajustes a where a.clave='config' for share;
    if jsonb_typeof(v_conf)='array' then
      select count(*) into v_cupones_count from jsonb_array_elements(v_conf) as c(value)
        where upper(coalesce(c.value->>'codigo',''))=v_codigo
          and lower(coalesce(c.value->>'activo','false'))='true';
      if v_cupones_count>1 then raise exception 'Hay códigos de cupón duplicados en ajustes.config.'; end if;
      if v_cupones_count=1 then
        select c.value into v_conf from jsonb_array_elements(v_conf) as c(value)
          where upper(coalesce(c.value->>'codigo',''))=v_codigo
            and lower(coalesce(c.value->>'activo','false'))='true';
        v_tipo_cupon:=v_conf->>'tipo';
        begin v_valor_cupon:=nullif(v_conf->>'valor','')::numeric;
        exception when others then raise exception 'Valor de cupón inválido en ajustes.config.'; end;
        v_fuente_cupon:='ajustes';
      end if;
    end if;
    if v_fuente_cupon is null then
      select c.tipo,c.valor,c.usado,c.vence,c.reservado_pedido_id into v_cupon
        from public.cupones_ruleta c where c.codigo=v_codigo for update;
      if not found then raise exception 'Cupón no disponible. Verifica su estado antes de crear el pedido.'; end if;
      if v_cupon.usado or v_cupon.vence<=now() or v_cupon.reservado_pedido_id is not null then
        raise exception 'Cupón no disponible. Verifica su estado antes de crear el pedido.';
      end if;
      v_tipo_cupon:=v_cupon.tipo; v_valor_cupon:=v_cupon.valor; v_fuente_cupon:='ruleta';
    end if;
    if v_tipo_cupon='pct' then
      if v_valor_cupon not between 1 and 100 then raise exception 'Porcentaje de cupón inválido.'; end if;
      v_descuento:=round(v_subtotal*v_valor_cupon/100,2);
    elsif v_tipo_cupon='fijo' then
      if v_valor_cupon is null or v_valor_cupon<0 then raise exception 'Valor fijo de cupón inválido.'; end if;
      v_descuento:=least(v_subtotal,v_valor_cupon);
    else
      raise exception 'Tipo de cupón inválido.';
    end if;
  end if;

  v_descuento:=least(v_subtotal,greatest(0,round(v_descuento,2)));
  v_total:=round(v_subtotal-v_descuento,2);
  v_fecha_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_datos:=v_datos-'abonos';
  v_datos:=jsonb_set(v_datos,'{items}',v_items,true);
  v_datos:=jsonb_set(v_datos,'{fecha}',to_jsonb(v_fecha_ms),true);
  v_datos:=jsonb_set(v_datos,'{historial}',jsonb_build_array(
    jsonb_build_object('de','','a','Pendiente','fecha',v_fecha_ms)
  ),true);
  v_datos:=v_datos||jsonb_build_object(
    'subtotal',v_subtotal,'descuento',v_descuento,'total',v_total,
    'cupon',v_codigo,
    '_nexora',jsonb_build_object('version_precios',1,'validado_en',clock_timestamp(),
      'fuente_cupon',v_fuente_cupon)
  );
  return v_datos;
end $$;
revoke all on function public.nexora_calcular_pedido(jsonb) from public,anon,authenticated;

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

create table if not exists public.pedido_propietarios (
  pedido_id text primary key references public.pedidos(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  creado timestamptz not null default now()
);
create index if not exists pedido_propietarios_usuario_fecha_idx
  on public.pedido_propietarios(user_id,creado desc);
alter table public.pedido_propietarios enable row level security;
revoke all on public.pedido_propietarios from public,anon,authenticated;
grant select on public.pedido_propietarios to authenticated;
drop policy if exists nexora_cliente_lee_sus_pedidos on public.pedido_propietarios;
create policy nexora_cliente_lee_sus_pedidos on public.pedido_propietarios
  for select to authenticated using (user_id=auth.uid());

create table if not exists public.pedido_idempotencia (
  user_id uuid not null references auth.users(id) on delete restrict,
  clave text not null check (clave ~ '^[A-Za-z0-9_-]{8,80}$'),
  huella text not null check (huella ~ '^[0-9a-f]{32}$'),
  pedido_id text references public.pedidos(id) on delete restrict,
  creado timestamptz not null default now(),
  primary key(user_id,clave)
);
create index if not exists pedido_idempotencia_pedido_idx
  on public.pedido_idempotencia(pedido_id);
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

notify pgrst,'reload schema';
commit;
