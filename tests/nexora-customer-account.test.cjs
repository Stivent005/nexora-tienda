const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const contracts = require("../js/contracts.js");

const root = path.join(__dirname, "..");
const backendSource = fs.readFileSync(path.join(root, "js/backend.js"), "utf8");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body == null ? "" : JSON.stringify(body)
  };
}

function createBackend(supabase, fetchImpl) {
  const stored = new Map();
  const context = vm.createContext({
    CONFIG: { supabase }, ADMIN_PAGE: false, enLocal: false,
    sessionStorage: {
      getItem(key) { return stored.get(key) || null; },
      setItem(key, value) { stored.set(key, value); },
      removeItem(key) { stored.delete(key); }
    },
    fetch: fetchImpl || (() => Promise.reject(new Error("fetch inesperado"))),
    T: (key) => key,
    normalizarPedido: (row) => row
  });
  vm.runInContext(backendSource, context, { filename: "js/backend.js" });
  return { backend: context.Backend, stored };
}

test("checkout remoto permanece cerrado si no esta activo el calculo seguro", async () => {
  const { backend } = createBackend({ enabled: true, secureCheckout: false, customerAccounts: true, url: "https://shop.supabase.co", anonKey: "public" });
  assert.equal(backend.ready, false);
  await assert.rejects(backend.crear({}), (error) => error.code === "SECURE_CHECKOUT_REQUIRED");
});

test("checkout remoto exige cuenta y Auth permite consultar solo la RPC de compras propias", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/v1/token?grant_type=password")) {
      return response(200, { access_token: "access-token", refresh_token: "refresh-token", user: { id: "user-1", email: "cliente@example.com", user_metadata: { full_name: "Cliente Demo" } } });
    }
    if (url.endsWith("/rest/v1/rpc/mis_pedidos")) return response(200, [{ id: "pedido-1", estado: "Pendiente", datos: { total: 25000 } }]);
    throw new Error("Ruta inesperada: " + url);
  };
  const { backend, stored } = createBackend({ enabled: true, secureCheckout: true, customerAccounts: true, url: "https://shop.supabase.co", anonKey: "public" }, fetchImpl);

  assert.equal(backend.ready, true);
  assert.equal(backend.customer(), null);
  await assert.rejects(backend.crear({}), (error) => error.code === "AUTH_REQUIRED");
  const user = await backend.loginCustomer("cliente@example.com", "password-largo");
  assert.equal(user.id, "user-1");
  assert.equal(user.email, "cliente@example.com");
  assert.equal(backend.restoreCustomer(), true);
  assert.ok(stored.has("tienda_customer_ses"));

  const orders = await backend.myOrders();
  assert.deepEqual(Array.from(orders, (order) => order.id), ["pedido-1"]);
  const orderRequest = calls.find((call) => call.url.endsWith("/rest/v1/rpc/mis_pedidos"));
  assert.equal(orderRequest.options.headers.Authorization, "Bearer access-token");
});

test("las RPC de puntos solo salen con sesión Auth y el cliente no envía saldo ni user_id", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/v1/token?grant_type=password")) {
      return response(200, { access_token: "points-token", refresh_token: "refresh", user: { id: "uid-own", email: "own@example.com" } });
    }
    if (url.endsWith("/rest/v1/rpc/mis_puntos_cliente")) return response(200, { puntos: 25, movimientos: [] });
    if (url.endsWith("/rest/v1/rpc/canjear_mis_puntos")) return response(200, { ok: true, puntos: 5 });
    throw new Error("Ruta inesperada: " + url);
  };
  const { backend } = createBackend({ enabled: true, secureCheckout: true, customerAccounts: true, url: "https://shop.supabase.co", anonKey: "public" }, fetchImpl);

  await assert.rejects(backend.misPuntosCliente(), (error) => error.code === "AUTH_REQUIRED");
  await assert.rejects(backend.canjearPuntosCliente(7, "clave-12345678"), (error) => error.code === "AUTH_REQUIRED");
  await backend.loginCustomer("own@example.com", "password-largo");
  assert.deepEqual(JSON.parse(JSON.stringify(await backend.misPuntosCliente())), { puntos: 25, movimientos: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(await backend.canjearPuntosCliente(7, "clave-12345678"))), { ok: true, puntos: 5 });

  const reads = calls.find((call) => call.url.endsWith("/rpc/mis_puntos_cliente"));
  const redeem = calls.find((call) => call.url.endsWith("/rpc/canjear_mis_puntos"));
  assert.equal(reads.options.headers.Authorization, "Bearer points-token");
  assert.deepEqual(JSON.parse(redeem.options.body), { p_premio: 7, p_clave: "clave-12345678" });
  assert.equal(redeem.options.headers.Authorization, "Bearer points-token");
});

