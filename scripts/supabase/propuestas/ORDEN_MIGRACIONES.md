# Orden propuesto de scripts SQL (no ejecutado)

Estos archivos son una propuesta de revisión, no una instrucción para pegarlos juntos ni para aplicar todos sobre una base existente. No se ha consultado el estado remoto.

La configuración de conexión en `js/config.js` está desactivada (`enabled:false`). Las llamadas remotas solo se habilitan con `enabled:true`; ese cambio es manual y deliberado, y no forma parte de las migraciones.

| Orden de revisión | Archivo existente | Uso / condición |
|---|---|---|
| 0 | `../01_diagnostico_solo_lectura.sql` | Diagnóstico inicial de tablas, columnas, triggers, RPC y RLS. Solo lectura. |
| 1 | `../schema.sql` | Base de administración y pedidos. Contiene una dirección de correo específica en `admins`; sustituir por el usuario Auth correcto y revisar la política antes de reutilizarlo. |
| 2 | `../schema_2_catalogo_puntos.sql` | Agrega catálogo, ajustes y primer modelo de puntos por teléfono. Solo es la base histórica antes de la conversión de identidad. |
| 3 | `../precheck_schema_3.sql` | Precheck de identidad y datos antes de migrar puntos. Solo lectura; revisar el resultado manualmente. |
| 4 | `../02_migracion_definitiva_schema_3.sql` | Rama que convierte puntos al identificador `ff_id` y define RPC usadas por `js/backend.js`/`js/puntos.js`. Requiere las tablas base y revisión de sus datos antes de aplicar. |
| 5 | `../03_verificacion_post_migracion.sql` | Verificación de la línea 02. No es migración. |
| 6 | `../05_seguridad_compras_pagos.sql` | Propuesta de ampliación y endurecimiento: roles, pagos, reintegros, entregas, inventario, pedidos seguros y RPC. Requiere el esquema de 02, preflight satisfactorio y despliegue previo de un cliente actualizado para usar las RPC nuevas. No aplicar con el frontend actual. |
| 7 | `../06_verificacion_seguridad_backend.sql` | Verificación posterior propuesta para 05. Solo lectura. |

`../schema_3_puntos_ff.sql` es una alternativa de línea de puntos, no una migración adicional a `02`. `../verificacion_schema_3.sql` corresponde a esa rama. `../04_procedimiento_reversion.sql` requiere revisión específica del estado/datos; no usarlo como rollback genérico.

## Preparación de migraciones versionadas

El repositorio no tiene `supabase/migrations/` ni un historial de migraciones CLI. Antes de crear/aplicar una secuencia versionada hay que comparar el SQL con el estado real de la base y registrar un baseline, sin fingir que las migraciones históricas se aplicaron mediante CLI. Mantener las propuestas aisladas aquí evita que `supabase db push` las trate como una secuencia lista para producción.

## Puerta de compatibilidad para 05

La app de hoy crea pedidos y modifica pedidos/productos/ajustes mediante REST directo. 05 añade creación de pedido segura y quita mutaciones directas de estado/borrado de pedidos; el inventario se modifica mediante RPC. Antes de habilitarla, el frontend debe usar `crear_pedido_seguro` y los RPC administrativos, manejar respuestas `{error: ...}`, refrescar datos de solo lectura y conservar la generación actual de estados, puntos, cupones y productos. Aplicar 05 primero puede romper acciones del panel y el checkout no aprovecharía la respuesta validada por servidor.

## Cartera de puntos ligada a clientes Auth

`../18_puntos_clientes_auth.sql` depende de la línea 02 + 05 + 07 + 17, de `pedido_propietarios` y de cuentas Supabase Auth. Crea una cartera independiente por `auth.uid()`, movimientos inmutables, consulta y canje privados, y acredita únicamente pedidos pagados asociados por la RPC segura al mismo usuario. Invitados no reciben saldo de cliente. No reasigna automáticamente las antiguas carteras por ID de Free Fire/PIN, porque no hay prueba suficiente para atribuirlas a una cuenta Auth. La pantalla nueva solo usa las RPC de cuenta; las funciones legacy por ID/PIN se revocan a clientes.
