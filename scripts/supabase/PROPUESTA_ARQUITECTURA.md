# NEXORA: propuesta de arquitectura Supabase

Estado: revisión y artefactos preparados localmente. No se hicieron llamadas a Supabase ni se ejecutaron scripts SQL.

## Estado actual del cliente

NEXORA ya tiene una integración de navegador en `js/backend.js`: llama Auth y PostgREST por `fetch`, usa RPC para puntos y ruleta, y guarda el access/refresh token de administración en `sessionStorage`. `js/config.js` conserva una URL y llave publicable configuradas, pero ahora `enabled:false` desactiva las solicitudes hasta habilitar expresamente la conexión. Se conservan ambos valores sin usarlos; el switch también bloquea cualquier llamada RPC que alcanzara el cliente con la integración desactivada.

La aplicación es estática, no tiene `package.json`, servidor propio ni pipeline de build que lea `.env`. Se añadió `.env.example` como contrato futuro y `js/config.example.js` como plantilla compatible con el global `CONFIG`; ninguno está conectado al HTML. La llave publicable del navegador no es un secreto. Una llave `service_role`/secret nunca debe entrar en HTML, JavaScript, respaldos ni variables expuestas al build del cliente.

## Esquema reconocido

El modelo que corresponde al código actual es la línea base `schema.sql` + `schema_2_catalogo_puntos.sql` + migración `02_migracion_definitiva_schema_3.sql`. `schema_3_puntos_ff.sql` es una rama alternativa de puntos, no debe combinarse con `02` sin comparar el esquema real.

| Tabla | Propósito y forma usada |
|---|---|
| `admins` | Lista de correos autorizados en el esquema antiguo; privada por RLS. `02` conserva `es_admin()` como control de permisos. |
| `pedidos` | Pedido y estado en columnas; datos del checkout en `datos jsonb`. Clientes crean pedidos pendientes; panel lee y actualiza pedidos. |
| `productos` | `id`, `datos jsonb`, `activo`, `creado`; lectura pública de productos activos y CRUD de administración. |
| `ajustes` | `clave`/`valor jsonb`; contiene la configuración pública, puntos y ruleta. Actualmente se consulta desde la tienda. |
| `puntos` | Saldo por `ff_id`, PIN hasheado y fecha de definición. |
| `puntos_mov` | Libro de movimientos por `ff_id`; `pedido_id` es una referencia lógica en el esquema 02, no una FK. |
| `intentos` | Contadores de intentos por IP/identidad para limitar consultas y PIN. |
| `catalogo_premios` | Premios y probabilidades de la ruleta. |
| `cupones_ruleta` | Cupones emitidos, su titular `ff_id`, vigencia y estado de uso. |
| `giros` | Historial de giros por `ff_id`; `catalogo_id`/`clave` no están declarados como FK en 02. |
| `premios` | Catálogo de premios que se canjean con puntos. |
| `canjes` | Solicitudes de canje por `ff_id`; mantiene referencias a pedido/persona como valores y no como FK en 02. |

La migración 05 propone además `admin_roles` (FK a `auth.users`), `admin_activity` (actor a Auth), `pagos_abonos` (FK a `pedidos`), `pagos_reintegros` (FK a abono), `pedido_entregas` (FK a pedido y producto) e `inventario_movimientos` (FK opcional a pedido y FK a producto). Agrega totales validados al pedido y reserva de cupón. Esas tablas aún no las consume el JavaScript actual.

Pedidos, productos y ajustes almacenan gran parte del detalle en JSONB. Eso conserva compatibilidad con el panel, pero limita integridad referencial y cálculo confiable de precios hasta que el servidor valide líneas e importes. Las fotos y comprobantes se guardan como data URLs en JSON; no se encontró configuración de Supabase Storage.

## Auth, RLS y límites

