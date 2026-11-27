# Pagos manuales con QR en NEXORA

Por ahora los cobros se revisan manualmente. Mercado Pago automático permanece apagado. No hace falta configurar secretos del Worker ni Webhooks para recibir pagos por QR.

## Configurar el QR y el número

1. Entra a **Administración → Pagos** y edita el método de billetera/cuenta que vas a recibir.
2. Escribe el número o cuenta que corresponde al QR.
3. Sube el QR oficial que genera la aplicación de pago. La tienda lo muestra primero y pone el número debajo; el panel enseña una vista previa antes de guardar.
4. Guarda el método y déjalo activo. Usa un QR que corresponda a esa misma cuenta.

El QR y el número se guardan en la configuración de la tienda, no en el código ni en GitHub. No los publiques en el repositorio o en mensajes.

## Cómo se revisa cada pedido

1. El cliente escanea el QR, paga el valor exacto y envía el pedido con la referencia o captura.
2. El pedido y el pago quedan **Pendientes**. La captura o referencia sirve como evidencia, pero no confirma que el dinero haya llegado.
3. En **Administración → Pagos → Pendientes**, comprueba el ingreso en la cuenta y pulsa **Verificar pago completo**.
4. Solo tras esa revisión el pedido cambia a **Pagado** y aparece en **Pedidos → Por entregar**.

## Migraciones necesarias en Supabase

La migración `20_mercadopago_checkout.sql` también crea la consulta que permite listar y revisar los pagos en el panel; su método de Mercado Pago queda apagado. Si ya están las tablas `pedidos`, `pagos_abonos`, `pedido_propietarios` y `ajustes`, pero falta `nexora_guardar_estado_pedido()`, ejecuta `19b_reparar_estado_pedido.sql` primero y después ejecuta completa la migración 20. La reparación se detiene y enumera dependencias si la migración 05 está incompleta.

La automatización de Mercado Pago solo debe prepararse si más adelante decides activarla expresamente.
