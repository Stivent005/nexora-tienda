const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pointsSource = fs.readFileSync(path.join(__dirname, "../js/puntos.js"), "utf8");

test("Mis puntos exige cuenta Auth y no consulta por ID de Free Fire", () => {
  const start = pointsSource.indexOf("function abrirPuntos() {");
  const end = pointsSource.indexOf("function fechaMovimientoPuntos", start);
  assert.ok(start >= 0 && end > start);
  const box = { innerHTML: "" };
  let opened = false;
  const context = {
    Backend: { accountsReady: true, customer: () => null },
    $: (id) => id === "dbox" ? box : { showModal() { opened = true; }, addEventListener() {} }
  };
  vm.runInNewContext(pointsSource.slice(start, end) + "\nglobalThis.openPoints=abrirPuntos;", context);
  context.openPoints();

  assert.equal(opened, true);
  assert.match(box.innerHTML, /cuenta autenticada de Nexora/);
  assert.match(box.innerHTML, /ID de Free Fire no sirve/);
  assert.doesNotMatch(box.innerHTML, /consultar_puntos|p_ff/);
});

test("la interfaz de puntos carga y canjea mediante RPC de cuenta", () => {
  assert.match(pointsSource, /Backend\.misPuntosCliente\(\)/);
  assert.match(pointsSource, /Backend\.canjearPuntosCliente\(id,clave\)/);
  assert.doesNotMatch(pointsSource.slice(pointsSource.indexOf("function abrirPuntos()"), pointsSource.indexOf("function ptsAplicar")), /consultar_puntos|pt-ff/);
});

test("las rutas antiguas por ID siguen cerradas en el cliente", async () => {
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
