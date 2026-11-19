-- ============================================================================
-- 06: VERIFICACIÓN LOCALMENTE PREPARADA (SOLO LECTURA)
--
-- No se ha ejecutado. Usar solo después de una futura aprobación y de aplicar
-- 05_seguridad_compras_pagos.sql en un entorno de prueba.
-- No selecciona nombres, correos, pedidos, comprobantes ni datos de clientes.
-- ============================================================================

-- 1) Las tablas sensibles deben tener RLS activo.
select c.relname as tabla,c.relrowsecurity as rls_activo
from pg_class c
where c.relnamespace='public'::regnamespace
  and c.relname in (
    'admin_roles','admin_activity','pagos_abonos','pagos_reintegros','pedido_entregas',
    'inventario_movimientos','pedidos','productos'
  )
order by c.relname;

-- 2) Rutas y permisos publicados: las operaciones de mutación deben estar
-- disponibles solo a authenticated; anon no debe poder ejecutarlas.
select p.proname,pg_get_function_identity_arguments(p.oid) as argumentos,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_ejecuta,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_ejecuta
from pg_proc p
where p.pronamespace='public'::regnamespace
  and p.proname in (
    'admin_asignar_rol','admin_listar_roles','admin_crear_pedido','admin_validar_pedido_anterior',
    'admin_registrar_abono','admin_verificar_abono','admin_registrar_reintegro','admin_verificar_reintegro',
    'admin_verificar_reintegros_pedido','admin_cambiar_estado_pedido',
    'admin_actualizar_entrega','admin_ajustar_stock'
  )
order by p.proname;

-- El checkout puede crear un pedido validado, pero solo recibe una respuesta
-- mínima (ID/total) y no obtiene permisos de lectura de pedidos.
select
  has_function_privilege('anon','public.crear_pedido_seguro(jsonb)','EXECUTE') as anon_crea_pedido_validado,
  has_function_privilege('authenticated','public.crear_pedido_seguro(jsonb)','EXECUTE') as auth_crea_pedido_validado;

-- 3) Lecturas y escrituras directas de pedidos/pagos. Esperado: anon puede
-- insertar pedidos pendientes, authenticated puede leer según RLS y no puede
-- mutar pedidos/pagos/entregas directamente.
select
  has_table_privilege('anon','public.pedidos','INSERT') as anon_inserta_pedido,
  has_table_privilege('anon','public.pedidos','SELECT') as anon_lee_pedidos,
  has_table_privilege('anon','public.pagos_abonos','SELECT') as anon_lee_abonos,
  has_table_privilege('anon','public.pagos_reintegros','SELECT') as anon_lee_reintegros,
  has_table_privilege('anon','public.pedido_entregas','SELECT') as anon_lee_entregas,
  has_table_privilege('anon','public.inventario_movimientos','SELECT') as anon_lee_inventario,
  has_table_privilege('authenticated','public.pedidos','SELECT') as auth_tiene_select_pedidos,
  has_table_privilege('authenticated','public.pedidos','UPDATE') as auth_actualiza_pedido_directo,
  has_table_privilege('authenticated','public.pagos_abonos','INSERT') as auth_inserta_abono_directo,
  has_table_privilege('authenticated','public.pagos_abonos','UPDATE') as auth_actualiza_abono_directo,
  has_table_privilege('authenticated','public.pagos_reintegros','INSERT') as auth_inserta_reintegro_directo,
  has_table_privilege('authenticated','public.pagos_reintegros','UPDATE') as auth_actualiza_reintegro_directo,
  has_table_privilege('authenticated','public.pedido_entregas','INSERT') as auth_inserta_entrega_directa,
  has_table_privilege('authenticated','public.pedido_entregas','UPDATE') as auth_actualiza_entrega_directa,
  has_table_privilege('authenticated','public.inventario_movimientos','INSERT') as auth_inserta_inventario_directo,
  has_table_privilege('authenticated','public.inventario_movimientos','UPDATE') as auth_actualiza_inventario_directo;

-- 4) Políticas administrativas RLS por tabla (no devuelve filas de negocio).
select tablename,policyname,cmd,roles
from pg_policies
where schemaname='public'
  and tablename in (
    'pedidos','productos','admin_roles','admin_activity','pagos_abonos',
    'pagos_reintegros','pedido_entregas','inventario_movimientos'
  )
order by tablename,policyname;

-- 5) Triggers de validación y protección instalados.
select t.tgname as trigger,p.proname as funcion,t.tgenabled as habilitado
from pg_trigger t
join pg_proc p on p.oid=t.tgfoid
where t.tgrelid in ('public.pedidos'::regclass,'public.productos'::regclass)
  and not t.tgisinternal
  and (t.tgname like '%nexora%' or t.tgname='pedidos_puntos_trg')
order by t.tgrelid,t.tgname;

-- 6) Contadores agregados (sin datos de clientes). Debe existir al menos un
-- owner activo; los demás roles solo se crean por una asignación autorizada.
select role,activo,count(*) as usuarios
from public.admin_roles
group by role,activo
order by role,activo;

-- 7) Las órdenes anteriores quedan pendientes de reconciliación: no se les
-- asigna un precio confiable automáticamente.
select
  count(*) filter (where total_validado is null) as pedidos_por_validar,
  count(*) filter (where total_validado is not null) as pedidos_con_total_validado
from public.pedidos;
