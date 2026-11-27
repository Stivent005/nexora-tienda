const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const shop = fs.readFileSync(path.join(root, "js/shop.js"), "utf8");
const backend = fs.readFileSync(path.join(root, "js/backend.js"), "utf8");
const core = fs.readFileSync(path.join(root, "js/core.js"), "utf8");

test("el catálogo remoto usa el ID de la fila y elimina repeticiones por identidad", () => {
  assert.match(backend, /productos\?select=id,datos,activo/);
  assert.match(backend, /d\.id=String\(x\.id\)/);
  assert.match(backend, /NexoraContracts\.uniqueProducts\(ps\)/);
});

test("las páginas renuevan la caché de los módulos del catálogo", () => {
  for (const page of ["index.html", "admin.html"]) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    for (const module of ["contracts", "core", "backend", "ui", "store", "shop"]) {
      assert.match(html, new RegExp(`js/${module}\\.js\\?v=20261127-catalog-2`));
    }
  }
});

test("la respuesta de la ruleta no vuelve a reconstruir toda la tienda", () => {
  const start = core.indexOf("function cargarCatalogo(){");
  const end = core.indexOf("function eff(", start);
  const loader = core.slice(start, end);
  assert.equal((loader.match(/renderAll\(\)/g) || []).length, 1);
});

test("cada producto se muestra una sola vez entre secciones editoriales y catálogo", () => {
  const start = shop.indexOf("function fxSections(act, cats) {");
  const end = shop.indexOf("\n(function() {", start);
  assert.ok(start >= 0 && end > start, "no se encontró el renderer editorial");

  const context = {
    FX_RENDERED_IDS: new Set(),
    FX_PROXIMOS: [],
    fxIn: {},
    cat: "",
    tipoF: "",
    favoritosSolo: false,
    $: () => null,
    esc: (value) => String(value),
    agotado: (product) => !product.ilimitado && Number(product.stock) <= 0,
    esDigitalFreeFire: () => false,
    fxCard: (product) => `<article data-product-id="${product.id}"></article>`
  };
  vm.runInNewContext(`${shop.slice(start, end)}\nglobalThis.renderSections = fxSections;`, context);

  const products = [
    { id: "physical-1", tipo: "fisico", active: true, stock: 3, createdAt: 10 },
    { id: "physical-2", tipo: "fisico", active: true, stock: 3, createdAt: 20 },
    { id: "physical-3", tipo: "fisico", active: true, stock: 3, createdAt: 30 },
    { id: "physical-4", tipo: "fisico", active: true, stock: 3, createdAt: 40 },
    { id: "physical-5", tipo: "fisico", active: true, stock: 3, offer: true, offerPrice: 8, createdAt: 50 },
    { id: "digital-1", tipo: "virtual", active: true, ilimitado: true, offer: true, offerPrice: 9, createdAt: 60 },
    { id: "digital-2", tipo: "virtual", active: true, ilimitado: true, createdAt: 70 }
  ];

  const editorial = context.renderSections(products, []);
  const grid = products.filter((product) => !context.FX_RENDERED_IDS.has(product.id));
  const rendered = editorial + grid.map((product) => `<article data-product-id="${product.id}"></article>`).join("");

  for (const product of products) {
    const cards = rendered.match(new RegExp(`data-product-id="${product.id}"`, "g")) || [];
    assert.equal(cards.length, 1, `${product.id} debe aparecer una sola vez`);
  }
});
