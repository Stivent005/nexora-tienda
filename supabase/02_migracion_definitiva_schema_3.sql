
begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1) Renombrar columna de identidad 'tel' -> 'ff_id' si existe
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['puntos', 'puntos_mov', 'giros'] loop
    if exists (
      select 1 from information_schema.columns 
      where table_schema = 'public' and table_name = t and column_name = 'tel'
    ) and not exists (
      select 1 from information_schema.columns 
      where table_schema = 'public' and table_name = t and column_name = 'ff_id'
    ) then
      execute format('alter table public.%I rename column tel to ff_id', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) Ajustar tabla 'puntos' (Cuentas de jugadores)
-- ---------------------------------------------------------------------
create table if not exists public.puntos (
  ff_id        text primary key,
  puntos       integer not null default 0,
  total_ganado integer not null default 0,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now()
);

alter table public.puntos add column if not exists creado timestamptz not null default now();
alter table public.puntos add column if not exists actualizado timestamptz not null default now();
alter table public.puntos add column if not exists pin_hash text;
alter table public.puntos add column if not exists pin_definido timestamptz;

create unique index if not exists puntos_ff_id_uq on public.puntos (ff_id);

alter table public.puntos drop constraint if exists puntos_ff_id_formato;
alter table public.puntos add constraint puntos_ff_id_formato check (ff_id ~ '^[0-9]{6,15}$');

alter table public.puntos drop constraint if exists puntos_saldo_no_negativo;
alter table public.puntos add constraint puntos_saldo_no_negativo check (puntos >= 0);

-- ---------------------------------------------------------------------
-- 3) Ajustar tabla 'puntos_mov' (Historial auditable)
-- ---------------------------------------------------------------------
create table if not exists public.puntos_mov (
  id            bigserial primary key,
  ff_id         text not null,
  cantidad      integer not null,
  motivo        text not null default 'compra',
  pedido_id     text,
  ref           text,
  saldo_despues integer,
  creado        timestamptz not null default now()
);

-- Si viene de schema 2 donde pedido_id era la PK:
do $$
begin
  -- Si pedido_id es PK, remover la restricción para permitir nulos e inserciones múltiples
  if exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
    where tc.table_schema = 'public' and tc.table_name = 'puntos_mov'
      and tc.constraint_type = 'PRIMARY KEY' and kcu.column_name = 'pedido_id'
  ) then
    execute 'alter table public.puntos_mov drop constraint if exists puntos_mov_pkey';
  end if;
end $$;

-- Si existe columna vieja 'puntos' y no 'cantidad', renombrarla
do $$
begin
  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'puntos_mov' and column_name = 'puntos'
  ) and not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'puntos_mov' and column_name = 'cantidad'
  ) then
    execute 'alter table public.puntos_mov rename column puntos to cantidad';
  end if;
end $$;

alter table public.puntos_mov add column if not exists id bigserial;
alter table public.puntos_mov add column if not exists cantidad integer not null default 0;
alter table public.puntos_mov add column if not exists motivo text not null default 'compra';
alter table public.puntos_mov add column if not exists ref text;
alter table public.puntos_mov add column if not exists saldo_despues integer;
alter table public.puntos_mov alter column pedido_id drop not null;

-- Garantizar que 'id' sea PK si no tiene
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'puntos_mov' and constraint_type = 'PRIMARY KEY'
  ) then
    execute 'alter table public.puntos_mov add primary key (id)';
  end if;
end $$;

create index if not exists puntos_mov_ff_idx on public.puntos_mov (ff_id, creado desc);
create unique index if not exists puntos_mov_pedido_motivo_uq on public.puntos_mov (pedido_id, motivo) where pedido_id is not null;
create unique index if not exists puntos_mov_ref_uq on public.puntos_mov (ref) where ref is not null;

-- ---------------------------------------------------------------------
-- 4) Ajustar tabla 'intentos' (Protección de fuerza bruta en PIN y pedidos)
-- ---------------------------------------------------------------------
create table if not exists public.intentos (
  id     bigserial primary key,
  ip     text,
  ff_id  text,
  tipo   text not null default 'pin',
  creado timestamptz not null default now()
);

alter table public.intentos add column if not exists ff_id text;
alter table public.intentos add column if not exists tipo text not null default 'pin';
create index if not exists intentos_ff_idx on public.intentos (ff_id, tipo, creado);

-- ---------------------------------------------------------------------
-- 5) Ajustar tabla 'giros' (Registro de sorteos de ruleta)
-- ---------------------------------------------------------------------
create table if not exists public.giros (
  id             bigserial primary key,
  ff_id          text not null,
  premio         text not null,
  puntos_ganados integer not null default 0,
  catalogo_id    bigint,
  costo          integer not null default 0,
  clave          text,
  creado         timestamptz not null default now()
);

alter table public.giros add column if not exists catalogo_id bigint;
alter table public.giros add column if not exists costo integer not null default 0;
alter table public.giros add column if not exists clave text;
alter table public.giros add column if not exists puntos_ganados integer not null default 0;

