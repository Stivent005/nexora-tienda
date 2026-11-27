const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const workerPath = path.join(root, "worker", "index.mjs");

async function loadWorker() {
  return import(`${require("node:url").pathToFileURL(workerPath).href}?test=${Date.now()}-${Math.random()}`);
}

function signedHeaders(dataId, secret = "test-webhook-secret", requestId = "request-123") {
  const ts = "1770000000000";
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const digest = createHmac("sha256", secret).update(manifest).digest("hex");
  return { "x-signature": `ts=${ts},v1=${digest}`, "x-request-id": requestId };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("Mercado Pago firma HMAC válida ignora mayúsculas del ID y rechaza cambios", async () => {
  const { verifyWebhookSignature } = await loadWorker();
  const headers = signedHeaders("ORDTEST0123456789");
  assert.equal(await verifyWebhookSignature(headers["x-signature"], headers["x-request-id"], "ORDTEST0123456789", "test-webhook-secret"), true);
  assert.equal(await verifyWebhookSignature(headers["x-signature"], headers["x-request-id"], "ORDTEST0123456788", "test-webhook-secret"), false);
  assert.equal(await verifyWebhookSignature(headers["x-signature"], "", "ORDTEST0123456789", "test-webhook-secret"), false);
});

test("solo una order acreditada en COP por el monto completo admite confirmación", async () => {
  const { paymentFor } = await loadWorker();
  const order = {
    status: "processed", status_detail: "accredited", currency: "COP", country_code: "COL",
    total_amount: "125000.00", total_paid_amount: "125000.00",
    transactions: { payments: [{ id: "PAYTEST012345", status: "processed", status_detail: "accredited", paid_amount: "125000.00" }] }
  };
  assert.deepEqual(paymentFor(order), { amount: 125000, paymentId: "PAYTEST012345" });
  assert.equal(paymentFor({ ...order, total_paid_amount: "120000.00" }), null);
  assert.equal(paymentFor({ ...order, currency: "ARS" }), null);
  assert.equal(paymentFor({ ...order, status_detail: "in_process" }), null);
});

test("checkout toma el total de Supabase, valida login y liga la order", async () => {
  const worker = await loadWorker();
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith("/rpc/nexora_mercadopago_checkout")) return jsonResponse({ id: "pedido-123456", total: 125000, moneda: "COP", email: "cliente@example.com" });
    if (url.endsWith("/v1/orders")) return jsonResponse({ id: "ORDTEST0123456789", external_reference: "pedido-123456", checkout_url: "https://www.mercadopago.com.co/checkout/v1/redirect?test=1" }, 201);
    if (url.endsWith("/rpc/nexora_vincular_orden_mercadopago")) return jsonResponse({ ok: true });
    throw new Error(`Solicitud inesperada: ${url}`);
  };
  try {
    const env = {
      ASSETS: { fetch: () => new Response("static") },
      SUPABASE_URL: "https://supabase.example", SUPABASE_ANON_KEY: "public-test-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-test-key", MERCADOPAGO_ACCESS_TOKEN: "test-access-token"
    };
    const request = new Request("https://store.example/api/mercadopago/checkout", {
      method: "POST", headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz0123456789", "Content-Type": "application/json" },
      body: JSON.stringify({ pedidoId: "pedido-123456", total: 1 })
    });
    const result = await worker.default.fetch(request, env);
    const body = await result.json();
    assert.equal(result.status, 200);
    assert.equal(body.checkoutUrl, "https://www.mercadopago.com.co/checkout/v1/redirect?test=1");
    const mpCall = calls.find((call) => call.url.endsWith("/v1/orders"));
    assert.equal(mpCall.body.total_amount, "125000.00");
    assert.equal(mpCall.body.external_reference, "pedido-123456");
    assert.match(mpCall.init.headers["X-Idempotency-Key"], /^[0-9a-f-]{36}$/);
    const bindCall = calls.find((call) => call.url.endsWith("nexora_vincular_orden_mercadopago"));
    assert.equal(bindCall.body.p_order_id, "ORDTEST0123456789");

    const noSession = await worker.default.fetch(new Request("https://store.example/api/mercadopago/checkout", { method: "POST", body: JSON.stringify({ pedidoId: "pedido-123456" }) }), env);
    assert.equal(noSession.status, 401);
  } finally {
    global.fetch = originalFetch;
  }
});

