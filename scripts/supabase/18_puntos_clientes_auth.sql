-- NEXORA 18: cartera de puntos por UID de Supabase Auth.
-- Requiere las migraciones 02/05/07/17 aplicadas. No reasigna saldos legacy.
begin;
do $$
begin
  if to_regclass('public.pedidos') is null or to_regclass('public.pedido_propietarios') is null
     or to_regclass('public.premios') is null or to_regclass('public.canjes') is null
     or to_regclass('public.ajustes') is null or to_regclass('auth.users') is null
     or to_regprocedure('public.es_admin()') is null
     or to_regprocedure('public.mover_puntos(text,integer,text,text,text)') is null
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='canjes' and column_name='ff_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pedidos' and column_name='total_validado') then
    raise exception 'NEXORA 18: faltan dependencias 02/05/07/17; no se aplicó la migración.';
  end if;
end $$;

create table if not exists public.puntos_cuentas_cliente (
  user_id uuid primary key references auth.users(id) on delete restrict,
  puntos integer not null default 0 check(puntos>=0),
  total_ganado bigint not null default 0 check(total_ganado>=0),
  creado timestamptz not null default now(), actualizado timestamptz not null default now()
);
create table if not exists public.puntos_mov_cliente (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  cantidad integer not null check(cantidad<>0),
  motivo text not null check(char_length(motivo) between 1 and 60),
  referencia text, ref_unica text unique,
  saldo_despues integer not null check(saldo_despues>=0), creado timestamptz not null default now()
);
create index if not exists puntos_mov_cliente_usuario_fecha_idx on public.puntos_mov_cliente(user_id,creado desc,id desc);
alter table public.puntos_cuentas_cliente enable row level security;
alter table public.puntos_mov_cliente enable row level security;
revoke all on public.puntos_cuentas_cliente,public.puntos_mov_cliente from public,anon,authenticated;
revoke all on sequence public.puntos_mov_cliente_id_seq from public,anon,authenticated;

create or replace function public.nexora_puntos_mov_inmutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'El historial de puntos es inmutable.' using errcode='42501'; end $$;
revoke all on function public.nexora_puntos_mov_inmutable() from public,anon,authenticated;
drop trigger if exists puntos_mov_cliente_inmutable on public.puntos_mov_cliente;
create trigger puntos_mov_cliente_inmutable before update or delete on public.puntos_mov_cliente
  for each row execute function public.nexora_puntos_mov_inmutable();

alter table public.canjes alter column ff_id drop not null;
alter table public.canjes add column if not exists user_id uuid references auth.users(id) on delete restrict;
create index if not exists canjes_usuario_fecha_idx on public.canjes(user_id,creado desc) where user_id is not null;

-- Solo funciones SECURITY DEFINER llaman este movimiento; valida límites, saldo e idempotencia.
create or replace function public.nexora_mover_puntos_cliente(p_user_id uuid,p_cantidad integer,p_motivo text,p_referencia text,p_ref_unica text)
returns integer language plpgsql security definer
set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_saldo integer; v_prev_user uuid;
begin
  if p_user_id is null or p_cantidad is null or p_cantidad=0 or abs(p_cantidad)>1000000
     or p_ref_unica is null or char_length(p_ref_unica)>160
     or p_motivo is null or char_length(p_motivo) not between 1 and 60 then
    raise exception 'Movimiento de puntos inválido.' using errcode='22023';
  end if;
  insert into public.puntos_cuentas_cliente(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select puntos into v_saldo from public.puntos_cuentas_cliente where user_id=p_user_id for update;
  select user_id into v_prev_user from public.puntos_mov_cliente where ref_unica=p_ref_unica;
  if found then
    if v_prev_user<>p_user_id then raise exception 'Referencia de puntos ya utilizada.' using errcode='23505'; end if;
    return v_saldo;
  end if;
  if v_saldo+p_cantidad<0 then raise exception 'Saldo de puntos insuficiente.' using errcode='23514'; end if;
  update public.puntos_cuentas_cliente set puntos=v_saldo+p_cantidad,
    total_ganado=total_ganado+greatest(p_cantidad,0),actualizado=clock_timestamp()
    where user_id=p_user_id returning puntos into v_saldo;
  insert into public.puntos_mov_cliente(user_id,cantidad,motivo,referencia,ref_unica,saldo_despues)
    values(p_user_id,p_cantidad,p_motivo,left(coalesce(p_referencia,''),160),p_ref_unica,v_saldo);
  return v_saldo;
end $$;
revoke all on function public.nexora_mover_puntos_cliente(uuid,integer,text,text,text) from public,anon,authenticated;

create or replace function public.mis_puntos_cliente() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_cfg jsonb; v_saldo integer; v_total bigint;
begin
  if v_uid is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'Inicia sesión para consultar tus puntos.' using errcode='42501'; end if;
  select coalesce(valor,'{}'::jsonb) into v_cfg from public.ajustes where clave='puntos';
  if coalesce((v_cfg->>'activa')::boolean,false) then
    insert into public.puntos_cuentas_cliente(user_id) values(v_uid) on conflict(user_id) do nothing;
    if coalesce((v_cfg->>'bienvenida')::integer,0)>0 then
      perform public.nexora_mover_puntos_cliente(v_uid,(v_cfg->>'bienvenida')::integer,'bienvenida','Bonificación de bienvenida','bienvenida:'||v_uid::text);
    end if;
  end if;
  select puntos,total_ganado into v_saldo,v_total from public.puntos_cuentas_cliente where user_id=v_uid;
  return jsonb_build_object('activa',coalesce((v_cfg->>'activa')::boolean,false),
    'cada',greatest(coalesce((v_cfg->>'cada')::integer,0),0),'por_compra',greatest(coalesce((v_cfg->>'por_compra')::integer,0),0),
    'puntos',coalesce(v_saldo,0),'total_ganado',coalesce(v_total,0),
    'movimientos',(select coalesce(jsonb_agg(jsonb_build_object('cantidad',m.cantidad,'motivo',m.motivo,'referencia',m.referencia,'creado',m.creado) order by m.creado desc,m.id desc),'[]'::jsonb)
      from (select cantidad,motivo,referencia,creado,id from public.puntos_mov_cliente where user_id=v_uid order by creado desc,id desc limit 50) m),
    'canjes',(select coalesce(jsonb_agg(jsonb_build_object('nombre',c.nombre,'costo',c.costo,'estado',c.estado,'creado',c.creado) order by c.creado desc),'[]'::jsonb)
      from (select nombre,costo,estado,creado from public.canjes where user_id=v_uid order by creado desc limit 30) c),
    'premios',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'descripcion',coalesce(p.descripcion,''),'costo',p.costo_puntos,'disponible',p.stock is null or p.stock>0) order by p.costo_puntos,p.id),'[]'::jsonb) from public.premios p where p.activo));
