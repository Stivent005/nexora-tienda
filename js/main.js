/* ARRANQUE: eventos globales e inicio de la aplicación */
/* ---------- Eventos ---------- */
document.addEventListener("change",function(e){
  var el=e.target;
  if(!el.matches("input[data-qty]"))return;
  var id=el.dataset.id;
  var n=Math.floor(Number(el.value));
  if(!Number.isFinite(n)||n<1)n=1;
  var product=items.find(function(p){return p.id===id}),limit=product?stockLimit(product):0;
  if(n>limit)n=limit;
  if(n>0)cart[id]=n;else delete cart[id];
  lsSet("tienda_carrito",cart);
  updateCount();
  drawCart();
});
document.addEventListener("click",function(e){
  if(e.target.classList&&e.target.classList.contains("comp")){e.target.classList.toggle("big");return}
  var t=e.target.closest("button");if(!t)return;var d=t.dataset;
  if(d.fav!==undefined){var favResult=alternarFavorito(d.fav);if(!favResult.ok){favoritosError=T(favResult.limit?"favorito.limite":"favorito.error");renderStore();var favFilter=$("favorites-filter");if(favFilter)favFilter.focus();return}favoritosError="";renderStore();var nextFav=[].slice.call(document.querySelectorAll("[data-fav]")).find(function(button){return button.dataset.fav===d.fav});if(nextFav)nextFav.focus();else{var filter=$("favorites-filter");if(filter)filter.focus()}}
  else if(d.favfilter!==undefined){favoritosSolo=!favoritosSolo;favoritosError="";renderStore();var favoritesFilter=$("favorites-filter");if(favoritesFilter)favoritesFilter.focus()}
  else if(d.add){var product=items.find(function(p){return p.id===d.add}),limit=product?stockLimit(product):0,next=(cart[d.add]||0)+1;if(next>limit){t.textContent=T("producto.stockMaximo");t.setAttribute("aria-live","polite");setTimeout(renderStore,1000);return}cart[d.add]=next;lsSet("tienda_carrito",cart);updateCount();t.textContent=T("producto.agregado");t.setAttribute("aria-live","polite");setTimeout(renderStore,700)}
  else if(d.c!==undefined&&t.classList.contains("chip")){cat=d.c;renderStore()}
  else if(d.t!==undefined&&t.classList.contains("chip")){tipoF=d.t;renderStore()}
  else if(d.pf!==undefined){if(atab==="pay")adminPaymentFilter=d.pf;else pedidoFiltro=d.pf;renderAdmin()}
  else if(d.oa)cambiarEstado(d.id,d.oa);
  else if(d.tab){atab=d.tab;renderAdmin()}
  else if(d.x==="newp")openForm(null);
  else if(d.x==="logout"){authed=false;atab="";Backend.logout();if(Backend.remote)orders=[];renderAll()}
  else if(d.x==="catalog-retry")(ADMIN_PAGE?cargarCatalogoAdmin():cargarCatalogoCliente());
  else if(d.x==="orders-retry")cargarPedidos();
  else if(d.x==="notice-dismiss"){ordersNotice="";renderAdmin()}
  else if(d.q){var id=d.id,product=items.find(function(p){return p.id===id}),limit=product?stockLimit(product):0,next=(cart[id]||0)+Number(d.q);next=Math.max(0,Math.min(limit,next));if(next===0)delete cart[id];else cart[id]=next;lsSet("tienda_carrito",cart);updateCount();drawCart()}
  else if(d.x==="close")$("dlg").close();
  else if(d.x==="account")abrirCuenta(false);
  else if(d.x==="account-mode"){$("account-name")&&(accountNameDraft=$("account-name").value);$("account-email")&&(accountEmailDraft=$("account-email").value);accountView=d.mode==="register"?"register":"login";accountMessage="";renderCuenta()}
  else if(d.x==="account-submit")enviarFormularioCuenta();
  else if(d.x==="account-logout")cerrarCuentaCliente();
  else if(d.x==="account-orders")cargarComprasCuenta();
  else if(d.x==="invoice")imprimirPedidoCuenta(d.id);
  else if(d.x==="invoice-last")imprimirComprobante(lastPurchasedOrder);
  else if(d.x==="to-datos"){if(!ADMIN_PAGE&&Backend.remote&&Backend.accountsReady&&!Backend.customer()){abrirCuenta(true);return}step="datos";drawCart()}
  else if(d.x==="to-pago"){var fd=validarDatos(lines());if(fd.length){$("err").textContent=T("falta.prefijo",{lista:fd.join(", ")});$("err").focus();return}step="pago";drawCart()}
  else if(d.x==="back-cart"){step="cart";drawCart()}
  else if(d.x==="back-datos"){step="datos";drawCart()}
  else if(d.modo){chk.modo=d.modo;drawCart()}
  else if(d.pm){chk.pay=d.pm;drawCart()}
  else if(d.copy!==undefined)copiar(d.copy,t);
  else if(d.x==="msave")saveMetodo();
  else if(d.x==="qr-remove"){mQr="";var qrInput=$("m-qrf");if(qrInput)qrInput.value="";renderMetodoQrPreview()}
  else if(d.x==="send")sendOrder();else if(d.x==="cup")applyCoupon();else if(d.x==="osave")saveOrder();
  else if(d.x==="save")saveForm();
  else if(d.x==="pin")checkPin();
  else if(d.a==="edit")openForm(items.find(function(p){return p.id===d.id}));
  else if(d.a==="del"){
    if(pdel!==d.id){pdel=d.id;if(ADMIN_PAGE)renderAdmin();else renderStore();setTimeout(function(){if(pdel===d.id){pdel=null;if(ADMIN_PAGE)renderAdmin();else renderStore()}},4000);return}
    pdel=null;items=items.filter(function(p){return p.id!==d.id});delete cart[d.id];persist();refresh();
  }
  else if(d.a==="vis"){var pv=items.find(function(p){return p.id===d.id});pv.active=!pv.active;persist();refresh()}
});
if($("adminlink"))$("adminlink").addEventListener("click",function(){if(!authed)askPin()});
renderAll();
if (typeof mostrarAvisoRetornoMercadoPago === "function") mostrarAvisoRetornoMercadoPago();
/* Arranque: la tienda lee el catálogo de la base de datos; el panel (admin.html) pide sesión. */
if(ADMIN_PAGE){
  if(Backend.remote&&Backend.restore()){authed=true;renderAll();cargarCatalogoAdmin().then(cargarPedidos)}
  else askPin();
}else if(REMOTO)cargarCatalogoCliente();

