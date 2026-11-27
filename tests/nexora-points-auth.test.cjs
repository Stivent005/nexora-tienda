const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "scripts/supabase/18_puntos_clientes_auth.sql"), "utf8");
const backend = fs.readFileSync(path.join(root, "js/backend.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "js/admin.js"), "utf8");
const pointsPage = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("la cartera se vincula a Auth y solo las RPC concedidas consultan el UID propio", () => {
  assert.match(sql, /user_id uuid primary key references auth\.users\(id\)/i);
  assert.match(sql, /user_id uuid not null references auth\.users\(id\)/i);
  assert.match(sql, /v_uid uuid:=auth\.uid\(\)/i);
  assert.match(sql, /if v_uid is null or coalesce\(auth\.role\(\),''\)<>'authenticated'/i);
  assert.match(sql, /where user_id=v_uid/i);
  assert.match(sql, /create or replace function public\.mis_puntos_cliente\(\)/i);
  assert.match(sql, /revoke all on public\.puntos_cuentas_cliente,public\.puntos_mov_cliente from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.mis_puntos_cliente\(\),public\.canjear_mis_puntos\(bigint,text\) to authenticated/i);
});

test("el saldo se cambia con reglas del servidor y el libro mayor no se edita ni borra", () => {
  assert.match(sql, /if v_saldo\+p_cantidad<0 then raise exception 'Saldo de puntos insuficiente\.'/i);
  assert.match(sql, /if v_wallet\.puntos<v_p\.costo_puntos then raise exception 'No tienes puntos suficientes\.'/i);
  assert.match(sql, /if v_p\.stock is not null and v_p\.stock<=0 then raise exception 'Premio agotado\.'/i);
  assert.match(sql, /before update or delete on public\.puntos_mov_cliente/i);
  assert.match(sql, /ref_unica text unique/i);
  assert.match(sql, /insert into public\.puntos_mov_cliente\(user_id,cantidad,motivo,referencia,ref_unica,saldo_despues\)/i);
  assert.match(sql, /public\.nexora_mover_puntos_cliente\(v_uid,-v_p\.costo_puntos,'canje'/i);
});

test("solo pedidos propios pagados con sistema activo acreditan puntos; invitados quedan fuera", () => {
  assert.match(sql, /select user_id into v_uid from public\.pedido_propietarios where pedido_id=new\.id/i);
  assert.match(sql, /if v_uid is null then return new/i);
  assert.match(sql, /if not coalesce\(\(v_cfg->>'activa'\)::boolean,false\) then return new/i);
  assert.match(sql, /new\.estado in \('Pagado','Entregado'\)/i);
  assert.match(sql, /new\.total_validado/i);
  assert.match(sql, /bienvenida:'\|\|v_uid::text/i);
  assert.doesNotMatch(sql, /aplicar_puntos_pedido/i);
  assert.match(sql, /from public\.canjes where user_id=v_uid/i);
});

test("el navegador no manda saldo, UID ni cantidad y usa scripts versionados", () => {
  assert.match(backend, /misPuntosCliente:function\(\)[\s\S]*rpcChecked\("mis_puntos_cliente",\{\}\)/);
  assert.match(backend, /canjearPuntosCliente:function\(premio,clave\)[\s\S]*p_premio:Number\(premio\)[\s\S]*p_clave:String\(clave\|\|""\)/);
  assert.doesNotMatch(backend, /p_user_id:|p_cantidad:/);
  assert.match(admin, /P\.activa===true/);
  assert.match(admin, /por_compra/);
  assert.match(admin, /bienvenida/);
  assert.match(admin, /Guardar configur/);
  assert.match(pointsPage, /js\/backend\.js\?v=20261127-catalog-2/);
  assert.match(pointsPage, /js\/puntos\.js\?v=20261126-puntos-auth-1/);
});
