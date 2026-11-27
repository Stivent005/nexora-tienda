-- Añade los paquetes iniciales de diamantes como productos digitales.
-- Requiere public.productos (creada por schema_2_catalogo_puntos.sql / migración 02).
-- Es seguro volver a ejecutar: conserva cualquier producto existente con esos IDs.
begin;

do $$
begin
  if to_regclass('public.productos') is null then
    raise exception 'NEXORA: primero aplica la migración que crea public.productos.';
  end if;
end;
$$;

insert into public.productos (id, datos, activo)
select p.id,
       jsonb_build_object(
         'schemaVersion', 2,
         'name', p.nombre,
         'description', 'Paquete digital de diamantes para Free Fire. La entrega se coordina después de verificar el pago.',
         'price', p.precio,
         'stock', 0,
         'tipo', 'virtual',
         'ilimitado', true,
         'category', 'Diamantes Free Fire',
         'brand', 'Free Fire',
         'sku', p.sku,
         'unit', 'paquete',
         'specifications', '[]'::jsonb,
         'variants', '[]'::jsonb,
         'envio', '',
         'garantia', '',
         'valorDigital', p.paquete,
         'tiempoDigital', '',
         'digital', jsonb_build_object(
           'game', 'Free Fire',
           'packageLabel', p.paquete,
           'playerIdLabel', 'ID de jugador',
           'playerIdValidation', 'digits_6_15',
           'displayNameLabel', 'Nombre visible del jugador',
           'serverMode', 'none',
           'serverLabel', '',
           'fields', jsonb_build_array(
             jsonb_build_object(
               'key', 'playerId',
               'label', 'ID de jugador (6 a 15 dígitos)',
               'required', true,
               'validation', 'digits_6_15',
               'maxLength', 15
             ),
             jsonb_build_object(
               'key', 'displayName',
               'label', 'Nombre visible del jugador',
               'required', true,
               'validation', 'text',
               'maxLength', 80
             )
           )
         ),
         'offer', false,
         'offerPrice', 0,
         'active', true,
         'image', p.imagen,
         'createdAt', floor(extract(epoch from now()) * 1000)
       ),
       true
from (values
  ('ff-diam-100',  '100 diamantes Free Fire',   '100 diamantes',   'FF-DIAM-100',  3000,   '/images/ff-caja-azul-amarilla.jpg'),
  ('ff-diam-300',  '300 diamantes Free Fire',   '300 diamantes',   'FF-DIAM-300',  9000,   '/images/ff-cofre-rojo-diamantes.jpg'),
  ('ff-diam-500',  '500 diamantes Free Fire',   '500 diamantes',   'FF-DIAM-500', 17000,   '/images/ff-caja-segura-diamantes.jpg'),
  ('ff-diam-1000', '1.000 diamantes Free Fire', '1.000 diamantes', 'FF-DIAM-1000',35000,   '/images/ff-cofre-azul-rojo.jpg'),
  ('ff-diam-2000', '2.000 diamantes Free Fire', '2.000 diamantes', 'FF-DIAM-2000',73000,   '/images/ff-caja-azul-amarilla.jpg'),
  ('ff-diam-5000', '5.000 diamantes Free Fire', '5.000 diamantes', 'FF-DIAM-5000',160000,  '/images/ff-cofre-rojo-diamantes.jpg'),
  ('ff-diam-6120', '6.120 diamantes Free Fire', '6.120 diamantes', 'FF-DIAM-6120',170000,  '/images/ff-caja-segura-diamantes.jpg')
) as p(id, nombre, paquete, sku, precio, imagen)
on conflict (id) do update set datos = excluded.datos, activo = excluded.activo;

notify pgrst, 'reload schema';
commit;