end $$;

create or replace function public.canjear_mis_puntos(p_premio bigint,p_clave text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_cfg jsonb; v_wallet public.puntos_cuentas_cliente%rowtype; v_p public.premios%rowtype; v_c public.canjes%rowtype; v_id bigint; v_saldo integer;
begin
  if v_uid is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'Inicia sesión para canjear.' using errcode='42501'; end if;
  if coalesce(p_clave,'') !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'Solicitud inválida.' using errcode='22023'; end if;
  select coalesce(valor,'{}'::jsonb) into v_cfg from public.ajustes where clave='puntos';
  if not coalesce((v_cfg->>'activa')::boolean,false) then raise exception 'El programa de puntos está pausado.'; end if;
  select * into v_wallet from public.puntos_cuentas_cliente where user_id=v_uid for update;
  if not found then raise exception 'Todavía no tienes una cartera de puntos.'; end if;
  select * into v_c from public.canjes where clave='u-'||p_clave;
  if found then
    if v_c.user_id is distinct from v_uid then raise exception 'Solicitud inválida.' using errcode='23505'; end if;
    return jsonb_build_object('ok',true,'repetido',true,'puntos',v_wallet.puntos,'nombre',v_c.nombre);
  end if;
  select * into v_p from public.premios where id=p_premio for update;
  if not found or not v_p.activo then raise exception 'Ese premio ya no está disponible.'; end if;
  if v_p.stock is not null and v_p.stock<=0 then raise exception 'Premio agotado.'; end if;
  if v_wallet.puntos<v_p.costo_puntos then raise exception 'No tienes puntos suficientes.'; end if;
  if v_p.stock is not null then update public.premios set stock=stock-1,actualizado=now() where id=v_p.id; end if;
  insert into public.canjes(ff_id,user_id,premio_id,nombre,costo,origen,estado,clave)
    values(null,v_uid,v_p.id,v_p.nombre,v_p.costo_puntos,'canje','pendiente','u-'||p_clave) returning id into v_id;
  v_saldo:=public.nexora_mover_puntos_cliente(v_uid,-v_p.costo_puntos,'canje',v_p.nombre,'canje-usuario:'||v_id::text);
  return jsonb_build_object('ok',true,'puntos',v_saldo,'nombre',v_p.nombre,'costo',v_p.costo_puntos);
end $$;

-- Solo pedidos atribuidos por crear_pedido_seguro a ese UID reciben puntos. Invitados no.
create or replace function public.nexora_puntos_cliente_pedido() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_uid uuid; v_cfg jsonb; v_total numeric; v_cada integer; v_por integer; v_pts integer; v_compra integer; v_reversar integer;
begin
  select user_id into v_uid from public.pedido_propietarios where pedido_id=new.id;
  if v_uid is null then return new; end if;
  select coalesce(valor,'{}'::jsonb) into v_cfg from public.ajustes where clave='puntos';
  if not coalesce((v_cfg->>'activa')::boolean,false) then return new; end if;
  if new.estado in ('Pagado','Entregado') and old.estado is distinct from new.estado then
    v_cada:=coalesce((v_cfg->>'cada')::integer,0); v_por:=greatest(coalesce((v_cfg->>'por_compra')::integer,0),0);
    v_total:=coalesce(new.total_validado,0);
    v_pts:=v_por+case when v_cada>0 then floor(greatest(v_total,0)/v_cada)::integer else 0 end;
    if v_pts>0 then
      if coalesce((v_cfg->>'bienvenida')::integer,0)>0 then
        perform public.nexora_mover_puntos_cliente(v_uid,(v_cfg->>'bienvenida')::integer,'bienvenida','Bonificación de bienvenida','bienvenida:'||v_uid::text);
      end if;
      perform public.nexora_mover_puntos_cliente(v_uid,v_pts,'compra','Compra confirmada','pedido:'||new.id);
    end if;
  elsif new.estado='Cancelado' and old.estado is distinct from new.estado then
    select cantidad into v_compra from public.puntos_mov_cliente where user_id=v_uid and motivo='compra' and ref_unica='pedido:'||new.id;
    if found then
      select least(v_compra,puntos) into v_reversar from public.puntos_cuentas_cliente where user_id=v_uid for update;
      if v_reversar>0 then perform public.nexora_mover_puntos_cliente(v_uid,-v_reversar,'reversa_compra','Compra cancelada','pedido-cancelado:'||new.id); end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.nexora_puntos_cliente_pedido() from public,anon,authenticated;
drop trigger if exists nexora_puntos_cliente_pedido on public.pedidos;
create trigger nexora_puntos_cliente_pedido after update of estado on public.pedidos
  for each row when(old.estado is distinct from new.estado) execute function public.nexora_puntos_cliente_pedido();

-- Mantiene el consumo de cupones de la migración 05, pero deja de acreditar en
-- paralelo la cartera legacy keyed por Free Fire (las carteras cliente las lleva el trigger anterior).
create or replace function public.pedidos_puntos_trg() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
begin
  if new.estado in ('Pagado','Entregado') and new.datos#>>'{_nexora,fuente_cupon}'='ruleta'
     and coalesce(new.datos->>'cupon','')<>'' then
    update public.cupones_ruleta set usado=true,reservado_pedido_id=null
      where codigo=upper(new.datos->>'cupon') and not usado
        and (reservado_pedido_id is null or reservado_pedido_id=new.id);
  end if;
  return new;
end $$;
revoke all on function public.pedidos_puntos_trg() from public,anon,authenticated;

create or replace function public.admin_puntos_clientes()
returns jsonb language plpgsql security definer stable
set search_path=pg_catalog,public,auth,pg_temp as $$
begin
  if not public.es_admin() then raise exception 'No autorizado.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',q.user_id,'puntos',q.puntos,'total_ganado',q.total_ganado,'actualizado',q.actualizado) order by q.puntos desc),'[]'::jsonb)
    from (select user_id,puntos,total_ganado,actualizado from public.puntos_cuentas_cliente order by puntos desc limit 200) q);
