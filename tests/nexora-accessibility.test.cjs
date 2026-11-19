const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function luminance(hex) {
  const channels = [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("los iconos de validación conservan contraste suficiente en las reglas CSS activas", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/store.css"), "utf8");
  for (const selector of ["valid", "invalid"]) {
    const block = css.match(new RegExp(`\\.field-icon\\.${selector}\\s*\\{([^}]+)\\}`));
    assert.ok(block, `debe existir el estilo ${selector}`);
    const foreground = block[1].match(/color:\s*#([\da-f]{6})/i)?.[1];
    const background = block[1].match(/background:\s*#([\da-f]{6})/i)?.[1];
    assert.ok(foreground && background, `los colores de ${selector} deben ser explícitos para esta prueba`);
    assert.ok(contrast(foreground, background) >= 4.5, `${selector} debe superar 4.5:1 para el glifo de estado`);
  }
});

test("checkout etiqueta referencia y cupón y anuncia selección de entrega y pago", () => {
  const store = fs.readFileSync(path.join(__dirname, "../js/store.js"), "utf8");
  assert.match(store, /for="c-ref"/);
  assert.match(store, /id="c-ref"/);
  assert.match(store, /for="c-cup"/);
  assert.match(store, /id="c-cup"/);
  assert.match(store, /role="group" aria-label="' \+ esc\(T\("datos\.comoRecibir"\)\) \+ '"/);
  assert.match(store, /aria-pressed="' \+ \(chk\.modo === "dom"\)/);
  assert.match(store, /aria-pressed="' \+ \(x\.id === chk\.pay\)/);
});

test("formularios dinámicos del panel dan nombre a archivos, cantidades y controles de puntos", () => {
  const admin = fs.readFileSync(path.join(__dirname, "../js/admin.js"), "utf8");
  assert.match(admin, /for="f-file">Foto del producto/);
  assert.match(admin, /for="bk">Datos de respaldo de productos y ajustes/);
  assert.match(admin, /aria-label="Cantidad de '\+esc\(p\.name\)/);
  assert.match(admin, /aria-label="Probabilidad del premio en porcentaje"/);
  assert.match(admin, /aria-label="Costo del premio en puntos"/);
});
