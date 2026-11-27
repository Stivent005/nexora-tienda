-- ============================================================================
-- 05: SEGURIDAD DE COMPRAS, PAGOS PARCIALES, INVENTARIO Y ENTREGAS
--
-- PREPARADO LOCALMENTE. NO se ha ejecutado.
-- Prerrequisito: revisar y aplicar en una ventana aprobada el esquema base
-- (schema.sql, schema_2_catalogo_puntos.sql) y la migración definitiva 02.
-- schema_3_puntos_ff.sql es una rama histórica alternativa; no se debe ejecutar
-- encima de 02 sin revisar antes su compatibilidad.
--
-- Esta migración es aditiva respecto de pedidos/productos y conserva pedidos,
-- productos, puntos, cupones y funciones existentes. No crea datos de tienda.
-- IMPORTANTE: antes de aplicarla, desplegar el JavaScript que llama estos RPC:
-- esta migración revoca mutaciones REST directas de pedidos y de stock para
-- impedir saltarse validaciones, pagos parciales, auditoría e inventario.
-- Si el esquema real no coincide con el esperado, el preflight aborta.
-- ============================================================================

begin;

-- 0) Preflight estricto: no adivinar ni adaptar columnas desconocidas.
do $$
declare
  v_missing text;
  v_type_mismatch text;
begin
  if to_regclass('public.pedidos') is null
     or to_regclass('public.productos') is null
     or to_regclass('public.ajustes') is null
     or to_regclass('public.admins') is null
     or to_regclass('public.cupones_ruleta') is null
     or to_regclass('auth.users') is null then
    raise exception 'Preflight NEXORA 05: faltan tablas del esquema base/02. No se aplicó ningún cambio.';
  end if;
  if to_regprocedure('public.pedidos_antes_insertar()') is null
     or to_regprocedure('public.aplicar_puntos_pedido(text,text,jsonb,text)') is null
     or to_regprocedure('public.pedidos_puntos_trg()') is null
     or to_regprocedure('public.pedidos_proteger_datos()') is null
     or (select count(*) from pg_trigger where tgrelid='public.pedidos'::regclass
       and not tgisinternal and tgenabled<>'D'
       and tgname in ('pedidos_antes_insertar','pedidos_puntos_trg','pedidos_proteger_datos'))<3 then
    raise exception 'Preflight NEXORA 05: no está instalada la lógica de pedidos/puntos de la migración 02.';
  end if;

  select string_agg(x.tabla || '.' || x.columna, ', ' order by x.tabla, x.columna)
    into v_missing
  from (values
    ('pedidos','id'), ('pedidos','creado'), ('pedidos','estado'), ('pedidos','datos'), ('pedidos','ip'),
    ('productos','id'), ('productos','datos'), ('productos','activo'),
    ('ajustes','clave'), ('ajustes','valor'),
    ('admins','email'), ('cupones_ruleta','codigo'), ('cupones_ruleta','ff_id'),
    ('cupones_ruleta','tipo'), ('cupones_ruleta','valor'),
    ('cupones_ruleta','usado'), ('cupones_ruleta','vence')
  ) as x(tabla,columna)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name=x.tabla and c.column_name=x.columna
  );
  if v_missing is not null then
    raise exception 'Preflight NEXORA 05: columnas requeridas ausentes: %. No se aplicó ningún cambio.', v_missing;
  end if;

  select string_agg(x.tabla || '.' || x.columna || ' (esperado ' || x.tipo || ', encontrado ' || coalesce(c.data_type,'ausente') || ')', ', ')
    into v_type_mismatch
  from (values
    ('pedidos','id','text'), ('pedidos','creado','timestamp with time zone'),
    ('pedidos','estado','text'), ('pedidos','datos','jsonb'), ('pedidos','ip','text'),
    ('productos','id','text'), ('productos','datos','jsonb'), ('productos','activo','boolean'),
    ('ajustes','clave','text'), ('ajustes','valor','jsonb'), ('admins','email','text'),
    ('cupones_ruleta','codigo','text'), ('cupones_ruleta','ff_id','text'),
    ('cupones_ruleta','tipo','text'), ('cupones_ruleta','valor','integer'),
    ('cupones_ruleta','usado','boolean'), ('cupones_ruleta','vence','timestamp with time zone')
  ) as x(tabla,columna,tipo)
  left join information_schema.columns c
    on c.table_schema='public' and c.table_name=x.tabla and c.column_name=x.columna
  where c.data_type is distinct from x.tipo;
  if v_type_mismatch is not null then
    raise exception 'Preflight NEXORA 05: tipos de columna incompatibles: %. No se aplicó ningún cambio.', v_type_mismatch;
  end if;

  -- Las políticas locales conocidas se reemplazan más abajo. Un permiso
  -- adicional en pedidos/productos podría abrir acceso por la regla OR de RLS.
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='pedidos'
      and policyname not in (
        'clientes crean pedidos','admin crea pedidos','admin lee','admin actualiza','admin elimina',
        'nexora_pedidos_anon_insert','nexora_pedidos_staff_select'
      )
  ) then
    raise exception 'Preflight NEXORA 05: pedidos tiene políticas RLS no reconocidas; revísalas antes de migrar.';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='productos'
      and policyname not in ('ver productos activos','admin productos','nexora_productos_admin')
  ) then
    raise exception 'Preflight NEXORA 05: productos tiene políticas RLS no reconocidas; revísalas antes de migrar.';
  end if;

  if not exists (
    select 1 from public.admins a join auth.users u
      on lower(u.email)=lower(a.email)
  ) then
    raise exception 'Preflight NEXORA 05: ningún administrador actual coincide con un usuario de Auth. Revisa el acceso antes de migrar.';
  end if;
end $$;

-- 1) Roles explícitos. Los administradores que ya estaban autorizados se
-- conservan como owners; la migración no crea cuentas de Auth.
create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','admin','catalog','orders','payments','fulfillment')),
  activo boolean not null default true,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  otorgado_por uuid references auth.users(id) on delete set null
);

insert into public.admin_roles (user_id,role,activo,otorgado_por)
select u.id,'owner',true,u.id
from public.admins a
join auth.users u on lower(u.email)=lower(a.email)
on conflict (user_id) do nothing;

do $$
begin
  if not exists (select 1 from public.admin_roles where role='owner' and activo) then
    raise exception 'Preflight NEXORA 05: no hay owner activo después de migrar los administradores actuales.';
  end if;
end $$;

create table if not exists public.admin_activity (
  id bigint generated by default as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  accion text not null check (char_length(accion) between 1 and 80),
  entidad text not null check (char_length(entidad) between 1 and 60),
  entidad_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  creado timestamptz not null default now()
);
create index if not exists admin_activity_creado_idx on public.admin_activity (creado desc);
create index if not exists admin_activity_entidad_idx on public.admin_activity (entidad,entidad_id,creado desc);

