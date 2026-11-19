const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("la vista previa del descuento limita porcentajes y descuentos fijos al subtotal", () => {
  const source = fs.readFileSync(path.join(__dirname, "../js/store.js"), "utf8");
  const start = source.indexOf("function discount() {");
  const end = source.indexOf("function subtotal()", start);
  assert.ok(start >= 0 && end > start);
  const context = { coupon: null, subtotal: () => 10000, Number, Math };
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.previewDiscount=discount; globalThis.previewTotal=total;", context);

  assert.equal(context.previewDiscount(), 0);
  assert.equal(context.previewTotal(), 10000);

  context.coupon = { tipo: "pct", valor: 12.5 };
  assert.equal(context.previewDiscount(), 1250);
  assert.equal(context.previewTotal(), 8750);

  context.coupon = { tipo: "fijo", valor: 12500 };
  assert.equal(context.previewDiscount(), 10000);
  assert.equal(context.previewTotal(), 0);
});

test("un cupón local inválido no crea un descuento negativo o desconocido", () => {
  const source = fs.readFileSync(path.join(__dirname, "../js/store.js"), "utf8");
  const start = source.indexOf("function discount() {");
  const end = source.indexOf("function subtotal()", start);
  const context = { coupon: null, subtotal: () => 10000, Number, Math };
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.previewDiscount=discount;", context);

  for (const coupon of [
    { tipo: "pct", valor: 150 },
    { tipo: "fijo", valor: -5 },
    { tipo: "otro", valor: 500 }
  ]) {
    context.coupon = coupon;
    assert.equal(context.previewDiscount(), 0);
  }
  context.coupon = { tipo: "fijo", valor: "no-es-numero" };
  assert.equal(context.previewDiscount(), 0);
});