end $$;

create or replace function public.admin_estado_canje(p_id bigint,p_estado text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare c public.canjes%rowtype;
begin
  if not public.es_admin() then return jsonb_build_object('error','No autorizado.'); end if;
  if p_estado not in ('entregado','cancelado') then return jsonb_build_object('error','Estado inválido.'); end if;
  select * into c from public.canjes where id=p_id for update;
  if not found then return jsonb_build_object('error','Canje no encontrado.'); end if;
  if c.estado<>'pendiente' then return jsonb_build_object('error','Ese canje ya está '||c.estado||'.'); end if;
  update public.canjes set estado=p_estado,actualizado=now() where id=p_id;
  if p_estado='cancelado' and c.origen='canje' and c.costo>0 then
    if c.user_id is not null then
      perform public.nexora_mover_puntos_cliente(c.user_id,c.costo,'canje_cancelado',c.nombre,'canje-cancelado-usuario:'||c.id::text);
    elsif c.ff_id is not null then
      perform public.mover_puntos(c.ff_id,c.costo,'canje_cancelado',null,'canje-cancelado-'||c.id);
    end if;
    update public.premios set stock=stock+1,actualizado=now() where id=c.premio_id and stock is not null;
  end if;
  return jsonb_build_object('ok',true);
end $$;

-- Las rutas antiguas aceptaban el ID de juego como credencial; se cierran.
revoke all on function public.consultar_puntos(text),public.crear_cuenta(text,text),public.definir_pin(text,text,text),
  public.detalle_cuenta(text,text),public.canjear_premio(text,text,bigint,text),public.girar_ruleta(text,text,text)
  from public,anon,authenticated;
revoke all on function public.admin_estado_canje(bigint,text) from public,anon,authenticated;
grant execute on function public.admin_estado_canje(bigint,text) to authenticated;
revoke all on function public.mis_puntos_cliente(),public.canjear_mis_puntos(bigint,text) from public,anon,authenticated;
grant execute on function public.mis_puntos_cliente(),public.canjear_mis_puntos(bigint,text) to authenticated;
revoke all on function public.admin_puntos_clientes() from public,anon,authenticated;
grant execute on function public.admin_puntos_clientes() to authenticated;
notify pgrst,'reload schema';
commit;
