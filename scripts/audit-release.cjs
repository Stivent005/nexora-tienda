const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const approved = new Set([
  "index.html", "admin.html",
  "css/base.css", "css/store.css", "css/admin.css", "css/rgb.css", "css/motion.css", "css/hud.css", "css/shop.css", "css/perfil.css", "css/final.css",
  "js/textos.js", "js/contracts.js", "js/core.js", "js/backend.js", "js/cookies.js", "js/puntos.js", "js/ui.js", "js/recibo.js", "js/account.js", "js/store.js", "js/hud.js", "js/shop.js", "js/perfil.js", "js/main.js", "js/motion.js", "js/final.js", "js/admin.js",
  "js/config.js", "data/datos.js"
]);
const hardBlocked = /(^|\/)(?:respaldos|node_modules|\.git|\.aws|\.codex|\.agents)(?:\/|$)|(^|\/)\.env(?:\.|$)|(^|\/)busqueda_pedido\.txt$/i;
const localConfig = /^js\/config\.js$/i;
const reviewOnly = /^data\/datos\.js$/i;
const backupName = /(?:\.bak|\.backup|_backup_|_antes_|\.old|\.tmp)/i;
const included = new Set();
const problems = [];

function relativePath(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function localReference(reference, parent) {
  const value = decodeURIComponent(String(reference).split(/[?#]/, 1)[0]).trim();
  if (!value || /^(?:[a-z]+:|\/\/|#)/i.test(value) || value.startsWith("data:")) return null;
  const absolute = path.resolve(path.dirname(parent), value);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return { unsafe: value };
  return { absolute, relative: relativePath(absolute) };
}

function inspectReference(reference, parent) {
  const local = localReference(reference, parent);
  if (!local) return;
  if (local.unsafe) {
    problems.push(`Referencia fuera de la raíz permitida: ${path.basename(parent)}.`);
    return;
  }

  const relative = local.relative;
  if (hardBlocked.test(relative) || localConfig.test(relative)) {
    problems.push(`BLOQUEADO: ${relative}`);
    return;
  }
  if (!approved.has(relative)) {
    problems.push(`NO ESTÁ EN ALLOWLIST: ${relative}`);
    return;
  }
  if (reviewOnly.test(relative)) {
    problems.push(`REQUIERE REVISIÓN MANUAL; no se abre: ${relative}`);
    return;
  }
  if (!fs.existsSync(local.absolute) || !fs.statSync(local.absolute).isFile()) {
    problems.push(`FALTA: ${relative}`);
    return;
  }
  if (included.has(relative)) return;
  included.add(relative);

  if (/\.css$/i.test(relative)) {
    const css = fs.readFileSync(local.absolute, "utf8");
    for (const match of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      inspectReference(match[1] || match[2], local.absolute);
    }
  }
}

for (const entry of ["index.html", "admin.html"]) {
  const absolute = path.join(root, entry);
  if (!fs.existsSync(absolute)) {
    problems.push(`FALTA: ${entry}`);
    continue;
  }
  if (!approved.has(entry)) problems.push(`NO ESTÁ EN ALLOWLIST: ${entry}`);
  included.add(entry);
  const html = fs.readFileSync(absolute, "utf8");
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
    inspectReference(match[1], absolute);
  }
}

function scanNames(directory, prefix = "") {
  if (!fs.existsSync(directory)) return;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (hardBlocked.test(relative) || localConfig.test(relative)) {
      problems.push(`EXCLUIR DEL ARTEFACTO: ${relative}`);
      continue;
    }
    if (backupName.test(item.name)) {
      problems.push(`EXCLUIR RESPALDO/TEMPORAL: ${relative}`);
      continue;
    }
    if (item.isDirectory()) scanNames(path.join(directory, item.name), relative);
  }
}

for (const directory of ["css", "js", "data", "respaldos"]) {
  if (directory === "respaldos") {
    if (fs.existsSync(path.join(root, directory))) problems.push("EXCLUIR DEL ARTEFACTO: respaldos/ (contenido no inspeccionado)");
    continue;
  }
  scanNames(path.join(root, directory), directory);
}

for (const file of [...included].sort()) console.log(`CANDIDATO REFERENCIADO: ${file}`);
for (const problem of [...new Set(problems)].sort()) console.log(problem);

if (problems.length) {
  console.error(`Preflight bloqueado: ${new Set(problems).size} hallazgos. No se creó ni publicó ningún artefacto.`);
  process.exitCode = 1;
} else {
  console.log("Referencias de publicación aprobadas por allowlist. Este comando no publica archivos.");
}
