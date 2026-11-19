const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

test("un fallo del catálogo admin deja visible el error, permite reintentar y conserva sesión", async () => {
  const source = fs.readFileSync(path.join(root, "js/main.js"), "utf8");
  const start = source.indexOf("function describirErrorCatalogo(e)");
  const end = source.indexOf("function cargarCatalogoCliente()", start);
  assert.ok(start >= 0 && end > start, "debe encontrar el adaptador de error y la carga del catálogo admin");

  let renderCalls = 0;
  const context = {
    catalogoCargando: false,
    catalogoError: "",
    authed: true,
    cargarCatalogo: () => Promise.reject(Object.assign(new Error("offline"), { status: 503, code: "NETWORK_ERROR" })),
    renderAdmin() {},
    renderAll() { renderCalls += 1; }
  };
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.loadAdminCatalog=cargarCatalogoAdmin;", context);
  await context.loadAdminCatalog();

  assert.equal(context.catalogoCargando, false);
  assert.match(context.catalogoError, /HTTP 503/);
  assert.match(context.catalogoError, /offline/);
  assert.equal(context.authed, true);
  assert.equal(renderCalls, 1);
});

test("las vistas admin anuncian estados vacíos/error y exponen reintento para datos remotos", () => {
  const admin = fs.readFileSync(path.join(root, "js/admin.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8");

  assert.match(admin, /data-x="catalog-retry"/);
  assert.match(admin, /data-x="orders-retry"/);
  assert.match(admin, /<div class="empty" role="status" aria-live="polite">/);
  assert.match(admin, /No se puede confirmar que el catálogo esté vacío porque no se pudo cargar/);
  assert.match(main, /else if\(d\.x==="orders-retry"\)cargarPedidos\(\)/);
});

test("el documento admin ofrece salto de teclado al contenido y el destino acepta foco", () => {
  const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  assert.match(html, /<a class="skip" href="#adminroot">Saltar al contenido<\/a>/);
  assert.match(html, /<main class="wrap" id="adminroot" tabindex="-1">/);
});
