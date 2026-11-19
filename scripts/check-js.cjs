const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const htmlFiles = ["index.html", "admin.html"];
const sources = new Set();

for (const htmlFile of htmlFiles) {
  const absoluteHtml = path.join(root, htmlFile);
  if (!fs.existsSync(absoluteHtml)) {
    console.error(`Falta la página requerida: ${htmlFile}`);
    process.exitCode = 1;
    continue;
  }

  const html = fs.readFileSync(absoluteHtml, "utf8");
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const reference = match[1].split(/[?#]/, 1)[0];
    if (!reference.startsWith("js/")) continue;
    const absoluteSource = path.resolve(root, reference);
    if (!absoluteSource.startsWith(root + path.sep) || !fs.existsSync(absoluteSource)) {
      console.error(`${htmlFile} referencia un script local faltante o fuera del proyecto.`);
      process.exitCode = 1;
      continue;
    }
    sources.add(absoluteSource);
  }
}

for (const folder of ["scripts", "tests"]) {
  const absoluteFolder = path.join(root, folder);
  if (!fs.existsSync(absoluteFolder)) continue;
  for (const entry of fs.readdirSync(absoluteFolder, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:cjs|mjs|js)$/.test(entry.name)) {
      sources.add(path.join(absoluteFolder, entry.name));
    }
  }
}

let checked = 0;
for (const source of [...sources].sort()) {
  const result = spawnSync(process.execPath, ["--check", source], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  checked += 1;
  if (result.error || result.status !== 0) {
    const detail = result.stderr || result.error?.message || "error de sintaxis";
    const summary = detail.match(/SyntaxError:[^\r\n]*/)?.[0] || "error de sintaxis";
    console.error(`Sintaxis inválida en ${path.relative(root, source)}: ${summary}`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log(`Sintaxis correcta: ${checked} scripts referenciados y archivos de prueba.`);