create unique index if not exists giros_clave_uq on public.giros (clave) where clave is not null;
create index if not exists giros_ff_idx on public.giros (ff_id, creado desc);

-- ---------------------------------------------------------------------
-- 6) Tabla 'cupones_ruleta' (Cupones ganados en la ruleta)
-- ---------------------------------------------------------------------
create table if not exists public.cupones_ruleta (
  codigo   text primary key,
  ff_id    text not null,
  nombre   text not null,
  tipo     text not null check (tipo in ('pct', 'fijo')),
  valor    integer not null check (valor > 0),
  usado    boolean not null default false,
  giro_id  bigint,
  creado   timestamptz not null default now(),
  vence    timestamptz not null default now() + interval '60 days'
);
create index if not exists cupones_ruleta_ff_idx on public.cupones_ruleta (ff_id);

-- ---------------------------------------------------------------------
-- 7) Ajustar o crear 'premios' (Catálogo de premios canjeables de la tienda)
--    Si 'premios' era la tabla de cupones de schema 2, preservamos sus datos migrándolos a cupones_ruleta
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'premios' and column_name = 'codigo'
  ) and not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'premios' and column_name = 'costo_puntos'
  ) then
    -- Copiar cupones viejos a cupones_ruleta si aún no están
    insert into public.cupones_ruleta (codigo, ff_id, nombre, tipo, valor, usado, creado, vence)
    select 
      codigo, 
      coalesce(nullif(regexp_replace(coalesce(tel, ''), '\D', '', 'g'), ''), '000000'), 
      nombre, tipo, valor, usado, creado, vence
    from public.premios
    on conflict (codigo) do nothing;

    -- Renombrar la tabla vieja a respaldo
    execute 'alter table public.premios rename to premios_cupones_legacy';
  end if;
end $$;

create table if not exists public.premios (
  id           bigserial primary key,
  nombre       text not null,
  descripcion  text not null default '',
  costo_puntos integer not null,
  stock        integer,
  activo       boolean not null default true,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now()
);

alter table public.premios add column if not exists stock integer;
alter table public.premios add column if not exists activo boolean not null default true;
alter table public.premios add column if not exists descripcion text not null default '';
alter table public.premios add column if not exists actualizado timestamptz not null default now();

alter table public.premios drop constraint if exists premios_stock_ok;
alter table public.premios add constraint premios_stock_ok check (stock is null or stock >= 0);

alter table public.premios drop constraint if exists premios_costo_ok;
alter table public.premios add constraint premios_costo_ok check (costo_puntos > 0);

-- ---------------------------------------------------------------------
-- 8) Crear tabla 'catalogo_premios' (Premios que componen la ruleta)
-- ---------------------------------------------------------------------
create table if not exists public.catalogo_premios (
  id          bigserial primary key,
  nombre      text not null,
  descripcion text not null default '',
  tipo        text not null default 'nada',
  valor       text not null default '0',
  peso        integer not null default 0,
  stock       integer,
  activo      boolean not null default true,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

alter table public.catalogo_premios drop constraint if exists catalogo_premios_tipo_ok;
alter table public.catalogo_premios add constraint catalogo_premios_tipo_ok
  check (tipo in ('nada', 'puntos', 'pct', 'fijo', 'manual'));

alter table public.catalogo_premios drop constraint if exists catalogo_premios_peso_ok;
alter table public.catalogo_premios add constraint catalogo_premios_peso_ok check (peso >= 0);

alter table public.catalogo_premios drop constraint if exists catalogo_premios_stock_ok;
alter table public.catalogo_premios add constraint catalogo_premios_stock_ok check (stock is null or stock >= 0);

-- Semilla inicial para la ruleta si la tabla está vacía (pesos suman exactamente 100%)
insert into public.catalogo_premios (nombre, descripcion, tipo, valor, peso, stock, activo)
select d.nombre, d.descripcion, d.tipo, d.valor, d.peso, null, true
from (values
  ('5% de descuento', 'Cupón de 5% de descuento para tu próxima compra', 'pct', '5', 30),
  ('10% de descuento', 'Cupón de 10% de descuento para tu próxima compra', 'pct', '10', 15),
  ('+20 puntos', '20 puntos extra acreditados a tu saldo', 'puntos', '20', 25),
  ('Sigue intentando', 'No hubo premio esta vez, ¡sigue acumulando!', 'nada', '0', 20),
  ('$5.000 COP', 'Cupón de $5.000 COP de descuento', 'fijo', '5000', 8),
  ('20% de descuento', '¡Gran premio! 20% de descuento', 'pct', '20', 2)
) as d(nombre, descripcion, tipo, valor, peso)
where not exists (select 1 from public.catalogo_premios);

-- ---------------------------------------------------------------------
-- 9) Tabla 'canjes' (Canjes realizados y premios manuales)
-- ---------------------------------------------------------------------
create table if not exists public.canjes (
  id          bigserial primary key,
  ff_id       text not null,
  premio_id   bigint,
  nombre      text not null,
  costo       integer not null default 0,
  origen      text not null default 'canje' check (origen in ('canje', 'ruleta')),
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'entregado', 'cancelado')),
  clave       text,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

