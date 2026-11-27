-- =====================================================================
-- 03: VERIFICACIÓN POST-MIGRACIÓN (SOLO LECTURA)
-- Ejecutar en: Supabase > SQL Editor > Run después de 02_migracion_definitiva_schema_3.sql
-- =====================================================================

-- 1) RLS activo en todas las tablas -> Todas deben devolver true
select relname as tabla, relrowsecurity as rls_activo
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('puntos','puntos_mov','premios','catalogo_premios','giros','intentos','cupones_ruleta','canjes','pedidos')
order by relname;

-- 2) Comprobar que las 21 funciones existen en el esquema public
select proname as funcion, pg_get_function_identity_arguments(oid) as argumentos
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'ff_norm','pedido_ff','pin_error','mover_puntos','puntos_de_pedido','aplicar_puntos_pedido',
    'pedidos_puntos_trg','pedidos_proteger_datos','procesar_puntos_pedido','ruleta_publica','consultar_puntos',
    'crear_cuenta','definir_pin','detalle_cuenta','canjear_premio','girar_ruleta','validar_premio',
    'admin_guardar_ruleta','admin_guardar_premio_canje','admin_borrar_premio_canje','admin_estado_canje'
  )
order by proname;

-- 3) Permisos de ejecución de la llave pública (anon)
--    Esperado:
--    true  : consultar_puntos, crear_cuenta, definir_pin, detalle_cuenta, canjear_premio, girar_ruleta, ruleta_publica, validar_premio
--    false : mover_puntos, pin_error, aplicar_puntos_pedido, procesar_puntos_pedido, admin_*
select p.proname as funcion, has_function_privilege('anon', p.oid, 'execute') as anon_puede_ejecutar
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'consultar_puntos','crear_cuenta','definir_pin','detalle_cuenta','canjear_premio','girar_ruleta','ruleta_publica','validar_premio',
    'mover_puntos','pin_error','aplicar_puntos_pedido','procesar_puntos_pedido',
    'admin_guardar_ruleta','admin_guardar_premio_canje','admin_borrar_premio_canje','admin_estado_canje'
  )
order by anon_puede_ejecutar desc, p.proname;

-- 4) Triggers en pedidos (debe verse pedidos_puntos_trg y pedidos_proteger_datos; NO debe existir pedidos_puntos)
select tgname as nombre_trigger, tgenabled as habilitado
from pg_trigger
where tgrelid = 'public.pedidos'::regclass
  and not tgisinternal
order by tgname;

-- 5) Índices únicos de integridad creados
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and indexname in ('puntos_ff_id_uq','puntos_mov_pedido_motivo_uq','puntos_mov_ref_uq','giros_clave_uq','canjes_clave_uq')
order by tablename, indexname;

-- 6) Prueba de llamada pública (Simulación de tienda)
select public.ruleta_publica() as test_ruleta_publica;
select public.consultar_puntos('123456789') as test_consultar_puntos;

-- 7) Suma de probabilidades activas de la ruleta -> Debe sumar exactamente 100
select 
  count(*) as premios_activos, 
  coalesce(sum(peso), 0) as suma_pesos_porcentaje
from public.catalogo_premios 
where activo;