test("webhook consulta a Mercado Pago y solo llama Supabase si el pago está acreditado", async () => {
  const worker = await loadWorker();
  const originalFetch = global.fetch;
  const calls = [];
  const order = {
    id: "ORDTEST0123456789", external_reference: "pedido-123456", status: "processed", status_detail: "accredited",
    currency: "COP", country_code: "COL", total_amount: "125000.00", total_paid_amount: "125000.00",
    transactions: { payments: [{ id: "PAYTEST012345", status: "processed", status_detail: "accredited", paid_amount: "125000.00" }] }
  };
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("/v1/orders/")) return jsonResponse(order);
    if (url.endsWith("/rpc/nexora_confirmar_pago_mercadopago")) return jsonResponse({ ok: true, estado: "Pagado" });
    throw new Error(`Solicitud inesperada: ${url}`);
  };
  try {
    const env = {
      ASSETS: { fetch: () => new Response("static") },
      SUPABASE_URL: "https://supabase.example", SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
      MERCADOPAGO_ACCESS_TOKEN: "test-access-token", MERCADOPAGO_WEBHOOK_SECRET: "test-webhook-secret"
    };
    const id = "ORDTEST0123456789";
    const url = new URL("https://store.example/api/mercadopago/webhook");
    url.searchParams.set("data.id", id);
    url.searchParams.set("type", "order");
    const makeRequest = (headers = signedHeaders(id)) => new Request(url, { method: "POST", headers, body: JSON.stringify({ type: "order", data: { id } }) });
    const result = await worker.default.fetch(makeRequest(), env);
    assert.equal(result.status, 200);
    const confirm = calls.find((call) => call.url.endsWith("nexora_confirmar_pago_mercadopago"));
    assert.equal(confirm.body.p_pedido_id, "pedido-123456");
    assert.equal(confirm.body.p_payment_id, "PAYTEST012345");
    assert.equal(confirm.body.p_monto, 125000);

    calls.length = 0;
    global.fetch = async (input) => {
      const url = String(input);
      calls.push({ url });
      if (url.includes("/v1/orders/")) return jsonResponse({ ...order, total_paid_amount: "10.00" });
      throw new Error("No debe confirmar un pago incompleto.");
    };
    const rejected = await worker.default.fetch(makeRequest(), env);
    assert.equal(rejected.status, 200);
    assert.equal(calls.some((call) => call.url.endsWith("nexora_confirmar_pago_mercadopago")), false);

    const invalid = makeRequest({ "x-signature": "ts=1,v1=" + "0".repeat(64), "x-request-id": "bad" });
    assert.equal((await worker.default.fetch(invalid, env)).status, 401);
  } finally {
    global.fetch = originalFetch;
  }
});

test("interfaz y migración separan Mercado Pago del comprobante manual", () => {
  const store = fs.readFileSync(path.join(root, "js", "store.js"), "utf8");
  const backend = fs.readFileSync(path.join(root, "js", "backend.js"), "utf8");
  const admin = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
  const migration = fs.readFileSync(path.join(root, "scripts", "supabase", "20_mercadopago_checkout.sql"), "utf8");
  const workerSource = fs.readFileSync(workerPath, "utf8");
  assert.match(store, /NEXORA_MP_PENDING/);
  assert.match(store, /Backend\.iniciarPagoMercadoPago\(o\.id\)/);
  assert.match(backend, /api\/mercadopago\/checkout/);
  assert.match(admin, /gateway==="mercadopago"/);
  assert.match(migration, /service_role/);
  assert.match(migration, /nexora\.mercadopago_rpc/);
  assert.match(migration, /grant execute on function public\.nexora_confirmar_pago_mercadopago/);
  assert.match(workerSource, /verifyWebhookSignature/);
  assert.match(workerSource, /order\.status_detail !== "accredited"/);
});