create unique index if not exists canjes_clave_uq on public.canjes (clave) where clave is not null;
create index if not exists canjes_ff_idx on public.canjes (ff_id, creado desc);
create index if not exists canjes_estado_idx on public.canjes (estado, creado desc);

-- ---------------------------------------------------------------------
-- 10) Limpieza de triggers obsoletos y prevención de doble asignación
-- ---------------------------------------------------------------------
-- Eliminar trigger y función heredada de schema 2 que asignaba puntos por teléfono
drop trigger if exists pedidos_puntos on public.pedidos;
drop function if exists public.pedidos_puntos();

-- ---------------------------------------------------------------------
-- 11) Funciones internas de normalización y lógica de negocio
-- ---------------------------------------------------------------------
create or replace function public.ff_norm(t text) returns text
language sql immutable set search_path = public as $$
  select case when regexp_replace(coalesce(t, ''), '\D', '', 'g') ~ '^[0-9]{6,15}$'
              then regexp_replace(t, '\D', '', 'g') end
$$;

create or replace function public.pedido_ff(d jsonb) returns text
language sql immutable set search_path = public as $$
  select public.ff_norm(coalesce(nullif(d ->> 'idJuego', ''), d -> 'cuenta' ->> 'id'))
$$;

create or replace function public.pin_error(p_ff text, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_hash text;
begin
  if (select count(*) from public.intentos where ff_id = p_ff and tipo = 'pin' and creado > now() - interval '15 minutes') >= 5 then
    return 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.';
  end if;
  select pin_hash into v_hash from public.puntos where ff_id = p_ff;
  if v_hash is null then
    return 'Esta cuenta todavía no tiene PIN. Créalo primero.';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' or crypt(p_pin, v_hash) <> v_hash then
    insert into public.intentos (ff_id, tipo) values (p_ff, 'pin');
    delete from public.intentos where creado < now() - interval '1 day';
    return 'PIN incorrecto.';
  end if;
  delete from public.intentos where ff_id = p_ff and tipo = 'pin';
  return null;
end $$;

create or replace function public.mover_puntos(p_ff text, p_cant int, p_motivo text, p_pedido text, p_ref text)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_saldo int;
begin
  insert into public.puntos (ff_id, puntos, total_ganado) values (p_ff, 0, 0) on conflict (ff_id) do nothing;
  update public.puntos
     set puntos = puntos + p_cant,
         total_ganado = total_ganado + greatest(p_cant, 0),
         actualizado = now()
   where ff_id = p_ff
   returning puntos into v_saldo;
  insert into public.puntos_mov (ff_id, cantidad, motivo, pedido_id, ref, saldo_despues)
  values (p_ff, p_cant, p_motivo, p_pedido, p_ref, v_saldo);
  return v_saldo;
end $$;

create or replace function public.puntos_de_pedido(d jsonb, p_cada int) returns int
language plpgsql immutable set search_path = public as $$
declare v_total numeric := 0; v_custom int := 0; v_custom_valor numeric := 0; it jsonb; v_pts numeric; v_q numeric; v_pr numeric;
begin
  begin v_total := (d ->> 'total')::numeric; exception when others then return 0; end;
  if jsonb_typeof(d -> 'items') = 'array' then
    for it in select * from jsonb_array_elements(d -> 'items') loop
      if jsonb_typeof(it -> 'puntos') = 'number' then
        v_pts := greatest(floor((it ->> 'puntos')::numeric), 0);
        v_q := greatest(coalesce((it ->> 'q')::numeric, 1), 1);
        v_pr := greatest(coalesce((it ->> 'pr')::numeric, 0), 0);
        v_custom := v_custom + (v_pts * v_q)::int;
        v_custom_valor := v_custom_valor + v_pr * v_q;
      end if;
    end loop;
  end if;
  if p_cada is null or p_cada <= 0 then return v_custom; end if;
  return v_custom + floor(greatest(v_total - v_custom_valor, 0) / p_cada)::int;
end $$;

create or replace function public.aplicar_puntos_pedido(p_id text, p_estado text, p_datos jsonb, p_anterior text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ff text := public.pedido_ff(p_datos); v_cada int; v_pts int; v_mov record; v_rev int;
begin
  if p_estado in ('Pagado', 'Entregado') and v_ff is not null then
    select coalesce((valor ->> 'cada')::int, 0) into v_cada from public.ajustes where clave = 'puntos';
    v_pts := public.puntos_de_pedido(p_datos, v_cada);
    if v_pts > 0 and not exists (select 1 from public.puntos_mov where pedido_id = p_id and motivo = 'compra') then
      perform public.mover_puntos(v_ff, v_pts, 'compra', p_id, null);
      return 'sumados ' || v_pts;
    end if;
    return 'sin cambios';
  end if;

  if p_estado = 'Cancelado' then
    select * into v_mov from public.puntos_mov where pedido_id = p_id and motivo = 'compra';
    if found and not exists (select 1 from public.puntos_mov where pedido_id = p_id and motivo = 'reversa_compra') then
      select least(v_mov.cantidad, puntos) into v_rev from public.puntos where ff_id = v_mov.ff_id for update;
      if coalesce(v_rev, 0) > 0 then
        perform public.mover_puntos(v_mov.ff_id, -v_rev, 'reversa_compra', p_id, null);
      else
        insert into public.puntos_mov (ff_id, cantidad, motivo, pedido_id, saldo_despues)
        select v_mov.ff_id, 0, 'reversa_compra', p_id, puntos from public.puntos where ff_id = v_mov.ff_id;
      end if;
      return 'revertidos ' || coalesce(v_rev, 0);
    end if;
    return 'sin cambios';
  end if;
  return 'sin cambios';
end $$;

create or replace function public.pedidos_puntos_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.aplicar_puntos_pedido(new.id, new.estado, new.datos, case when tg_op = 'UPDATE' then old.estado end);
  if new.estado in ('Pagado', 'Entregado') and coalesce(new.datos ->> 'cupon', '') <> '' then
    update public.cupones_ruleta set usado = true where codigo = upper(new.datos ->> 'cupon') and not usado;
  end if;
  return new;
end $$;

drop trigger if exists pedidos_puntos_trg on public.pedidos;
create trigger pedidos_puntos_trg
  after update of estado on public.pedidos
  for each row when (old.estado is distinct from new.estado)
  execute function public.pedidos_puntos_trg();

create or replace function public.pedidos_proteger_datos() returns trigger
language plpgsql set search_path = public as $$
declare k text;
begin
  foreach k in array array['idJuego', 'cuenta', 'items', 'total'] loop
    if old.datos ? k then
      new.datos := new.datos || jsonb_build_object(k, old.datos -> k);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists pedidos_proteger_datos on public.pedidos;
create trigger pedidos_proteger_datos
  before update on public.pedidos
  for each row execute function public.pedidos_proteger_datos();

-- ---------------------------------------------------------------------
-- 12) Funciones RPC públicas y de administración
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select oid::regprocedure as firma from pg_proc where proname = 'procesar_puntos_pedido' and pronamespace = 'public'::regnamespace loop
    execute 'drop function ' || f.firma;
  end loop;
end $$;

create or replace function public.procesar_puntos_pedido(p_pedido_id text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p record;
begin
  if not public.es_admin() then return jsonb_build_object('error', 'No autorizado.'); end if;
  select * into v_p from public.pedidos where id = p_pedido_id;
  if not found then return jsonb_build_object('error', 'Pedido no encontrado.'); end if;
  return jsonb_build_object('ok', true, 'resultado', public.aplicar_puntos_pedido(v_p.id, v_p.estado, v_p.datos, null));
end $$;

create or replace function public.ruleta_publica() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_obj int; v_n int; v_lista jsonb;
begin
  select coalesce((valor ->> 'objetivo')::int, 0) into v_obj from public.ajustes where clave = 'puntos';
  select count(*), coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'descripcion', coalesce(descripcion, '')) order by id), '[]'::jsonb)
    into v_n, v_lista from public.catalogo_premios where activo;
  return jsonb_build_object('activa', coalesce(v_obj, 0) > 0 and v_n >= 2, 'costo', coalesce(v_obj, 0), 'premios', v_lista);
