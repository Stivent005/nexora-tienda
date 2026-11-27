/* Cuenta cliente: registro seguro con Supabase, compras propias y comprobantes. */
var accountView="login",accountMessage="",accountBusy=false,accountOrders=[],accountOrdersLoaded=false,accountReturnToCheckout=false,lastPurchasedOrder=null,accountNameDraft="",accountEmailDraft="";

function abrirCuenta(retomarCheckout){
  accountReturnToCheckout=!!retomarCheckout;
  accountView=Backend.customer()?"orders":"login";
  accountMessage="";
  renderCuenta();
  $("dlg").showModal();
  if(Backend.customer()&&!accountOrdersLoaded)cargarComprasCuenta();
}

function renderCuenta(){
  var box=$("dbox"),user=Backend.customer();
  box.classList.toggle("account-login-view",!!Backend.accountsReady&&!user);
  if(!Backend.accountsReady){
    box.innerHTML='<h2>Cuenta de cliente</h2><p class="account-note" role="status">El registro, las compras y los comprobantes requieren la conexión segura de la tienda. Aún no está activada para recibir pedidos reales.</p>'+
      (Backend.ready?'<p class="meta">La prueba local guarda pedidos solo en este navegador y no crea cuentas de cliente.</p>':'<p class="meta">Antes de activarla, el administrador debe verificar la base de datos y configurar el checkout seguro.</p>')+
      '<div class="foot"><button class="btn" data-x="close">Cerrar</button></div>';
    return;
  }

  if(user){
    var rows=accountOrders.map(function(o){
      var title="#"+String(o.id||"").slice(-6).toUpperCase(),date=o.fecha?new Date(o.fecha).toLocaleDateString("es-CO"):"Fecha no disponible";
      var items=(o.items||[]).map(function(i){return esc(i.q+" × "+i.n)}).join(", ");
      return '<article class="account-order"><div class="account-order-head"><div><b>'+esc(title)+'</b><small>'+esc(date)+" · "+esc(o.estado||"Pendiente")+'</small></div><b>'+esc(fmt.format(o.total||0))+'</b></div>'+
        '<p>'+items+'</p><button type="button" class="btn sm" data-x="invoice" data-id="'+esc(o.id)+'">Ver / imprimir comprobante</button></article>';
    }).join("");
    box.innerHTML='<div class="account-head"><div><span class="account-eyebrow">MI CUENTA</span><h2>Mis compras</h2><p>'+esc(user.name||user.email)+'</p></div><button type="button" class="btn sm" data-x="account-logout">Cerrar sesión</button></div>'+
      (accountMessage?'<p class="account-note" role="status">'+esc(accountMessage)+'</p>':"")+
      (accountBusy?'<p class="meta" role="status">Cargando tus compras…</p>':accountOrders.length?'<div class="account-orders">'+rows+'</div>':'<p class="account-note" role="status">'+(accountOrdersLoaded?'Todavía no tienes compras asociadas a esta cuenta.':'Selecciona “Actualizar compras” para consultar tu historial.')+'</p>')+
      '<div class="foot"><button type="button" class="btn" data-x="account-orders">Actualizar compras</button><button type="button" class="btn" data-x="close">Cerrar</button></div>';
    return;
  }

  var registering=accountView==="register";
  box.innerHTML='<span class="account-eyebrow">NEXORA · CLIENTES</span><h2>'+(registering?'Crear cuenta':'Iniciar sesión')+'</h2>'+
    '<p class="meta">Usa tu cuenta para asociar tus pedidos y consultar sus comprobantes.</p>'+
    (accountMessage?'<p class="account-note" role="status">'+esc(accountMessage)+'</p>':"")+
    '<div class="f">'+(registering?'<label class="field-label" for="account-name">Nombre completo</label><input id="account-name" maxlength="80" autocomplete="name" value="'+esc(accountNameDraft)+'" required>':"")+
    '<label class="field-label" for="account-email">Correo electrónico</label><input id="account-email" type="email" maxlength="254" autocomplete="email" value="'+esc(accountEmailDraft)+'" required>'+
    '<label class="field-label" for="account-password">Contraseña</label><input id="account-password" type="password" minlength="8" maxlength="128" autocomplete="'+(registering?'new-password':'current-password')+'" required>'+
    (registering?'<label class="field-label" for="account-password-repeat">Repite la contraseña</label><input id="account-password-repeat" type="password" minlength="8" maxlength="128" autocomplete="new-password" required>':"")+'</div>'+
    '<div class="err" role="alert" aria-live="polite">'+(accountBusy?'Procesando…':'')+'</div>'+
    '<div class="account-switch"><span>'+(registering?'¿Ya tienes cuenta?':'¿Es tu primera compra?')+'</span><button type="button" class="btn sm" data-x="account-mode" data-mode="'+(registering?'login':'register')+'">'+(registering?'Iniciar sesión':'Crear cuenta')+'</button></div>'+
    '<div class="foot"><button type="button" class="btn" data-x="close">Cancelar</button><button type="button" class="btn primary" data-x="account-submit"'+(accountBusy?' disabled':'')+'>'+(registering?'Crear cuenta':'Entrar')+'</button></div>';
  var first=box.querySelector(registering?'#account-name':'#account-email');
  if(first)first.focus();
}