-- 2) Libro de abonos y entregas. Las evidencias y datos de entrega no son
-- accesibles a anon; solo quedan visibles a roles administrativos autorizados.
create table if not exists public.pagos_abonos (
  id bigint generated by default as identity primary key,
  pedido_id text not null references public.pedidos(id) on delete restrict,
  monto numeric(14,2) not null check (monto > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente','verificado','rechazado')),
  metodo text not null check (char_length(btrim(metodo)) between 1 and 80),
  referencia text not null default '' check (char_length(referencia) <= 200),
  comprobante text not null default '' check (
    comprobante='' or (
      length(comprobante) <= 700000 and
      comprobante ~ '^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$'
    )
  ),
  nota_admin text not null default '' check (char_length(nota_admin) <= 500),
  registrado_por uuid references auth.users(id) on delete set null,
  verificado_por uuid references auth.users(id) on delete set null,
  creado timestamptz not null default now(),
  verificado_en timestamptz
);
create index if not exists pagos_abonos_pedido_idx on public.pagos_abonos (pedido_id,creado,id);
create index if not exists pagos_abonos_referencia_idx
  on public.pagos_abonos (lower(metodo),lower(referencia)) where referencia<>'';

create table if not exists public.pagos_reintegros (
  id bigint generated by default as identity primary key,
  abono_id bigint not null references public.pagos_abonos(id) on delete restrict,
  monto numeric(14,2) not null check (monto > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente','verificado','rechazado')),
  metodo text not null check (char_length(btrim(metodo)) between 1 and 80),
  referencia text not null default '' check (char_length(referencia)<=200),
  comprobante text not null default '' check (
    comprobante='' or (
      length(comprobante)<=700000 and
      comprobante ~ '^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$'
    )
  ),
  nota_admin text not null default '' check (char_length(nota_admin)<=500),
  registrado_por uuid references auth.users(id) on delete set null,
  verificado_por uuid references auth.users(id) on delete set null,
  creado timestamptz not null default now(),
  verificado_en timestamptz
);
create index if not exists pagos_reintegros_abono_idx on public.pagos_reintegros(abono_id,creado,id);
create index if not exists pagos_reintegros_referencia_idx
  on public.pagos_reintegros(lower(metodo),lower(referencia)) where referencia<>'';

create table if not exists public.pedido_entregas (
  id bigint generated by default as identity primary key,
  pedido_id text not null references public.pedidos(id) on delete restrict,
  producto_id text not null references public.productos(id) on delete restrict,
  tipo text not null check (tipo in ('fisico','digital')),
  cantidad integer not null check (cantidad > 0),
  estado text not null default 'pendiente'
    check (estado in ('pendiente','preparacion','en_camino','entregado','fallo','cancelado')),
  datos_entrega jsonb not null default '{}'::jsonb
    check (jsonb_typeof(datos_entrega)='object' and octet_length(datos_entrega::text)<=16000),
  actualizado_por uuid references auth.users(id) on delete set null,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique (pedido_id,producto_id)
);
create index if not exists pedido_entregas_estado_idx on public.pedido_entregas (estado,pedido_id);

create table if not exists public.inventario_movimientos (
  id bigint generated by default as identity primary key,
  pedido_id text references public.pedidos(id) on delete restrict,
  producto_id text not null references public.productos(id) on delete restrict,
  movimiento text not null check (movimiento in ('venta','devolucion_cancelacion','ajuste_manual')),
  cantidad integer not null check (cantidad > 0),
  motivo text not null default '' check (char_length(motivo)<=500),
  actor_id uuid references auth.users(id) on delete set null,
  creado timestamptz not null default now(),
  unique (pedido_id,producto_id,movimiento)
);
create index if not exists inventario_mov_producto_idx on public.inventario_movimientos (producto_id,creado desc);

alter table public.pedidos add column if not exists total_validado numeric(14,2);
alter table public.pedidos add column if not exists precio_validado_en timestamptz;
alter table public.pedidos add column if not exists version_precios smallint;
alter table public.cupones_ruleta add column if not exists reservado_pedido_id text;
create unique index if not exists cupones_ruleta_reserva_uq
  on public.cupones_ruleta (reservado_pedido_id) where reservado_pedido_id is not null;

-- 3) Permisos centralizados en Auth UID + rol activo. es_admin() se conserva
-- como interfaz para las políticas/RPC antiguas, ahora basada en roles del servidor.
create or replace function public.nexora_admin_permiso(p_permiso text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(exists (
    select 1
    from public.admin_roles r
    where r.user_id=auth.uid() and r.activo
      and case p_permiso
        when 'manage_roles' then r.role='owner'
        when 'admin' then r.role in ('owner','admin')
        when 'manage_products' then r.role in ('owner','admin','catalog')
        when 'view_orders' then r.role in ('owner','admin','orders','payments','fulfillment')
        when 'manage_orders' then r.role in ('owner','admin','orders')
        when 'view_payments' then r.role in ('owner','admin','payments')
        when 'manage_payments' then r.role in ('owner','admin','payments')
        when 'view_inventory' then r.role in ('owner','admin','catalog','orders','fulfillment')
        when 'manage_deliveries' then r.role in ('owner','admin','orders','fulfillment')
        when 'manage_loyalty' then r.role in ('owner','admin')
        when 'view_activity' then r.role in ('owner','admin')
        else false
      end
  ),false)
$$;

create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$ select public.nexora_admin_perm('admin') $$;

create or replace function public.nexora_registrar_actividad(
  p_accion text,p_entidad text,p_entidad_id text,p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.admin_activity(actor_id,accion,entidad,entidad_id,metadata)
  values (
    auth.uid(),left(coalesce(p_accion,'cambio'),80),left(coalesce(p_entidad,'sistema'),60),
    nullif(left(coalesce(p_entidad_id,''),120),''),
    case when jsonb_typeof(p_metadata)='object' then p_metadata else '{}'::jsonb end
  );
end $$;

create or replace function public.admin_asignar_rol(p_user_id uuid,p_rol text,p_activo boolean default true)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_rol_actual text;
begin
  if not public.nexora_admin_permiso('manage_roles') then
    return jsonb_build_object('error','No autorizado.');
  end if;
  if p_user_id is null or p_rol is null or p_rol not in ('owner','admin','catalog','orders','payments','fulfillment') then
    return jsonb_build_object('error','Usuario o rol inválido.');
  end if;
  if not exists (select 1 from auth.users where id=p_user_id) then
    return jsonb_build_object('error','El usuario no existe en Auth.');
  end if;

  lock table public.admin_roles in share row exclusive mode;
  if not public.nexora_admin_permiso('manage_roles') then
    return jsonb_build_object('error','No autorizado.');
  end if;
  select role into v_rol_actual from public.admin_roles where user_id=p_user_id for update;
  if v_rol_actual='owner' and (p_rol<>'owner' or not coalesce(p_activo,true))
     and (select count(*) from public.admin_roles where role='owner' and activo)<=1 then
    return jsonb_build_object('error','No se puede desactivar o degradar al último owner.');
  end if;

  insert into public.admin_roles(user_id,role,activo,otorgado_por,actualizado)
  values (p_user_id,p_rol,coalesce(p_activo,true),auth.uid(),now())
  on conflict (user_id) do update
    set role=excluded.role,activo=excluded.activo,otorgado_por=excluded.otorgado_por,actualizado=now();
  perform public.nexora_registrar_actividad('rol_actualizado','admin',p_user_id::text,
    jsonb_build_object('rol',p_rol,'activo',coalesce(p_activo,true)));
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.admin_listar_roles()
returns table(user_id uuid,email text,role text,activo boolean,creado timestamptz)
language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select r.user_id,u.email,r.role,r.activo,r.creado
  from public.admin_roles r join auth.users u on u.id=r.user_id
  where public.nexora_admin_permiso('manage_roles')
  order by r.creado,r.user_id
$$;

revoke all on function public.nexora_admin_permiso(text) from public,anon;
revoke all on function public.es_admin() from public,anon;
revoke all on function public.nexora_registrar_actividad(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.admin_asignar_rol(uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.admin_listar_roles() from public,anon,authenticated;
grant execute on function public.nexora_admin_permiso(text),public.es_admin() to authenticated;
grant execute on function public.admin_asignar_rol(uuid,text,boolean) to authenticated;
grant execute on function public.admin_listar_roles() to authenticated;

-- 4) RLS de las tablas nuevas y separación de permisos de lectura.
alter table public.admin_roles enable row level security;
alter table public.admin_activity enable row level security;
alter table public.pagos_abonos enable row level security;
alter table public.pagos_reintegros enable row level security;
alter table public.pedido_entregas enable row level security;
alter table public.inventario_movimientos enable row level security;

revoke all on public.admin_roles,public.admin_activity,public.pagos_abonos,public.pagos_reintegros,
  public.pedido_entregas,public.inventario_movimientos from anon,authenticated;
grant select on public.admin_roles,public.admin_activity,public.pagos_abonos,public.pagos_reintegros,
  public.pedido_entregas,public.inventario_movimientos to authenticated;

drop policy if exists nexora_roles_owner_read on public.admin_roles;
create policy nexora_roles_owner_read on public.admin_roles for select to authenticated
  using (public.nexora_admin_permiso('manage_roles'));
drop policy if exists nexora_activity_read on public.admin_activity;
create policy nexora_activity_read on public.admin_activity for select to authenticated
  using (public.nexora_admin_permiso('view_activity'));
drop policy if exists nexora_payments_read on public.pagos_abonos;
create policy nexora_payments_read on public.pagos_abonos for select to authenticated
  using (public.nexora_admin_permiso('view_payments'));
drop policy if exists nexora_refunds_read on public.pagos_reintegros;
create policy nexora_refunds_read on public.pagos_reintegros for select to authenticated
  using (public.nexora_admin_permiso('view_payments'));
drop policy if exists nexora_deliveries_read on public.pedido_entregas;
create policy nexora_deliveries_read on public.pedido_entregas for select to authenticated
  using (public.nexora_admin_permiso('manage_deliveries'));
drop policy if exists nexora_inventory_read on public.inventario_movimientos;
create policy nexora_inventory_read on public.inventario_movimientos for select to authenticated
  using (public.nexora_admin_permiso('view_inventory'));

drop policy if exists "admin productos" on public.productos;
drop policy if exists nexora_productos_admin on public.productos;
create policy nexora_productos_admin on public.productos for all to authenticated
  using (public.nexora_admin_permiso('manage_products'))
  with check (public.nexora_admin_permiso('manage_products'));

-- Las escrituras de pedidos autenticados pasan por RPC. El cliente anónimo
-- todavía puede crear pedidos, que se validan en los triggers del servidor.
drop policy if exists "clientes crean pedidos" on public.pedidos;
drop policy if exists "admin crea pedidos" on public.pedidos;
drop policy if exists "admin lee" on public.pedidos;
drop policy if exists "admin actualiza" on public.pedidos;
drop policy if exists "admin elimina" on public.pedidos;
drop policy if exists nexora_pedidos_anon_insert on public.pedidos;
drop policy if exists nexora_pedidos_staff_select on public.pedidos;
alter table public.pedidos enable row level security;
revoke all on public.pedidos from anon,authenticated;
grant insert on public.pedidos to anon;
grant select on public.pedidos to authenticated;
create policy nexora_pedidos_anon_insert on public.pedidos for insert to anon
  with check (estado='Pendiente');
create policy nexora_pedidos_staff_select on public.pedidos for select to authenticated
  using (public.nexora_admin_permiso('view_orders'));

-- El trigger de auditoría guarda solo campos no personales, nunca el JSON del pedido.
create or replace function public.nexora_auditar_catalogo()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_row jsonb; v_id text; v_metadata jsonb;
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id:=coalesce(v_row->>'id',v_row->>'clave');
  if tg_table_name='productos' then
    v_metadata:=jsonb_build_object('tipo',v_row->'datos'->>'tipo','activo',v_row->'activo');
    perform public.nexora_registrar_actividad('catalogo_'||lower(tg_op),'producto',v_id,v_metadata);
  else
    v_metadata:=jsonb_build_object('clave',v_row->>'clave');
    perform public.nexora_registrar_actividad('ajustes_'||lower(tg_op),'ajuste',v_id,v_metadata);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.nexora_auditar_catalogo() from public,anon,authenticated;
drop trigger if exists nexora_auditar_productos on public.productos;
create trigger nexora_auditar_productos after insert or update or delete on public.productos
  for each row execute function public.nexora_auditar_catalogo();
drop trigger if exists nexora_auditar_ajustes on public.ajustes;
create trigger nexora_auditar_ajustes after insert or update or delete on public.ajustes
  for each row execute function public.nexora_auditar_catalogo();

-- El stock vive actualmente dentro de productos.datos. Impide que un upsert
-- del catálogo desde un navegador restaure valores antiguos y borre ventas.
create or replace function public.nexora_proteger_stock_catalogo()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.datos->'stock' is distinct from new.datos->'stock'
     and current_setting('nexora.stock_rpc',true) is distinct from 'on' then
    raise exception 'El inventario se actualiza mediante admin_ajustar_stock, no desde la ficha del catálogo.';
  end if;
  return new;
end $$;
revoke all on function public.nexora_proteger_stock_catalogo() from public,anon,authenticated;
drop trigger if exists a_nexora_proteger_stock on public.productos;
create trigger a_nexora_proteger_stock before update on public.productos
  for each row execute function public.nexora_proteger_stock_catalogo();

-- 5) Validación de catálogo: el total, nombre, tipo y precio se reconstruyen
-- desde productos.datos; nunca se usan precio/total/tipo del navegador.
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
revoke all on function public.nexora_calcular_pedido(jsonb) from public,anon,authenticated;
revoke all on function public.nexora_validar_pedido_insert() from public,anon,authenticated;
drop trigger if exists a_nexora_validar_pedido on public.pedidos;
-- Los triggers BEFORE se ordenan por nombre: este corre antes de la validación
-- existente pedidos_antes_insertar, que también comprueba formato y tamaño.
create trigger a_nexora_validar_pedido before insert on public.pedidos
  for each row execute function public.nexora_validar_pedido_insert();

create or replace function public.nexora_crear_entregas_pedido()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_item record; v_codigo text;
begin
  v_codigo:=nullif(new.datos->>'cupon','');
  if v_codigo is not null and new.datos#>>'{_nexora,fuente_cupon}'='ruleta' then
    update public.cupones_ruleta set reservado_pedido_id=new.id
      where codigo=v_codigo and not usado and vence>now() and reservado_pedido_id is null;
    if not found then raise exception 'No se pudo reservar el cupón para este pedido.'; end if;
  end if;

  -- La referencia/comprobante del checkout se conserva como un abono pendiente;
  -- nunca se considera pagado hasta la verificación humana de su fuente.
  if coalesce(new.total_validado,0)>0
     and (btrim(coalesce(new.datos->>'referencia',''))<>'' or btrim(coalesce(new.datos->>'comprobante',''))<>'') then
    insert into public.pagos_abonos(pedido_id,monto,metodo,referencia,comprobante,registrado_por)
    values (
      new.id,new.total_validado,
      left(coalesce(nullif(btrim(new.datos->>'pago'),''),nullif(btrim(new.datos->>'pagoId'),''),'Metodo no identificado'),80),
      left(btrim(coalesce(new.datos->>'referencia','')),200),
      coalesce(new.datos->>'comprobante',''),auth.uid()
    );
  end if;

  for v_item in
    select e.value->>'id' as producto_id,
           bool_or(coalesce((e.value->>'v')::boolean,false)) as digital,
           sum((e.value->>'q')::integer)::integer as cantidad
    from jsonb_array_elements(new.datos->'items') as e(value)
    group by e.value->>'id' order by e.value->>'id'
  loop
    insert into public.pedido_entregas(pedido_id,producto_id,tipo,cantidad)
    values (new.id,v_item.producto_id,case when v_item.digital then 'digital' else 'fisico' end,v_item.cantidad)
    on conflict (pedido_id,producto_id) do nothing;
  end loop;
  return new;
end $$;
revoke all on function public.nexora_crear_entregas_pedido() from public,anon,authenticated;
drop trigger if exists z_nexora_crear_entregas on public.pedidos;
create trigger z_nexora_crear_entregas after insert on public.pedidos
  for each row execute function public.nexora_crear_entregas_pedido();

-- RPC pública acotada para que el checkout reciba el total fijado por el
-- servidor sin abrir lectura anónima de pedidos.
create or replace function public.crear_pedido_seguro(p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_id text:=replace(gen_random_uuid()::text,'-',''); v_p public.pedidos%rowtype;
begin
  if coalesce(auth.role(),'') not in ('anon','authenticated') then
    return jsonb_build_object('error','Sesión no permitida.');
  end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then
    return jsonb_build_object('error','Datos de pedido inválidos.');
  end if;
  insert into public.pedidos(id,estado,datos)
    values(v_id,'Pendiente',p_datos-'desc') returning * into v_p;
  return jsonb_build_object('ok',true,'id',v_p.id,'estado',v_p.estado,
    'total',v_p.total_validado,'subtotal',v_p.datos->'subtotal',
    'descuento',v_p.datos->'descuento','cupon',v_p.datos->'cupon',
    'items',v_p.datos->'items','creado',v_p.creado);
end $$;
revoke all on function public.crear_pedido_seguro(jsonb) from public,anon,authenticated;
grant execute on function public.crear_pedido_seguro(jsonb) to anon,authenticated;

-- 6) Inventario transaccional. Se descuenta solo al cubrir el total validado;
-- los productos virtuales ilimitados no consumen existencias.
create or replace function public.nexora_aplicar_inventario(p_pedido_id text,p_datos jsonb,p_movimiento text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_item record; v_prod jsonb; v_stock integer; v_nuevo integer; v_actor uuid:=auth.uid();
begin
  if p_movimiento='venta' then
    if exists (select 1 from public.inventario_movimientos where pedido_id=p_pedido_id and movimiento='venta') then
      return;
    end if;
    for v_item in
      select e.value->>'id' as producto_id,
             bool_or(coalesce((e.value->>'v')::boolean,false)) as digital,
             sum((e.value->>'q')::integer)::integer as cantidad
      from jsonb_array_elements(p_datos->'items') as e(value)
      group by e.value->>'id' order by e.value->>'id'
    loop
      select p.datos into v_prod from public.productos p where p.id=v_item.producto_id for update;
      if not found then raise exception 'El catálogo cambió: no existe el producto %.',v_item.producto_id; end if;
      if v_item.digital and coalesce((v_prod->>'ilimitado')::boolean,false) then continue; end if;
      begin v_stock:=coalesce((v_prod->>'stock')::integer,0);
      exception when others then raise exception 'Inventario inválido para el producto %.',v_item.producto_id; end;
      if v_stock<v_item.cantidad then raise exception 'Inventario insuficiente para el producto %.',v_item.producto_id; end if;
      v_nuevo:=v_stock-v_item.cantidad;
      perform set_config('nexora.stock_rpc','on',true);
      update public.productos set datos=jsonb_set(datos,'{stock}',to_jsonb(v_nuevo),true)
        where id=v_item.producto_id;
      perform set_config('nexora.stock_rpc','off',true);
      insert into public.inventario_movimientos(pedido_id,producto_id,movimiento,cantidad,actor_id)
        values (p_pedido_id,v_item.producto_id,'venta',v_item.cantidad,v_actor);
    end loop;
  elsif p_movimiento='devolucion_cancelacion' then
    for v_item in
      select m.producto_id,m.cantidad
      from public.inventario_movimientos m
      where m.pedido_id=p_pedido_id and m.movimiento='venta'
        and not exists (
          select 1 from public.inventario_movimientos r
          where r.pedido_id=m.pedido_id and r.producto_id=m.producto_id
            and r.movimiento='devolucion_cancelacion'
        )
      order by m.producto_id
    loop
      select p.datos into v_prod from public.productos p where p.id=v_item.producto_id for update;
      if not found then raise exception 'No se puede restituir inventario: falta el producto %.',v_item.producto_id; end if;
      begin v_stock:=coalesce((v_prod->>'stock')::integer,0);
      exception when others then raise exception 'Inventario inválido para el producto %.',v_item.producto_id; end;
      v_nuevo:=v_stock+v_item.cantidad;
      perform set_config('nexora.stock_rpc','on',true);
      update public.productos set datos=jsonb_set(datos,'{stock}',to_jsonb(v_nuevo),true)
        where id=v_item.producto_id;
      perform set_config('nexora.stock_rpc','off',true);
      insert into public.inventario_movimientos(pedido_id,producto_id,movimiento,cantidad,actor_id)
        values (p_pedido_id,v_item.producto_id,'devolucion_cancelacion',v_item.cantidad,v_actor);
    end loop;
  else
    raise exception 'Movimiento de inventario inválido.';
  end if;
end $$;
revoke all on function public.nexora_aplicar_inventario(text,jsonb,text) from public,anon,authenticated;

-- Bloquea cambios directos de estado, estados pagados sin abonos verificados,
-- entregas prematuras y cancelaciones con entrega ya iniciada/completada.
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

-- Las funciones existentes de puntos se conservan; este trigger las alimenta
-- con el total validado y quita puntos suministrados por el navegador.
create or replace function public.pedidos_puntos_trg()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_datos jsonb:=new.datos; v_items jsonb;
begin
  if jsonb_typeof(v_datos->'items')='array' then
    select coalesce(jsonb_agg(e.value-'puntos' order by e.ordinality),'[]'::jsonb)
      into v_items from jsonb_array_elements(v_datos->'items') with ordinality as e(value,ordinality);
    v_datos:=jsonb_set(v_datos,'{items}',v_items,true);
  end if;
  if new.total_validado is not null then
    v_datos:=jsonb_set(v_datos,'{total}',to_jsonb(new.total_validado),true);
  end if;
  perform public.aplicar_puntos_pedido(new.id,new.estado,v_datos,old.estado);
  if new.estado in ('Pagado','Entregado') and new.datos#>>'{_nexora,fuente_cupon}'='ruleta'
     and coalesce(new.datos->>'cupon','')<>'' then
    update public.cupones_ruleta set usado=true,reservado_pedido_id=null
      where codigo=upper(new.datos->>'cupon') and not usado
        and (reservado_pedido_id is null or reservado_pedido_id=new.id);
  end if;
  return new;
end $$;
revoke all on function public.pedidos_puntos_trg() from public,anon,authenticated;

create or replace function public.nexora_finalizar_estado_pedido()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  if new.estado='Cancelado' and old.estado is distinct from new.estado then
    update public.pagos_abonos set estado='rechazado',verificado_por=auth.uid(),verificado_en=now()
      where pedido_id=new.id and estado='pendiente';
    update public.pagos_reintegros set estado='rechazado',verificado_por=auth.uid(),verificado_en=now()
      where abono_id in (select id from public.pagos_abonos where pedido_id=new.id) and estado='pendiente';
    update public.pedido_entregas set estado='cancelado',actualizado=now(),actualizado_por=auth.uid()
      where pedido_id=new.id and estado in ('pendiente','preparacion','fallo');
    update public.cupones_ruleta set reservado_pedido_id=null
      where reservado_pedido_id=new.id and not usado;
  end if;
  if old.estado is distinct from new.estado then
    perform public.nexora_registrar_actividad('estado_pedido','pedido',new.id,
      jsonb_build_object('desde',old.estado,'hacia',new.estado));
  end if;
  return new;
end $$;
revoke all on function public.nexora_finalizar_estado_pedido() from public,anon,authenticated;
drop trigger if exists z_nexora_finalizar_estado on public.pedidos;
create trigger z_nexora_finalizar_estado after update of estado on public.pedidos
  for each row execute function public.nexora_finalizar_estado_pedido();

-- 7) RPC administrativa: crear pedido manual, validar pedidos antiguos,
-- registrar/verificar abonos, cambiar estado y registrar entregas.
create or replace function public.admin_crear_pedido(p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_id text:=replace(gen_random_uuid()::text,'-',''); v_row public.pedidos%rowtype;
begin
  if not public.nexora_admin_permiso('manage_orders') then return jsonb_build_object('error','No autorizado.'); end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then return jsonb_build_object('error','Datos de pedido inválidos.'); end if;
  insert into public.pedidos(id,estado,datos)
    values(v_id,'Pendiente',p_datos-'desc') returning * into v_row;
  perform public.nexora_registrar_actividad('pedido_creado','pedido',v_id,jsonb_build_object('origen','admin'));
  return jsonb_build_object('ok',true,'id',v_id,'estado',v_row.estado,
    'total',v_row.total_validado,'subtotal',v_row.datos->'subtotal',
    'descuento',v_row.datos->'descuento','cupon',v_row.datos->'cupon',
    'items',v_row.datos->'items','creado',v_row.creado);
end $$;

create or replace function public.admin_validar_pedido_anterior(
  p_pedido_id text,p_total numeric,p_motivo text,p_inventario_pagado text default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_p public.pedidos%rowtype; v_item record; v_prod jsonb; v_tipo text; v_nombre text;
  v_codigo text; v_config_cupones jsonb; v_cupones_count integer; v_fuente_cupon text;
  v_cantidad integer; v_items_seguros jsonb:='[]'::jsonb; v_datos_seguros jsonb;
begin
  if not public.nexora_admin_permiso('manage_payments') then return jsonb_build_object('error','No autorizado.'); end if;
  if p_total is null or p_total<0 or p_total>999999999999
     or char_length(btrim(coalesce(p_motivo,'')))<8 or char_length(p_motivo)>500 then
    return jsonb_build_object('error','Total o motivo de validación inválido.');
  end if;
  select * into v_p from public.pedidos where id=p_pedido_id for update;
  if not found then return jsonb_build_object('error','Pedido no encontrado.'); end if;
  if v_p.total_validado is not null then return jsonb_build_object('error','El pedido ya tiene un total validado.'); end if;
  if v_p.estado not in ('Pendiente','Nuevo','Pagado') then
    return jsonb_build_object('error','Solo se reconcilian pedidos anteriores pendientes o pagados.');
  end if;
  if v_p.estado='Pagado' and (p_inventario_pagado is null or p_inventario_pagado not in ('ya_descontado','descontar_ahora')) then
    return jsonb_build_object('error','Confirma si el inventario antiguo ya se descontó o si debe descontarse ahora.');
  end if;
  if jsonb_typeof(v_p.datos->'items') is distinct from 'array'
     or jsonb_array_length(v_p.datos->'items') not between 1 and 100 then
    return jsonb_build_object('error','El detalle anterior del pedido no es válido.');
  end if;
  for v_item in
    select e.value from jsonb_array_elements(v_p.datos->'items') as e(value)
    order by e.value->>'id'
  loop
    if coalesce(v_item.value->>'id','') !~ '^[A-Za-z0-9_-]{1,40}$' then
      return jsonb_build_object('error','El pedido contiene productos o cantidades que requieren revisión manual.');
    end if;
    begin v_cantidad:=(v_item.value->>'q')::integer;
    exception when others then return jsonb_build_object('error','El pedido contiene productos o cantidades que requieren revisión manual.'); end;
    if v_cantidad not between 1 and 9999 then
      return jsonb_build_object('error','El pedido contiene productos o cantidades que requieren revisión manual.');
    end if;
    select p.datos into v_prod from public.productos p where p.id=v_item.value->>'id' for share;
    if not found then return jsonb_build_object('error','Falta un producto del pedido en el catálogo actual.'); end if;
    if coalesce(v_prod->>'tipo','fisico') not in ('fisico','virtual') then
      return jsonb_build_object('error','El tipo de un producto histórico requiere revisión manual.');
    end if;
    v_tipo:=case when v_prod->>'tipo'='virtual' then 'digital' else 'fisico' end;
    v_nombre:=left(btrim(coalesce(v_prod->>'name','Producto histórico')),80);
    v_items_seguros:=v_items_seguros||jsonb_build_array(jsonb_build_object(
      'id',v_item.value->>'id','n',v_nombre,'q',v_cantidad,'v',v_tipo='digital',
      'ilimitado',v_tipo='digital' and coalesce((v_prod->>'ilimitado')::boolean,false),'puntos',null
    ));
  end loop;
  v_datos_seguros:=jsonb_set(v_p.datos,'{items}',v_items_seguros,true);
  v_codigo:=upper(btrim(coalesce(v_p.datos->>'cupon','')));
  if v_codigo<>'' then
    select a.valor->'cupones' into v_config_cupones from public.ajustes a where a.clave='config' for share;
    if jsonb_typeof(v_config_cupones)='array' then
      select count(*) into v_cupones_count from jsonb_array_elements(v_config_cupones) as c(value)
        where upper(coalesce(c.value->>'codigo',''))=v_codigo;
      if v_cupones_count>1 then return jsonb_build_object('error','Hay cupones duplicados; resuélvelos antes de validar el pedido.'); end if;
    end if;
    if coalesce(v_cupones_count,0)=1 then
      v_fuente_cupon:='ajustes';
    elsif v_p.estado in ('Pendiente','Nuevo') then
      update public.cupones_ruleta set reservado_pedido_id=v_p.id
        where codigo=v_codigo and not usado and vence>now() and reservado_pedido_id is null;
      v_fuente_cupon:=case when found then 'ruleta' else 'historico' end;
    else
      v_fuente_cupon:='historico';
    end if;
  end if;
  for v_item in
    select e.value->>'id' as producto_id,e.value->>'n' as nombre,
           bool_or(coalesce((e.value->>'v')::boolean,false)) as digital,
           bool_or(coalesce((e.value->>'ilimitado')::boolean,false)) as ilimitado,
           sum((e.value->>'q')::integer)::integer as cantidad
    from jsonb_array_elements(v_items_seguros) as e(value)
    group by e.value->>'id',e.value->>'n' order by e.value->>'id'
  loop
    insert into public.pedido_entregas(pedido_id,producto_id,tipo,cantidad)
    values(v_p.id,v_item.producto_id,case when v_item.digital then 'digital' else 'fisico' end,v_item.cantidad)
    on conflict (pedido_id,producto_id) do nothing;
  end loop;
  if v_p.estado='Pagado' and p_inventario_pagado='descontar_ahora' then
    perform public.nexora_aplicar_inventario(v_p.id,v_datos_seguros,'venta');
  elsif v_p.estado='Pagado' and p_inventario_pagado='ya_descontado' then
    for v_item in
      select e.value->>'id' as producto_id,
             bool_or(coalesce((e.value->>'v')::boolean,false)) as digital,
             bool_or(coalesce((e.value->>'ilimitado')::boolean,false)) as ilimitado,
             sum((e.value->>'q')::integer)::integer as cantidad
      from jsonb_array_elements(v_items_seguros) as e(value)
      group by e.value->>'id' order by e.value->>'id'
    loop
      if not (v_item.digital and v_item.ilimitado) then
        insert into public.inventario_movimientos(pedido_id,producto_id,movimiento,cantidad,motivo,actor_id)
        values(v_p.id,v_item.producto_id,'venta',v_item.cantidad,'reconciliacion_anterior',auth.uid());
      end if;
    end loop;
  end if;
  update public.pedidos set total_validado=round(p_total,2),precio_validado_en=now(),version_precios=0,
    datos=jsonb_set(v_p.datos,'{_nexora}',jsonb_build_object('version_precios',0,'fuente_cupon',v_fuente_cupon),true)
    where id=v_p.id;
  perform public.nexora_registrar_actividad('total_anterior_validado','pedido',v_p.id,
    jsonb_build_object('total',round(p_total,2),'revision_manual',true));
  return jsonb_build_object('ok',true,'total_validado',round(p_total,2));
end $$;

create or replace function public.admin_registrar_abono(
  p_pedido_id text,p_monto numeric,p_metodo text,p_referencia text default '',
  p_comprobante text default '',p_nota text default ''
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_p public.pedidos%rowtype; v_comprometido numeric(14,2); v_id bigint; v_monto numeric(14,2);
begin
  if not public.nexora_admin_permiso('manage_payments') then return jsonb_build_object('error','No autorizado.'); end if;
  if p_monto is null or p_monto<=0 or p_monto>999999999999
     or char_length(btrim(coalesce(p_metodo,''))) not between 1 and 80
     or char_length(coalesce(p_referencia,''))>200 or char_length(coalesce(p_nota,''))>500
     or (coalesce(p_comprobante,'')<>'' and (length(p_comprobante)>700000 or p_comprobante !~ '^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$')) then
    return jsonb_build_object('error','Datos del abono inválidos.');
  end if;
  v_monto:=round(p_monto,2);
  if v_monto<=0 then return jsonb_build_object('error','El abono debe ser mayor que cero.'); end if;
  select * into v_p from public.pedidos where id=p_pedido_id for update;
  if not found then return jsonb_build_object('error','Pedido no encontrado.'); end if;
  if v_p.estado not in ('Pendiente','Nuevo') then return jsonb_build_object('error','El pedido ya no recibe abonos.'); end if;
  if v_p.total_validado is null then return jsonb_build_object('error','Valida primero el total de este pedido anterior.'); end if;
  select
    coalesce(sum(a.monto) filter (where a.estado in ('pendiente','verificado')),0)
      -coalesce((select sum(r.monto) from public.pagos_reintegros r
        join public.pagos_abonos x on x.id=r.abono_id
        where x.pedido_id=v_p.id and r.estado='verificado'),0)
    into v_comprometido
  from public.pagos_abonos a where a.pedido_id=v_p.id;
  if v_comprometido+v_monto>v_p.total_validado then
    return jsonb_build_object('error','El abono supera el saldo disponible.');
  end if;
  insert into public.pagos_abonos(pedido_id,monto,metodo,referencia,comprobante,nota_admin,registrado_por)
    values(v_p.id,v_monto,btrim(p_metodo),btrim(coalesce(p_referencia,'')),
      coalesce(p_comprobante,''),btrim(coalesce(p_nota,'')),auth.uid()) returning id into v_id;
  perform public.nexora_registrar_actividad('abono_registrado','abono',v_id::text,
    jsonb_build_object('pedido_id',v_p.id,'monto',v_monto));
  return jsonb_build_object('ok',true,'id',v_id,'saldo',v_p.total_validado-v_comprometido-v_monto);
end $$;

create or replace function public.admin_verificar_abono(p_abono_id bigint,p_aprobar boolean,p_nota text default '')
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_a public.pagos_abonos%rowtype; v_p public.pedidos%rowtype; v_total_pagado numeric(14,2); v_saldo numeric(14,2);
begin
  if not public.nexora_admin_permiso('manage_payments') then return jsonb_build_object('error','No autorizado.'); end if;
  if p_aprobar is null or char_length(coalesce(p_nota,''))>500 then return jsonb_build_object('error','Decisión inválida.'); end if;
  select * into v_a from public.pagos_abonos where id=p_abono_id;
  if not found then return jsonb_build_object('error','Abono no encontrado.'); end if;
  select * into v_p from public.pedidos where id=v_a.pedido_id for update;
  if not found then return jsonb_build_object('error','Pedido no encontrado.'); end if;
  select * into v_a from public.pagos_abonos where id=p_abono_id for update;
  if v_a.estado<>'pendiente' then return jsonb_build_object('error','El abono ya fue revisado.'); end if;
  if p_aprobar and v_a.referencia='' and v_a.comprobante='' then
    return jsonb_build_object('error','Para aprobar, registra la referencia o adjunta evidencia y comprueba el pago en su fuente.');
  end if;
  if v_p.estado not in ('Pendiente','Nuevo') or v_p.total_validado is null then
    return jsonb_build_object('error','El pedido no está disponible para verificar pagos.');
  end if;
  update public.pagos_abonos set estado=case when p_aprobar then 'verificado' else 'rechazado' end,
      nota_admin=case when btrim(coalesce(p_nota,''))='' then nota_admin else btrim(p_nota) end,
      verificado_por=auth.uid(),verificado_en=now()
    where id=p_abono_id;
  select
    coalesce(sum(a.monto) filter (where a.estado='verificado'),0)
      -coalesce((select sum(r.monto) from public.pagos_reintegros r
        join public.pagos_abonos x on x.id=r.abono_id
        where x.pedido_id=v_p.id and r.estado='verificado'),0)
    into v_total_pagado
  from public.pagos_abonos a where a.pedido_id=v_p.id;
  v_saldo:=greatest(0,v_p.total_validado-v_total_pagado);
  if p_aprobar and v_total_pagado>=v_p.total_validado then
    perform set_config('nexora.order_rpc','on',true);
    update public.pedidos
      set estado='Pagado',datos=jsonb_set(datos,'{historial}',
        coalesce(case when jsonb_typeof(datos->'historial')='array' then datos->'historial' else '[]'::jsonb end,'[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('de',v_p.estado,'a','Pagado','fecha',floor(extract(epoch from clock_timestamp())*1000)::bigint)),true)
      where id=v_p.id;
    perform set_config('nexora.order_rpc','off',true);
  end if;
  perform public.nexora_registrar_actividad(case when p_aprobar then 'abono_verificado' else 'abono_rechazado' end,
    'abono',p_abono_id::text,jsonb_build_object('pedido_id',v_p.id,'monto',v_a.monto,'saldo',v_saldo));
  return jsonb_build_object('ok',true,'pagado',v_total_pagado>=v_p.total_validado,'abonado',v_total_pagado,'saldo',v_saldo);
end $$;

create or replace function public.admin_registrar_reintegro(
  p_abono_id bigint,p_monto numeric,p_metodo text,p_referencia text default '',
  p_comprobante text default '',p_nota text default ''
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_a public.pagos_abonos%rowtype; v_p public.pedidos%rowtype;
  v_comprometido numeric(14,2); v_monto numeric(14,2); v_id bigint;
  v_pagado_neto numeric(14,2); v_reintegros_comprometidos numeric(14,2);
begin
  if not public.nexora_admin_permiso('manage_payments') then return jsonb_build_object('error','No autorizado.'); end if;
  if p_monto is null or p_monto<=0 or p_monto>999999999999
     or char_length(btrim(coalesce(p_metodo,''))) not between 1 and 80
     or char_length(coalesce(p_referencia,''))>200 or char_length(coalesce(p_nota,''))>500
     or (coalesce(p_comprobante,'')<>'' and (length(p_comprobante)>700000 or p_comprobante !~ '^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$')) then
    return jsonb_build_object('error','Datos del reintegro inválidos.');
  end if;
  v_monto:=round(p_monto,2);
  if v_monto<=0 then return jsonb_build_object('error','El reintegro debe ser mayor que cero.'); end if;
  select * into v_a from public.pagos_abonos where id=p_abono_id;
  if not found then return jsonb_build_object('error','Abono no encontrado.'); end if;
  select * into v_p from public.pedidos where id=v_a.pedido_id for update;
  if not found then return jsonb_build_object('error','Pedido no encontrado.'); end if;
  if v_p.estado not in ('Pendiente','Nuevo','Pagado') then return jsonb_build_object('error','El pedido ya está cerrado.'); end if;
  select * into v_a from public.pagos_abonos where id=p_abono_id for update;
  if v_a.estado<>'verificado' then return jsonb_build_object('error','Solo se reintegran abonos verificados.'); end if;
  select coalesce(sum(r.monto),0) into v_comprometido from public.pagos_reintegros r
    where r.abono_id=p_abono_id and r.estado in ('pendiente','verificado');
  if v_comprometido+v_monto>v_a.monto then return jsonb_build_object('error','El reintegro supera el abono confirmado.'); end if;
  select
    coalesce((select sum(a.monto) from public.pagos_abonos a
      where a.pedido_id=v_p.id and a.estado='verificado'),0),
    coalesce((select sum(r.monto) from public.pagos_reintegros r
      join public.pagos_abonos a on a.id=r.abono_id
      where a.pedido_id=v_p.id and r.estado in ('pendiente','verificado')),0)
    into v_pagado_neto,v_reintegros_comprometidos;
  if v_reintegros_comprometidos+v_monto>v_pagado_neto then
    return jsonb_build_object('error','Los reintegros superan el pago confirmado del pedido.');
  end if;
  if v_p.estado='Pagado' and exists (
    select 1 from public.pedido_entregas d where d.pedido_id=v_p.id and d.estado in ('en_camino','entregado')
  ) then
    return jsonb_build_object('error','No se puede reintegrar un pedido enviado o entregado.');
  end if;
  insert into public.pagos_reintegros(abono_id,monto,metodo,referencia,comprobante,nota_admin,registrado_por)
    values(p_abono_id,v_monto,btrim(p_metodo),btrim(coalesce(p_referencia,'')),coalesce(p_comprobante,''),
      btrim(coalesce(p_nota,'')),auth.uid()) returning id into v_id;
  perform public.nexora_registrar_actividad('reintegro_registrado','reintegro',v_id::text,
    jsonb_build_object('pedido_id',v_p.id,'abono_id',p_abono_id,'monto',v_monto));
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.admin_verificar_reintegro(p_reintegro_id bigint,p_aprobar boolean,p_nota text default '')
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_r public.pagos_reintegros%rowtype; v_a public.pagos_abonos%rowtype;
  v_p public.pedidos%rowtype; v_por_abono numeric(14,2); v_neto numeric(14,2);
begin
  if not public.nexora_admin_permiso('manage_payments') then return jsonb_build_object('error','No autorizado.'); end if;
  if p_aprobar is null or char_length(coalesce(p_nota,''))>500 then return jsonb_build_object('error','Decisión inválida.'); end if;
  select * into v_r from public.pagos_reintegros where id=p_reintegro_id;
  if not found then return jsonb_build_object('error','Reintegro no encontrado.'); end if;
  select * into v_a from public.pagos_abonos where id=v_r.abono_id;
  if not found then return jsonb_build_object('error','Abono no encontrado.'); end if;
  select * into v_p from public.pedidos where id=v_a.pedido_id for update;
  if not found then return jsonb_build_object('error','Pedido no encontrado.'); end if;
  select * into v_r from public.pagos_reintegros where id=p_reintegro_id for update;
  if v_r.estado<>'pendiente' then return jsonb_build_object('error','El reintegro ya fue revisado.'); end if;
  if v_p.estado not in ('Pendiente','Nuevo','Pagado') then return jsonb_build_object('error','El pedido ya está cerrado.'); end if;
  if v_p.estado='Pagado' and p_aprobar then
    return jsonb_build_object('error','Aprueba todos los reintegros del pedido en una operacion atomica.');
  end if;
  if p_aprobar and v_r.referencia='' and v_r.comprobante='' then
    return jsonb_build_object('error','Para aprobar, registra la referencia o evidencia del reintegro y comprueba su fuente.');
  end if;
  select coalesce(sum(r.monto),0) into v_por_abono from public.pagos_reintegros r
    where r.abono_id=v_a.id and r.estado='verificado';
  if p_aprobar and v_por_abono+v_r.monto>v_a.monto then
    return jsonb_build_object('error','Los reintegros verificados superan el abono.');
  end if;
  update public.pagos_reintegros set estado=case when p_aprobar then 'verificado' else 'rechazado' end,
    nota_admin=case when btrim(coalesce(p_nota,''))='' then nota_admin else btrim(p_nota) end,
    verificado_por=auth.uid(),verificado_en=now() where id=p_reintegro_id;
  select
    coalesce((select sum(a.monto) from public.pagos_abonos a where a.pedido_id=v_p.id and a.estado='verificado'),0)
      -coalesce((select sum(r.monto) from public.pagos_reintegros r join public.pagos_abonos a on a.id=r.abono_id
        where a.pedido_id=v_p.id and r.estado='verificado'),0)
    into v_neto;
  perform public.nexora_registrar_actividad(case when p_aprobar then 'reintegro_verificado' else 'reintegro_rechazado' end,
    'reintegro',p_reintegro_id::text,jsonb_build_object('pedido_id',v_p.id,'monto',v_r.monto,'pagado_neto',v_neto));
  return jsonb_build_object('ok',true,'pagado_neto',v_neto);
end $$;

-- Un pedido Pagado solo admite reintegros completos en una operacion atomica:
-- se verifican juntos todos sus comprobantes, se cancela y se revierten
-- inventario y puntos en la misma transaccion.
create or replace function public.admin_verificar_reintegros_pedido(
  p_pedido_id text,p_aprobar boolean,p_nota text default ''
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_p public.pedidos%rowtype;
  v_pendientes numeric(14,2);
  v_verificados numeric(14,2);
  v_registrados numeric(14,2);
  v_total_abonos numeric(14,2);
begin
  if not public.nexora_admin_permiso('manage_payments') then
    return jsonb_build_object('error','No autorizado.');
  end if;
  if p_aprobar is null or char_length(coalesce(p_nota,''))>500 then
    return jsonb_build_object('error','Decision invalida.');
  end if;
  select * into v_p from public.pedidos where id=p_pedido_id for update;
  if not found then return jsonb_build_object('error','Pedido no encontrado.'); end if;
  if v_p.estado not in ('Pendiente','Nuevo','Pagado') then
    return jsonb_build_object('error','El pedido ya esta cerrado.');
  end if;
  if v_p.estado='Pagado' and v_p.version_precios is distinct from 1 then
    return jsonb_build_object('error','El pago de este pedido historico requiere conciliacion manual.');
  end if;

  select
    coalesce(sum(r.monto) filter (where r.estado='pendiente'),0),
    coalesce(sum(r.monto) filter (where r.estado='verificado'),0),
    coalesce(sum(r.monto) filter (where r.estado in ('pendiente','verificado')),0)
    into v_pendientes,v_verificados,v_registrados
  from public.pagos_reintegros r join public.pagos_abonos a on a.id=r.abono_id
  where a.pedido_id=v_p.id;
  if v_pendientes<=0 then return jsonb_build_object('error','No hay reintegros pendientes de revisar.'); end if;
  if p_aprobar and exists (select 1 from public.pagos_reintegros r join public.pagos_abonos a on a.id=r.abono_id
    where a.pedido_id=v_p.id and r.estado='pendiente' and r.referencia='' and r.comprobante='') then
    return jsonb_build_object('error','Cada reintegro debe tener referencia o evidencia revisada en su fuente.');
  end if;

  if p_aprobar and v_p.estado='Pagado' then
    select coalesce(sum(a.monto),0) into v_total_abonos
      from public.pagos_abonos a where a.pedido_id=v_p.id and a.estado='verificado';
    if v_p.total_validado is null or v_total_abonos-v_verificados<>v_p.total_validado
       or v_registrados<>v_total_abonos then
      return jsonb_build_object('error','Registra todos los reintegros por el saldo total para aprobar el reembolso del pedido pagado.');
    end if;
    if exists (select 1 from public.pedido_entregas d
      where d.pedido_id=v_p.id and d.estado in ('en_camino','entregado')) then
      return jsonb_build_object('error','No se reintegra un pedido enviado o entregado.');
    end if;
    update public.pagos_reintegros r
      set estado='verificado',verificado_por=auth.uid(),verificado_en=now(),
          nota_admin=case when btrim(coalesce(p_nota,''))='' then r.nota_admin else btrim(p_nota) end
      from public.pagos_abonos a
      where r.abono_id=a.id and a.pedido_id=v_p.id and r.estado='pendiente';
    perform set_config('nexora.order_rpc','on',true);
    update public.pedidos set estado='Cancelado',datos=jsonb_set(datos,'{historial}',
      coalesce(case when jsonb_typeof(datos->'historial')='array' then datos->'historial' else '[]'::jsonb end,'[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('de','Pagado','a','Cancelado','fecha',floor(extract(epoch from clock_timestamp())*1000)::bigint)),true)
      where id=v_p.id;
    perform set_config('nexora.order_rpc','off',true);
    perform public.nexora_registrar_actividad('reintegros_pedido_verificados','pedido',v_p.id,
      jsonb_build_object('monto',v_registrados,'estado','Cancelado'));
    return jsonb_build_object('ok',true,'estado','Cancelado','reintegrado',v_registrados);
  end if;

  update public.pagos_reintegros r
    set estado=case when p_aprobar then 'verificado' else 'rechazado' end,
        verificado_por=auth.uid(),verificado_en=now(),
        nota_admin=case when btrim(coalesce(p_nota,''))='' then r.nota_admin else btrim(p_nota) end
    from public.pagos_abonos a
    where r.abono_id=a.id and a.pedido_id=v_p.id and r.estado='pendiente';
  perform public.nexora_registrar_actividad(
    case when p_aprobar then 'reintegros_pedido_verificados' else 'reintegros_pedido_rechazados' end,
    'pedido',v_p.id,jsonb_build_object('monto',v_pendientes));
  return jsonb_build_object('ok',true,'estado',v_p.estado,'monto',v_pendientes);
end $$;

create or replace function public.admin_cambiar_estado_pedido(p_pedido_id text,p_estado text,p_motivo text default '')
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_p public.pedidos%rowtype; v_hist jsonb; v_permiso text;
begin
  if p_estado is null or p_estado not in ('Pagado','Entregado','Cancelado') then return jsonb_build_object('error','Estado inválido.'); end if;
  v_permiso:=case when p_estado='Pagado' then 'manage_payments'
    when p_estado='Entregado' then 'manage_deliveries' else 'manage_orders' end;
  if not public.nexora_admin_permiso(v_permiso) then return jsonb_build_object('error','No autorizado.'); end if;
  if p_estado='Cancelado' and (p_motivo is null or p_motivo not in ('cliente_solicito','sin_inventario','pago_reversado','otro')) then
    return jsonb_build_object('error','Elige un motivo de cancelación permitido.');
  end if;
  select * into v_p from public.pedidos where id=p_pedido_id for update;
  if not found then return jsonb_build_object('error','Pedido no encontrado.'); end if;
  if p_estado='Pagado' and coalesce(v_p.total_validado,0)>0 then
    return jsonb_build_object('error','Registra y verifica abonos hasta cubrir el total.');
  end if;
  v_hist:=case when jsonb_typeof(v_p.datos->'historial')='array' then v_p.datos->'historial' else '[]'::jsonb end;
  v_hist:=v_hist||jsonb_build_array(jsonb_build_object('de',v_p.estado,'a',p_estado,
    'fecha',floor(extract(epoch from clock_timestamp())*1000)::bigint));
  perform set_config('nexora.order_rpc','on',true);
  update public.pedidos set estado=p_estado,datos=jsonb_set(datos,'{historial}',v_hist,true)
    where id=v_p.id;
  perform set_config('nexora.order_rpc','off',true);
  if p_estado='Cancelado' then
    perform public.nexora_registrar_actividad('pedido_cancelado','pedido',v_p.id,
      jsonb_build_object('motivo',p_motivo));
  end if;
  return jsonb_build_object('ok',true,'estado',p_estado);
end $$;

create or replace function public.admin_actualizar_entrega(
  p_entrega_id bigint,p_estado text,p_datos_entrega jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_d public.pedido_entregas%rowtype; v_p public.pedidos%rowtype; v_confirmacion text;
begin
  if not public.nexora_admin_permiso('manage_deliveries') then return jsonb_build_object('error','No autorizado.'); end if;
  if p_estado is null or p_estado not in ('preparacion','en_camino','entregado','fallo')
     or jsonb_typeof(coalesce(p_datos_entrega,'{}'::jsonb)) is distinct from 'object'
     or octet_length(coalesce(p_datos_entrega,'{}'::jsonb)::text)>16000 then
    return jsonb_build_object('error','Datos o estado de entrega inválidos.');
  end if;
  select * into v_d from public.pedido_entregas where id=p_entrega_id for update;
  if not found then return jsonb_build_object('error','Entrega no encontrada.'); end if;
  select * into v_p from public.pedidos where id=v_d.pedido_id for update;
  if not found then return jsonb_build_object('error','Pedido no encontrado.'); end if;
  if v_p.estado not in ('Pagado','Entregado') then
    return jsonb_build_object('error','No se entrega ningún producto antes de cubrir el saldo del pedido.');
  end if;
  if v_p.total_validado is null then
    return jsonb_build_object('error','Reconcilia primero el total del pedido histórico.');
  end if;
  if exists (select 1 from public.pagos_reintegros r join public.pagos_abonos a on a.id=r.abono_id
    where a.pedido_id=v_p.id and r.estado='pendiente') then
    return jsonb_build_object('error','El pedido tiene reintegros pendientes; completa su conciliación antes de entregar.');
  end if;
  if v_d.estado in ('cancelado','entregado') then return jsonb_build_object('error','La entrega ya está cerrada.'); end if;
  v_confirmacion:=btrim(coalesce(p_datos_entrega->>'confirmacion',''));
  if p_estado='entregado' and v_d.tipo='digital' and char_length(v_confirmacion)<3 then
    return jsonb_build_object('error','Registra la confirmación o referencia de entrega digital.');
  end if;
  update public.pedido_entregas set estado=p_estado,datos_entrega=coalesce(p_datos_entrega,'{}'::jsonb),
    actualizado=now(),actualizado_por=auth.uid() where id=p_entrega_id;
  perform public.nexora_registrar_actividad('entrega_actualizada','entrega',p_entrega_id::text,
    jsonb_build_object('pedido_id',v_d.pedido_id,'tipo',v_d.tipo,'estado',p_estado));

  if p_estado='entregado' and not exists (
    select 1 from public.pedido_entregas d where d.pedido_id=v_p.id and d.estado<>'entregado'
  ) and v_p.estado='Pagado' then
    perform set_config('nexora.order_rpc','on',true);
    update public.pedidos set estado='Entregado',datos=jsonb_set(datos,'{historial}',
      coalesce(case when jsonb_typeof(datos->'historial')='array' then datos->'historial' else '[]'::jsonb end,'[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('de','Pagado','a','Entregado','fecha',floor(extract(epoch from clock_timestamp())*1000)::bigint)),true)
      where id=v_p.id;
    perform set_config('nexora.order_rpc','off',true);
  end if;
  return jsonb_build_object('ok',true,'estado',p_estado);
end $$;

create or replace function public.admin_ajustar_stock(p_producto_id text,p_stock integer,p_motivo text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_datos jsonb; v_tipo text; v_ilimitado boolean; v_anterior integer; v_delta integer;
begin
  if not public.nexora_admin_permiso('manage_products') then return jsonb_build_object('error','No autorizado.'); end if;
  if coalesce(p_producto_id,'') !~ '^[A-Za-z0-9_-]{1,40}$' or p_stock is null or p_stock<0
     or p_motivo is null or p_motivo not in ('conteo','recepcion','devolucion','correccion') then
    return jsonb_build_object('error','Producto, cantidad o motivo inválido.');
  end if;
  select datos into v_datos from public.productos where id=p_producto_id for update;
  if not found then return jsonb_build_object('error','Producto no encontrado.'); end if;
  v_tipo:=coalesce(v_datos->>'tipo','fisico');
  v_ilimitado:=v_tipo='virtual' and coalesce((v_datos->>'ilimitado')::boolean,false);
  if v_ilimitado then return jsonb_build_object('error','El producto digital tiene inventario ilimitado.'); end if;
  begin v_anterior:=coalesce((v_datos->>'stock')::integer,0);
  exception when others then return jsonb_build_object('error','El inventario actual requiere revisión manual.'); end;
  v_delta:=abs(p_stock-v_anterior);
  if p_stock<>v_anterior then
    perform set_config('nexora.stock_rpc','on',true);
    update public.productos set datos=jsonb_set(datos,'{stock}',to_jsonb(p_stock),true) where id=p_producto_id;
    perform set_config('nexora.stock_rpc','off',true);
    if v_delta>0 then
      insert into public.inventario_movimientos(pedido_id,producto_id,movimiento,cantidad,motivo,actor_id)
        values(null,p_producto_id,'ajuste_manual',v_delta,btrim(p_motivo),auth.uid());
    end if;
    perform public.nexora_registrar_actividad('stock_ajustado','producto',p_producto_id,
      jsonb_build_object('desde',v_anterior,'hasta',p_stock));
  end if;
  return jsonb_build_object('ok',true,'stock',p_stock);
end $$;

-- Endurece la lectura del catálogo, conservando lectura pública de activos y
-- CRUD autenticado para el rol de catálogo; los cambios quedan auditados arriba.
grant select on public.productos to anon,authenticated;
grant insert,update,delete on public.productos to authenticated;

-- Solo los RPC aprobados mutan pedidos/pagos/entregas/roles.
revoke all on function public.admin_crear_pedido(jsonb) from public,anon,authenticated;
revoke all on function public.admin_validar_pedido_anterior(text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.admin_registrar_abono(text,numeric,text,text,text,text) from public,anon,authenticated;
revoke all on function public.admin_verificar_abono(bigint,boolean,text) from public,anon,authenticated;
revoke all on function public.admin_registrar_reintegro(bigint,numeric,text,text,text,text) from public,anon,authenticated;
revoke all on function public.admin_verificar_reintegro(bigint,boolean,text) from public,anon,authenticated;
revoke all on function public.admin_verificar_reintegros_pedido(text,boolean,text) from public,anon,authenticated;
revoke all on function public.admin_cambiar_estado_pedido(text,text,text) from public,anon,authenticated;
revoke all on function public.admin_actualizar_entrega(bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public.admin_ajustar_stock(text,integer,text) from public,anon,authenticated;
grant execute on function public.admin_crear_pedido(jsonb),
  public.admin_validar_pedido_anterior(text,numeric,text,text),
  public.admin_registrar_abono(text,numeric,text,text,text,text),
  public.admin_verificar_abono(bigint,boolean,text),
  public.admin_registrar_reintegro(bigint,numeric,text,text,text,text),
  public.admin_verificar_reintegro(bigint,boolean,text),
  public.admin_verificar_reintegros_pedido(text,boolean,text),
  public.admin_cambiar_estado_pedido(text,text,text),
  public.admin_actualizar_entrega(bigint,text,jsonb),
  public.admin_ajustar_stock(text,integer,text)
to authenticated;

-- Notifica a PostgREST solo cuando se aplique en la ventana autorizada.
notify pgrst,'reload schema';
commit;

-- Comprobaciones de solo lectura para revisar después de la aplicación:
-- SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace
--   AND relname IN ('admin_roles','admin_activity','pagos_abonos','pedido_entregas','inventario_movimientos','pedidos');
-- SELECT proname,pg_get_function_identity_arguments(oid) FROM pg_proc
--   WHERE pronamespace='public'::regnamespace AND proname LIKE 'admin_%'
--   ORDER BY proname;
-- SELECT policyname,tablename,cmd,roles FROM pg_policies WHERE schemaname='public'
--   AND tablename IN ('pedidos','productos','admin_roles','admin_activity','pagos_abonos','pedido_entregas','inventario_movimientos')
--   ORDER BY tablename,policyname;
