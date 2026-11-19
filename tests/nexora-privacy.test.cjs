const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pointsSource = fs.readFileSync(path.join(__dirname, "../js/puntos.js"), "utf8");

test("el texto de cuenta nunca promete acceso privado usando solo el ID de juego", () => {
  assert.doesNotMatch(pointsSource, /entra solo con tu <b>ID de Free Fire/i);
  assert.match(pointsSource, /se requerirá una sesión verificada del titular/);
  assert.match(pointsSource, /el ID de Free Fire solo identifica la cuenta del juego/);
});

test("la tienda informa del cierre de puntos sin pedir el ID ni mostrar saldo/historial", () => {
  const start = pointsSource.indexOf("function abrirPuntos() {");
  const end = pointsSource.indexOf("/* ==========================================\n   CONSULTAR CUENTA", start);
  assert.ok(start >= 0 && end > start);
  const box = { innerHTML: "" };
  let opened = false;
  const context = {
    PUNTOS_PRIVADOS_AUTENTICADOS: false,
    ruletaOn: () => true,
    $: (id) => id === "dbox" ? box : { showModal() { opened = true; } }
  };
  vm.runInNewContext(pointsSource.slice(start, end) + "\nglobalThis.openPoints=abrirPuntos;", context);
  context.openPoints();

  assert.equal(opened, true);
  assert.match(box.innerHTML, /role="status"/);
  assert.match(box.innerHTML, /no demuestra que quien consulta sea su titular/);
  assert.doesNotMatch(box.innerHTML, /id="pt-ff"|consultar_puntos|movimientos|saldo:/i);
});

test("las rutas de consulta y recarga no llaman el RPC con autenticación privada desactivada", async () => {
  let rpcCalls = 0;
  const context = {
    PUNTOS_PRIVADOS_AUTENTICADOS: false,
    rueda: { cuenta: { ff: "123456789" } },
    Backend: { rpc() { rpcCalls += 1; return Promise.resolve({}); } },
    $: () => ({ textContent: "" })
  };
  const verStart = pointsSource.indexOf("function verPuntos(ff, msg)");
  const refreshStart = pointsSource.indexOf("function recargarCuenta(msg)");
  const refreshEnd = pointsSource.indexOf("/* ==========================================\n   FORMULARIOS DE ACCESO", refreshStart);
  assert.ok(verStart >= 0 && refreshStart > verStart && refreshEnd > refreshStart);

  const verEnd = pointsSource.indexOf("/* Vuelve a leer la cuenta", verStart);
  vm.runInNewContext(pointsSource.slice(verStart, verEnd) + pointsSource.slice(refreshStart, refreshEnd) + "\nglobalThis.readPoints=verPuntos; globalThis.refreshPoints=recargarCuenta;", context);
  assert.equal(await context.readPoints("123456789"), false);
  assert.equal(await context.refreshPoints(), false);
  assert.equal(rpcCalls, 0);
});