function describirErrorCatalogo(e){
  var msg=String(e&&e.message||e||"Error desconocido").slice(0,320);
  if(e&&e.status)return "Supabase respondió HTTP "+e.status+(e.code?" ("+e.code+")":"")+": "+msg;
  if(e&&e.code==="TIMEOUT")return "Supabase no respondió dentro del tiempo límite. Vuelve a intentarlo.";
  if(e&&e.code==="NETWORK_ERROR")return "No se pudo alcanzar Supabase. Revisa la conexión, DNS y los bloqueos CORS/CSP. Detalle: "+msg;
  return "No se pudo cargar el catálogo de Supabase: "+msg;
}

function cargarCatalogoAdmin(){
  catalogoCargando=true;catalogoError="";renderAdmin();
  return cargarCatalogo().catch(function(e){
    catalogoCargando=false;
    catalogoError=describirErrorCatalogo(e);
    renderAll();
  });
}

function cargarCatalogoCliente(){
  catalogoCargando=true;catalogoError="";renderStore();
  return cargarCatalogo().catch(function(e){
    console.error("[NEXORA] Error al cargar el catálogo remoto",e);
    catalogoCargando=false;
    catalogoError=items.some(function(p){return p.active})
      ?"No se pudo actualizar el catálogo. Se muestran datos guardados en este dispositivo. "+describirErrorCatalogo(e)
      :describirErrorCatalogo(e);
    renderStore();
  });
}

/* Con base de datos en línea, revisa cada 30 s si llegaron pedidos nuevos */
setInterval(function(){if(ADMIN_PAGE&&authed&&Backend.remote&&(atab==="orders"||atab==="pay"||atab==="dashboard"||atab==="")&&!$("dlg").open)cargarPedidos()},30000);

/* Guarda lo que el cliente escribe mientras avanza por los pasos del pago */
var CHKMAP={"c-name":"nombre","c-phone":"tel","c-ffid":"idJuego","c-addr":"addr","c-city":"city","c-department":"department","c-zone":"zone","c-reference":"reference","c-punto":"punto","c-ref":"ref"};
$("dbox").addEventListener("input",function(e){
  var k=CHKMAP[e.target.id];
  if(k)chk[k]=e.target.value;
  var productId=e.target.getAttribute("data-digital-product"),field=e.target.getAttribute("data-digital-field");
  if(productId&&field){if(!chk.digital[productId])chk.digital[productId]={};chk.digital[productId][field]=e.target.value}
});


