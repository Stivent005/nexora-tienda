const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.resolve(root, "dist");
if (output !== path.join(root, "dist")) throw new Error("Ruta de salida inesperada.");

const assets = new Set(["index.html", "admin.html"]);
const blocked = /(^|\/)(?:\.git|\.wrangler|node_modules|respaldos|supabase|tests)(?:\/|$)|(?:\.backup|\.bak|\.old|\.tmp)$/i;

function localPath(reference, parent) {
  const value = String(reference || "").split(/[?#]/, 1)[0].trim();
  if (!value || /^(?:[a-z]+:|\/\/|#|data:)/i.test(value)) return null;
  const absolute = path.resolve(path.dirname(parent), decodeURIComponent(value));
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error("Una referencia sale de la carpeta del proyecto.");
  }
  return path.relative(root, absolute).split(path.sep).join("/");
}

function addAsset(relative) {
  if (!relative || assets.has(relative)) return;
  if (blocked.test(relative) || relative === "js/config.example.js") {
    throw new Error("El paquete intenta incluir un archivo excluido.");
  }
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error("Falta un recurso referenciado por la tienda.");
  }
  assets.add(relative);
  const source = fs.readFileSync(absolute, "utf8");
  if (/\.css$/i.test(relative)) {
    for (const match of source.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const dependency = localPath(match[1] || match[2], absolute);
      if (dependency) addAsset(dependency);
    }
  }
}

for (const htmlFile of ["index.html", "admin.html"]) {
  const source = fs.readFileSync(path.join(root, htmlFile), "utf8");
  for (const match of source.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
    const reference = localPath(match[1], path.join(root, htmlFile));
    if (reference) addAsset(reference);
  }
}

// Recurso compartido por los paquetes digitales iniciales del catálogo Supabase.
addAsset("images/diamantes-free-fire.png");

const config = fs.readFileSync(path.join(root, "js/config.js"), "utf8");
if (/service_role|secret_key/i.test(config) || !/anonKey\s*:\s*["'](?:sb_publishable_|eyJ)/.test(config)) {
  throw new Error("La configuración Supabase no pasó la comprobación de clave pública.");
}

if (fs.existsSync(output)) {
  if (!fs.statSync(output).isDirectory()) throw new Error("dist existe y no es una carpeta.");
  fs.rmSync(output, { recursive: true, force: true });
}
fs.mkdirSync(output, { recursive: true });
for (const relative of [...assets].sort()) {
  const destination = path.join(output, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, relative), destination);
}
const headers = path.join(root, "_headers");
if (fs.existsSync(headers)) fs.copyFileSync(headers, path.join(output, "_headers"));

console.log(`Paquete Cloudflare preparado: ${assets.size + (fs.existsSync(headers) ? 1 : 0)} recursos.`);
console.log("Se excluyeron respaldos, SQL, pruebas y archivos internos.");
