const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const contracts = require("../js/contracts.js");

test("el adaptador conserva productos antiguos y agrega el contrato versionado", () => {
  const legacy = contracts.normalizeProduct({
    id: "legacy-1", name: "Control", description: "Consola", price: 120000,
    stock: 3, tipo: "fisico", category: "Accesorios", offer: true,
    offerPrice: 110000, createdAt: 123
  });
  assert.equal(legacy.schemaVersion, 2);
  assert.equal(legacy.id, "legacy-1");
  assert.equal(legacy.price, 120000);
  assert.equal(legacy.offerPrice, 110000);
  assert.equal(legacy.stock, 3);
  assert.deepEqual(legacy.specifications, []);
  assert.deepEqual(legacy.variants, []);
});

test("version 2 normaliza SKU, especificaciones y variantes sin colisiones ocultas", () => {
  const product = contracts.normalizeProduct({
    id: "p1", name: "Teclado", tipo: "fisico", brand: "Nex", sku: "KB-1",
    unit: "unidad", specifications: [{ name: "Layout", value: "ES" }],
    variants: [
      { id: "red", sku: "KB-R", name: "Rojo", price: 50, stock: 2 },
      { id: "blue", sku: "KB-R", name: "Azul", price: 55, stock: 0 }
    ]
  });
  assert.equal(product.brand, "Nex");
  assert.equal(product.sku, "KB-1");
  assert.deepEqual(product.specifications, [{ name: "Layout", value: "ES" }]);
  assert.deepEqual(product.variants.map((variant) => variant.id), ["red", "blue"]);
  assert.match(contracts.variantIdentityErrors(product.variants).join(" "), /SKU de variante duplicado/);
});

test("configuración digital valida ID y servidor por producto y descarta campos no permitidos", () => {
  const fields = contracts.normalizeDigitalFields([
    { key: "playerId", label: "ID jugador", required: true, validation: "digits_6_15" },
    { key: "displayName", label: "Nombre", required: true },
    { key: "server", label: "Servidor", required: true },
    { key: "password", label: "Contraseña", required: true }
  ]);
  assert.deepEqual(fields.map((field) => field.key), ["playerId", "displayName", "server"]);
  assert.deepEqual(contracts.validateDigitalValues(fields, {
    playerId: "12x", displayName: "Jugador", server: "SA"
  }), ["ID jugador"]);
  assert.deepEqual(contracts.validateDigitalValues(fields, {
    playerId: "123456789", displayName: "Jugador", server: "SA"
  }), []);
  assert.deepEqual(contracts.sanitizeDigitalValues(fields, {
    playerId: "123456789", displayName: "Jugador", server: "SA", password: "secret"
  }), { playerId: "123456789", displayName: "Jugador", server: "SA" });
});

test("dirección de domicilio y retiro se validan con requisitos distintos", () => {
  assert.deepEqual(contracts.validateAddress({ method: "home", street: "Calle 1" }), ["ciudad", "departamento"]);
  assert.deepEqual(contracts.validateAddress({ method: "home", street: "Calle 1", city: "Cali", department: "Valle" }), []);
  assert.deepEqual(contracts.validateAddress({ method: "pickup", pickupPoint: "Centro" }), []);
  assert.deepEqual(contracts.validateAddress({ method: "pickup" }), ["punto de recogida"]);
});

test("las líneas física y digital guardan estados de cumplimiento independientes", () => {
  const physical = contracts.normalizeOrderLine({ id: "p1", n: "Mouse", q: 1, pr: 20, v: false, fulfillment: { status: "shipped", carrier: "Transportadora", trackingNumber: "G-1" } }, 0);
  const digital = contracts.normalizeOrderLine({ id: "p2", n: "Recarga", q: 1, pr: 10, v: true, digitalFields: [{ key: "playerId" }], digitalData: { playerId: "123456", password: "discard" }, fulfillment: { status: "queued" } }, 1);
  assert.equal(physical.fulfillment.status, "shipped");
  assert.equal(digital.fulfillment.status, "queued");
  assert.equal(physical.fulfillment.type, "physical");
  assert.equal(digital.fulfillment.type, "digital");
  assert.deepEqual(digital.digitalData, { playerId: "123456" });
});