- Para administración, mantener Supabase Auth con alta pública desactivada, cuentas invitadas manualmente, contraseña fuerte, MFA si está disponible y URLs de retorno/orígenes permitidos acotados. La autorización real debe seguir en RLS/RPC, nunca en `authed` ni en ocultar `admin.html`.
- El cliente actual implementa el flujo de contraseña y refresh manualmente; tokens quedan en `sessionStorage`, no en cookie HttpOnly. La CSP existente limita scripts a archivos propios y conexiones a `*.supabase.co`.
- En el esquema base, clientes anónimos solo deben insertar pedidos pendientes; no leer ni alterar pedidos. El administrador autorizado lee y modifica pedidos. Productos activos y ajustes se leen públicamente; escritura requiere sesión administrativa. Puntos, movimientos, premios, giros, intentos, cupones y canjes son privados para lectura directa; el cliente opera mediante RPC restringidas.
- `02` expone RPC públicas de cuenta/PIN, consulta de puntos, ruleta y validación de cupón; RPC administrativas requieren rol autenticado. La función de trigger acredita puntos al cambiar estado del pedido.
- El checkout sigue aceptando datos calculados en el navegador. La migración 05 propone `crear_pedido_seguro(jsonb)` para recalcular precios, aplicar stock y crear entregas en servidor; el flujo manual de comprobantes no equivale a confirmar un pago de pasarela.
- La migración 05 cambia la autorización de correo a roles asociados a UID de Auth; quita las mutaciones directas de estado/borrado de pedidos y protege stock para que sus cambios pasen por RPC. También incorpora `crear_pedido_seguro(jsonb)` para el checkout con precio calculado en servidor. No se debe habilitar hasta actualizar `js/backend.js` y los manejadores del panel para consumir los RPC y tratar sus respuestas.
- No hay función Edge configurada. Haría falta una solo al añadir webhook de pasarela, notificaciones externas o subida privada de comprobantes. Los webhooks deben verificar firma e idempotencia; el secreto de pasarela/Supabase va en variables privadas del servidor, nunca en el bundle.

## Funciones backend por fase

**Usadas por el flujo actual (línea 02):** Auth password/refresh; PostgREST de catálogo, ajustes y pedidos; RPC `ruleta_publica`, `consultar_puntos`, `crear_cuenta`, `definir_pin`, `detalle_cuenta`, `canjear_premio`, `girar_ruleta`, `validar_premio`; RPC admin `procesar_puntos_pedido`, `admin_guardar_ruleta`, `admin_guardar_premio_canje`, `admin_borrar_premio_canje`, `admin_estado_canje`; triggers de validación de pedido y puntos.

**Propuestas de 05 para fase posterior:** `crear_pedido_seguro`; `admin_crear_pedido`, `admin_validar_pedido_anterior`, `admin_registrar_abono`, `admin_verificar_abono`, `admin_registrar_reintegro`, `admin_verificar_reintegro`, `admin_verificar_reintegros_pedido`, `admin_cambiar_estado_pedido`, `admin_actualizar_entrega`, `admin_ajustar_stock`; autorización por `nexora_admin_permiso`, auditoría y triggers de total, pagos, stock y entregas.

## Migraciones propuestas y orden de revisión

Ver [propuestas/ORDEN_MIGRACIONES.md](propuestas/ORDEN_MIGRACIONES.md). Los scripts SQL existentes son borradores manuales; no están en `supabase/migrations/` y no se trataron como aplicados. Antes de cualquier aplicación hay que comprobar el proyecto/entorno y los scripts realmente instalados, respaldar datos y probar en staging. La migración 05 queda bloqueada hasta migrar el frontend a sus RPC.

## Pendientes antes de conectar/cambiar el entorno

1. Confirmar si el proyecto referenciado actualmente en `js/config.js` es el destino correcto; no exponer ni copiar llaves en tickets o respaldos.
2. Consultar estado real de tablas, columnas, funciones, triggers, políticas y datos mediante los diagnósticos existentes; elegir una sola línea de esquema.
3. El PIN local `1234` queda limitado a `file://`/localhost; mantener ese límite si se cambia el flujo de acceso. En sitios publicados el panel requiere Auth, incluso cuando la conexión remota está desactivada.
4. Migrar las operaciones de `js/backend.js` que escriben pedidos/productos/ajustes a RPC por permisos antes de aplicar 05; de otro modo el panel perderá operaciones que hoy hace por REST.
5. Separar pagos/entregas/inventario de `pedidos.datos`, decidir política de retención de datos personales y mover comprobantes/fotos a Storage privado si el volumen lo requiere.
6. Elegir estrategia de build: inyectar solo URL y llave publicable al artefacto estático o generar `js/config.js` durante despliegue. El `.env.example` presente es documental y la app no lo lee aún.
7. Configurar límites de Auth, MFA, dominios/orígenes permitidos y alertas; luego hacer pruebas autorizadas de cliente anónimo, admin por rol y RPC antes de desplegar.
