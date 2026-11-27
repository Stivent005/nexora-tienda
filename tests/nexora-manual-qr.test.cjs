const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

test("checkout manual muestra el QR arriba del número y conserva la revisión pendiente", () => {
  const store = fs.readFileSync(path.join(root, "js", "store.js"), "utf8");
  const start = store.indexOf("function detallePago(m) {");
  const end = store.indexOf("\nfunction avisoWhatsApp()", start);
  assert.ok(start >= 0 && end > start);

  const context = {
    safeImg: (value) => value,
    safeUrl: () => "",
    T: (key, values) => values ? `${key} ${values.titular}` : key,
    fmt: { format: (value) => `COP ${value}` },
    total: () => 24800,
    esc: (value) => String(value),
    chk: { ref: "" },
    compImg: ""
  };
  vm.runInNewContext(store.slice(start, end), context);
  const html = context.detallePago({
    tipo: "transfer",
    nombre: "Billetera de prueba",
    qr: "data:image/png;base64,QR_DE_PRUEBA",
    cuenta: "000 000 0000",
    instr: "Instrucción de prueba"
  });

  assert.ok(html.indexOf('class="payment-qr-card"') < html.indexOf('class="payment-destination"'));
  assert.match(html, /class="acct-number">000 000 0000<\/b>/);
  assert.match(html, /data-copy="000 000 0000"/);
  assert.match(html, /payment-evidence-note/);
});

test("la tienda oculta Mercado Pago automático y conserva transferencias manuales activas", () => {
  const core = fs.readFileSync(path.join(root, "js", "core.js"), "utf8");
  const start = core.indexOf("function metodos(){");
  const end = core.indexOf("var cart=lsGet", start);
  assert.ok(start >= 0 && end > start);

  const context = {
    cfg: {
      metodos: [
        { id: "nequi", tipo: "transfer", activo: true },
        { id: "mercadopago", tipo: "link", gateway: "mercadopago", activo: true }
      ]
    }
  };
  vm.runInNewContext(core.slice(start, end), context);

  assert.deepEqual(Array.from(context.pagos(), (method) => method.id), ["nequi"]);
});

test("la reparación SQL restaura inventario y guards desde la migración 05 sin abrir la tabla", () => {
  const security = fs.readFileSync(path.join(root, "scripts", "supabase", "05_seguridad_compras_pagos.sql"), "utf8");
  const repair = fs.readFileSync(path.join(root, "scripts", "supabase", "19b_reparar_estado_pedido.sql"), "utf8");
  const functionSql = (source, name) => {
    const start = source.indexOf(`create or replace function public.${name}(`);
    const end = source.indexOf("end $$;", start) + "end $$;".length;
    assert.ok(start >= 0 && end > start, `falta ${name}`);
    return source.slice(start, end);
  };

  assert.match(repair, /create table if not exists public\.inventario_movimientos/);
  assert.match(repair, /alter table public\.inventario_movimientos enable row level security/);
  assert.match(repair, /revoke all on public\.inventario_movimientos from anon,authenticated/);
  assert.equal(functionSql(repair, "nexora_aplicar_inventario"), functionSql(security, "nexora_aplicar_inventario"));
  assert.equal(functionSql(repair, "nexora_guardar_estado_pedido"), functionSql(security, "nexora_guardar_estado_pedido"));
});