end $$;

create or replace function public.consultar_puntos(p_ff text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ff text := public.ff_norm(p_ff); v_c record; v_ex boolean;
begin
  if v_ff is null then return jsonb_build_object('error', 'Escribe tu ID de Free Fire (solo números).'); end if;
  select ff_id, puntos, total_ganado, (pin_hash is not null) as tiene_pin into v_c from public.puntos where ff_id = v_ff;
  v_ex := found;
  return jsonb_build_object(
    'ok', true, 'ff_id', v_ff, 'existe', v_ex,
    'tiene_pin', coalesce(v_c.tiene_pin, false),
    'puntos', coalesce(v_c.puntos, 0),
    'total_ganado', coalesce(v_c.total_ganado, 0),
    'movimientos', (select coalesce(jsonb_agg(jsonb_build_object('cantidad', m.cantidad, 'motivo', m.motivo, 'creado', m.creado) order by m.creado desc, m.id desc), '[]'::jsonb)
                      from (select * from public.puntos_mov where ff_id = v_ff order by creado desc, id desc limit 30) m),
    'premios', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', coalesce(p.descripcion, ''),
                                                              'costo', p.costo_puntos, 'disponible', (p.stock is null or p.stock > 0)) order by p.costo_puntos, p.id), '[]'::jsonb)
                  from public.premios p where p.activo),
    'ruleta', public.ruleta_publica());
end $$;

