const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const storefront = fs.readFileSync(path.join(root, "index.html"), "utf8");
const admin = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "css/refresh.css"), "utf8");
const hud = fs.readFileSync(path.join(root, "js/hud.js"), "utf8");
const finalMotion = fs.readFileSync(path.join(root, "js/final.js"), "utf8");
const shop = fs.readFileSync(path.join(root, "js/shop.js"), "utf8");

test("tienda y administración cargan la capa visual renovada con versión nueva", () => {
  for (const html of [storefront, admin]) {
    assert.match(html, /css\/refresh\.css\?v=20261127-visual-refresh-3/);
    assert.match(html, /js\/hud\.js\?v=20261127-visual-refresh-1/);
    assert.match(html, /js\/final\.js\?v=20261127-visual-refresh-1/);
  }
});

test("la capa renueva tienda, diálogos y administración y limita movimiento cuando se solicita", () => {
  for (const selector of [".hero-x", ".fx-sec", ".card", "dialog", ".admin-sidebar", ".admin-order-card"]) {
    assert.ok(styles.includes(selector), `falta el estilo para ${selector}`);
  }
  assert.match(styles, /\.input-wrap input:focus/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /@keyframes section-arrive/);
});

test("el logo mantiene el texto y un catálogo pequeño no duplica sus productos", () => {
  assert.match(styles, /\.logo\{[^}]*-webkit-background-clip:text/);
  assert.ok(/if\s*\(ok\.length\s*<\s*4\)/.test(shop), "faltan secciones compactas para catálogos pequeños");
  assert.ok(/smallDigitales\.some\(esDigitalFreeFire\)/.test(shop), "se debe conservar la sección de recompensas Free Fire");
});

test("el panel admin no arranca el canvas y el cursor personalizado queda opcional", () => {
  assert.match(hud, /adminPage=document\.body\.classList\.contains\("admin-page"\)/);
  assert.match(hud, /if\(RM\|\|adminPage\)return/);
  assert.match(hud, /var count=\(mob\|\|lite\)\?18:40/);
  assert.match(finalMotion, /var on = false/);
  assert.match(finalMotion, /localStorage\.getItem\(KEY\) === "on"/);
});
