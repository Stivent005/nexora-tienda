const MP_API = "https://api.mercadopago.com";
const MP_HOSTS = new Set(["www.mercadopago.com.co", "mercadopago.com.co"]);
const MAX_WEBHOOK_BYTES = 32_000;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function textResponse(body, status = 200) {
  return new Response(body, { status, headers: { "Cache-Control": "no-store" } });
}

function required(env, names) {
  return names.every((name) => typeof env[name] === "string" && env[name].trim());
}

function validOrderId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

async function deterministicUuid(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes.slice(0, 16)].map((item) => item.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function supabaseRpc(env, name, args, { userToken } = {}) {
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const privileged = !userToken;
  const key = privileged ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const bearer = userToken || env.SUPABASE_SERVICE_ROLE_KEY;
  const result = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  const body = await result.text();
  let data;
  try { data = body ? JSON.parse(body) : null; } catch { data = null; }
  if (!result.ok) {
    const error = new Error(data?.message || "Supabase no pudo completar la operación.");
    error.status = result.status;
    throw error;
  }
  return data;
}

function signatureParts(value) {
  const output = {};
  for (const part of String(value || "").split(",")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    output[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return output;
}

async function verifyWebhookSignature(signature, requestId, dataId, secret) {
  const parts = signatureParts(signature);
  if (!parts.ts || !parts.v1 || !requestId || !dataId || !secret || !/^\d+$/.test(parts.ts)) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(manifest)));
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const candidates = parts.v1.split(/\s+/).filter((item) => /^[a-f0-9]{64}$/i.test(item));
  return candidates.some((candidate) => {
    const supplied = candidate.toLowerCase();
    let mismatch = expected.length ^ supplied.length;
    for (let index = 0; index < expected.length; index++) {
      mismatch |= expected.charCodeAt(index) ^ (supplied.charCodeAt(index) || 0);
    }
    return mismatch === 0;
  });
}

function paymentFor(order) {
  if (!order || order.status !== "processed" || order.status_detail !== "accredited") return null;
  const currency = order.currency || order.currency_id;
  if (currency !== "COP" || (order.country_code && order.country_code !== "COL")) return null;
  const total = Number(order.total_amount);
  const paid = Number(order.total_paid_amount);
  if (!(total > 0) || !Number.isFinite(total) || paid !== total) return null;
  const payments = order.transactions?.payments;
  if (!Array.isArray(payments)) return null;
  const approved = payments.filter((item) => item?.status === "processed" && item?.status_detail === "accredited");
  if (approved.length !== 1) return null;
  const payment = approved[0];
  const paidAmount = Number(payment.paid_amount ?? payment.amount);
  if (paidAmount !== total || !/^[A-Za-z0-9_-]{6,100}$/.test(String(payment.id || ""))) return null;
  return { amount: total, paymentId: String(payment.id) };
}

async function startCheckout(request, env) {
  if (!required(env, ["SUPABASE_URL", "SUPABASE_ANON_KEY", "MERCADOPAGO_ACCESS_TOKEN"])) {
    return response({ error: "El checkout automático todavía no está configurado en el servidor." }, 503);
  }
  const authorization = request.headers.get("Authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!tokenMatch || tokenMatch[1].length < 30) return response({ error: "Inicia sesión para continuar." }, 401);

  let input;
  try { input = await request.json(); } catch { return response({ error: "Solicitud de pago inválida." }, 400); }
  const orderId = String(input?.pedidoId || "");
  if (!validOrderId(orderId)) return response({ error: "El número del pedido no es válido." }, 400);

  let order;
  try {
    order = await supabaseRpc(env, "nexora_mercadopago_checkout", { p_pedido_id: orderId }, { userToken: tokenMatch[1] });
  } catch (error) {
    const status = error.status === 401 ? 401 : (error.status >= 400 && error.status < 500 ? 400 : 502);
    return response({ error: status === 401 ? "Tu sesión venció. Inicia sesión e inténtalo otra vez." : "No se pudo validar el pedido para Mercado Pago." }, status);
  }
  if (!order || String(order.id) !== orderId || !(Number(order.total) > 0) || order.moneda !== "COP") {
    return response({ error: "El pedido no está disponible para iniciar este pago." }, 409);
  }

  const workerUrl = new URL(request.url);
  const returnUrl = new URL("/", workerUrl.origin);
  returnUrl.searchParams.set("mp_return", "1");
  const payload = {
    type: "online",
    processing_mode: "manual",
    capture_mode: "automatic_async",
    total_amount: Number(order.total).toFixed(2),
    external_reference: orderId,
    description: `Pedido NEXORA #${orderId.slice(-6).toUpperCase()}`,
    config: { online: {
      success_url: returnUrl.href,
      failure_url: returnUrl.href,
      pending_url: returnUrl.href,
      auto_return: "approved"
    } }
  };
  if (typeof order.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email) && order.email.length <= 254) {
    payload.payer = { email: order.email };
  }

  let mpOrder;
  try {
    const result = await fetch(`${MP_API}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": await deterministicUuid(`nexora-mercadopago:${orderId}`)
      },
      body: JSON.stringify(payload)
    });
    const body = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error("Mercado Pago no pudo crear la orden.");
    mpOrder = body;
  } catch {
    return response({ error: "Mercado Pago no pudo iniciar el pago. Puedes intentarlo otra vez sin duplicar el pedido." }, 502);
  }

  let checkoutUrl;
  try { checkoutUrl = new URL(mpOrder.checkout_url); } catch { return response({ error: "Mercado Pago no devolvió un enlace de checkout válido." }, 502); }
  if (checkoutUrl.protocol !== "https:" || !MP_HOSTS.has(checkoutUrl.hostname) || !mpOrder.id) {
    return response({ error: "Mercado Pago devolvió un enlace de checkout inesperado." }, 502);
  }

  try {
    const linked = await supabaseRpc(env, "nexora_vincular_orden_mercadopago", {
      p_pedido_id: orderId,
      p_order_id: String(mpOrder.id),
      p_external_reference: String(mpOrder.external_reference || "")
    });
    if (linked?.error) throw new Error("No se pudo vincular la orden de pago.");
  } catch {
    return response({ error: "El checkout se creó, pero no se pudo registrar de forma segura. Intenta de nuevo." }, 502);
  }
  return response({ checkoutUrl: checkoutUrl.href });
}

async function handleWebhook(request, env) {
  if (!required(env, ["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])) {
    return textResponse("Webhook no configurado.", 503);
  }
  const url = new URL(request.url);
  const dataId = url.searchParams.get("data.id") || "";
  if (!validOrderId(dataId)) return textResponse("ID de order inválido.", 400);
  const type = url.searchParams.get("type");
  if (type && type !== "order" && type !== "orders") return textResponse("Evento ignorado.", 200);
  const rawLength = Number(request.headers.get("Content-Length") || 0);
  if (rawLength > MAX_WEBHOOK_BYTES) return textResponse("Notificación demasiado grande.", 413);
  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BYTES) return textResponse("Notificación demasiado grande.", 413);
  let notice = {};
  try { notice = rawBody ? JSON.parse(rawBody) : {}; } catch { return textResponse("Notificación inválida.", 400); }
  const bodyId = String(notice?.data?.id || "");
  if (bodyId && bodyId.toLowerCase() !== dataId.toLowerCase()) return textResponse("ID no coincide.", 400);
  const signatureOk = await verifyWebhookSignature(
    request.headers.get("x-signature"),
    request.headers.get("x-request-id"),
    dataId,
    env.MERCADOPAGO_WEBHOOK_SECRET
  );
  if (!signatureOk) return textResponse("Firma inválida.", 401);

  let order;
  try {
    const result = await fetch(`${MP_API}/v1/orders/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}` }
    });
    if (!result.ok) return textResponse("No se pudo consultar la order.", 502);
    order = await result.json();
  } catch {
    return textResponse("No se pudo consultar la order.", 502);
  }
  const internalId = String(order?.external_reference || "");
  const payment = paymentFor(order);
  if (!validOrderId(internalId) || !payment || String(order.id || "").toLowerCase() !== dataId.toLowerCase()) {
    return textResponse("Notificación recibida; todavía no hay un pago acreditado para confirmar.", 200);
  }
  try {
    const confirmed = await supabaseRpc(env, "nexora_confirmar_pago_mercadopago", {
      p_pedido_id: internalId,
      p_order_id: String(order.id),
      p_payment_id: payment.paymentId,
      p_monto: payment.amount,
      p_moneda: String(order.currency || order.currency_id || ""),
      p_external_reference: internalId
    });
    if (confirmed?.error) return textResponse("No se pudo confirmar el pago en Supabase.", 500);
  } catch {
    return textResponse("No se pudo confirmar el pago en Supabase.", 500);
  }
  return textResponse("OK", 200);
}

export { deterministicUuid, paymentFor, verifyWebhookSignature };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/mercadopago/checkout") {
      if (request.method !== "POST") return response({ error: "Método no permitido." }, 405);
      return startCheckout(request, env);
    }
    if (url.pathname === "/api/mercadopago/webhook") {
      if (request.method !== "POST") return textResponse("Método no permitido.", 405);
      return handleWebhook(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
