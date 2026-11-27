const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const account = fs.readFileSync(path.join(__dirname, "../js/account.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "../js/main.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../css/final.css"), "utf8");

test("el formulario de cuenta conserva nombre y correo escapados, nunca la contraseña", () => {
  assert.match(account, /value="'\+esc\(accountNameDraft\)\+'"/);
  assert.match(account, /value="'\+esc\(accountEmailDraft\)\+'"/);
  assert.match(account, /accountNameDraft=name;accountEmailDraft=email/);
  assert.match(account, /id="account-password" type="password"[^>]*required/);
  assert.doesNotMatch(account, /accountPasswordDraft/);
  assert.match(main, /accountEmailDraft=\$\("account-email"\)\.value/);
});

test("el panel de acceso incluye estados de foco, botones táctiles y movimiento reducido", () => {
  assert.match(styles, /#dbox\.account-login-view input:focus/);
  assert.match(styles, /#dbox\.account-login-view \.foot \.btn\.primary:active/);
  assert.match(styles, /@media\(prefers-reduced-motion:\s*reduce\)[^{]*\{[^}]*#dbox\.account-login-view/s);
  assert.match(account, /classList\.toggle\("account-login-view",!!Backend\.accountsReady&&!user\)/);
});
