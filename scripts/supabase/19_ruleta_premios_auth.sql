-- NEXORA 19: ruleta y premios automaticos para cuentas Supabase Auth.
-- No habilita las RPC antiguas que identificaban clientes por Free Fire ID/PIN.
begin;

do $$
declare v_missing text[]:=array[]::text[];
begin
  if to_regclass('public.pedidos') is null then v_missing:=array_append(v_missing,'tabla public.pedidos (migraciones 05/15)'); end if;
  if to_regclass('public.puntos_cuentas_cliente') is null then v_missing:=array_append(v_missing,'tabla public.puntos_cuentas_cliente (migracion 18)'); end if;
  if to_regclass('public.puntos_mov_cliente') is null then v_missing:=array_append(v_missing,'tabla public.puntos_mov_cliente (migracion 18)'); end if;
  if to_regclass('public.catalogo_premios') is null then v_missing:=array_append(v_missing,'tabla public.catalogo_premios (migracion 02)'); end if;
  if to_regclass('public.cupones_ruleta') is null then v_missing:=array_append(v_missing,'tabla public.cupones_ruleta (migracion 02)'); end if;
  if to_regclass('public.canjes') is null then v_missing:=array_append(v_missing,'tabla public.canjes (migracion 02)'); end if;
  if to_regclass('public.ajustes') is null then v_missing:=array_append(v_missing,'tabla public.ajustes'); end if;
  if to_regclass('auth.users') is null then v_missing:=array_append(v_missing,'tabla auth.users'); end if;
  if to_regprocedure('public.nexora_mover_puntos_cliente(uuid,integer,text,text,text)') is null then v_missing:=array_append(v_missing,'funcion public.nexora_mover_puntos_cliente(uuid,integer,text,text,text) (migracion 18)'); end if;
  if to_regprocedure('public.es_admin()') is null then v_missing:=array_append(v_missing,'funcion public.es_admin() (migracion 05)'); end if;
  if to_regprocedure('public.nexora_calcular_pedido(jsonb)') is null then v_missing:=array_append(v_missing,'funcion public.nexora_calcular_pedido(jsonb) (migracion 05/15)'); end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pedidos' and column_name='total_validado') then v_missing:=array_append(v_missing,'columna public.pedidos.total_validado (migracion 05/15/17)'); end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='canjes' and column_name='ff_id') then v_missing:=array_append(v_missing,'columna public.canjes.ff_id (migracion 02)'); end if;
  if (select count(distinct column_name)<5 from information_schema.columns where table_schema='public' and table_name='catalogo_premios' and column_name in ('tipo','valor','peso','stock','activo')) then v_missing:=array_append(v_missing,'columnas de premios de public.catalogo_premios (migracion 02)'); end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='canjes' and column_name='user_id') then v_missing:=array_append(v_missing,'columna public.canjes.user_id (migracion 18)'); end if;
  if cardinality(v_missing)>0 then
    raise exception 'NEXORA 19: faltan dependencias; no se aplico la migracion.' using detail=array_to_string(v_missing,E'\n');
  end if;
end $$;

-- Valores iniciales editables por premio: 30 dias y compra minima de $20.000 COP.
-- 05 define la reserva de un cupon por pedido. Repara de forma aditiva una instalacion donde falto ese DDL.
alter table public.cupones_ruleta add column if not exists reservado_pedido_id text;
create unique index if not exists cupones_ruleta_reserva_uq
  on public.cupones_ruleta (reservado_pedido_id) where reservado_pedido_id is not null;
alter table public.catalogo_premios add column if not exists vence_dias integer not null default 30;
alter table public.catalogo_premios add column if not exists compra_minima numeric(14,2) not null default 20000;
alter table public.cupones_ruleta alter column ff_id drop not null;
alter table public.cupones_ruleta add column if not exists user_id uuid references auth.users(id) on delete restrict;
alter table public.cupones_ruleta add column if not exists compra_minima numeric(14,2) not null default 0;
alter table public.catalogo_premios drop constraint if exists catalogo_premios_vigencia_ok;
alter table public.catalogo_premios add constraint catalogo_premios_vigencia_ok check(vence_dias between 1 and 365);
alter table public.catalogo_premios drop constraint if exists catalogo_premios_compra_minima_ok;
alter table public.catalogo_premios add constraint catalogo_premios_compra_minima_ok check(compra_minima between 0 and 9999999999.99);
alter table public.cupones_ruleta drop constraint if exists cupones_ruleta_compra_minima_ok;
alter table public.cupones_ruleta add constraint cupones_ruleta_compra_minima_ok check(compra_minima between 0 and 9999999999.99);
create index if not exists cupones_ruleta_usuario_fecha_idx on public.cupones_ruleta(user_id,creado desc) where user_id is not null;