create or replace function public.crear_cuenta(p_ff text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_ff text := public.ff_norm(p_ff);
begin
  if v_ff is null then return jsonb_build_object('error', 'Escribe tu ID de Free Fire (solo números).'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then return jsonb_build_object('error', 'El PIN debe tener de 4 a 6 números.'); end if;
  if exists (select 1 from public.puntos where ff_id = v_ff) then
    if exists (select 1 from public.puntos where ff_id = v_ff and pin_hash is not null) then
      return jsonb_build_object('error', 'Ese ID ya tiene cuenta. Entra con tu PIN.');
    end if;
    return jsonb_build_object('error', 'Ese ID ya tiene puntos de compras. Actívalo con el número de uno de tus pedidos.');
  end if;
  insert into public.puntos (ff_id, puntos, total_ganado, pin_hash, pin_definido)
  values (v_ff, 0, 0, crypt(p_pin, gen_salt('bf', 8)), now());
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.definir_pin(p_ff text, p_pedido text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_ff text := public.ff_norm(p_ff); v_ped text := right(upper(trim(coalesce(p_pedido, ''))), 6);
begin
  if v_ff is null then return jsonb_build_object('error', 'Escribe tu ID de Free Fire (solo números).'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then return jsonb_build_object('error', 'El PIN debe tener de 4 a 6 números.'); end if;
  if (select count(*) from public.intentos where ff_id = v_ff and tipo = 'pedido' and creado > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('error', 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');
  end if;
  if length(v_ped) < 4 or not exists (
       select 1 from public.pedidos
        where estado <> 'Cancelado' and public.pedido_ff(datos) = v_ff and right(upper(id), 6) = v_ped) then
    insert into public.intentos (ff_id, tipo) values (v_ff, 'pedido');
    return jsonb_build_object('error', 'No encontramos un pedido con ese ID de Free Fire y ese número.');
  end if;
  delete from public.intentos where ff_id = v_ff and tipo in ('pedido', 'pin');
  insert into public.puntos (ff_id, puntos, total_ganado, pin_hash, pin_definido)
  values (v_ff, 0, 0, crypt(p_pin, gen_salt('bf', 8)), now())
  on conflict (ff_id) do update set pin_hash = excluded.pin_hash, pin_definido = now(), actualizado = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.detalle_cuenta(p_ff text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_ff text := public.ff_norm(p_ff); v_err text;
begin
  if v_ff is null then return jsonb_build_object('error', 'ID de Free Fire inválido.'); end if;
  v_err := public.pin_error(v_ff, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  return jsonb_build_object('ok', true,
    'cupones', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'tipo', tipo, 'valor', valor) order by creado desc), '[]'::jsonb)
                  from public.cupones_ruleta where ff_id = v_ff and not usado and vence > now()),
    'canjes', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'costo', costo, 'estado', estado, 'origen', origen, 'creado', creado) order by creado desc), '[]'::jsonb)
                 from (select * from public.canjes where ff_id = v_ff order by creado desc limit 20) c));
end $$;