function cargarComprasCuenta(){
  if(!Backend.customer())return Promise.resolve([]);
  accountBusy=true;accountOrdersLoaded=false;renderCuenta();
  return Backend.myOrders().then(function(rows){accountOrders=rows;accountOrdersLoaded=true;accountMessage="";return rows;})
    .catch(function(e){accountOrders=[];accountOrdersLoaded=true;accountMessage=String(e&&e.message||"No se pudo consultar el historial.");return [];})
    .then(function(rows){accountBusy=false;renderCuenta();return rows;});
}

function enviarFormularioCuenta(){
  if(!Backend.accountsReady){renderCuenta();return Promise.resolve(false)}
  var registering=accountView==="register",name=registering?$("account-name").value.trim():"",email=$("account-email").value.trim(),password=$("account-password").value,
      repeated=registering?$("account-password-repeat").value:"";
  accountNameDraft=name;accountEmailDraft=email;
  if(registering&&name.length<2){accountMessage="Escribe tu nombre completo.";renderCuenta();return Promise.resolve(false)}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){accountMessage="Escribe un correo válido.";renderCuenta();return Promise.resolve(false)}
  if(password.length<8){accountMessage="La contraseña debe tener al menos 8 caracteres.";renderCuenta();return Promise.resolve(false)}
  if(registering&&password!==repeated){accountMessage="Las contraseñas no coinciden.";renderCuenta();return Promise.resolve(false)}
  accountBusy=true;accountMessage="";renderCuenta();
  var request=registering?Backend.signupCustomer(name,email,password):Backend.loginCustomer(email,password);
  return request.then(function(result){
    accountBusy=false;
    if(registering&&result.requiresEmailConfirmation){accountView="login";accountMessage="Cuenta creada. Confirma tu correo y luego inicia sesión.";renderCuenta();return false}
    accountOrders=[];accountOrdersLoaded=false;accountNameDraft="";accountEmailDraft="";
    var user=Backend.customer();
    if(user&&user.name&&!chk.nombre)chk.nombre=user.name;
    if(accountReturnToCheckout){accountReturnToCheckout=false;$("dlg").close();step="datos";drawCart();renderAll();return true}
    accountView="orders";accountMessage="Sesión iniciada.";renderCuenta();cargarComprasCuenta();renderAll();return true;
  }).catch(function(e){accountBusy=false;accountMessage=String(e&&e.message||"No se pudo completar el acceso.");renderCuenta();return false});
}

function cerrarCuentaCliente(){
  return Backend.logoutCustomer().then(function(){accountOrders=[];accountOrdersLoaded=false;accountView="login";accountMessage="Sesión cerrada.";renderCuenta();renderAll()});
}

function guardarUltimoPedido(o){lastPurchasedOrder=o;}

function imprimirPedidoCuenta(id){
  var order=accountOrders.find(function(o){return String(o.id)===String(id)});
  if(order)imprimirComprobante(order);
}

function imprimirComprobante(o){
  if(!o||!o.id)return;
  var w=window.open("about:blank","_blank");
  if(!w){alert("Permite ventanas emergentes para abrir el comprobante.");return}
  w.opener=null;
  var title="Comprobante de compra NEXORA #"+String(o.id).slice(-6).toUpperCase();
  var html='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+esc(title)+'</title><style>body{font:15px Arial,sans-serif;color:#14202b;margin:32px}.rc{max-width:820px;margin:auto}.rc-head,.rc-info{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.rc-head{border-bottom:2px solid #152333;padding-bottom:16px}.rc-k,.rc-info span{display:block;color:#536273;font-size:12px}.rc-n{display:block;font-size:24px;margin-top:6px}.rc-date{align-self:end}.rc-info{padding:18px 0;border-bottom:1px solid #ccd4dc}.rc-info>div{min-width:150px}.rc-info b{display:block;margin-top:4px}.rc-scroll{overflow:visible}.rc-t{width:100%;border-collapse:collapse;margin-top:18px}.rc-t th,.rc-t td{padding:10px;border-bottom:1px solid #ccd4dc;text-align:left}.rc-t .n{text-align:right}.rc-tot{font-size:18px}@media print{body{margin:10mm}button{display:none}}</style></head><body><header><h1>NEXORA</h1><p>Comprobante de compra</p></header>'+reciboCompleto(o)+'<p>Usa Imprimir en el navegador y selecciona Guardar como PDF.</p></body></html>';
  w.document.open();w.document.write(html);w.document.close();
}