create table if not exists public.ruleta_giros_cliente (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  clave text not null check(clave ~ '^[A-Za-z0-9_-]{8,64}$'),
  catalogo_id bigint not null,
  premio text not null,
  tipo text not null check(tipo in ('nada','puntos','pct','fijo','manual')),
  valor integer not null default 0 check(valor>=0),
  costo integer not null check(costo>0),
  estado text not null check(estado in ('completado','requiere_id','pendiente_entrega')),
  codigo text,
  ff_id text,
  canje_id bigint references public.canjes(id) on delete restrict,
  puntos_despues integer not null check(puntos_despues>=0),
  indice integer not null default 0,
  segmentos integer not null default 0,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique(user_id,clave),
  unique(canje_id)
);
create index if not exists ruleta_giros_cliente_user_fecha_idx on public.ruleta_giros_cliente(user_id,creado desc,id desc);
alter table public.ruleta_giros_cliente enable row level security;
revoke all on public.ruleta_giros_cliente from public,anon,authenticated;
revoke all on sequence public.ruleta_giros_cliente_id_seq from public,anon,authenticated;
revoke all on public.cupones_ruleta from public,anon,authenticated;

create or replace function public.nexora_girar_ruleta_cliente(p_clave text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_cfg jsonb; v_wallet public.puntos_cuentas_cliente%rowtype;
  v_old public.ruleta_giros_cliente%rowtype; v_item public.catalogo_premios%rowtype;
  v_cost integer; v_total numeric; v_roll numeric; v_acc numeric:=0; v_found boolean:=false;
  v_n integer; v_index integer:=0; v_pos integer:=0; v_value integer:=0; v_code text;
  v_giro bigint; v_balance integer; r public.catalogo_premios%rowtype;
begin
  if v_uid is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'Inicia sesion para jugar.' using errcode='42501'; end if;
  if coalesce(p_clave,'') !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'Solicitud de giro invalida.' using errcode='22023'; end if;
  select coalesce(valor,'{}'::jsonb) into v_cfg from public.ajustes where clave='puntos';
  if not coalesce((v_cfg->>'activa')::boolean,false) then raise exception 'El programa de puntos esta pausado.'; end if;
  begin v_cost:=nullif(v_cfg->>'objetivo','')::integer; exception when others then v_cost:=null; end;
  if v_cost is null or v_cost<1 or v_cost>1000000 then raise exception 'Configura el costo de giro en administracion.'; end if;
  select * into v_wallet from public.puntos_cuentas_cliente where user_id=v_uid for update;
  if not found then raise exception 'Todavia no tienes saldo de puntos.'; end if;
  select * into v_old from public.ruleta_giros_cliente where user_id=v_uid and clave=p_clave;
  if found then
    select count(*) into v_index from public.catalogo_premios where activo and (stock is null or stock>0) and id<v_old.catalogo_id;
    return jsonb_build_object('ok',true,'repetido',true,'giro_id',v_old.id,'indice',v_old.indice,'nombre',v_old.premio,
      'tipo',v_old.tipo,'valor',v_old.valor,'codigo',v_old.codigo,'estado',v_old.estado,'requiere_id',v_old.estado='requiere_id',
      'puntos',v_wallet.puntos,'segmentos',v_old.segmentos);
  end if;
  if v_wallet.puntos<v_cost then raise exception 'Necesitas % puntos para girar.',v_cost using errcode='23514'; end if;
  select count(*),coalesce(sum(peso),0) into v_n,v_total from public.catalogo_premios
    where activo and peso>0 and (stock is null or stock>0);
  if v_n<2 or v_total<=0 then raise exception 'La ruleta no tiene suficientes premios disponibles.'; end if;
  v_roll:=random()*v_total;
  for r in select * from public.catalogo_premios where activo order by id for update loop
    if r.peso>0 and (r.stock is null or r.stock>0) then
      v_acc:=v_acc+r.peso;
      if not v_found and v_roll<v_acc then v_item:=r; v_index:=v_pos; v_found:=true; end if;
      v_pos:=v_pos+1;
    end if;
  end loop;
  if not v_found then raise exception 'No se pudo seleccionar el premio.'; end if;
  begin v_value:=greatest(0,coalesce(nullif(v_item.valor,'')::numeric,0))::integer; exception when others then v_value:=0; end;
  if v_item.tipo='pct' and v_value not between 1 and 100 then raise exception 'El premio porcentual tiene un valor invalido.'; end if;
  if v_item.tipo='fijo' and v_value<1 then raise exception 'El premio de descuento tiene un valor invalido.'; end if;
  if v_item.tipo='puntos' and v_value<1 then raise exception 'El premio de puntos tiene un valor invalido.'; end if;
  if v_item.stock is not null then update public.catalogo_premios set stock=stock-1,actualizado=now() where id=v_item.id; end if;
  insert into public.ruleta_giros_cliente(user_id,clave,catalogo_id,premio,tipo,valor,costo,estado,puntos_despues,indice,segmentos)
    values(v_uid,p_clave,v_item.id,v_item.nombre,v_item.tipo,v_value,v_cost,case when v_item.tipo='manual' then 'requiere_id' else 'completado' end,v_wallet.puntos-v_cost,v_index,v_n)
    returning id into v_giro;
  v_balance:=public.nexora_mover_puntos_cliente(v_uid,-v_cost,'ruleta_giro',v_item.nombre,'ruleta-cliente-giro:'||v_giro::text);
  if v_item.tipo='puntos' then
    v_balance:=public.nexora_mover_puntos_cliente(v_uid,v_value,'ruleta_premio',v_item.nombre,'ruleta-cliente-premio:'||v_giro::text);
    update public.ruleta_giros_cliente set puntos_despues=v_balance where id=v_giro;
  elsif v_item.tipo in ('pct','fijo') then
    v_code:='NXR-'||upper(replace(gen_random_uuid()::text,'-',''));
    insert into public.cupones_ruleta(codigo,ff_id,user_id,nombre,tipo,valor,usado,giro_id,vence,compra_minima)
      values(v_code,null,v_uid,left(v_item.nombre,60),v_item.tipo,v_value,false,v_giro,now()+make_interval(days=>v_item.vence_dias),v_item.compra_minima);
    update public.ruleta_giros_cliente set codigo=v_code where id=v_giro;
  end if;
  return jsonb_build_object('ok',true,'giro_id',v_giro,'indice',v_index,'nombre',v_item.nombre,'tipo',v_item.tipo,
    'valor',v_value,'codigo',v_code,'puntos',v_balance,'requiere_id',v_item.tipo='manual','estado',case when v_item.tipo='manual' then 'requiere_id' else 'completado' end,'segmentos',v_n);
end $$;

create or replace function public.nexora_completar_premio_ruleta_cliente(p_giro bigint,p_ff_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_giro public.ruleta_giros_cliente%rowtype; v_canje bigint; v_ff text:=btrim(coalesce(p_ff_id,''));
begin
  if v_uid is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'Inicia sesion para registrar la entrega.' using errcode='42501'; end if;
  if v_ff !~ '^[0-9]{6,15}$' then raise exception 'Escribe un ID de Free Fire de 6 a 15 digitos.' using errcode='22023'; end if;
  select * into v_giro from public.ruleta_giros_cliente where id=p_giro and user_id=v_uid for update;
  if not found then raise exception 'Premio no encontrado.'; end if;
  if v_giro.tipo<>'manual' then raise exception 'Ese premio no requiere datos de entrega.'; end if;
  if v_giro.estado='pendiente_entrega' then return jsonb_build_object('ok',true,'repetido',true,'canje_id',v_giro.canje_id); end if;
  if v_giro.estado<>'requiere_id' then raise exception 'El premio ya fue procesado.'; end if;
  insert into public.canjes(ff_id,user_id,premio_id,nombre,costo,origen,estado,clave)
    values(v_ff,v_uid,null,v_giro.premio,0,'ruleta','pendiente','auth-ruleta-'||v_giro.id::text)
    returning id into v_canje;
  update public.ruleta_giros_cliente set ff_id=v_ff,canje_id=v_canje,estado='pendiente_entrega',actualizado=now() where id=v_giro.id;
  return jsonb_build_object('ok',true,'canje_id',v_canje,'estado','pendiente');
end $$;

create or replace function public.validar_premio_cliente(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v record;
begin
  select tipo,valor,compra_minima,user_id into v from public.cupones_ruleta
    where codigo=upper(trim(coalesce(p_codigo,''))) and not usado and vence>now() and reservado_pedido_id is null;
  if not found or (v.user_id is not null and v.user_id is distinct from auth.uid()) then return null; end if;
  return jsonb_build_object('tipo',v.tipo,'valor',v.valor,'compra_minima',v.compra_minima);
end $$;

-- El checkout conserva sus validaciones actuales y suma pertenencia Auth y minimo de compra.
create or replace function public.nexora_validar_cupon_cliente_insert() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_uid uuid; v_min numeric; v_codigo text;
begin
  if new.datos#>>'{_nexora,fuente_cupon}' is distinct from 'ruleta' then return new; end if;
  v_codigo:=upper(btrim(coalesce(new.datos->>'cupon','')));
  if v_codigo='' then return new; end if;
  select user_id,compra_minima into v_uid,v_min from public.cupones_ruleta where codigo=v_codigo;
  if not found then raise exception 'El cupon de ruleta ya no esta disponible.'; end if;
  if v_uid is not null and v_uid is distinct from auth.uid() then raise exception 'Este cupon pertenece a otra cuenta.' using errcode='42501'; end if;
  if coalesce(v_min,0)>coalesce((new.datos->>'subtotal')::numeric,0) then
    raise exception 'Este cupon requiere una compra minima de $% COP.',to_char(v_min,'FM999G999G999G990');
  end if;
  return new;
end $$;
revoke all on function public.nexora_validar_cupon_cliente_insert() from public,anon,authenticated;
drop trigger if exists b_nexora_validar_cupon_cliente on public.pedidos;
create trigger b_nexora_validar_cupon_cliente before insert on public.pedidos
  for each row execute function public.nexora_validar_cupon_cliente_insert();

create or replace function public.admin_guardar_ruleta_cliente(p_premios jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare e jsonb; v_active integer:=0; v_sum integer:=0; v_type text; v_value numeric; v_weight integer; v_stock integer;
  v_days integer; v_min numeric; v_id bigint;
begin
  if not public.es_admin() then return jsonb_build_object('error','No autorizado.'); end if;
  if jsonb_typeof(p_premios) is distinct from 'array' then return jsonb_build_object('error','Datos invalidos.'); end if;
  for e in select * from jsonb_array_elements(p_premios) loop
    continue when coalesce((e->>'eliminar')::boolean,false);
    if char_length(btrim(coalesce(e->>'nombre',''))) not between 1 and 60 then return jsonb_build_object('error','Cada premio necesita nombre de 1 a 60 caracteres.'); end if;
    v_type:=coalesce(e->>'tipo','');
    if v_type not in ('nada','puntos','pct','fijo','manual') then return jsonb_build_object('error','Tipo de premio invalido.'); end if;
    begin v_weight:=(e->>'peso')::integer; exception when others then return jsonb_build_object('error','Probabilidad invalida.'); end;
    if v_weight not between 0 and 100 then return jsonb_build_object('error','La probabilidad debe estar entre 0 y 100.'); end if;
    if v_type in ('puntos','pct','fijo') then
      begin v_value:=(e->>'valor')::numeric; exception when others then return jsonb_build_object('error','Valor de premio invalido.'); end;
      if v_value is null or v_value<1 or v_value<>floor(v_value) or (v_type='pct' and v_value>100) then return jsonb_build_object('error','Revisa el valor del premio.'); end if;
    end if;
    begin v_days:=coalesce(nullif(e->>'vence_dias','')::integer,30); exception when others then return jsonb_build_object('error','Vigencia de cupon invalida.'); end;
    begin v_min:=coalesce(nullif(e->>'compra_minima','')::numeric,20000); exception when others then return jsonb_build_object('error','Compra minima invalida.'); end;
    if v_days not between 1 and 365 or v_min not between 0 and 9999999999.99 then return jsonb_build_object('error','La vigencia debe ser 1 a 365 dias y la compra minima no puede ser negativa.'); end if;
    if nullif(e->>'stock','') is not null then
      begin v_stock:=(e->>'stock')::integer; exception when others then return jsonb_build_object('error','Stock invalido.'); end;
      if v_stock<0 then return jsonb_build_object('error','El stock no puede ser negativo.'); end if;
    end if;
    if coalesce((e->>'activo')::boolean,true) then
      if v_weight<1 then return jsonb_build_object('error','Un premio activo necesita probabilidad mayor que cero.'); end if;
      v_active:=v_active+1; v_sum:=v_sum+v_weight;
    end if;
  end loop;
  if v_active not between 2 and 12 or v_sum<>100 then return jsonb_build_object('error','La ruleta requiere de 2 a 12 premios activos y probabilidades que sumen 100 %.'); end if;
  for e in select * from jsonb_array_elements(p_premios) loop
    v_id:=nullif(e->>'id','')::bigint;
    if coalesce((e->>'eliminar')::boolean,false) then
      if v_id is not null then delete from public.catalogo_premios where id=v_id; end if;
      continue;
    end if;
    v_type:=e->>'tipo'; v_stock:=nullif(e->>'stock','')::integer;
    v_days:=coalesce(nullif(e->>'vence_dias','')::integer,30); v_min:=coalesce(nullif(e->>'compra_minima','')::numeric,20000);
    if v_id is null then
      insert into public.catalogo_premios(nombre,descripcion,tipo,valor,peso,stock,activo,vence_dias,compra_minima)
      values(btrim(e->>'nombre'),left(coalesce(e->>'descripcion',''),200),v_type,
        case when v_type='nada' then '0' else left(coalesce(nullif(btrim(e->>'valor'),''),'0'),60) end,
        (e->>'peso')::integer,v_stock,coalesce((e->>'activo')::boolean,true),v_days,v_min);
    else
      update public.catalogo_premios set nombre=btrim(e->>'nombre'),descripcion=left(coalesce(e->>'descripcion',''),200),tipo=v_type,
        valor=case when v_type='nada' then '0' else left(coalesce(nullif(btrim(e->>'valor'),''),'0'),60) end,
        peso=(e->>'peso')::integer,stock=v_stock,activo=coalesce((e->>'activo')::boolean,true),vence_dias=v_days,compra_minima=v_min,actualizado=now()
        where id=v_id;
    end if;
  end loop;
  select count(*),coalesce(sum(peso),0) into v_active,v_sum from public.catalogo_premios where activo;
  if v_active not between 2 and 12 or v_sum<>100 then raise exception 'La ruleta guardada debe sumar exactamente 100 %%.'; end if;
  return jsonb_build_object('ok',true,'suma',v_sum,'activos',v_active);
end $$;

-- El panel debe leer los giros autenticados desde su tabla privada, no desde la ruleta legacy.
create or replace function public.admin_ruleta_giros_cliente() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,auth,pg_temp as $$
begin
  if not public.es_admin() then raise exception 'No autorizado.' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id',g.id,'user_id',g.user_id,'ff_id',g.ff_id,'premio',g.premio,
      'puntos_ganados',case when g.tipo='puntos' then g.valor else 0 end,'costo',g.costo,'creado',g.creado)
      order by g.creado desc,g.id desc)
    from (select id,user_id,ff_id,premio,tipo,valor,costo,creado from public.ruleta_giros_cliente order by creado desc,id desc limit 50) g
  ),'[]'::jsonb);