create or replace function public.canjear_premio(p_ff text, p_pin text, p_premio bigint, p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_ff text := public.ff_norm(p_ff); v_err text; v_saldo int; v_p record; v_id bigint; v_prev record;
begin
  if v_ff is null then return jsonb_build_object('error', 'ID de Free Fire inválido.'); end if;
  if coalesce(p_clave, '') !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('error', 'Solicitud inválida.'); end if;
  v_err := public.pin_error(v_ff, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;

  select puntos into v_saldo from public.puntos where ff_id = v_ff for update;

  select * into v_prev from public.canjes where clave = 'c-' || p_clave;
  if found then
    if v_prev.ff_id <> v_ff then return jsonb_build_object('error', 'Solicitud inválida.'); end if;
    return jsonb_build_object('ok', true, 'repetido', true, 'puntos', v_saldo, 'nombre', v_prev.nombre);
  end if;

  select * into v_p from public.premios where id = p_premio for update;
  if not found or not v_p.activo then return jsonb_build_object('error', 'Ese premio ya no está disponible.'); end if;
  if v_p.stock is not null and v_p.stock <= 0 then return jsonb_build_object('error', 'Premio agotado.'); end if;
  if v_saldo < v_p.costo_puntos then return jsonb_build_object('error', 'No tienes puntos suficientes.'); end if;

  if v_p.stock is not null then update public.premios set stock = stock - 1, actualizado = now() where id = v_p.id; end if;
  insert into public.canjes (ff_id, premio_id, nombre, costo, origen, estado, clave)
  values (v_ff, v_p.id, v_p.nombre, v_p.costo_puntos, 'canje', 'pendiente', 'c-' || p_clave)
  returning id into v_id;
  v_saldo := public.mover_puntos(v_ff, -v_p.costo_puntos, 'canje', null, 'canje-' || v_id);
  return jsonb_build_object('ok', true, 'puntos', v_saldo, 'nombre', v_p.nombre, 'costo', v_p.costo_puntos);
end $$;

create or replace function public.girar_ruleta(p_ff text, p_pin text, p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_ff text := public.ff_norm(p_ff); v_err text; v_costo int; v_saldo int; v_prev record;
  v_n int; v_tot numeric; v_r numeric; v_acc numeric := 0; v_sel record; v_idx int := 0; v_pos int := 0; v_hay boolean := false;
  v_tipo text; v_val int; v_cod text := null; v_gano int := 0; v_giro bigint; r record;
begin
  if v_ff is null then return jsonb_build_object('error', 'ID de Free Fire inválido.'); end if;
  if coalesce(p_clave, '') !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('error', 'Solicitud inválida.'); end if;
  v_err := public.pin_error(v_ff, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;

  select puntos into v_saldo from public.puntos where ff_id = v_ff for update;

  select * into v_prev from public.giros where clave = 'g-' || p_clave;
  if found then
    if v_prev.ff_id <> v_ff then return jsonb_build_object('error', 'Solicitud inválida.'); end if;
    select count(*) into v_idx from public.catalogo_premios where activo and id < v_prev.catalogo_id;
    return jsonb_build_object('ok', true, 'repetido', true, 'indice', v_idx, 'nombre', v_prev.premio, 'puntos', v_saldo);
  end if;

  select coalesce((valor ->> 'objetivo')::int, 0) into v_costo from public.ajustes where clave = 'puntos';
  select count(*) into v_n from public.catalogo_premios where activo;
  if coalesce(v_costo, 0) <= 0 or v_n < 2 then return jsonb_build_object('error', 'La ruleta no está disponible.'); end if;
  if v_saldo < v_costo then return jsonb_build_object('error', 'Necesitas ' || v_costo || ' puntos para girar.'); end if;

  select coalesce(sum(peso), 0) into v_tot from public.catalogo_premios
   where activo and peso > 0 and (stock is null or stock > 0);
  if v_tot <= 0 then return jsonb_build_object('error', 'La ruleta no tiene premios disponibles en este momento.'); end if;

  v_r := random() * v_tot;
  for r in select * from public.catalogo_premios where activo order by id for update loop
    if not v_hay and r.peso > 0 and (r.stock is null or r.stock > 0) then
      v_acc := v_acc + r.peso;
      if v_r < v_acc then v_sel := r; v_idx := v_pos; v_hay := true; end if;
    end if;
    v_pos := v_pos + 1;
  end loop;
  if not v_hay then return jsonb_build_object('error', 'La ruleta no tiene premios disponibles en este momento.'); end if;

  v_tipo := v_sel.tipo;
  begin v_val := greatest(coalesce(nullif(v_sel.valor, '')::numeric, 0), 0)::int; exception when others then v_val := 0; end;
  if v_tipo not in ('nada', 'puntos', 'pct', 'fijo', 'manual') then v_tipo := 'manual'; end if;
  if v_tipo = 'pct' then v_val := least(v_val, 100); end if;

  if v_sel.stock is not null then update public.catalogo_premios set stock = stock - 1, actualizado = now() where id = v_sel.id; end if;

  insert into public.giros (ff_id, premio, puntos_ganados, catalogo_id, costo, clave)
  values (v_ff, v_sel.nombre, 0, v_sel.id, v_costo, 'g-' || p_clave) returning id into v_giro;
  v_saldo := public.mover_puntos(v_ff, -v_costo, 'ruleta_giro', null, 'giro-' || v_giro);

  if v_tipo = 'puntos' and v_val > 0 then
    v_saldo := public.mover_puntos(v_ff, v_val, 'ruleta_premio', null, 'premio-' || v_giro);
    v_gano := v_val;
    update public.giros set puntos_ganados = v_val where id = v_giro;
  elsif v_tipo in ('pct', 'fijo') and v_val > 0 then
    v_cod := 'R' || upper(substr(md5(random()::text || clock_timestamp()::text || v_ff), 1, 8));
    insert into public.cupones_ruleta (codigo, ff_id, nombre, tipo, valor, giro_id) values (v_cod, v_ff, left(v_sel.nombre, 60), v_tipo, v_val, v_giro);
  elsif v_tipo = 'manual' then
    insert into public.canjes (ff_id, premio_id, nombre, costo, origen, estado, clave)
    values (v_ff, v_sel.id, left(v_sel.nombre, 60), 0, 'ruleta', 'pendiente', 'r-' || v_giro);
  else
    v_tipo := 'nada';
  end if;

  return jsonb_build_object('ok', true, 'indice', v_idx, 'nombre', v_sel.nombre, 'tipo', v_tipo, 'valor', v_val,
                            'codigo', v_cod, 'puntos', v_saldo, 'ganados', v_gano, 'segmentos', v_n);
end $$;

create or replace function public.validar_premio(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v record;
begin
  select tipo, valor into v from public.cupones_ruleta where codigo = upper(trim(coalesce(p_codigo, ''))) and not usado and vence > now();
  if not found then return null; end if;
  return jsonb_build_object('tipo', v.tipo, 'valor', v.valor);
end $$;

create or replace function public.admin_guardar_ruleta(p_premios jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; v_act int := 0; v_sum int := 0; v_tipo text; v_val numeric; v_peso int; v_stock int; v_id bigint; v_nom text; v_activo boolean;
begin
  if not public.es_admin() then return jsonb_build_object('error', 'No autorizado.'); end if;
  if jsonb_typeof(p_premios) is distinct from 'array' then return jsonb_build_object('error', 'Datos inválidos.'); end if;

  for e in select * from jsonb_array_elements(p_premios) loop
    continue when coalesce((e ->> 'eliminar')::boolean, false);
    v_nom := btrim(coalesce(e ->> 'nombre', ''));
    v_tipo := coalesce(e ->> 'tipo', '');
    v_activo := coalesce((e ->> 'activo')::boolean, true);
    if char_length(v_nom) not between 1 and 30 then return jsonb_build_object('error', 'Cada premio necesita un nombre de 1 a 30 letras.'); end if;
    if v_tipo not in ('nada', 'puntos', 'pct', 'fijo', 'manual') then return jsonb_build_object('error', 'Tipo de premio inválido en "' || v_nom || '".'); end if;
    begin v_peso := (e ->> 'peso')::int; exception when others then return jsonb_build_object('error', 'Probabilidad inválida en "' || v_nom || '".'); end;
    if v_peso is null or v_peso < 0 or v_peso > 100 then return jsonb_build_object('error', 'La probabilidad de "' || v_nom || '" debe estar entre 0 y 100.'); end if;
    if v_tipo in ('puntos', 'pct', 'fijo') then
      begin v_val := (e ->> 'valor')::numeric; exception when others then return jsonb_build_object('error', 'Valor inválido en "' || v_nom || '".'); end;
      if v_val is null or v_val <= 0 or v_val <> floor(v_val) then return jsonb_build_object('error', 'El valor de "' || v_nom || '" debe ser un entero mayor que 0.'); end if;
      if v_tipo = 'pct' and v_val > 100 then return jsonb_build_object('error', 'Un descuento en % no puede pasar de 100 ("' || v_nom || '").'); end if;
    end if;
    if nullif(e ->> 'stock', '') is not null then
      begin v_stock := (e ->> 'stock')::int; exception when others then return jsonb_build_object('error', 'Stock inválido en "' || v_nom || '".'); end;
      if v_stock < 0 then return jsonb_build_object('error', 'El stock de "' || v_nom || '" no puede ser negativo.'); end if;
    end if;
    if v_activo then
      if v_peso < 1 then return jsonb_build_object('error', '"' || v_nom || '" está activo con probabilidad 0. Ponle al menos 1 o desactívalo.'); end if;
      v_act := v_act + 1; v_sum := v_sum + v_peso;
    end if;
  end loop;
  if v_act < 2 or v_act > 12 then return jsonb_build_object('error', 'La ruleta necesita entre 2 y 12 premios activos.'); end if;
  if v_sum <> 100 then return jsonb_build_object('error', 'Las probabilidades de los premios activos suman ' || v_sum || ' %. Deben sumar exactamente 100 %.'); end if;

  for e in select * from jsonb_array_elements(p_premios) loop
    v_id := nullif(e ->> 'id', '')::bigint;
    if coalesce((e ->> 'eliminar')::boolean, false) then
      if v_id is not null then delete from public.catalogo_premios where id = v_id; end if;
      continue;
    end if;
    v_tipo := e ->> 'tipo';
    v_stock := nullif(e ->> 'stock', '')::int;
    if v_id is null then
      insert into public.catalogo_premios (nombre, descripcion, tipo, valor, peso, stock, activo)
      values (btrim(e ->> 'nombre'), left(coalesce(e ->> 'descripcion', ''), 200), v_tipo,
              case when v_tipo in ('nada') then '0' else left(coalesce(nullif(btrim(e ->> 'valor'), ''), '0'), 60) end,
              (e ->> 'peso')::int, v_stock, coalesce((e ->> 'activo')::boolean, true));
    else
      update public.catalogo_premios
         set nombre = btrim(e ->> 'nombre'), descripcion = left(coalesce(e ->> 'descripcion', ''), 200), tipo = v_tipo,
             valor = case when v_tipo in ('nada') then '0' else left(coalesce(nullif(btrim(e ->> 'valor'), ''), '0'), 60) end,
             peso = (e ->> 'peso')::int, stock = v_stock, activo = coalesce((e ->> 'activo')::boolean, true), actualizado = now()
       where id = v_id;
    end if;
  end loop;

  select count(*), coalesce(sum(peso), 0) into v_act, v_sum from public.catalogo_premios where activo;
  if v_act < 2 or v_act > 12 or v_sum <> 100 then
    raise exception 'La ruleta guardada tendría % premios activos y probabilidades que suman % %%. No se guardó nada.', v_act, v_sum;
  end if;
  return jsonb_build_object('ok', true, 'suma', v_sum, 'activos', v_act);
end $$;

create or replace function public.admin_guardar_premio_canje(p_id bigint, p_nombre text, p_descripcion text, p_costo int, p_stock int, p_activo boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.es_admin() then return jsonb_build_object('error', 'No autorizado.'); end if;
  if char_length(btrim(coalesce(p_nombre, ''))) not between 1 and 60 then return jsonb_build_object('error', 'El nombre debe tener de 1 a 60 letras.'); end if;
  if p_costo is null or p_costo < 1 or p_costo > 1000000 then return jsonb_build_object('error', 'El costo en puntos debe ser un entero mayor que 0.'); end if;
  if p_stock is not null and p_stock < 0 then return jsonb_build_object('error', 'El stock no puede ser negativo.'); end if;
  if p_id is null then
    insert into public.premios (nombre, descripcion, costo_puntos, stock, activo)
    values (btrim(p_nombre), left(coalesce(p_descripcion, ''), 200), p_costo, p_stock, coalesce(p_activo, true));
  else
    update public.premios set nombre = btrim(p_nombre), descripcion = left(coalesce(p_descripcion, ''), 200), costo_puntos = p_costo,
           stock = p_stock, activo = coalesce(p_activo, true), actualizado = now() where id = p_id;
    if not found then return jsonb_build_object('error', 'Premio no encontrado.'); end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_borrar_premio_canje(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.es_admin() then return jsonb_build_object('error', 'No autorizado.'); end if;
  delete from public.premios where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_estado_canje(p_id bigint, p_estado text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record;
begin
  if not public.es_admin() then return jsonb_build_object('error', 'No autorizado.'); end if;
  if p_estado not in ('entregado', 'cancelado') then return jsonb_build_object('error', 'Estado inválido.'); end if;
  select * into c from public.canjes where id = p_id for update;
  if not found then return jsonb_build_object('error', 'Canje no encontrado.'); end if;
  if c.estado <> 'pendiente' then return jsonb_build_object('error', 'Ese canje ya está ' || c.estado || '.'); end if;
  update public.canjes set estado = p_estado, actualizado = now() where id = p_id;
  if p_estado = 'cancelado' and c.origen = 'canje' and c.costo > 0 then
    perform public.mover_puntos(c.ff_id, c.costo, 'canje_cancelado', null, 'canje-cancelado-' || c.id);
    update public.premios set stock = stock + 1, actualizado = now() where id = c.premio_id and stock is not null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 13) Políticas de seguridad RLS y permisos
-- ---------------------------------------------------------------------
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
            where schemaname = 'public'
              and tablename in ('puntos', 'puntos_mov', 'premios', 'catalogo_premios', 'giros', 'intentos', 'cupones_ruleta', 'canjes')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.puntos           enable row level security;
alter table public.puntos_mov       enable row level security;
alter table public.premios          enable row level security;
alter table public.catalogo_premios enable row level security;
alter table public.giros            enable row level security;
alter table public.intentos         enable row level security;
alter table public.cupones_ruleta   enable row level security;
alter table public.canjes           enable row level security;

revoke all on public.puntos, public.puntos_mov, public.premios, public.catalogo_premios,
              public.giros, public.intentos, public.cupones_ruleta, public.canjes from anon, authenticated;

-- El administrador autenticado lee las tablas (puntos sin pin_hash)
grant select (ff_id, puntos, total_ganado, creado, actualizado, pin_definido) on public.puntos to authenticated;
grant select on public.puntos_mov, public.premios, public.catalogo_premios, public.giros,
                public.cupones_ruleta, public.canjes to authenticated;

create policy "admin lee puntos"    on public.puntos           for select to authenticated using (public.es_admin());
create policy "admin lee mov"       on public.puntos_mov       for select to authenticated using (public.es_admin());
create policy "admin lee premios"   on public.premios          for select to authenticated using (public.es_admin());
create policy "admin lee catalogo"  on public.catalogo_premios for select to authenticated using (public.es_admin());
create policy "admin lee giros"     on public.giros            for select to authenticated using (public.es_admin());
create policy "admin lee cupones"   on public.cupones_ruleta   for select to authenticated using (public.es_admin());
create policy "admin lee canjes"    on public.canjes           for select to authenticated using (public.es_admin());

-- Revocar llamadas públicas indiscriminadas
revoke all on function
  public.ff_norm(text), public.pedido_ff(jsonb), public.pin_error(text, text), public.mover_puntos(text, int, text, text, text),
  public.puntos_de_pedido(jsonb, int), public.aplicar_puntos_pedido(text, text, jsonb, text), public.pedidos_puntos_trg(), public.pedidos_proteger_datos(),
  public.procesar_puntos_pedido(text),
  public.ruleta_publica(), public.consultar_puntos(text), public.crear_cuenta(text, text), public.definir_pin(text, text, text),
  public.detalle_cuenta(text, text), public.canjear_premio(text, text, bigint, text), public.girar_ruleta(text, text, text),
  public.validar_premio(text),
  public.admin_guardar_ruleta(jsonb), public.admin_guardar_premio_canje(bigint, text, text, int, int, boolean),
  public.admin_borrar_premio_canje(bigint), public.admin_estado_canje(bigint, text)
from public, anon, authenticated;

-- Permisos a clientes (anon) y autenticados (authenticated) para funciones RPC de la tienda
grant execute on function
  public.ruleta_publica(), public.consultar_puntos(text), public.crear_cuenta(text, text), public.definir_pin(text, text, text),
  public.detalle_cuenta(text, text), public.canjear_premio(text, text, bigint, text), public.girar_ruleta(text, text, text),
  public.validar_premio(text)
to anon, authenticated;

-- Permisos exclusivos para el administrador autenticado
grant execute on function
  public.procesar_puntos_pedido(text), public.admin_guardar_ruleta(jsonb),
  public.admin_guardar_premio_canje(bigint, text, text, int, int, boolean), public.admin_borrar_premio_canje(bigint),
  public.admin_estado_canje(bigint, text)
to authenticated;

notify pgrst, 'reload schema';

commit;
