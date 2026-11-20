select 
  table_name,
  (xpath('/row/cnt/text()', xml_count))[1]::text::int as total_filas
from (
  select table_name, 
         query_to_xml(format('select count(*) as cnt from public.%I', table_name), false, true, '') as xml_count
  from information_schema.tables 
  where table_schema = 'public' 
    and table_name in ('admins','pedidos','productos','ajustes','puntos','puntos_mov','premios','catalogo_premios','giros','intentos','cupones_ruleta','canjes')
) t
order by table_name;

-- 2) Comprobar columnas clave en puntos, puntos_mov, premios, giros e intentos
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('puntos','puntos_mov','premios','catalogo_premios','giros','intentos','cupones_ruleta')
  and column_name in ('tel','ff_id','puntos','cantidad','motivo','pedido_id','codigo','costo_puntos','puntos_ganados','pin_hash','tipo')
order by table_name, column_name;

-- 3) Claves primarias actuales de las tablas de puntos
select tc.table_name, tc.constraint_name, kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'PRIMARY KEY'
  and tc.table_name in ('puntos','puntos_mov','premios','catalogo_premios','giros','intentos','cupones_ruleta','canjes')
order by tc.table_name;

-- 4) Triggers activos en la tabla de pedidos (detectar si aún existe el viejo 'pedidos_puntos')
select tgname, tgenabled, proname as funcion_asociada
from pg_trigger tr
join pg_proc pr on tr.tgfoid = pr.oid
where tgrelid = 'public.pedidos'::regclass
  and not tgisinternal
order by tgname;

-- 5) Funciones RPC existentes y número de parámetros
select proname, pg_get_function_identity_arguments(oid) as argumentos, prosecdef as es_security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'procesar_puntos_pedido','pedidos_puntos','pedidos_puntos_trg','pedidos_proteger_datos',
    'ruleta_publica','consultar_puntos','crear_cuenta','definir_pin','detalle_cuenta',
    'canjear_premio','girar_ruleta','validar_premio','admin_guardar_ruleta',
    'admin_guardar_premio_canje','admin_borrar_premio_canje','admin_estado_canje','es_admin'
  )
order by proname;

-- 6) Estado de Row Level Security (RLS) en todas las tablas
select relname as tabla, relrowsecurity as rls_activado
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('admins','pedidos','productos','ajustes','puntos','puntos_mov','premios','catalogo_premios','giros','intentos','cupones_ruleta','canjes')
order by relname;

-- 7) Ajustes de puntos y ruleta almacenados
select clave, valor
from public.ajustes
where clave in ('puntos','ruleta');
