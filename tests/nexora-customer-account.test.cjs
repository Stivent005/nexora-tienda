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
  const migration = fs.readFileSync(path.join(root, "supabase/07_cuentas_cliente_historial.sql"), "utf8");
  const secureCheckout = fs.readFileSync(path.join(root, "supabase/05_seguridad_compras_pagos.sql"), "utf8");
  assert.match(migration, /insert into public\.pedido_propietarios\(pedido_id,user_id\)/i);
  assert.match(migration, /where po\.user_id=auth\.uid\(\)/i);
  assert.match(migration, /grant execute on function public\.mis_pedidos\(\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.crear_pedido_seguro\(jsonb\) to authenticated/i);
  assert.match(migration, /revoke insert on public\.pedidos from anon/i);
  assert.match(secureCheckout, /'digitalData',case when v_digital then v_digital_data/i);
  assert.match(secureCheckout, /Completa el ID y el nombre de la cuenta digital/i);
  assert.match(secureCheckout, /Completa direccion, ciudad y departamento/i);
});
