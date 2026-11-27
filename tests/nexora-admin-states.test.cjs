const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

test("Clientes agrupa los pedidos, permite buscar y distingue un fallo de carga", () => {
  const panel = { innerHTML: "" };
  const search = {
    addEventListener(event, handler) { this[event] = handler; },
    focus() {}
  };
  const context = vm.createContext({
    $(id) { return { panel, "admin-customer-search": search }[id] || null; },
    Backend: { remote: true },
    atab: "customers",
    authed: true,
    ordersErr: "",
    orders: [
      { id: "1", nombre: "María de prueba", tel: "555001", fecha: 1, estado: "Pagado", total: 1000 },
      { id: "2", nombre: "María de prueba", tel: "555001", fecha: 2, estado: "Pendiente", total: 2000 }
    ],
    esc: String,
    fmt: { format: (value) => `COP ${value}` },
    estadoDe: (order) => order.estado
  });
  vm.runInContext(fs.readFileSync(path.join(root, "js/admin.js"), "utf8"), context);

  context.renderAdmin();
  assert.equal((panel.innerHTML.match(/class="admin-customer-row"/g) || []).length, 1);
  assert.match(panel.innerHTML, /María de prueba/);
  assert.match(panel.innerHTML, /2 pedido\(s\)/);
  assert.match(panel.innerHTML, /1 pendiente\(s\)/);
  assert.match(panel.innerHTML, /COP 1000/);

  search.value = "otro cliente";
  search.input();
  assert.match(panel.innerHTML, /Sin resultados/);

  context.orders = [];
  context.ordersErr = "No se pudieron cargar los pedidos";
  context.renderAdmin();
  assert.match(panel.innerHTML, /data-x="orders-retry">Reintentar/);
});

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

test("el menú abre Pedidos, Pagos y Cupones con sus propios controles", async () => {
  const panel = { innerHTML: "" };
  const listeners = {};
  const control = { addEventListener() {} };
  const order = {
    id: "pedido-prueba", nombre: "Cliente de prueba", fecha: 1700000000000,
    estado: "Pendiente", items: [{ n: "Artículo de prueba", q: 1, pr: 1000 }], total: 1000,
    pagoRegistro: { id: "pago-prueba", estado: "pendiente", monto: 1000 }
  };
  const context = vm.createContext({
    document: {
      addEventListener(event, handler) { listeners[event] = handler; },
      querySelectorAll() { return []; }
    },
    $(id) {
      if (id === "panel") return panel;
      return id === "dbox" || panel.innerHTML.includes(`id="${id}"`) ? control : null;
    },
    Backend: { remote: true, restore: () => true, listar: async () => [order] },
    ADMIN_PAGE: true,
    atab: "", authed: false, orders: [], ordersErr: "", pedidoFiltro: "Pendiente",
    cfg: { cupones: [{ codigo: "BIENVENIDO10", tipo: "pct", valor: 10, activo: true }] },
    items: [], catalogoCargando: false, catalogoError: "", pdel: null,
    async cargarCatalogo() { context.catalogoCargando = false; },
    renderAll() { context.renderAdmin(); },
    setInterval() {},
    esc: String, fmt: new Intl.NumberFormat("es-CO"), estadoDe: (row) => row.estado,
    safeImg: () => "", ico: () => "",
    metodos: () => [{ nombre: "Pago contra entrega", tipo: "efectivo", activo: true }]
  });
  for (const script of ["recibo.js", "admin.js", "main.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "js", script), "utf8"), context);
  }
  await new Promise(setImmediate);
  assert.match(panel.innerHTML, /data-tab="orders">Ver pedidos<\/button>/);

  listeners.click({ target: { closest: () => ({ dataset: { tab: "orders" } }) } });

  assert.match(panel.innerHTML, /<h1>Pedidos<\/h1>/);
  assert.match(panel.innerHTML, /Artículo de prueba/);
  assert.doesNotMatch(panel.innerHTML, /id="madd"/);

  listeners.click({ target: { closest: () => ({ dataset: { tab: "pay" } }) } });

  assert.match(panel.innerHTML, /<h1>Pagos<\/h1>/);
  assert.match(panel.innerHTML, /Artículo de prueba/);
  assert.match(panel.innerHTML, /id="madd"/);
  assert.match(panel.innerHTML, /Métodos de pago/);
  assert.match(panel.innerHTML, /Pago contra entrega/);

  listeners.click({ target: { closest: () => ({ dataset: { tab: "coupons" } }) } });

  assert.match(panel.innerHTML, /<h1>Cupones<\/h1>/);
  assert.match(panel.innerHTML, /id="kadd">Crear cupón<\/button>/);
  assert.match(panel.innerHTML, /<b>BIENVENIDO10<\/b>/);
});

test("registrar el pago abre Pagos pendientes y verificarlo abre Por entregar", async () => {
  let paymentVerified = false;
  const order = {
    id: "pedido-pago-prueba", estado: "Pendiente", total: 12000,
    pago: "Transferencia", referencia: "REF-PRUEBA"
  };
  const context = {
    Backend: {
      registrarAbono: async () => ({ ok: true }),
      verificarAbono: async () => { paymentVerified = true; return { pagado: true, saldo: 0 }; }
    },
    window: { confirm: () => true },
    orders: [order], ordersErr: "", ordersNotice: "", atab: "orders",
    adminPaymentFilter: "", pedidoFiltro: "Pendiente", ordersLoading: false,
    fmt: { format: (value) => `COP ${value}` },
    estadoDe: (row) => row.estado,
    renderAdmin() { this.renderCount = (this.renderCount || 0) + 1; }
  };
  context.cargarPedidos = async () => {
    if (paymentVerified) {
      order.estado = "Pagado";
      order.pagoRegistro.estado = "verificado";
    } else {
      order.pagoRegistro = { id: "abono-prueba", pedido_id: order.id, estado: "pendiente", monto: order.total };
    }
    context.renderAdmin();
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(root, "js/admin.js"), "utf8");
  const registerStart = source.indexOf("function registrarAbonoPedido");
  const verifyStart = source.indexOf("function revisarPagoCompleto", registerStart);
  const refundStart = source.indexOf("function registrarReintegro", verifyStart);
  assert.ok(registerStart >= 0 && verifyStart > registerStart && refundStart > verifyStart);
  vm.runInContext(source.slice(registerStart, verifyStart) + source.slice(verifyStart, refundStart), context);

  await context.registrarAbonoPedido(order.id, { disabled: false });
  assert.equal(context.atab, "pay");
  assert.equal(context.adminPaymentFilter, "pendiente");
  assert.match(context.ordersNotice, /Pagos → Pendientes/);

  await context.revisarPagoCompleto("abono-prueba");
  assert.equal(order.estado, "Pagado");
  assert.equal(context.atab, "orders");
  assert.equal(context.pedidoFiltro, "Pagado");
  assert.match(context.ordersNotice, /Pedidos → Por entregar/);
});

test("el documento admin ofrece salto de teclado al contenido y el destino acepta foco", () => {
  const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  assert.match(html, /<a class="skip" href="#adminroot">Saltar al contenido<\/a>/);
  assert.match(html, /<main class="wrap" id="adminroot" tabindex="-1">/);
});
