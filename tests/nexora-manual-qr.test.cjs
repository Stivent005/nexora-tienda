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