test("checkout mantiene el aviso de evidencia manual y el renderer digital no crea campos de contraseña", () => {
  const texts = fs.readFileSync(path.join(__dirname, "../js/textos.js"), "utf8");
  const store = fs.readFileSync(path.join(__dirname, "../js/store.js"), "utf8");
  const start = store.indexOf("function digitalFieldsHtml");
  const end = store.indexOf("function discount", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(store.slice(start, end), /type\s*=\s*["']password/i);
  assert.match(texts, /evidenciaAviso/);
  assert.match(texts, /No confirma el pago/);
});

test("el componente digital renderiza campos permitidos por producto con labels", () => {
  const store = fs.readFileSync(path.join(__dirname, "../js/store.js"), "utf8");
  const start = store.indexOf("function digitalFieldsHtml(L)");
  const end = store.indexOf("function discount()", start);
  const context = {
    NexoraContracts: contracts,
    chk: { digital: {} },
    esV: (line) => line.p.tipo === "virtual",
    esc: (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
  };
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(store.slice(start, end) + "\nglobalThis.renderDigitalFields=digitalFieldsHtml;", context);
  const html = context.renderDigitalFields([{ p: {
    id: "ff-topup", name: "Paquete digital", tipo: "virtual",
    digital: { game: "Free Fire", packageLabel: "500 diamantes", fields: [
      { key: "playerId", label: "ID jugador", required: true, validation: "digits_6_15" },
      { key: "server", label: "Servidor", required: true }
    ] }
  } }]);
  assert.match(html, /for="digital-ff-topup-playerId"/);
  assert.match(html, /data-digital-field="server"/);
  assert.match(html, /No escribas contraseñas/);
  assert.doesNotMatch(html, /type="password"|name="password"/i);
});

test("reglas de exclusión incluyen respaldos y configuración local", () => {
  const ignore = fs.readFileSync(path.join(__dirname, "../.gitignore"), "utf8");
  assert.match(ignore, /\/respaldos\//);
  assert.match(ignore, /\/js\/config\.js/);
  assert.match(ignore, /busqueda_pedido\.txt/);
});

test("favoritos guardan solo IDs de producto válidos y alternan de forma acotada", () => {
  assert.deepEqual(contracts.normalizeFavoriteIds(["p1", "p1", "x/../private", 5, "p2"]), ["p1", "p2"]);
  assert.deepEqual(contracts.toggleFavoriteId(["p1"], "p2"), { ids: ["p1", "p2"], active: true, changed: true });
  assert.deepEqual(contracts.toggleFavoriteId(["p1", "p2"], "p1"), { ids: ["p2"], active: false, changed: true });
  const capped = contracts.toggleFavoriteId(Array.from({ length: 1000 }, (_, index) => "p" + index), "last");
  assert.equal(capped.changed, false);
  assert.equal(capped.limit, true);
});

test("el control de favoritos tiene nombre accesible, estado y no aparece en el panel", () => {
  const core = fs.readFileSync(path.join(__dirname, "../js/core.js"), "utf8");
  const start = core.indexOf("function botonFavorito(p)");
  const end = core.indexOf("function persist()", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    ADMIN_PAGE: false,
    favoritos: new Set(),
    esc: (value) => String(value).replace(/&/g, "&amp;").replace(/\"/g, "&quot;").replace(/</g, "&lt;"),
    T: (key, values) => key === "favorito.agregar" ? `Guardar ${values.nombre} en favoritos` : `Quitar ${values.nombre} de favoritos`
  };
  vm.runInNewContext(core.slice(start, end) + "globalThis.renderFavorite=botonFavorito;", context);
  assert.match(context.renderFavorite({ id: "sku_1", name: "Mando" }), /aria-pressed="false" aria-label="Guardar Mando en favoritos"/);
  context.favoritos = new Set(["sku_1"]);
  assert.match(context.renderFavorite({ id: "sku_1", name: "Mando" }), /aria-pressed="true" aria-label="Quitar Mando de favoritos"/);
  context.ADMIN_PAGE = true;
  assert.equal(context.renderFavorite({ id: "sku_1", name: "Mando" }), "");
});

test("el preflight de publicación bloquea la configuración local y los datos sin revisar", () => {
  const audit = spawnSync(process.execPath, [path.join(__dirname, "../scripts/audit-release.cjs")], {
    cwd: path.join(__dirname, ".."), encoding: "utf8", windowsHide: true
  });
  assert.equal(audit.status, 1);
  assert.match(audit.stdout, /BLOQUEADO: js\/config\.js/);
  assert.match(audit.stdout, /REQUIERE REVISIÓN MANUAL; no se abre: data\/datos\.js/);
  assert.match(audit.stdout, /respaldos\/ \(contenido no inspeccionado\)/);
  assert.match(audit.stdout, /EXCLUIR RESPALDO\/TEMPORAL: css\/final\.css\.backup_/);
  assert.match(audit.stderr, /No se creó ni publicó ningún artefacto/);
});
