-- =====================================================================
-- 04: PROCEDIMIENTO DE REVERSIÓN (ROLLBACK CONTROLADO)
-- USAR ÚNICAMENTE SI SE REQUIERE VOLVER AL ESQUEMA PREVIO (SCHEMA 2).
-- Nota: La migración 02_migracion_definitiva_schema_3.sql preserva los cupones
-- originales en 'cupones_ruleta' y en 'premios_cupones_legacy' sin pérdida de datos.
-- =====================================================================

begin;

-- 1) Desvincular disparadores de schema 3 en pedidos
drop trigger if exists pedidos_puntos_trg on public.pedidos;
drop trigger if exists pedidos_proteger_datos on public.pedidos;
drop function if exists public.pedidos_puntos_trg();
drop function if exists public.pedidos_proteger_datos();

-- 2) Si se respaldó 'premios_cupones_legacy', restaurarlo si premios está vacío
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='premios_cupones_legacy') then
    drop table if exists public.premios;
    execute 'alter table public.premios_cupones_legacy rename to premios';
  end if;
end $$;

-- 3) Eliminar funciones creadas por schema 3
drop function if exists public.ruleta_publica();
drop function if exists public.consultar_puntos(text);
drop function if exists public.crear_cuenta(text, text);
drop function if exists public.definir_pin(text, text, text);
drop function if exists public.detalle_cuenta(text, text);
drop function if exists public.canjear_premio(text, text, bigint, text);
drop function if exists public.girar_ruleta(text, text, text);
drop function if exists public.admin_guardar_ruleta(jsonb);
drop function if exists public.admin_guardar_premio_canje(bigint, text, text, int, int, boolean);
drop function if exists public.admin_borrar_premio_canje(bigint);
drop function if exists public.admin_estado_canje(bigint, text);

notify pgrst, 'reload schema';

commit;
