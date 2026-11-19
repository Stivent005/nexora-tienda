const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const contracts = require("../js/contracts.js");

test("el constructor local representa un pedido mixto con pago común y cumplimientos separados", () => {
  const source = fs.readFileSync(path.join(__dirname, "../js/store.js"), "utf8");
  const start = source.indexOf("function sendOrder() {");
  const end = source.indexOf("function applyCoupon()", start);
  assert.ok(start >= 0 && end > start, "debe encontrar el constructor activo de pedidos");

  const physical = { id: "mouse_1", name: "Mouse", tipo: "fisico", price: 1200, stock: 2, sku: "M-1" };
  const digital = {
    id: "ff_500", name: "500 diamantes", tipo: "virtual", price: 650,
    digital: { game: "Free Fire", packageLabel: "500 diamantes", playerIdLabel: "ID del jugador", playerIdValidation: "digits_6_15" }
  };
  const lines = [{ p: physical, n: 1 }, { p: digital, n: 1 }];
  let created;
  const sendButton = { disabled: false, textContent: "" };
  const context = {
    Backend: { ready: true, crear(order) { created = order; return new Promise(() => {}); } },
    NexoraContracts: contracts,
    lines: () => lines,
    esV: (line) => line.p.tipo === "virtual",
    esDigitalFreeFire: () => false,
    disponibles: () => [{ id: "transfer-1", nombre: "Transferencia", tipo: "transfer" }],
    validarDatos: () => [],
    chk: {
      pay: "transfer-1", ref: "REFERENCIA", nombre: "Cliente", tel: "3000000000", idJuego: "",
      digital: { ff_500: { playerId: "123456789" } }, modo: "dom", addr: "Calle 1", city: "Cali",
      department: "Valle", zone: "Centro", reference: "Portería", punto: ""
    },
    compImg: "",
    coupon: null,
    T: (key) => key,
    $: () => ({ textContent: "", focus() {} }),
    document: { querySelector: () => sendButton },
    Date,
    uid: () => "order-local-test",
    ptsSoloNum: (value) => value,
    eff: (product) => product.price,
    subtotal: () => 1850,
    discount: () => 0,
    total: () => 1850
  };

  vm.runInNewContext(source.slice(start, end), context, { filename: "js/store.js#sendOrder" });
  context.sendOrder = vm.runInNewContext("sendOrder", context);
  context.sendOrder();

  assert.ok(created, "debe pasar un solo pedido al adaptador local de persistencia");
  assert.equal(created.estado, "Pendiente");
  assert.equal(created.total, 1850);
  assert.equal(created.pagoId, "transfer-1");
  assert.equal(created.items.length, 2);
  assert.deepEqual(created.items.map((line) => line.fulfillment.type), ["physical", "digital"]);
  assert.equal(created.items[1].digitalData.playerId, "123456789");
  assert.equal(created.items[0].digitalData.playerId, undefined);

  created.items[0].fulfillment.status = "shipped";
  assert.equal(created.items[1].fulfillment.status, "pending");
  created.items[1].fulfillment.status = "queued";
  assert.equal(created.items[0].fulfillment.status, "shipped");
  assert.equal(sendButton.disabled, true);
  assert.match(sendButton.textContent, /pago\.enviando/);
});