test("todos los productos virtuales requieren ID y nombre aunque se configuren campos extra", () => {
  const product = contracts.normalizeProduct({
    id: "digital", tipo: "virtual", name: "Paquete", digital: {
      fields: [{ key: "server", label: "Servidor", required: false }]
    }
  });
  const fields = contracts.digitalFields(product);
  assert.deepEqual(fields.map((field) => field.key), ["playerId", "displayName", "server"]);
  assert.equal(fields[0].required, true);
  assert.equal(fields[1].required, true);
  assert.deepEqual(contracts.validateDigitalValues(fields, { playerId: "123456", displayName: "Jugador" }), []);
  assert.deepEqual(contracts.validateDigitalValues(fields, { playerId: "", displayName: "" }), ["ID del jugador o cuenta", "Nombre visible de la cuenta"]);
});

test("la migracion de cuentas vincula el pedido y la lectura al usuario autenticado", () => {
  const migration = fs.readFileSync(path.join(root, "scripts/supabase/07_cuentas_cliente_historial.sql"), "utf8");
  const secureCheckout = fs.readFileSync(path.join(root, "scripts/supabase/05_seguridad_compras_pagos.sql"), "utf8");
  assert.match(migration, /insert into public\.pedido_propietarios\(pedido_id,user_id\)/i);
  assert.match(migration, /where po\.user_id=auth\.uid\(\)/i);
  assert.match(migration, /grant execute on function public\.mis_pedidos\(\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.crear_pedido_seguro\(jsonb\) to authenticated/i);
  assert.match(migration, /revoke insert on public\.pedidos from anon/i);
  assert.match(secureCheckout, /'digitalData',case when v_digital then v_digital_data/i);
  assert.match(secureCheckout, /Completa el ID y el nombre de la cuenta digital/i);
  assert.match(secureCheckout, /Completa direccion, ciudad y departamento/i);
});

test("la migracion final mantiene checkout idempotente para invitados y cuentas", () => {
  const migration = fs.readFileSync(path.join(root, "scripts/supabase/14_checkout_idempotencia_invitados.sql"), "utf8");
  assert.match(migration, /v_clave !~ '\^\[A-Za-z0-9_-\]\{8,80\}\$'/i);
  assert.match(migration, /if v_user_id is not null and coalesce\(auth\.role\(\),''\)='authenticated'/i);
  assert.match(migration, /insert into public\.pedido_propietarios\(pedido_id,user_id\)/i);
  assert.match(migration, /grant execute on function public\.crear_pedido_seguro\(jsonb\) to anon,authenticated/i);
  const backend = fs.readFileSync(path.join(root, "js/backend.js"), "utf8");
  assert.match(backend, /\^\[A-Za-z0-9_-\]\{8,80\}\$/);
});

test("la reparacion de idempotencia crea la huella que usa la RPC autenticada", () => {
  const migration = fs.readFileSync(path.join(root, "scripts/supabase/15_reparar_dependencias_idempotencia.sql"), "utf8");
  assert.match(migration, /create or replace function public\.nexora_huella_pedido\(p_datos jsonb\)/i);
  assert.match(migration, /create or replace function public\.nexora_calcular_pedido\(p_datos jsonb\)/i);
  assert.match(migration, /create trigger a_nexora_validar_pedido before insert on public\.pedidos/i);
  assert.match(migration, /return md5\(v_datos::text\)/i);
  assert.match(migration, /create table if not exists public\.pedido_idempotencia/i);
  assert.match(migration, /create table if not exists public\.pedido_propietarios/i);
  assert.match(migration, /to_regclass\('public\.cupones_ruleta'\)/i);
});

test("la migracion de pagos inicializa config ausente sin pisar metodos ya guardados", () => {
  const migration = fs.readFileSync(path.join(root, "scripts/supabase/16_inicializar_metodos_pago.sql"), "utf8");
  assert.match(migration, /insert into public\.ajustes as actual\(clave,valor\)/i);
  assert.match(migration, /'id','nequi'[\s\S]*?'tipo','transfer'/i);
  assert.match(migration, /where case[\s\S]*?jsonb_typeof\(actual\.valor->'metodos'\)='array'/i);
  assert.match(migration, /then jsonb_array_length\(actual\.valor->'metodos'\)=0/i);
});

test("el trigger de validacion solo se instala junto con sus columnas de precio seguro", () => {
  const repair = fs.readFileSync(path.join(root, "scripts/supabase/15_reparar_dependencias_idempotencia.sql"), "utf8");
  const forward = fs.readFileSync(path.join(root, "scripts/supabase/17_reparar_columnas_pedido_seguro.sql"), "utf8");
  for (const sql of [repair, forward]) {
    assert.match(sql, /add column if not exists total_validado numeric\(14,2\)/i);
    assert.match(sql, /add column if not exists precio_validado_en timestamptz/i);
    assert.match(sql, /add column if not exists version_precios smallint/i);
    assert.match(sql, /new\.total_validado:=\(new\.datos->>'total'\)::numeric/i);
    assert.match(sql, /create trigger a_nexora_validar_pedido before insert on public\.pedidos/i);
  }
});
