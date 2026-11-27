# Activar Mercado Pago en NEXORA

La integración usa Checkout Pro con Orders API. La tienda crea el pedido en Supabase; el Worker crea la order de Mercado Pago a partir del total validado por la base de datos; el pedido solo pasa a `Pagado` después de una notificación Webhook autenticada y de verificar la order directamente con Mercado Pago.

## 1. Aplicar la migración

En Supabase SQL Editor, ejecuta `scripts/supabase/20_mercadopago_checkout.sql` después de las migraciones de seguridad, cuentas e idempotencia que ya usa la tienda. La migración agrega el método Mercado Pago apagado, guarda los identificadores del proveedor, protege la verificación manual y crea las RPC necesarias.

Si el diagnóstico confirma que existen `pedidos`, `pagos_abonos`, `pedido_propietarios` y `ajustes`, pero falta `nexora_guardar_estado_pedido()`, ejecuta primero `scripts/supabase/19b_reparar_estado_pedido.sql`. Si la reparación termina sin error, vuelve a ejecutar completa la migración 20. La reparación se detiene sin cambios y enumera dependencias si la migración 05 está incompleta.

## 2. Agregar secretos a Cloudflare

Configura estos valores como secretos/variables del Worker `nexora-tienda`. No los guardes en `js/config.js`, archivos `.env`, GitHub ni mensajes de chat.

| Nombre | Valor |
| --- | --- |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_ANON_KEY` | Clave pública/anon de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privada `service_role` de Supabase |
| `MERCADOPAGO_ACCESS_TOKEN` | Access Token de la aplicación de Mercado Pago |
| `MERCADOPAGO_WEBHOOK_SECRET` | Firma secreta de Webhooks de esa aplicación |

La clave `service_role`, el Access Token y la firma del webhook deben permanecer privadas. Si usas Wrangler, agrega cada valor de forma interactiva con `npx wrangler secret put NOMBRE`; no escribas el secreto en el comando.

## 3. Configurar Webhooks

En la aplicación de Mercado Pago, configura el evento **Order (Mercado Pago)** / **Orders** para la URL HTTPS pública:

```text
https://TU-DOMINIO/api/mercadopago/webhook
```

Guarda la firma secreta que Mercado Pago genera y configúrala como `MERCADOPAGO_WEBHOOK_SECRET` en el mismo entorno. Repite la configuración para prueba y producción cuando uses credenciales separadas.

## 4. Activar el método

Después de aplicar la migración y desplegar el Worker con sus variables, abre Administración → Pagos, edita Mercado Pago automático y actívalo. El checkout exige que el cliente haya iniciado sesión. Para empezar, usa credenciales de prueba y usuarios de prueba de Mercado Pago.

La tienda no confía en los parámetros que Mercado Pago agrega al regresar al sitio. La confirmación real es el Webhook firmado y la consulta servidor a servidor de la order. Si falta un secreto o la migración todavía no está aplicada, el checkout automático devuelve un error y el pedido no se marca como pagado.
