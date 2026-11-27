const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "scripts/supabase/19_ruleta_premios_auth.sql"), "utf8");
const backend = fs.readFileSync(path.join(root, "js/backend.js"), "utf8");
const points = fs.readFileSync(path.join(root, "js/puntos.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "js/admin.js"), "utf8");

test("si faltan precondiciones, la migracion informa cada dependencia exacta sin continuar", () => {
  assert.match(migration, /declare v_missing text\[\]/i);
  assert.match(migration, /array_append\(v_missing,'columna public\.pedidos\.total_validado/i);
  assert.match(migration, /array_append\(v_missing,'funcion public\.nexora_mover_puntos_cliente/i);
  assert.match(migration, /using detail=array_to_string\(v_missing/i);
  assert.match(migration, /if cardinality\(v_missing\)>0 then[\s\S]*raise exception/i);
});

test("la migracion restaura la reserva de cupones tal como la define la migracion 05", () => {
  assert.match(migration, /alter table public\.cupones_ruleta add column if not exists reservado_pedido_id text/i);
  assert.match(migration, /create unique index if not exists cupones_ruleta_reserva_uq[\s\S]*on public\.cupones_ruleta\s*\(reservado_pedido_id\) where reservado_pedido_id is not null/i);
});

test("cada giro autenticado se decide y se cobra en PostgreSQL con clave idempotente", () => {
  assert.match(migration, /create table if not exists public\.ruleta_giros_cliente/i);
  assert.match(migration, /unique\(user_id,clave\)/i);
  assert.match(migration, /create or replace function public\.nexora_girar_ruleta_cliente\(p_clave text\)/i);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /nexora_mover_puntos_cliente\(v_uid,-v_cost,'ruleta_giro'/i);
  assert.match(migration, /return jsonb_build_object\('ok',true,'repetido',true/i);
  assert.match(migration, /grant execute on function public\.nexora_girar_ruleta_cliente\(text\)/i);
  assert.match(backend, /girarRuletaCliente:function\(clave\)[\s\S]*rpcChecked\("nexora_girar_ruleta_cliente",\{p_clave:String\(clave\|\|""\)\}\)/);
  assert.match(points, /sessionStorage\.getItem\(storeKey\)/);
});

test("los descuentos se emiten como cupones de un uso ligados a la cuenta y se validan en checkout", () => {
  assert.match(migration, /insert into public\.cupones_ruleta\(codigo,ff_id,user_id,nombre,tipo,valor,usado,giro_id,vence,compra_minima\)/i);
  assert.match(migration, /if v_uid is not null and v_uid is distinct from auth\.uid\(\)/i);
  assert.match(migration, /if coalesce\(v_min,0\)>coalesce\(\(new\.datos->>'subtotal'\)::numeric,0\)/i);
  assert.match(migration, /before insert on public\.pedidos/i);
  assert.match(migration, /reservado_pedido_id is null/i);
  assert.match(migration, /cupones_ruleta\(codigo,ff_id,user_id,nombre,tipo,valor,usado,giro_id,vence,compra_minima\)/i);
});

test("los premios manuales solicitan ID de juego y quedan en la cola admin", () => {
  assert.match(migration, /nexora_completar_premio_ruleta_cliente\(p_giro bigint,p_ff_id text\)/i);
  assert.match(migration, /insert into public\.canjes\(ff_id,user_id,premio_id,nombre,costo,origen,estado,clave\)/i);
  assert.match(migration, /create or replace function public\.admin_ruleta_giros_cliente\(\)/i);
  assert.match(backend, /completarPremioRuletaCliente:function\(giro,ffId\)/);
  assert.match(backend, /rpcChecked\("admin_ruleta_giros_cliente",\{\}\)/);
  assert.match(admin, /ID de juego/);
});

test("la configuración admin valida porcentajes y permite fijar vigencia y mínimo", () => {
  assert.match(migration, /vence_dias integer not null default 30/i);
  assert.match(migration, /compra_minima numeric\(14,2\) not null default 20000/i);
  assert.match(migration, /create or replace function public\.admin_guardar_ruleta_cliente\(p_premios jsonb\)/i);
  assert.match(migration, /v_active not between 2 and 12 or v_sum<>100/i);
  assert.match(migration, /raise exception 'La ruleta guardada debe sumar exactamente 100 %%\.'/i);
  assert.match(admin, /\.l-vence/);
  assert.match(admin, /\.l-minimo/);
  assert.match(admin, /vence_dias:Math\.floor/);
  assert.match(admin, /compra_minima:Number/);
});

test("un pedido seguro con comprobante pero sin abono permite registrarlo como pendiente, nunca pagarlo directamente", () => {
  assert.match(admin, /if\(Backend\.secureCheckout&&e==="Pendiente"&&!o\.pagoRegistro\)b\+='.*data-register-payment=/);
  assert.match(admin, /if\(!String\(o\.referencia\|\|""\)\.trim\(\)&&!String\(o\.comprobante\|\|""\)\.trim\(\)\)/);
  assert.match(admin, /Registrar pago para revisión/);
  assert.match(admin, /Backend\.registrarAbono\(o\.id,monto/);
  assert.match(backend, /registrarAbono:function\(pedidoId,monto,metodo,referencia,comprobante,nota\)[\s\S]*rpcChecked\("admin_registrar_abono"/);
  assert.match(admin, /Pago registrado para revisión/);
  const start = admin.indexOf("function registrarAbonoPedido");
  const end = admin.indexOf("function revisarPagoCompleto", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(admin.slice(start, end), /revisarPagoCompleto\(/);
});

test("verificar un abono usa la RPC existente que cambia el pedido a pagado", () => {
  const start = admin.indexOf("function revisarPagoCompleto");
  const end = admin.indexOf("function registrarReintegro", start);
  const handler = admin.slice(start, end);
  const secureSql = fs.readFileSync(path.join(root, "scripts/supabase/05_seguridad_compras_pagos.sql"), "utf8");
  assert.match(handler, /Backend\.verificarAbono\(\s*p\.id,\s*true/);
  assert.doesNotMatch(handler, /confirmarPagoCompleto|admin_confirmar_pago_pedido/);
  assert.match(handler, /if\(!r\.pagado\)[\s\S]*r\.saldo/);
  assert.match(handler, /estadoDe\(actualizado\)!=="Pagado"/);
  assert.match(backend, /verificarAbono:function\([\s\S]*"admin_verificar_abono"/);
  assert.match(secureSql, /create or replace function public\.admin_verificar_abono\(p_abono_id bigint,p_aprobar boolean/i);
  assert.match(secureSql, /update public\.pedidos\s+set estado='Pagado'/i);
});

test("el panel no queda cargando indefinidamente y distingue qué consulta de pedidos falló", () => {
  assert.match(backend, /rpcChecked\(nombre,args,timeoutMs\)/);
  assert.match(backend, /admin_listar_pagos_pedidos",\s*\{\},\s*15000/);
  assert.match(backend, /admin_listar_entregas_pedidos",\s*\{\},\s*15000/);
  assert.match(backend, /function listarEntregasExistentes\(entregas,ultimoId\)[\s\S]*call\("GET",path,undefined,undefined,false,15000\)/);
  assert.match(backend, /No se pudo cargar pagos:/);
  assert.match(backend, /No se pudieron cargar entregas:/);
  assert.match(admin, /function cargarPedidos\(\)\{ordersErr="";ordersLoading=true/);
  assert.match(admin, /ordersLoading=false;renderAdmin\(\)\}\)\.catch/);
});