end $$;

-- Carga propia: saldos, cupones del usuario, premios pendientes de ID y ruleta activa.
create or replace function public.mis_puntos_cliente() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_cfg jsonb; v_balance integer; v_earned bigint; v_cost integer:=0;
begin
  if v_uid is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'Inicia sesion para consultar tus puntos.' using errcode='42501'; end if;
  select coalesce(valor,'{}'::jsonb) into v_cfg from public.ajustes where clave='puntos';
  if coalesce((v_cfg->>'activa')::boolean,false) then
    insert into public.puntos_cuentas_cliente(user_id) values(v_uid) on conflict(user_id) do nothing;
    if coalesce((v_cfg->>'bienvenida')::integer,0)>0 then
      perform public.nexora_mover_puntos_cliente(v_uid,(v_cfg->>'bienvenida')::integer,'bienvenida','Bonificacion de bienvenida','bienvenida:'||v_uid::text);
    end if;
  end if;
  begin v_cost:=coalesce(nullif(v_cfg->>'objetivo','')::integer,0); exception when others then v_cost:=0; end;
  select puntos,total_ganado into v_balance,v_earned from public.puntos_cuentas_cliente where user_id=v_uid;
  return jsonb_build_object(
    'activa',coalesce((v_cfg->>'activa')::boolean,false),'cada',greatest(coalesce((v_cfg->>'cada')::integer,0),0),
    'por_compra',greatest(coalesce((v_cfg->>'por_compra')::integer,0),0),'puntos',coalesce(v_balance,0),'total_ganado',coalesce(v_earned,0),
    'movimientos',(select coalesce(jsonb_agg(jsonb_build_object('cantidad',m.cantidad,'motivo',m.motivo,'referencia',m.referencia,'creado',m.creado) order by m.creado desc,m.id desc),'[]'::jsonb)
      from (select cantidad,motivo,referencia,creado,id from public.puntos_mov_cliente where user_id=v_uid order by creado desc,id desc limit 50) m),
    'canjes',(select coalesce(jsonb_agg(jsonb_build_object('nombre',c.nombre,'costo',c.costo,'estado',c.estado,'creado',c.creado,'ff_id',c.ff_id) order by c.creado desc),'[]'::jsonb)
      from (select nombre,costo,estado,creado,ff_id from public.canjes where user_id=v_uid order by creado desc limit 30) c),
    'premios',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'descripcion',coalesce(p.descripcion,''),'costo',p.costo_puntos,'disponible',p.stock is null or p.stock>0) order by p.costo_puntos,p.id),'[]'::jsonb) from public.premios p where p.activo),
    'cupones',(select coalesce(jsonb_agg(jsonb_build_object('codigo',c.codigo,'nombre',c.nombre,'tipo',c.tipo,'valor',c.valor,'compra_minima',c.compra_minima,'usado',c.usado,'reservado',c.reservado_pedido_id is not null,'vence',c.vence,'creado',c.creado) order by c.creado desc),'[]'::jsonb)
      from (select codigo,nombre,tipo,valor,compra_minima,usado,reservado_pedido_id,vence,creado from public.cupones_ruleta where user_id=v_uid order by creado desc limit 20) c),
    'pendientes_ruleta',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'nombre',g.premio,'creado',g.creado) order by g.creado desc),'[]'::jsonb)
      from public.ruleta_giros_cliente g where g.user_id=v_uid and g.estado='requiere_id'),
    'ruleta',jsonb_build_object('costo',greatest(v_cost,0),'disponible',coalesce((v_cfg->>'activa')::boolean,false) and v_cost>0,
      'premios',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'tipo',p.tipo,'valor',p.valor,'peso',p.peso,'stock',p.stock) order by p.id),'[]'::jsonb)
        from public.catalogo_premios p where p.activo and p.peso>0 and (p.stock is null or p.stock>0)))
  );
end $$;

revoke all on function public.nexora_girar_ruleta_cliente(text),public.nexora_completar_premio_ruleta_cliente(bigint,text),
  public.validar_premio_cliente(text),public.admin_guardar_ruleta_cliente(jsonb),public.admin_ruleta_giros_cliente() from public,anon,authenticated;
grant execute on function public.nexora_girar_ruleta_cliente(text),public.nexora_completar_premio_ruleta_cliente(bigint,text),
  public.validar_premio_cliente(text) to authenticated,anon;
grant execute on function public.admin_guardar_ruleta_cliente(jsonb) to authenticated;
grant execute on function public.admin_ruleta_giros_cliente() to authenticated;
revoke all on function public.validar_premio(text) from public,anon,authenticated;
revoke all on function public.mis_puntos_cliente() from public,anon,authenticated;
grant execute on function public.mis_puntos_cliente() to authenticated;
notify pgrst,'reload schema';
commit;
