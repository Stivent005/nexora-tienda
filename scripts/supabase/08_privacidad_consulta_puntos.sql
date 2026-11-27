-- =====================================================================
-- 08: PRIVACIDAD DEL RPC LEGADO DE CONSULTA DE PUNTOS
--
-- Dependencia: supabase/02_migracion_definitiva_schema_3.sql.
-- Se numera después de 07 para mantener la secuencia local existente.
--
-- La migración 02 concede consultar_puntos(text) a anon y authenticated.
-- Ese RPC recibe un ID de juego y devuelve saldo e historial; el ID no prueba
-- que quien consulta sea su titular. El frontend está pausado, pero eso no
-- revoca el permiso del backend.
--
-- Esta corrección solo retira el acceso de cliente. No altera filas ni saldos,
-- no cambia triggers ni reabre la función de puntos. No ejecutar hasta revisar
-- el proyecto de destino y verificar el esquema base en staging.
-- =====================================================================

begin;

-- Preflight: detenerse si la función o los roles Supabase esperados no existen.
do $preflight$
declare
  v_func regprocedure;
begin
  v_func := to_regprocedure('public.consultar_puntos(text)');
  if v_func is null then
    raise exception 'NEXORA 08: no existe public.consultar_puntos(text); no se aplicó ningún cambio.';
  end if;

  if not exists (
    select 1 from pg_proc where oid = v_func::oid and prosecdef
  ) then
    raise exception 'NEXORA 08: la función no coincide con la versión SECURITY DEFINER esperada; revisar manualmente.';
  end if;

  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise exception 'NEXORA 08: faltan los roles anon/authenticated; no se aplicó ningún cambio.';
  end if;
end;
$preflight$;

-- Cierra tanto los permisos explícitos creados por 02 como el permiso PUBLIC.
revoke all privileges on function public.consultar_puntos(text)
  from public, anon, authenticated;

-- Postcheck: has_function_privilege incluye permisos heredados y de PUBLIC.
do $verify$
declare
  v_func regprocedure := to_regprocedure('public.consultar_puntos(text)');
begin
  if has_function_privilege('anon', v_func::oid, 'EXECUTE') then
    raise exception 'NEXORA 08: anon todavía puede ejecutar consultar_puntos(text).';
  end if;

  if has_function_privilege('authenticated', v_func::oid, 'EXECUTE') then
    raise exception 'NEXORA 08: authenticated todavía puede ejecutar consultar_puntos(text).';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
commit;
