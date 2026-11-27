-- Ejecutar despues de confirmar que 05_seguridad_compras_pagos.sql esta aplicada.
-- Hace que PostgREST vuelva a descubrir admin_actualizar_entrega y su argumento
-- opcional p_datos_entrega, evitando errores por una cache RPC desactualizada.
notify pgrst, 'reload schema';
