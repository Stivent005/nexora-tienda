/* ADMINISTRACIÓN: productos, ofertas, pedidos, clientes, cupones, ajustes y respaldo */
/* ---------- ADMINISTRACIÓN ---------- */
var ordersNotice="";
var adminSearch={orders:"",products:"",customers:"",payments:""};
var adminProductType="",adminOrderTypeFilter="";
var adminPaymentFilter="";
var ordersLoading=false;
var ADMIN_NAV=[
  ["dashboard","Resumen","▦"],["products","Productos","▣"],["orders","Pedidos","▤"],
  ["pay","Pagos","＄"],["customers","Clientes","♙"],["loyalty","Puntos y recompensas","✦"],
  ["coupons","Cupones","％"],["settings","Ajustes","⚙"],["backup","Respaldo","⇧"],
  ["security","Acceso y roles","⌑"]
];

function adminTitle(){
  var key=atab||"dashboard",item=ADMIN_NAV.find(function(x){return x[0]===key;});
  return item?item[1]:"Resumen";
}
function adminFrame(content){
  var active=atab||"dashboard";
  return '<div class="admin-shell"><aside class="admin-sidebar">'+
    '<a class="admin-brand" href="index.html"><span class="admin-brand-mark">N</span><span><b>NEXORA</b><small>CENTRO DE CONTROL</small></span></a>'+
    '<div class="admin-mode-indicator '+(Backend.remote?'is-remote':'is-local')+'"><i aria-hidden="true"></i>'+(Backend.remote?'Sesión remota':'Local · solo pruebas')+'</div>'+
    '<nav class="admin-nav" aria-label="Navegación administrativa">'+ADMIN_NAV.map(function(x){
      return '<button class="admin-nav-item'+(active===x[0]?" is-active":"")+'" data-tab="'+x[0]+'" aria-current="'+(active===x[0]?"page":"false")+'"><span aria-hidden="true">'+x[1]+'</span><b>'+esc(x[1])+'</b></button>';
    }).join("")+'</nav><div class="admin-sidebar-foot"><a href="index.html">← Volver a la tienda</a><button class="btn sm" data-x="logout">Cerrar sesión</button></div></aside>'+
    '<div class="admin-main"><header class="admin-toolbar"><div><span class="admin-eyebrow">NEXORA / ADMINISTRACIÓN</span><h1>'+esc(adminTitle())+'</h1></div><button class="btn primary" data-x="newp">＋ Nuevo producto</button></header>'+
    '<section class="admin-content">'+content+'</section></div></div>';
}
function bindAdminSearch(id,key){
  var input=$(id);if(!input)return;
  input.value=adminSearch[key]||"";
  input.addEventListener("input",function(){
    adminSearch[key]=input.value;
    var pos=input.selectionStart;
    renderAdmin();
    var next=$(id);if(next){next.focus();if(next.setSelectionRange)next.setSelectionRange(pos,pos)}
  });
}
function getAdminOrderType(o){
  var its=Array.isArray(o.items)?o.items:[],digital=its.filter(function(i){return !!i.v}).length;
  if(!its.length)return "sin_tipo";
  return digital===its.length?"digital":(digital?"mixto":"fisico");
}
function adminOrderTypeLabel(o){return ({fisico:"Físico",digital:"Digital",mixto:"Mixto",sin_tipo:"Tipo no registrado"})[getAdminOrderType(o)]}
function adminEstadoClass(estado){return String(estado||"").toLowerCase().replace(/[^a-z]/g,"")}
function adminHistory(o){
  return Array.isArray(o.historial)?o.historial:[];
}
function adminPaymentDetails(o){
  var p=o.pagoRegistro||{},datos=p.datos||{};
  return {
    referencia:p.referencia||datos.referencia||o.referencia||"",
    comprobante:safeImg(datos.comprobante)||safeImg(p.comprobante)||safeImg(o.comprobante),
    nota:datos.nota||""
  };
}
function adminPagoHtml(o){
  var p=o&&o.pagoRegistro?o.pagoRegistro:null;

  if(!p){
    return '<b>Pago: sin registro</b><span>El pedido no tiene un registro de pago.</span>';
  }

  var estado=String(p.estado||"pendiente");
  var monto=Number(p.monto)||0;
  var datos=adminPaymentDetails(o);

  var puedeVerificar=estado==="pendiente"||estado==="en_revision";
  var total=Number(o&&o.total)||0;
  var montoCoincide=total>0&&monto===total;
  var accion=Backend.secureCheckout&&puedeVerificar
    ?(montoCoincide
    ?'<button class="btn sm primary" data-payment-review="'+esc(p.id)+'">Verificar pago completo</button>'
    :'<small>El monto del pago no coincide con el total del pedido.</small>')
    :'';

  return '<b>Pago registrado: '+fmt.format(monto)+'</b>'+
    '<span>'+esc(p.metodo||o.pago||"Método no registrado")+' · '+esc(estado)+'</span>'+
    (datos.referencia?'<small>Ref: '+esc(datos.referencia)+'</small>':'')+
    (datos.comprobante?'<img class="comp" src="'+datos.comprobante+'" alt="Evidencia del pago">':'')+
    accion;
}

function registrarPagoManual(id){
  var o=orders.find(function(x){
    return String(x.id)===String(id);
  });

  if(!o)return;

  var p=o.pagoRegistro||null;

  if(!p){
    alert("No existe un registro de pago para este pedido.");
    return;
  }

  if(String(p.estado)!=="pendiente"&&String(p.estado)!=="en_revision"){
    alert("Este pago ya no está pendiente de verificación.");
    return;
  }

  var total=Number(o.total)||0;

  if(!(total>0)){
    alert("No se pudo determinar el total del pedido.");
    return;
  }

  if(Number(p.monto)!==total){
    alert("El registro de pago no coincide con el total del pedido.");
    return;
  }

  revisarPagoCompleto(p.id);
}
function registrarAbonoPedido(id,button){
  var o=orders.find(function(x){return String(x.id)===String(id)});
  if(!o||o.pagoRegistro||estadoDe(o)!=="Pendiente")return;
  var monto=Number(o.total)||0;
  if(!(monto>0)){ordersErr="No se pudo determinar el total validado del pedido.";renderAdmin();return;}
  if(!String(o.referencia||"").trim()&&!String(o.comprobante||"").trim()){ordersErr="El pedido no tiene referencia ni comprobante para registrar el pago.";renderAdmin();return;}
  if(!window.confirm("Esto solo registra un pago pendiente por "+fmt.format(monto)+" para revisión. No marca el pedido como pagado ni confirma la entrega. Continúa solo si recibiste evidencia del cliente."))return;
  if(button)button.disabled=true;
  var comprobante=typeof o.comprobante==="string"&&/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(o.comprobante)&&o.comprobante.length<=700000?o.comprobante:"";
  return Backend.registrarAbono(o.id,monto,o.pago||"Pago manual",o.referencia||"",comprobante,"Registro manual desde el pedido; pendiente de verificacion.")
    .then(function(r){
      if(r&&r.error)throw new Error(r.error);
      ordersErr="";
      ordersNotice="Pago registrado para revisión. Comprueba que se recibió en su fuente y verifícalo en Pagos → Pendientes. Solo después aparecerá en Pedidos → Por entregar.";
      atab="pay";
      adminPaymentFilter="pendiente";
      return cargarPedidos();
    })
    .catch(function(e){ordersNotice="";ordersErr="No se pudo registrar el pago: "+(e&&e.message||e);renderAdmin();});
}
function revisarPagoCompleto(id){
  if(!window.confirm(
    "Verifica que el pago COMPLETO fue recibido en su fuente. ¿Confirmas que quieres marcarlo como pagado?"
  ))return;

  var p=null;

  orders.some(function(o){
    if(!o.pagoRegistro)return false;

    if(String(o.pagoRegistro.id)===String(id)){
      p=o.pagoRegistro;
      return true;
    }

    return false;
  });

  if(!p){
    alert("No se encontró el registro de pago.");
    return;
  }

  var pedidoId=String(p.pedido_id);

  var o=orders.find(function(x){
    return String(x.id)===pedidoId;
  });

  if(!o){
    alert("No se encontró el pedido asociado.");
    return;
  }

  if(p.estado!=="pendiente"&&p.estado!=="en_revision"){
    alert("Este pago ya no está pendiente de revisión.");
    return;
  }

  if(!(Number(o.total)>0)||Number(p.monto)!==Number(o.total)){
    alert("El monto del registro no coincide con el total del pedido.");
    return;
  }

  return Backend.verificarAbono(
    p.id,
    true,
    "Pago completo verificado manualmente desde el panel."
  ).then(function(r){
    if(!r||r.error)throw new Error(r&&r.error||"Supabase no devolvio el resultado de la verificacion.");
    if(!r.pagado){
      return cargarPedidos().then(function(){
        ordersErr="El abono se verifico, pero Supabase reporta saldo pendiente de "+fmt.format(Number(r.saldo)||0)+". El pedido sigue pendiente y aun no se puede entregar.";
        renderAdmin();
      });
    }
    return cargarPedidos().then(function(){
      var actualizado=orders.find(function(x){return String(x.id)===pedidoId;});
      if(!actualizado||estadoDe(actualizado)!=="Pagado"){
        ordersErr="Supabase acepto el pago completo, pero el pedido no aparece como Pagado al recargar. Actualiza la lista y revisa el estado antes de entregar.";
        renderAdmin();
      }else{
        ordersErr="";
        ordersNotice="Pago verificado. El pedido está en Pedidos → Por entregar; confirma cada entrega desde su botón.";
        atab="orders";
        pedidoFiltro="Pagado";
        renderAdmin();
      }
    });
  }).catch(function(e){
    ordersErr="No se pudo verificar el pago: "+(e&&e.message||e);
    renderAdmin();
  });
}
function registrarReintegro(abonoId){
  var pedido=null,abono=null;
  orders.some(function(o){var found=(o.abonos||[]).find(function(a){return String(a.id)===String(abonoId)});if(found){pedido=o;abono=found;return true}return false});
  if(!pedido||!abono||abono.estado!=="verificado")return;
  var reintegros=Array.isArray(abono.reintegros)?abono.reintegros:[],usado=reintegros.filter(function(r){return r.estado==="pendiente"||r.estado==="verificado"}).reduce(function(s,r){return s+(Number(r.monto)||0)},0),disponible=Math.max(0,Number(abono.monto)-usado);
  if(!disponible){alert("Este abono ya tiene reintegros registrados por su valor total.");return}
  var monto=window.prompt("Monto que vas a reintegrar (máximo: "+fmt.format(disponible)+")",String(disponible));if(monto===null)return;
  var n=Number(monto);if(!(n>0)||n>disponible){alert("Escribe un monto mayor que cero y no superior al disponible.");return}
  var referencia=window.prompt("Referencia o constancia del reintegro que se pueda comprobar en su fuente:","");if(referencia===null||!referencia.trim()){alert("La referencia es necesaria para verificar el reintegro.");return}
  Backend.registrarReintegro(abono.id,n,abono.metodo||"Reintegro manual",referencia.trim(),"","").then(cargarPedidos).catch(function(e){ordersErr="No se pudo registrar el reintegro: "+e.message;renderAdmin()});
}

function revisarAbono(id,aprobar){
  if(aprobar&&!window.confirm("Verifica el abono solo después de confirmar su recepción en la fuente de pago. ¿Ya lo comprobaste?"))return;
  Backend.verificarAbono(id,aprobar).then(function(){ordersErr="";return cargarPedidos()}).catch(function(e){ordersErr="No se pudo revisar el abono: "+e.message;renderAdmin()});
}

function revisarReintegro(id,aprobar,pedidoId){
  var o=orders.find(function(x){return String(x.id)===String(pedidoId)});
  if(!o)return;
  if(aprobar&&!window.confirm("Comprueba el reintegro en su fuente. Si el pedido ya está pagado, se deben verificar todos los reintegros por el total para cancelar y revertir puntos e inventario. ¿Confirmas la revisión?"))return;
  var request=Backend.secureCheckout&&estadoDe(o)==="Pagado"
    ?Backend.verificarReintegrosPedido(o.id,aprobar)
    :Backend.verificarReintegro(id,aprobar);
  request.then(function(){ordersErr="";return cargarPedidos()}).catch(function(e){ordersErr="No se pudo revisar el reintegro: "+e.message;renderAdmin()});
}


function actualizarEntrega(id,tipo){
  var datos={};
  if(tipo==="digital"){
    var confirmacion=window.prompt("Escribe la referencia o confirmación de la recarga digital para guardarla en el pedido:");
    if(confirmacion===null)return;
    confirmacion=confirmacion.trim();
    if(confirmacion.length<3){
      ordersErr="La confirmación de la recarga debe tener al menos 3 caracteres.";
      renderAdmin();
      return;
    }
    datos.confirmacion=confirmacion;
  }else if(!window.confirm("¿Confirmas que entregaste este producto?"))return;

  Backend.actualizarEntrega(id,"entregado",datos)
    .then(cargarPedidos)
    .catch(function(e){
      ordersErr="No se pudo actualizar la entrega: "+e.message;
      renderAdmin();
    });
}


function adminEntregasHtml(o){
  if(!Backend.secureCheckout||estadoDe(o)!=="Pagado")return "";
  if(!Array.isArray(o.entregas)||!o.entregas.length)return '<div class="admin-note is-muted">No hay entregas registradas para este pedido.</div>';
  return '<div class="admin-order-deliveries"><b>Entregas</b>'+o.entregas.map(function(d){
    var productoId=d.producto_id==null?d.productoId:d.producto_id;
    var item=(o.items||[]).find(function(i){return String(i.id)===String(productoId)});
    var cerrada=d.estado==="entregado"||d.estado==="cancelado";
    return '<div class="admin-delivery-row"><span>'+esc(item&&item.n||productoId)+' · '+(d.tipo==="digital"?"Digital":"Física")+' · '+esc(d.estado)+' · '+esc(d.cantidad)+'</span>'+
      (cerrada?'':'<button class="btn sm primary" data-delivery="'+esc(d.id)+'" data-kind="'+esc(d.tipo)+'">'+(d.tipo==="digital"?"Confirmar recarga":"Confirmar entrega")+'</button>')+'</div>';
  }).join("")+'</div>';
}

function renderSalesChart(){
  if(ordersLoading)return '<div class="admin-empty" role="status">Cargando datos de ventas…</div>';
  if(ordersErr)return '<div class="admin-empty" role="status">No se pudo actualizar la gráfica. Revisa el estado de pedidos.</div>';
  var now=new Date(),days=[],totals={};
  for(var i=6;i>=0;i--){var d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()-i);var key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");days.push({key:key,label:d.toLocaleDateString("es-CO",{weekday:"short"})});totals[key]=0}
  orders.filter(function(o){return estadoDe(o)==="Pagado"||estadoDe(o)==="Entregado"}).forEach(function(o){var d=new Date(o.fecha),key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");if(Object.prototype.hasOwnProperty.call(totals,key))totals[key]+=Number(o.total)||0});
  var max=Math.max.apply(null,days.map(function(d){return totals[d.key]}));
  if(!max)return '<div class="admin-empty">Sin ventas confirmadas en los últimos 7 días.</div>';
  return '<div class="admin-chart" role="img" aria-label="Ventas confirmadas por día durante los últimos siete días">'+days.map(function(d){var amount=totals[d.key],height=amount?Math.max(5,Math.round(amount/max*100)):0;return '<div class="admin-chart-day"><div class="admin-chart-track"><span class="'+(amount?'':'is-zero')+'" style="height:'+height+'%" title="'+esc(fmt.format(amount))+'"></span></div><small>'+esc(d.label)+'</small><b>'+esc(fmt.format(amount))+'</b></div>'}).join("")+'</div>';
}
function renderRecentActivity(){
  if(ordersLoading)return '<div class="admin-empty" role="status">Cargando actividad…</div>';
  if(ordersErr&&!orders.length)return '<div class="admin-empty" role="status">La actividad no está disponible mientras no se puedan leer los pedidos.</div>';
  var entries=[];
  orders.forEach(function(o){var hist=adminHistory(o);
    if(hist.length)hist.forEach(function(x){entries.push({o:o,fecha:x.fecha,text:x.de?x.de+" → "+x.a:"Pedido recibido",estado:x.a})});
    else if(o.fecha)entries.push({o:o,fecha:o.fecha,text:"Pedido recibido",estado:estadoDe(o)});
  });
  entries.sort(function(a,b){return b.fecha-a.fecha});entries=entries.slice(0,8);
  return entries.length?'<div class="admin-activity">'+entries.map(function(x){return '<article class="admin-activity-item"><span class="admin-activity-dot" aria-hidden="true"></span><div><b>'+esc(x.text)+'</b><p>'+esc(x.o.nombre||"Cliente")+' · pedido #'+esc(String(x.o.id||"").slice(-6).toUpperCase())+' · <span class="tag st-'+adminEstadoClass(x.estado)+'">'+esc(x.estado)+'</span></p><small>'+esc(new Date(x.fecha).toLocaleString("es-CO"))+'</small></div></article>'}).join("")+'</div>':'<div class="admin-empty">Aún no hay actividad registrada.</div>';
}
function renderDashboard(){
  var confirmed=orders.filter(function(o){return estadoDe(o)==="Pagado"||estadoDe(o)==="Entregado"});
  var sales=confirmed.reduce(function(a,o){return a+(Number(o.total)||0)},0);
  var pending=orders.filter(function(o){return estadoDe(o)==="Pendiente"}).length;
  var done=orders.filter(function(o){return estadoDe(o)==="Entregado"}).length;
  var active=items.filter(function(p){return p.active}).length;
  var low=items.filter(function(p){return p.active&&p.tipo==="fisico"&&(Number(p.stock)||0)>=0&&(Number(p.stock)||0)<=3}).length;
  var unavailable=ordersLoading||!!ordersErr||!orders.length;
  var productsUnavailable=catalogoCargando||!!catalogoError;
  var stat=function(value,label,sub){return '<article class="admin-stat"><span>'+esc(label)+'</span><b>'+value+'</b><small>'+esc(sub)+'</small></article>'};
  return (ordersErr?'<div class="msg err" role="alert">'+esc(ordersErr)+' <button class="btn sm" id="orefresh">Reintentar</button></div>':'')+
    '<div class="admin-stats">'+
    stat(unavailable?'—':fmt.format(sales),"Ventas confirmadas","Pedidos pagados o entregados")+
    stat(unavailable?'—':pending,"Pedidos pendientes","Requieren revisión manual")+
    stat(unavailable?'—':done,"Pedidos completados","Estado entregado")+
    stat(productsUnavailable?'—':active,"Productos activos","Visibles en la tienda")+
    stat(productsUnavailable?'—':low,"Inventario bajo","Productos físicos con 0 a 3 unidades")+
    '</div><div class="admin-dashboard-grid"><section class="admin-panel"><div class="admin-panel-head"><div><span class="admin-eyebrow">ÚLTIMOS 7 DÍAS</span><h2>Ventas confirmadas</h2></div></div>'+renderSalesChart()+'</section>'+
    '<section class="admin-panel"><div class="admin-panel-head"><div><span class="admin-eyebrow">PEDIDOS Y CAMBIOS</span><h2>Actividad reciente</h2></div><button class="btn sm" data-tab="orders">Ver pedidos</button></div>'+renderRecentActivity()+'</section></div>'+
    (catalogoError?'<div class="msg err" role="alert">'+esc(catalogoError)+' <button class="btn sm" data-x="catalog-retry">Reintentar catálogo</button></div>':'');
}
function renderAdmin(){
  if(!authed){$("panel").innerHTML="";if($("app"))$("app").hidden=false;return}
  if($("app"))$("app").hidden=true;
  if(!atab||atab==="dashboard"){$("panel").innerHTML=adminFrame(renderDashboard());var refresh=$("orefresh");if(refresh)refresh.addEventListener("click",cargarPedidos);return}
  var h="";
  if(atab==="products"){
    var q=(adminSearch.products||"").trim().toLowerCase();
    var pr=items.filter(function(p){return(!adminProductType||p.tipo===adminProductType)&&(!q||(p.name+" "+p.description+" "+p.category+" "+p.brand+" "+p.sku+" "+p.specifications.map(function(x){return x.name+" "+x.value}).join(" ")).toLowerCase().indexOf(q)>-1)});
    if(catalogoCargando)h+='<div class="admin-empty" role="status">Cargando productos…</div>';
    if(catalogoError)h+='<div class="msg err" role="alert">'+esc(catalogoError)+' <button class="btn sm" data-x="catalog-retry">Reintentar catálogo</button></div>';
    if(Backend.secureCheckout)h+='<div class="admin-note is-muted">Los ajustes de inventario se registran por separado en el servidor. Para conservar pedidos y entregas anteriores, oculta productos en vez de eliminarlos.</div>';
    h+='<div class="admin-tools"><label class="admin-search"><span class="sr-only">Buscar productos</span><input id="admin-product-search" type="search" placeholder="Buscar producto o categoría…" value="'+esc(adminSearch.products)+'"></label><label><span class="sr-only">Tipo de producto</span><select id="admin-product-type"><option value="">Todos los tipos</option><option value="fisico"'+(adminProductType==="fisico"?" selected":"")+'>Físicos</option><option value="virtual"'+(adminProductType==="virtual"?" selected":"")+'>Digitales</option></select></label><span class="admin-result-count">'+pr.length+' de '+items.length+' productos</span></div>';
    h+=pr.length?'<div class="admin-product-list">'+pr.map(function(p){var digital=p.tipo==="virtual",image=safeImg(p.image),availability=digital?(ilim(p)?"Stock ilimitado":(Number(p.stock)||0)+" disponibles"):((Number(p.stock)||0)>0?(Number(p.stock)||0)+" unidades":"Agotado");return '<article class="admin-product-row"><div class="admin-product-image">'+(image?'<img src="'+image+'" alt="'+esc(p.name)+'" loading="lazy">':'<span aria-hidden="true">'+(digital?'✦':'▧')+'</span>')+'</div><div class="admin-product-info"><div><span class="product-type '+(digital?'is-digital':'is-physical')+'">'+(digital?'Digital':'Físico')+'</span> <span class="tag'+(p.active?'':' off')+'">'+(p.active?'Activo':'Oculto')+'</span></div><h3>'+esc(p.name)+'</h3><p>'+esc(p.category||"Sin categor\u00eda")+' \u00b7 '+esc(availability)+(p.brand?' \u00b7 '+esc(p.brand):'')+(p.sku?' \u00b7 SKU '+esc(p.sku):'')+(p.unit?' \u00b7 '+esc(p.unit):'')+'</p></div><b class="admin-product-price">'+fmt.format(eff(p))+'</b><div class="acts"><button class="btn sm" data-a="edit" data-id="'+esc(p.id)+'">Editar</button><button class="btn sm" data-a="vis" data-id="'+esc(p.id)+'">'+(p.active?'Ocultar':'Activar')+'</button>'+(Backend.secureCheckout?'':'<button class="btn sm danger" data-a="del" data-id="'+esc(p.id)+'">'+(pdel===p.id?'Confirmar':'Eliminar')+'</button>')+'</div></article>'}).join("")+'</div>':(catalogoCargando?'<div class="admin-empty" role="status">Los productos se mostrarán cuando termine la carga.</div>':(catalogoError&&!items.length?'<div class="admin-empty" role="status">No se puede confirmar que el catálogo esté vacío porque no se pudo cargar.</div>':'<div class="empty" role="status" aria-live="polite"><h2>'+(items.length?'Sin resultados':'Aún no hay productos')+'</h2><p>'+(items.length?'Prueba otra búsqueda o filtro.':'Crea un producto para empezar; el panel no incluye productos de ejemplo.')+'</p></div>'));
    $("panel").innerHTML=adminFrame(h);bindAdminSearch("admin-product-search","products");var type=$("admin-product-type");if(type)type.addEventListener("change",function(){adminProductType=type.value;renderAdmin()});return;
  }
  if(atab==="orders"||atab==="pay"){
    var paymentView=atab==="pay";
    var searchKey=paymentView?"payments":"orders";
    var searchId=paymentView?"admin-payment-search":"admin-order-search";
    var sourceOrders=paymentView?orders.filter(function(o){return !!o.pagoRegistro}):orders;
    var currentFilter=paymentView?adminPaymentFilter:pedidoFiltro;
    var F=paymentView
      ?[["pendiente","Pendientes"],["en_revision","En revisión"],["verificado","Verificados"],["rechazado","Rechazados"],["reembolsado","Reembolsados"],["","Todos"]]
      :[["Pendiente","Pendientes"],["Pagado","Por entregar"],["Entregado","Entregados"],["Cancelado","Cancelados"],["","Todos"]];
    var filterState=function(o){return paymentView?String(o.pagoRegistro&&o.pagoRegistro.estado||"").toLowerCase():estadoDe(o)};
    var cnt=function(estado){return sourceOrders.filter(function(o){return!estado||filterState(o)===estado}).length};
    if(!Backend.remote)h+='<div class="msg">Modo de prueba: los pedidos se guardan solo en este navegador. Para recibir los pedidos de tus clientes aquí, configura la base de datos (README, "Pedidos en línea").</div>';
    if(ordersNotice)h+='<div class="msg admin-flow-notice" role="status" aria-live="polite">'+esc(ordersNotice)+' <button class="btn sm" data-x="notice-dismiss">Entendido</button></div>';
    if(ordersErr)h+='<div class="msg err" role="alert">'+esc(ordersErr)+' Usa “Actualizar” para volver a intentar. <button class="btn sm" data-x="orders-retry">Reintentar</button></div>';
    h+='<div class="admin-tools"><label class="admin-search"><span class="sr-only">'+(paymentView?"Buscar pagos":"Buscar pedidos")+'</span><input id="'+searchId+'" type="search" placeholder="'+(paymentView?"Buscar cliente, pedido o referencia de pago…":"Buscar cliente, teléfono, pedido o pago…")+'" value="'+esc(adminSearch[searchKey])+'"></label><label><span class="sr-only">Tipo de pedido</span><select id="admin-order-type"><option value="">Todos los tipos</option><option value="fisico"'+(adminOrderTypeFilter==="fisico"?" selected":"")+'>Físicos</option><option value="digital"'+(adminOrderTypeFilter==="digital"?" selected":"")+'>Digitales</option><option value="mixto"'+(adminOrderTypeFilter==="mixto"?" selected":"")+'>Mixtos</option></select></label><button class="btn" id="orefresh">Actualizar</button>'+(paymentView?'':'<button class="btn primary" id="onew">Registrar pedido</button>')+'</div>';
    h+='<div class="admin-filter-row" role="group" aria-label="'+(paymentView?"Filtrar pagos por estado":"Filtrar pedidos por estado")+'">'+F.map(function(f){return '<button class="chip" aria-pressed="'+(currentFilter===f[0])+'" data-pf="'+f[0]+'">'+f[1]+' ('+cnt(f[0])+')</button>'}).join("")+'</div>';
    var qOrder=(adminSearch[searchKey]||"").trim().toLowerCase();
    var vis=sourceOrders.filter(function(o){
      var p=o.pagoRegistro||{};
      var matchText=[o.nombre,o.tel,o.id,o.pago,o.pagoId,o.referencia,p.id,p.estado,p.metodo,p.referencia]
        .concat((o.items||[]).map(function(i){return i.n})).join(" ").toLowerCase();
      return(!currentFilter||filterState(o)===currentFilter)&&
        (!adminOrderTypeFilter||adminOrderTypeFilter===getAdminOrderType(o))&&
        (!qOrder||matchText.indexOf(qOrder)>-1);
    });
    h+=ordersLoading
      ?'<div class="admin-empty" role="status">Cargando '+(paymentView?"pagos":"pedidos")+'…</div>'
      :(ordersErr&&!orders.length
        ?'<div class="admin-empty" role="status">No se puede confirmar el estado de pagos porque los pedidos no se pudieron cargar. <button class="btn sm" data-x="orders-retry">Reintentar</button></div>'
        :(vis.length
          ?'<div class="admin-order-list">'+vis.map(orderRow).join("")+'</div>'
          :'<div class="admin-empty" role="status">'+(sourceOrders.length?(paymentView?"No hay pagos que coincidan con la búsqueda.":"No hay pedidos que coincidan con la búsqueda."):(paymentView?"Aún no hay pagos asociados a pedidos.":"Aún no hay pedidos."))+'</div>'));
    if(paymentView){
      var ms=metodos();
      if(ms.some(function(m){return m.activo!==false&&((m.tipo==="transfer"&&!m.cuenta&&!m.qr)||(m.tipo==="link"&&!m.enlace))}))
        h+='<div class="msg err">Hay métodos activos sin configurar: no se mostrarán a tus clientes hasta que agregues su número, cuenta o enlace.</div>';
      h+='<section class="admin-panel admin-methods-panel"><div class="admin-panel-head"><div><span class="admin-eyebrow">CONFIGURACIÓN</span><h2>Métodos de pago</h2></div><button class="btn primary" id="madd">Agregar método</button></div><p class="meta">Configura las opciones que tus clientes pueden elegir. Editar un método no confirma los pagos de pedidos existentes.</p>';
      h+='<div class="list">'+ms.map(function(m,i){
        var falta=(m.tipo==="transfer"&&!m.cuenta&&!m.qr)||(m.tipo==="link"&&!m.enlace);
        var det=m.tipo==="efectivo"?"Contra entrega (efectivo)":m.tipo==="link"?"Enlace de pago en línea":"Cuenta o billetera: "+esc(m.cuenta||(m.qr?"solo QR":"—"));
        return '<div class="row" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center"><div><b>'+ico(m)+' '+esc(m.nombre)+'</b><span class="tag'+(m.activo!==false?' off':'')+'">'+(m.activo!==false?"Activo":"Apagado")+'</span><div class="meta">'+det+(falta?' • <span style="color:var(--danger)">Falta configurar</span>':'')+'</div></div><div class="acts" style="flex-wrap:wrap"><button class="btn sm" data-mv="-1" data-i="'+i+'" aria-label="Subir">▲</button><button class="btn sm" data-mv="1" data-i="'+i+'" aria-label="Bajar">▼</button><button class="btn sm" data-mt="'+i+'">'+(m.activo!==false?"Apagar":"Activar")+'</button><button class="btn sm" data-me="'+i+'">Editar</button><button class="btn sm danger" data-md="'+i+'">'+(pdel==="m"+i?"Confirmar":"Eliminar")+'</button></div></div>';
      }).join("")+'</div>';
      if(!ms.length)h+='<div class="admin-empty">Aún no hay métodos de pago configurados.</div>';
      h+='</section>';
    }
    $("panel").innerHTML=adminFrame(h);
    bindAdminSearch(searchId,searchKey);
    var type=$("admin-order-type");
    if(type)type.addEventListener("change",function(){adminOrderTypeFilter=type.value;renderAdmin()});
    var refreshOrders=$("orefresh");
    if(refreshOrders)refreshOrders.addEventListener("click",cargarPedidos);
    var newOrder=$("onew");
    if(newOrder)newOrder.addEventListener("click",openOrder);
    document.querySelectorAll("[data-payment-review]").forEach(function(b){
      b.addEventListener("click",function(){revisarPagoCompleto(b.dataset.paymentReview)});
    });
    document.querySelectorAll("[data-register-payment]").forEach(function(b){
      b.addEventListener("click",function(){registrarAbonoPedido(b.dataset.registerPayment,b)});
    });
    document.querySelectorAll("[data-delivery]").forEach(function(b){
      b.addEventListener("click",function(){actualizarEntrega(b.dataset.delivery,b.dataset.kind)});
    });
    document.querySelectorAll("[data-od]").forEach(function(b){
      b.addEventListener("click",function(){eliminarPedido(b.dataset.od)});
    });
    if(paymentView){
      var cp=function(){return metodos().map(function(x){return Object.assign({},x)})};
      $("madd").addEventListener("click",function(){openMetodo(-1)});
      document.querySelectorAll("[data-me]").forEach(function(b){b.addEventListener("click",function(){openMetodo(Number(b.dataset.me))})});
      document.querySelectorAll("[data-mt]").forEach(function(b){b.addEventListener("click",function(){var l=cp(),x=l[Number(b.dataset.mt)];x.activo=x.activo===false;svm(l)})});
      document.querySelectorAll("[data-mv]").forEach(function(b){b.addEventListener("click",function(){var l=cp(),i=Number(b.dataset.i),j=i+Number(b.dataset.mv);if(j<0||j>=l.length)return;var t=l[i];l[i]=l[j];l[j]=t;svm(l)})});
      document.querySelectorAll("[data-md]").forEach(function(b){b.addEventListener("click",function(){var i=Number(b.dataset.md);if(pdel!=="m"+i){pdel="m"+i;renderAdmin();return}pdel=null;var l=cp();l.splice(i,1);svm(l)})});
    }
    return;
  }
  if(atab==="customers"){
    var customersByOrder=new Map();
    orders.slice().sort(function(a,b){return b.fecha-a.fecha}).forEach(function(order){
      var key=order.tel||order.nombre||"pedido:"+order.id;
      var customer=customersByOrder.get(key);
      if(!customer){
        customer={name:order.nombre,phone:order.tel,address:"",count:0,sales:0,last:Number(order.fecha)||0,pending:0};
        customersByOrder.set(key,customer);
      }
      var address=order.direccion||{},state=estadoDe(order);
      customer.address=customer.address||order.dir||order.punto||address.street||address.pickupPoint||"";
      customer.count++;
      if(state==="Pagado"||state==="Entregado")customer.sales+=Number(order.total)||0;
      if(state==="Pendiente")customer.pending++;
    });
    var customerQuery=(adminSearch.customers||"").trim().toLowerCase();
    var customers=Array.from(customersByOrder.values()).filter(function(customer){
      return [customer.name,customer.phone,customer.address].join(" ").toLowerCase().includes(customerQuery);
    });
    h+='<div class="admin-tools"><label class="admin-search"><span class="sr-only">Buscar clientes</span><input id="admin-customer-search" type="search" placeholder="Buscar nombre, teléfono o dirección…" value="'+esc(adminSearch.customers)+'"></label><span class="admin-result-count">'+customers.length+' clientes</span></div>';
    if(customers.length){
      h+='<div class="admin-customer-list">'+customers.map(function(customer){
        var name=customer.name||"",initial=name.trim().charAt(0).toUpperCase()||"?";
        var last=customer.last?new Date(customer.last).toLocaleDateString("es-CO"):"—";
        return '<article class="admin-customer-row"><div class="admin-customer-avatar" aria-hidden="true">'+esc(initial)+'</div>'+
          '<div class="admin-customer-info"><b>'+esc(name||"Nombre no registrado")+'</b><span>'+esc(customer.phone||"Teléfono no registrado")+'</span><small>'+esc(customer.address||"Sin dirección registrada")+'</small></div>'+
          '<div class="admin-customer-metrics"><b>'+customer.count+' pedido(s)</b><span>'+customer.pending+' pendiente(s)</span><small>Último: '+esc(last)+'</small></div><strong>'+fmt.format(customer.sales)+'<small> ventas confirmadas</small></strong></article>';
      }).join("")+'</div>';
    }else if(ordersLoading){
      h+='<div class="admin-empty" role="status">Cargando clientes desde pedidos…</div>';
    }else if(ordersErr&&!orders.length){
      h+='<div class="admin-empty" role="status">Los clientes no están disponibles mientras falla la carga de pedidos. <button class="btn sm" data-x="orders-retry">Reintentar</button></div>';
    }else{
      h+='<div class="empty" role="status" aria-live="polite"><h2>'+(orders.length?'Sin resultados':'Aún no hay clientes')+'</h2><p>'+(orders.length?'Prueba con otro criterio de búsqueda.':'Los clientes aparecerán aquí cuando existan pedidos.')+'</p></div>';
    }
    $("panel").innerHTML=adminFrame(h);
    bindAdminSearch("admin-customer-search","customers");
    return;
  }
  if(atab==="loyalty"){renderLoyalty(h);return}
  if(atab==="security"){
    h+='<section class="admin-panel"><div class="admin-panel-head"><div><span class="admin-eyebrow">ACCESO</span><h2>Autenticación y roles</h2></div></div>'+
      (Backend.remote?'<div class="admin-security-state is-remote"><b>Inicio de sesión remoto activo</b><span>La sesión autentica al usuario. El servidor debe comprobar los permisos en cada lectura y escritura.</span></div>':'<div class="admin-security-state is-local"><b>Modo local de prueba</b><span>La clave se valida en este navegador y no ofrece control de acceso para una tienda publicada.</span></div>')+
      '<div class="admin-note"><b>Roles administrativos</b><p>El contrato disponible no incluye una API para consultar ni asignar roles. No se habilitan cambios de permisos desde el navegador. Para varios administradores, el backend debe asignar roles y validarlos en cada operación; la interfaz por sí sola no protege los datos.</p></div>'+
      '<div class="admin-note is-muted"><b>Operaciones sensibles</b><p>Pedidos, pagos, inventario y ajustes necesitan autorización del servidor. Revisa la política de acceso del backend antes de publicar cambios de roles o compartir esta URL.</p></div></section>';
    $("panel").innerHTML=adminFrame(h);return;
  }
  if(atab==="coupons"){
    if(catalogoCargando||catalogoError){
      h=catalogoCargando
        ?'<div class="admin-empty" role="status">Cargando cupones…</div>'
        :'<div class="msg err" role="alert">'+esc(catalogoError)+' <button class="btn sm" data-x="catalog-retry">Reintentar catálogo</button></div>';
      $("panel").innerHTML=adminFrame(h);
      return;
    }
    var cu=Array.isArray(cfg.cupones)?cfg.cupones.slice():[];
    h+='<div class="box" style="padding:0 0 18px;max-width:560px"><div class="two">'+
      '<label>Código<input id="k-c" placeholder="BIENVENIDO10" maxlength="40"></label>'+
      '<label>Tipo<select id="k-t"><option value="pct">Porcentaje (%)</option><option value="fijo">Valor fijo</option></select></label></div>'+
      '<label>Valor<input id="k-v" type="number" min="0" step="any"></label>'+
      '<div class="foot"><span class="err" id="kerr" role="alert"></span><button class="btn primary" id="kadd">Crear cupón</button></div></div>';
    h+=cu.length?'<div class="list">'+cu.map(function(k,i){
      return '<div class="row" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between">'+
        '<div><b>'+esc(k.codigo)+'</b><span class="tag'+(k.activo?'':' off')+'">'+(k.activo?'Activo':'Pausado')+'</span>'+
        '<div class="meta">'+(k.tipo==="pct"?esc(k.valor)+"%":fmt.format(k.valor))+" de descuento</div></div>"+
        '<div class="acts"><button class="btn sm" data-kt="'+i+'">'+(k.activo?'Pausar':'Activar')+'</button>'+
        '<button class="btn sm danger" data-kd="'+i+'">Eliminar</button></div></div>';
    }).join("")+'</div>':'<div class="empty" role="status"><h2>Aún no hay cupones</h2><p>Crea uno y tus clientes lo escriben al pagar.</p></div>';
    $("panel").innerHTML=adminFrame(h);
    var sv=function(){cfg=Object.assign({},cfg,{cupones:cu});guardarCfg();renderAdmin()};
    $("kadd").addEventListener("click",function(){
      var c=$("k-c").value.trim().toUpperCase(),v=Number($("k-v").value),t=$("k-t").value;
      if(!c||c.length>40||cu.some(function(k){return String(k.codigo).toUpperCase()===c})){
        $("kerr").textContent="Escribe un código único de hasta 40 caracteres.";
        return;
      }
      if(!Number.isFinite(v)||v<=0||(t==="pct"&&(v<1||v>100))){
        $("kerr").textContent=t==="pct"?"El porcentaje debe estar entre 1 y 100.":"El valor debe ser mayor que cero.";
        return;
      }
      cu.push({codigo:c,tipo:t,valor:v,activo:true});
      sv();
    });
    document.querySelectorAll("[data-kt]").forEach(function(b){b.addEventListener("click",function(){
      var i=Number(b.dataset.kt);
      cu[i]=Object.assign({},cu[i],{activo:!cu[i].activo});
      sv();
    })});
    document.querySelectorAll("[data-kd]").forEach(function(b){b.addEventListener("click",function(){cu.splice(Number(b.dataset.kd),1);sv()})});
    return;
  }
  if(atab==="settings"){
    h+='<div class="box" style="padding:0;max-width:560px"><label>Nombre de la tienda<input id="s-nombre"></label><label>Lema de bienvenida<input id="s-lema"></label><label>WhatsApp de contacto para tus clientes (con código de país, sin +)<input id="s-wa" inputmode="numeric"></label><div class="two"><label>Color principal<input id="s-color" type="color" style="height:42px;padding:4px"></label><label>Logo (opcional)<input id="s-logo" type="file" accept="image/*"></label></div><label class="chk"><input id="s-nologo" type="checkbox"> Quitar el logo actual</label><label>Clave de administración (solo se usa sin base de datos)<input id="s-clave"></label><label>Puntos de recogida sugeridos (uno por línea)<textarea id="s-puntos" rows="3" placeholder="Parque principal, sábados 3 pm"></textarea></label><div class="foot"><span class="meta" id="smsg"></span><button class="btn primary" id="ssave">Guardar ajustes</button></div></div>';
    $("panel").innerHTML=adminFrame(h);
     if(Backend.remote)$("s-clave").closest("label").hidden=true;
    $("s-nombre").value=cfg.nombre;$("s-wa").value=cfg.whatsapp;$("s-clave").value=cfg.claveAdmin;$("s-lema").value=cfg.lema||"";$("s-puntos").value=cfg.puntos||"";$("s-color").value=cfg.color||"#ff7a3d";newLogo=undefined;
    $("s-logo").addEventListener("change",function(){if(this.files[0])resizeImg(this.files[0],300,"image/png",function(u){newLogo=u;$("smsg").textContent="Logo listo. Guarda los ajustes."})});
    $("s-nologo").addEventListener("change",function(){if(this.checked)newLogo=""});
    $("ssave").addEventListener("click",function(){
       var wa=$("s-wa").value.replace(/\D/g,""),cl=$("s-clave").value.trim();
       if(!$("s-nombre").value.trim()||wa.length<8||(!Backend.remote&&!cl)){$("smsg").textContent="Revisa nombre, WhatsApp"+(!Backend.remote?" y clave.":".");return}
       var cambios={nombre:$("s-nombre").value.trim(),whatsapp:wa,lema:$("s-lema").value.trim(),puntos:$("s-puntos").value.trim(),color:$("s-color").value,logo:newLogo===undefined?cfg.logo:newLogo};
       if(!Backend.remote)cambios.claveAdmin=cl;
       cfg=Object.assign({},cfg,cambios);
      guardarCfg();applyTheme();renderTop();$("smsg").textContent="Guardado.";
    });
    return;
  }
  if(atab==="backup"){
    h+='<div class="box" style="padding:0"><p class="meta">Tus productos se guardan solo en este navegador. Para que los vea todo el mundo, copia este respaldo y pégalo en <b>DATOS_INICIALES</b> dentro del archivo (reemplazando las llaves vacías). Incluye tus productos y tus ajustes. También puedes pegar un respaldo aquí para restaurarlo.</p><label class="sr-only" for="bk">Datos de respaldo de productos y ajustes</label><textarea id="bk" rows="10" spellcheck="false">'+esc(JSON.stringify({config:(function(){var c=Object.assign({},cfg);delete c.claveAdmin;return c})(),productos:items}))+'</textarea><div class="foot"><button class="btn" id="bkcopy">Copiar respaldo</button><button class="btn primary" id="bkload">Restaurar desde el texto</button></div><div class="meta" id="bkmsg"></div></div>';
    $("panel").innerHTML=adminFrame(h);
    $("bkcopy").addEventListener("click",function(){$("bk").select();try{document.execCommand("copy");$("bkmsg").textContent="Copiado."}catch(e){$("bkmsg").textContent="Selecciona el texto y cópialo."}});
    $("bkload").addEventListener("click",function(){try{var d=JSON.parse($("bk").value);var pr=Array.isArray(d)?d:d.productos;if(!Array.isArray(pr))throw 0;items=pr.map(limpiarProducto);if(d.config&&typeof d.config==="object"){var dc=Object.assign({},d.config);delete dc.supabase;delete dc.claveAdmin;cfg=Object.assign({},cfg,dc);guardarCfg()}persist();$("bkmsg").textContent="Restaurado: "+pr.length+" productos.";renderAdmin()}catch(e){$("bkmsg").textContent="El texto no es un respaldo válido."}});
    return;
  }
  $("panel").innerHTML=adminFrame(h);
}

function openForm(p){
  editing=p||null;img=p&&p.image||"";
  var cats=[...new Set(items.map(function(x){return x.category}).filter(Boolean))];
  var digital=p&&p.digital||{},specs=p&&p.specifications||[];
  $("dbox").innerHTML=
    '<h2>'+(p?"Editar producto":"Nuevo producto")+'</h2>'+
    '<label>Tipo de producto<select id="f-tipo"><option value="fisico">Físico (se envía)</option><option value="virtual">Digital (recarga, código o servicio)</option></select></label>'+
    '<label>Nombre<input id="f-name" maxlength="80"></label>'+
    '<label>Descripción<textarea id="f-desc" rows="3" maxlength="500"></textarea></label>'+
    '<div class="two"><label>Marca<input id="f-brand" maxlength="60"></label><label>SKU único<input id="f-sku" maxlength="40" autocomplete="off"></label></div>'+
    '<div class="two"><label>Precio<input id="f-price" type="number" min="0" step="100"></label><label>Unidad<input id="f-unit" maxlength="30" placeholder="unidad, paquete..."></label></div>'+
    '<label>Especificaciones públicas (una por línea: nombre: valor)<textarea id="f-specs" rows="3" maxlength="2400"></textarea></label>'+
    '<div class="two"><label>Stock disponible<input id="f-stock" type="number" min="0" step="1"></label><p class="meta">SKU identifica el producto. Variantes con precio o stock propio esperan el contrato backend.</p></div>'+
    '<div id="f-vbox" class="f" style="display:none">'+
      '<p class="meta" style="margin:0">Pide solo los datos de jugador configurados. Nunca solicites contraseñas ni códigos de acceso.</p>'+
      '<div class="two"><label>Juego<input id="f-game" maxlength="80" placeholder="Ej.: Free Fire"></label><label>Paquete o cantidad<input id="f-valorDigital" maxlength="120" placeholder="Ej.: 500 diamantes"></label></div>'+
      '<div class="two"><label>Etiqueta para ID<input id="f-player-label" maxlength="60"></label><label>Validación de ID<select id="f-player-rule"><option value="text">Texto sin patrón especial</option><option value="digits">Solo números</option><option value="digits_6_15">Entre 6 y 15 números</option><option value="alphanumeric">Letras, números, guion y guion bajo</option></select></label></div>'+
      '<div class="two"><label>Etiqueta para nombre visible<input id="f-display-label" maxlength="60"></label><label>Servidor/región<select id="f-server-mode"><option value="none">No solicitar</option><option value="optional">Opcional</option><option value="required">Obligatorio</option></select></label></div>'+
      '<label>Etiqueta del servidor/región<input id="f-server-label" maxlength="60"></label>'+
      '<label>Tiempo estimado de entrega (solo si está confirmado)<input id="f-tiempoDigital" maxlength="100"></label>'+
      '<label class="chk"><input id="f-ilim" type="checkbox"> Stock ilimitado</label>'+
    '</div>'+
    '<label>Categoría<input id="f-cat" list="cl" maxlength="40"><datalist id="cl">'+cats.map(function(c){return '<option value="'+esc(c)+'">'}).join("")+'</datalist></label>'+
    '<div id="f-physicalbox" class="f"><label>Envío y entrega<textarea id="f-envio" rows="2" maxlength="200" placeholder="Instrucciones confirmadas; las tarifas aún dependen del backend"></textarea></label><label>Garantía y condiciones (si aplica)<textarea id="f-garantia" rows="2" maxlength="200"></textarea></label></div>'+
    '<div class="imgrow"><img class="thumb" id="f-thumb" alt=""><div><label for="f-file">Foto del producto (opcional)</label><input id="f-file" type="file" accept="image/*"><div class="meta" id="f-imsg" role="status" aria-live="polite"></div></div></div>'+
    '<div class="two"><label class="chk"><input id="f-offer" type="checkbox"> Producto en oferta</label><label>Precio de oferta<input id="f-op" type="number" min="0" step="100"></label></div>'+
    '<label class="chk"><input id="f-active" type="checkbox"> Visible en la tienda</label>'+
    '<div class="err" id="ferr" role="alert" aria-live="assertive"></div><div class="foot"><button class="btn" data-x="close">Cancelar</button><button class="btn primary" data-x="save">Guardar</button></div>';
  $("f-name").value=p?p.name:"";$("f-desc").value=p?p.description:"";$("f-brand").value=p?p.brand||"":"";$("f-sku").value=p?p.sku||"":"";
  $("f-unit").value=p?p.unit||"unidad":"unidad";$("f-specs").value=specs.map(function(x){return x.name+": "+x.value}).join("\n");
  $("f-price").value=p?p.price:"";$("f-stock").value=p?p.stock:"";$("f-cat").value=p?p.category:"";
  $("f-envio").value=p?p.envio||"":"";$("f-garantia").value=p?p.garantia||"":"";$("f-offer").checked=!!(p&&p.offer);$("f-op").value=p&&p.offerPrice?p.offerPrice:"";$("f-active").checked=p?p.active:true;
  $("f-tipo").value=p&&p.tipo||"fisico";$("f-valorDigital").value=p?p.valorDigital||digital.packageLabel||"":"";$("f-tiempoDigital").value=p?p.tiempoDigital||"":"";$("f-ilim").checked=p?!!p.ilimitado:true;
  $("f-game").value=digital.game||"";$("f-player-label").value=digital.playerIdLabel||"ID del jugador o cuenta";$("f-player-rule").value=digital.playerIdValidation||"text";
  $("f-display-label").value=digital.displayNameLabel||"Nombre visible de la cuenta";$("f-server-mode").value=digital.serverMode||"none";$("f-server-label").value=digital.serverLabel||"Servidor o región";
  var tu=function(){var v=$("f-tipo").value==="virtual";$("f-vbox").style.display=v?"grid":"none";$("f-physicalbox").style.display=v?"none":"grid";$("f-stock").disabled=v&&$("f-ilim").checked;$("f-name").placeholder=v?"Ej.: paquete de diamantes":""};
  $("f-tipo").addEventListener("change",tu);$("f-ilim").addEventListener("change",tu);tu();
  $("f-thumb").src=img;$("f-thumb").style.visibility=img?"visible":"hidden";
  $("f-file").addEventListener("change",function(){
    var f=this.files[0];if(!f)return;$("f-imsg").textContent="Procesando imagen…";
    var r=new FileReader();r.onload=function(){var im=new Image();im.onload=function(){
      var s=Math.min(1,700/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);
      c.getContext("2d").drawImage(im,0,0,c.width,c.height);img=c.toDataURL("image/jpeg",0.78);
      $("f-thumb").src=img;$("f-thumb").style.visibility="visible";$("f-imsg").textContent="Imagen lista.";
    };im.onerror=function(){$("f-imsg").textContent="No se pudo leer la imagen."};im.src=r.result};r.readAsDataURL(f);
  });
  $("dlg").showModal();
}
function saveForm(){
  var name=$("f-name").value.trim(),price=Number($("f-price").value),off=$("f-offer").checked,op=Number($("f-op").value)||0;
  var sku=$("f-sku").value.trim(),specText=$("f-specs").value.trim(),specifications=[];
  if(!name){$("ferr").textContent="Escribe el nombre del producto.";$("f-name").focus();return}
  if(!(price>0)){$("ferr").textContent="Escribe un precio mayor a 0.";$("f-price").focus();return}
  if(off&&!(op>0&&op<price)){$("ferr").textContent="El precio de oferta debe ser menor al precio normal.";$("f-op").focus();return}
  if(sku&&items.some(function(x){return x.id!==(editing&&editing.id)&&String(x.sku||"").toLowerCase()===sku.toLowerCase()})){$("ferr").textContent="Ese SKU ya identifica otro producto.";$("f-sku").focus();return}
  if(specText){
    var invalidSpec=false;
    specText.split(/\r?\n/).forEach(function(line){var i=line.indexOf(":");if(i<1){invalidSpec=true;return}var key=line.slice(0,i).trim(),value=line.slice(i+1).trim();if(key&&value)specifications.push({name:key,value:value})});
    if(invalidSpec){$("ferr").textContent="Cada especificación debe tener el formato nombre: valor.";$("f-specs").focus();return}
  }
  var virtual=$("f-tipo").value==="virtual",serverMode=$("f-server-mode").value;
  var digitalFields=virtual?[
    {key:"playerId",label:$("f-player-label").value.trim()||"ID del jugador o cuenta",required:true,validation:$("f-player-rule").value,maxLength:80},
    {key:"displayName",label:$("f-display-label").value.trim()||"Nombre visible de la cuenta",required:true,validation:"text",maxLength:80}
  ]:[];
  if(virtual&&serverMode!=="none")digitalFields.push({key:"server",label:$("f-server-label").value.trim()||"Servidor o región",required:serverMode==="required",validation:"text",maxLength:60});
  var d={id:editing?editing.id:uid(),schemaVersion:2,name:name,description:$("f-desc").value.trim(),brand:$("f-brand").value.trim(),sku:sku,unit:$("f-unit").value.trim()||"unidad",specifications:specifications,variants:editing?editing.variants||[]:[],price:price,stock:Number($("f-stock").value)||0,tipo:virtual?"virtual":"fisico",envio:!virtual?$("f-envio").value.trim():"",garantia:!virtual?$("f-garantia").value.trim():"",valorDigital:virtual?$("f-valorDigital").value.trim():"",tiempoDigital:virtual?$("f-tiempoDigital").value.trim():"",ilimitado:virtual&&$("f-ilim").checked,digital:virtual?{game:$("f-game").value.trim(),packageLabel:$("f-valorDigital").value.trim(),playerIdLabel:digitalFields[0].label,playerIdValidation:digitalFields[0].validation,displayNameLabel:digitalFields[1].label,serverMode:serverMode,serverLabel:serverMode==="none"?"":digitalFields[2]&&digitalFields[2].label||"Servidor o región",fields:digitalFields}:null,category:$("f-cat").value.trim(),offer:off,offerPrice:off?op:0,active:$("f-active").checked,image:img,createdAt:editing?editing.createdAt:Date.now()};
  d=limpiarProducto(d);
  if(editing)items[items.indexOf(editing)]=d;else items.push(d);
  persist();$("dlg").close();refresh();
}
function askPin(){
  if(!Backend.remote&&!enLocal){
    $("dbox").innerHTML='<h2>Administración desactivada</h2><p>La conexión remota está desactivada en esta versión. Habilítala expresamente para iniciar sesión.</p><div class="foot"><button class="btn" data-x="close">Cerrar</button></div>';
    $("dlg").showModal();
    return;
  }
  var rem=Backend.remote;
  var h='<h2>'+esc(T("login.titulo"))+'</h2><div class="f">';
  if(rem){
    h+='<div class="form-field" id="grp-ml">' +
      '<label class="field-label" for="ml">'+esc(T("login.correo"))+' *</label>' +
      '<div class="input-wrap">' +
        '<input id="ml" type="email" autocomplete="username" placeholder="admin@tutienda.com">' +
        '<span class="field-icon" aria-hidden="true"></span>' +
      '</div>' +
      '<div class="field-msg"></div>' +
    '</div>' +
    '<div class="form-field" id="grp-pin">' +
      '<label class="field-label" for="pin">'+esc(T("login.contrasena"))+' *</label>' +
      '<div class="input-wrap">' +
        '<input id="pin" type="password" autocomplete="current-password" placeholder="Tu contraseña de administrador">' +
        '<span class="field-icon" aria-hidden="true"></span>' +
      '</div>' +
      '<div class="field-msg"></div>' +
    '</div>';
  } else {
    h+='<div class="form-field" id="grp-pin">' +
      '<label class="field-label" for="pin">'+esc(T("login.clave"))+' *</label>' +
      '<div class="input-wrap">' +
        '<input id="pin" type="password" autocomplete="current-password" placeholder="Clave local de acceso">' +
        '<span class="field-icon" aria-hidden="true"></span>' +
      '</div>' +
      '<div class="field-msg"></div>' +
    '</div>';
  }
  h+='</div><div class="err" id="perr"></div>' +
    '<div class="foot">' +
      '<button class="btn" data-x="close">'+esc(T("login.cancelar"))+'</button>' +
      '<button class="btn primary" data-x="pin">'+esc(T("login.entrar"))+'</button>' +
    '</div>';
  $("dbox").innerHTML=h;
  $("dlg").showModal();

  var mlEl=$("ml"), pinEl=$("pin");
  var emailRegex=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if(mlEl){
    var valMl=function(){
      var v=mlEl.value.trim();
      if(!v) setFieldValidation(mlEl, false, "Ingresa tu correo electrónico");
      else if(!emailRegex.test(v)) setFieldValidation(mlEl, false, "Correo electrónico no válido");
      else setFieldValidation(mlEl, true, "", "Correo válido");
    };
    mlEl.addEventListener("input", valMl);
    mlEl.addEventListener("blur", valMl);
  }

  if(pinEl){
    var valPin=function(){
      var v=pinEl.value;
      if(!v) setFieldValidation(pinEl, false, rem ? "Ingresa tu contraseña" : "Ingresa la clave");
      else if(rem && v.length < 6) setFieldValidation(pinEl, false, "Mínimo 6 caracteres");
      else setFieldValidation(pinEl, true, "", rem ? "Contraseña lista" : "Clave lista");
    };
    pinEl.addEventListener("input", valPin);
    pinEl.addEventListener("blur", valPin);
    pinEl.addEventListener("keydown", function(e){ if(e.key==="Enter") checkPin(); });
  }

  (rem ? mlEl : pinEl).focus();
}
function checkPin(){
  var entrar=function(){authed=true;$("dlg").close();renderAll();(REMOTO?cargarCatalogoAdmin():Promise.resolve()).then(cargarPedidos).catch(function(e){ordersErr=String(e&&e.message||e);renderAdmin()})};
  if(Backend.remote){
    var m=$("ml")?$("ml").value.trim():"", p=$("pin")?$("pin").value:"";
    if(!m || !p){
      $("perr").textContent="Por favor completa el correo y la contraseña.";
      return;
    }
    $("perr").textContent=T("login.entrando");
    Backend.login(m,p).then(entrar).catch(function(e){
      $("perr").textContent=e.message;
      if($("pin")) setFieldValidation($("pin"), false, "Credenciales incorrectas");
    });
  } else if(enLocal&&cfg.claveAdmin&&$("pin").value===cfg.claveAdmin){
    entrar();
  } else {
    $("perr").textContent=T("login.claveMala");
    if($("pin")) setFieldValidation($("pin"), false, "Clave incorrecta");
  }
}
function cargarPedidos(){ordersErr="";ordersLoading=true;renderAdmin();return Backend.listar().then(function(l){orders=l;ordersErr="";ordersLoading=false;renderAdmin()}).catch(function(e){ordersErr=(e&&e.message)||"No se pudieron cargar los pedidos.";ordersLoading=false;renderAdmin()})}
function adminAddressSummary(o){
  var a=o.direccion||{};
  if(a.method==="pickup")return a.pickupPoint?"Recoger en: "+esc(a.pickupPoint):"";
  var parts=[a.street||o.dir,a.zone,a.city,a.department,a.reference].filter(Boolean).map(esc);
  return parts.length?"Domicilio: "+parts.join(" · "):"";
}
function adminDigitalDataHtml(o){
  var rows=(o.items||[]).filter(function(item){return item.v&&item.digitalData&&Object.keys(item.digitalData).length});
  if(!rows.length)return "";
  var labels={playerId:"ID del jugador o cuenta",displayName:"Nombre visible",region:"Región",server:"Servidor"};
  return '<details class="admin-history"><summary>Datos privados para la entrega digital ('+rows.length+')</summary><p class="meta">Usa estos datos solo para cumplir el pedido después de verificar el pago.</p>'+rows.map(function(item){return '<div class="admin-digital-data"><b>'+esc(item.n)+'</b><ul>'+Object.keys(item.digitalData).map(function(key){return '<li>'+esc(labels[key]||key)+': <b>'+esc(item.digitalData[key])+'</b></li>'}).join("")+'</ul></div>'}).join("")+'</details>';
}
function orderRow(o){
  var its=Array.isArray(o.items)?o.items:[];
  var e=estadoDe(o),solo=its.length>0&&its.every(function(i){return i.v}),b="",kind=getAdminOrderType(o),hist=adminHistory(o);
  var ent=adminAddressSummary(o);
  if(e==="Pendiente"&&!Backend.secureCheckout)b+='<button class="btn sm primary" data-oa="pagado" data-id="'+esc(o.id)+'" title="Revisa evidencia o confirma la recepción antes de marcarlo">Registrar pago verificado</button>';
  if(e==="Pagado"&&!Backend.secureCheckout)b+='<button class="btn sm primary" data-oa="entregado" data-id="'+esc(o.id)+'">'+(solo?"Marcar recargado":"Marcar entregado")+'</button>';
  var paymentStatus=String(o.pagoRegistro&&o.pagoRegistro.estado||"").toLowerCase();
  var pagoActivo=paymentStatus==="pendiente"||paymentStatus==="en_revision"||paymentStatus==="verificado"||paymentStatus==="reembolsado";
  if(Backend.secureCheckout&&e==="Pendiente"&&!o.pagoRegistro)b+='<button class="btn sm primary" data-register-payment="'+esc(o.id)+'">Registrar pago para revisión</button>';
  if((!Backend.secureCheckout&&(e==="Pendiente"||e==="Pagado"))||(Backend.secureCheckout&&e==="Pendiente"&&!pagoActivo))b+='<button class="btn sm danger" data-oa="cancelar" data-id="'+esc(o.id)+'">Cancelar pedido</button>';
  b+='<button class="btn sm danger" data-od="'+esc(o.id)+'">'+(pdel==="o"+o.id?"Confirmar":"Eliminar")+'</button>';
  var history=hist.length?'<details class="admin-history"><summary>Historial ('+hist.length+')</summary><ol>'+hist.slice().sort(function(a,b){return a.fecha-b.fecha}).map(function(x){return '<li><b>'+esc(x.de?x.de+" → "+x.a:"Pedido recibido · "+x.a)+'</b><small>'+esc(new Date(x.fecha).toLocaleString("es-CO"))+'</small></li>'}).join("")+'</ol></details>':'<p class="meta">No hay historial de cambios disponible para este pedido.</p>';
  return '<article class="admin-order-card"><div class="admin-order-head"><div><b>'+esc(o.nombre||"Cliente")+'</b> <span class="meta">'+esc(o.tel||"Sin teléfono")+' · '+new Date(o.fecha).toLocaleString("es-CO")+' · #'+esc(String(o.id).slice(-6).toUpperCase())+'</span></div><span class="tag'+(e==="Pendiente"?" off":"")+' st-'+e.toLowerCase()+'">'+esc(e)+'</span></div><span class="product-type '+(kind==="digital"?"is-digital":"is-physical")+'">'+esc(adminOrderTypeLabel(o))+'</span>'+
    reciboTabla(o)+(ent?'<div class="meta">'+ent+'</div>':'')+
    (o.idJuego?'<div class="meta">ID de Free Fire para puntos: <b>'+esc(o.idJuego)+'</b></div>':'')+
    (o.cuenta?'<div class="cuenta">Cuenta a recargar — ID: <b>'+esc(o.cuenta.id)+'</b> • Nombre: <b>'+esc(o.cuenta.nombre)+'</b></div>':'')+
    adminDigitalDataHtml(o)+'<div class="meta">'+esc(o.pago||"Pago")+(o.referencia?' · Ref: '+esc(o.referencia):'')+(o.cupon?' · Cupón '+esc(o.cupon):'')+' · <b>'+fmt.format(Number(o.total)||0)+'</b></div>'+adminPagoHtml(o)+
    (!o.pagoRegistro&&safeImg(o.comprobante)?'<img class="comp" src="'+safeImg(o.comprobante)+'" alt="Comprobante de pago" title="Clic para ampliar">':'')+
    adminEntregasHtml(o)+history+'<div class="acts" style="flex-wrap:wrap">'+b+'</div></article>';
}
function eliminarPedido(id){
  var pedido=orders.find(function(o){return String(o.id)===String(id)});
  if(!pedido)return;
  if(pdel!=="o"+id){pdel="o"+id;renderAdmin();return}
  pdel=null;
  Backend.eliminar(pedido.id).then(cargarPedidos).catch(function(e){
    ordersErr="No se pudo eliminar el pedido: "+e.message;
    renderAdmin();
  });
}
function cambiarEstado(id,acc){
  var o=orders.find(function(x){return x.id===id});if(!o)return;
  var nuevo={pagado:"Pagado",entregado:"Entregado",cancelar:"Cancelado"}[acc],copia=Object.assign({},o,{estado:nuevo}),mover=0;
  if(!nuevo||nuevo===o.estado)return;
  if(Backend.secureCheckout){
    if(acc!=="cancelar"){ordersErr="En el modo seguro, los pagos se confirman desde Pagos y las entregas desde cada producto.";renderAdmin();return}
    if(!window.confirm("¿Confirmas cancelar este pedido? Si ya tiene pagos verificados, primero se debe registrar y verificar su reintegro."))return;
    Backend.cambiarEstadoPedido(id,"Cancelado","otro").then(cargarPedidos).catch(function(e){ordersErr="No se pudo cancelar el pedido: "+e.message;renderAdmin()});
    return;
  }
  if(acc==="pagado"&&!window.confirm("Confirma solo después de revisar el comprobante o verificar que el pago fue recibido. ¿Marcar este pago como verificado?"))return;
  copia.historial=(Array.isArray(o.historial)?o.historial.slice(-49):[]).concat([{de:o.estado,a:nuevo,fecha:Date.now()}]);
  if(acc==="pagado"&&!o.desc){copia.desc=true;mover=-1}
  if(acc==="cancelar"&&o.desc){copia.desc=false;mover=1}
  Backend.actualizar(copia).then(function(){
    Object.assign(o,copia);
    if(mover)o.items.forEach(function(i){var p=items.find(function(x){return x.id===i.id});if(p&&!ilim(p))p.stock=Math.max(0,(p.stock||0)+mover*i.q)});
    if(mover)persist();ordersErr="";refresh();
  }).catch(function(e){ordersErr="No se pudo actualizar el pedido: "+e.message;renderAdmin()});
}

function openOrder(){
  if(!items.length){alert("Primero agrega productos.");return}
  $("dbox").innerHTML='<h2>Registrar pedido</h2><div class="two"><label>Nombre<input id="o-n"></label><label>Celular<input id="o-t" inputmode="tel"></label></div><label>Dirección<input id="o-d"></label><label>Forma de pago<select id="o-p"><option>Pago contra entrega</option><option>Nequi</option><option>Transferencia bancaria</option><option>Otro</option></select></label><div class="meta">Productos (cantidad)</div>'+items.map(function(p){return '<div class="line"><span class="n">'+esc(p.name)+' <span class="meta">'+fmt.format(eff(p))+'</span></span><input type="number" min="0" value="0" aria-label="Cantidad de '+esc(p.name)+'" data-oq="'+p.id+'" style="width:80px"></div>'}).join("")+(Backend.secureCheckout?'<div class="admin-note is-muted">El stock se descuenta desde el servidor cuando el pedido queda completamente pagado.</div>':'<label class="chk"><input id="o-s" type="checkbox" checked> Descontar del inventario</label>')+'<div class="err" id="oerr"></div><div class="foot"><button class="btn" data-x="close">Cancelar</button><button class="btn primary" data-x="osave">Guardar pedido</button></div>';
  $("dlg").showModal();
}
function saveOrder(){
  var n=$("o-n").value.trim(),its=[],tot=0;
  var descontar=!Backend.secureCheckout&&$("o-s").checked;
  document.querySelectorAll("[data-oq]").forEach(function(i){var q=Number(i.value)||0;if(q>0){var p=items.find(function(x){return x.id===i.dataset.oq});its.push({id:p.id,n:p.name,q:q,pr:eff(p)});tot+=q*eff(p)}});
  if(!n||!its.length){$("oerr").textContent="Escribe el nombre del cliente y elige al menos un producto.";return}
  if(descontar){its.forEach(function(i){var p=items.find(function(x){return x.id===i.id});if(!ilim(p))p.stock=Math.max(0,(p.stock||0)-i.q)});persist()}
  var fechaPedido=Date.now();
  var no={id:uid(),fecha:fechaPedido,historial:[{de:"",a:"Pendiente",fecha:fechaPedido}],nombre:n,tel:$("o-t").value.trim(),dir:$("o-d").value.trim(),pago:$("o-p").value,estado:"Pendiente",total:tot,items:its,desc:descontar};
  Backend.crear(no).then(function(){$("dlg").close();cargarPedidos().then(renderStore)}).catch(function(e){$("oerr").textContent="No se pudo guardar: "+e.message});
}

/* ---------- Métodos de pago ---------- */
var mQr="",mIdx=-1;
function svm(ms){cfg=Object.assign({},cfg,{metodos:ms});guardarCfg();renderAdmin()}
function openMetodo(i){
  var m=i>=0?metodos()[i]:{nombre:"",tipo:"transfer",activo:true};mIdx=i;mQr=m.qr||"";
  $("dbox").innerHTML='<h2>'+(i>=0?"Editar método de pago":"Nuevo método de pago")+'</h2><label>Nombre<input id="m-nombre" placeholder="Ej: Nequi, Daviplata, Bancolombia"></label><label>Tipo<select id="m-tipo"><option value="transfer">Billetera o cuenta (Nequi, Daviplata, banco)</option><option value="link">Enlace de pago en línea (tarjeta, PSE)</option><option value="efectivo">Contra entrega (efectivo)</option></select></label><div id="m-t" class="f"><label>Número o cuenta<input id="m-cuenta" placeholder="Ej: 300 000 0000"></label><label>A nombre de (opcional)<input id="m-titular"></label><label>Código QR (opcional)<input id="m-qrf" type="file" accept="image/*"></label><div class="meta" id="m-qrm"></div></div><div id="m-l" class="f"><label>Enlace de pago (empieza con https://)<input id="m-enlace" placeholder="https://..."></label></div><label>Instrucciones para el cliente<textarea id="m-instr" rows="2"></textarea></label><label class="chk"><input id="m-activo" type="checkbox"> Activo</label><div class="err" id="merr"></div><div class="foot"><button class="btn" data-x="close">Cancelar</button><button class="btn primary" data-x="msave">Guardar</button></div>';
  $("m-nombre").value=m.nombre||"";$("m-tipo").value=m.tipo;$("m-cuenta").value=m.cuenta||"";$("m-titular").value=m.titular||"";$("m-enlace").value=m.enlace||"";$("m-instr").value=m.instr||"";$("m-activo").checked=m.activo!==false;
  $("m-qrm").textContent=mQr?"QR cargado. Sube otro para reemplazarlo.":"";
  var tu=function(){var t=$("m-tipo").value;$("m-t").style.display=t==="transfer"?"grid":"none";$("m-l").style.display=t==="link"?"grid":"none"};
  $("m-tipo").addEventListener("change",tu);tu();
  $("m-qrf").addEventListener("change",function(){if(this.files[0])resizeImg(this.files[0],500,"image/png",function(u){mQr=u;$("m-qrm").textContent="QR listo."})});
  $("dlg").showModal();
}
function saveMetodo(){
  var t=$("m-tipo").value,n=$("m-nombre").value.trim(),cu=$("m-cuenta").value.trim(),en=$("m-enlace").value.trim();
  if(!n){$("merr").textContent="Escribe el nombre del método.";return}
  if(t==="transfer"&&!cu&&!mQr){$("merr").textContent="Escribe el número o cuenta, o sube un código QR.";return}
  if(t==="link"&&!/^https:\/\//i.test(en)){$("merr").textContent="El enlace debe empezar con https://";return}
  var ms=metodos().map(function(x){return Object.assign({},x)});
  var m={id:mIdx>=0?ms[mIdx].id:uid(),nombre:n,tipo:t,activo:$("m-activo").checked,cuenta:t==="transfer"?cu:"",titular:t==="transfer"?$("m-titular").value.trim():"",qr:t==="transfer"?mQr:"",enlace:t==="link"?en:"",instr:$("m-instr").value.trim()};
  if(mIdx>=0)ms[mIdx]=m;else ms.push(m);
  $("dlg").close();svm(ms);
}

/* ---------- Puntos y recompensas (administración) ----------
   Los saldos nuevos pertenecen a UID autenticados; el cliente no puede asignarlos. */
var TIPOS_PREMIO=[["puntos","Puntos extra"],["pct","% de descuento (cupón)"],["fijo","Descuento fijo $ (cupón)"],["manual","Diamantes / premio digital (requiere ID)"],["nada","Sin premio"]];
var LOY=null;
function loyIni(){
  var P=cfg.pts||{};
  LOY={activa:P.activa===true,cada:P.cada==null?2000:(Number(P.cada)||0),porCompra:Number(P.por_compra)||0,bienvenida:Number(P.bienvenida)||0,obj:Number(P.objetivo)||50,ruleta:[],premios:[],canjes:[],clientes:[],giros:[],borrados:[],msg:"",msgR:"",msgP:"",msgC:"",cargando:true};
}
function loyLeer(){
  if(!LOY||!$("l-cada"))return;
  LOY.activa=$("l-activa").checked;LOY.cada=Number($("l-cada").value)||0;LOY.porCompra=Number($("l-compra").value)||0;LOY.bienvenida=Number($("l-bienvenida").value)||0;LOY.obj=Number($("l-obj").value)||0;
  document.querySelectorAll("[data-lr]").forEach(function(tr){var p=LOY.ruleta[Number(tr.dataset.lr)];if(!p)return;
    p.nombre=tr.querySelector(".l-n").value.trim();p.tipo=tr.querySelector(".l-t").value;p.valor=tr.querySelector(".l-v").value.trim();
    p.peso=tr.querySelector(".l-p").value.trim();p.stock=tr.querySelector(".l-s").value.trim();p.vence=tr.querySelector(".l-vence").value.trim();p.minimo=tr.querySelector(".l-minimo").value.trim();p.activo=tr.querySelector(".l-a").checked});
  document.querySelectorAll("[data-lp]").forEach(function(tr){var p=LOY.premios[Number(tr.dataset.lp)];if(!p)return;
    p.nombre=tr.querySelector(".p-n").value.trim();p.descripcion=tr.querySelector(".p-d").value.trim();p.costo=tr.querySelector(".p-c").value.trim();
    p.stock=tr.querySelector(".p-s").value.trim();p.activo=tr.querySelector(".p-a").checked});
}
function cargarLoy(){
  Promise.all([Backend.ruletaAdmin(),Backend.premiosCanje(),Backend.canjesAdmin(),Backend.clientesPuntos(),Backend.girosAdmin()])
    .then(function(r){
      LOY.ruleta=(r[0]||[]).map(function(x){return{id:x.id,nombre:x.nombre||"",descripcion:x.descripcion||"",tipo:x.tipo||"nada",valor:x.valor==null?"":String(x.valor),peso:String(x.peso==null?0:x.peso),stock:x.stock==null?"":String(x.stock),vence:String(x.vence_dias==null?30:x.vence_dias),minimo:String(x.compra_minima==null?20000:x.compra_minima),activo:x.activo!==false}});
      LOY.premios=(r[1]||[]).map(function(x){return{id:x.id,nombre:x.nombre||"",descripcion:x.descripcion||"",costo:String(x.costo_puntos==null?"":x.costo_puntos),stock:x.stock==null?"":String(x.stock),activo:x.activo!==false}});
      LOY.canjes=r[2]||[];LOY.clientes=r[3]||[];LOY.giros=r[4]||[];LOY.borrados=[];LOY.cargando=false;renderAdmin()})
    .catch(function(e){LOY.cargando=false;LOY.msg="No se pudieron leer los datos: "+e.message+" (¿ejecutaste scripts/supabase/18_puntos_clientes_auth.sql?)";renderAdmin()});
}
function loySuma(){return LOY.ruleta.reduce(function(a,p){var n=Math.floor(Number(p.peso));return a+(p.activo&&n>0?n:0)},0)}
function adminRuletaPremioHtml(p,i){return '<div class="row" data-lr="'+i+'" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:6px;align-items:center"><input class="l-n" aria-label="Nombre del premio" maxlength="60" placeholder="Nombre" value="'+esc(p.nombre)+'"><select class="l-t" aria-label="Tipo del premio">'+TIPOS_PREMIO.map(function(t){return '<option value="'+t[0]+'"'+(p.tipo===t[0]?' selected':'')+'>'+t[1]+'</option>'}).join("")+'</select><input class="l-v" aria-label="Valor del premio" placeholder="Valor" '+(p.tipo==="nada"?"disabled ":"")+'value="'+esc(p.tipo==="nada"?"":p.valor)+'"><input class="l-p" aria-label="Probabilidad del premio en porcentaje" type="number" min="0" max="100" step="1" placeholder="Probabilidad %" value="'+esc(p.peso)+'"><input class="l-s" aria-label="Stock" type="number" min="0" step="1" placeholder="Stock" title="Vacio = ilimitado" value="'+esc(p.stock)+'"><input class="l-vence" aria-label="Vigencia del cupon en dias" type="number" min="1" max="365" step="1" placeholder="Dias de vigencia" value="'+esc(p.vence||30)+'"><input class="l-minimo" aria-label="Compra minima del cupon en COP" type="number" min="0" step="1000" placeholder="Compra minima COP" value="'+esc(p.minimo==null?20000:p.minimo)+'"><label class="meta" style="white-space:nowrap"><input class="l-a" type="checkbox"'+(p.activo?' checked':'')+'> activo</label><button class="btn sm danger" data-lx="'+i+'" aria-label="Quitar premio">Quitar</button></div>'}
function renderLoyalty(h){
  if(!Backend.remote){$("panel").innerHTML=adminFrame(h+'<div class="msg">Los puntos y la ruleta necesitan la base de datos. Sigue TUTORIAL_BASE_DE_DATOS.md.</div>');return}
  if(!LOY){loyIni();cargarLoy()}
  var suma=loySuma(),ok100=suma===100,fecha=function(t){var d=new Date(t);return isNaN(d.getTime())?"":d.toLocaleString("es-CO")};
  h+='<div class="box" style="padding:0;max-width:900px"><p class="meta">El saldo y el historial se asocian al UID autenticado de Supabase. El ID de Free Fire no es una credencial. Los pedidos invitados no generan puntos; las compras de una cuenta los generan al confirmar el pago. Los saldos antiguos por ID/PIN no se reasignan automáticamente.</p>'
   +'<label class="chk"><input id="l-activa" type="checkbox"'+(LOY.activa?' checked':'')+'> Activar programa de puntos</label>'
   +'<div class="two"><label>Puntos por compra pagada<input id="l-compra" type="number" min="0" max="100000" step="1" value="'+esc(LOY.porCompra)+'"></label><label>Puntos por cada monto gastado (COP)<input id="l-cada" type="number" min="0" step="100" value="'+esc(LOY.cada)+'"></label><label>Puntos de bienvenida (una sola vez)<input id="l-bienvenida" type="number" min="0" max="100000" step="1" value="'+esc(LOY.bienvenida)+'"></label><label>Costo de cada giro de ruleta<input id="l-obj" type="number" min="1" step="1" value="'+esc(LOY.obj)+'"></label></div>'
   +'<div class="foot"><span class="meta" id="lmsg-cfg">'+esc(LOY.msg)+'</span><button class="btn primary" id="l-cfg">Guardar configuración</button></div></div>';

  h+='<div class="bar"><b>Premios de ruleta para cuentas autenticadas</b></div><div class="box" style="padding:0;max-width:900px"><p class="meta">El servidor elige y registra cada premio. Los descuentos generan un cupon personal de un uso. Los premios de diamantes piden el ID de juego y aparecen en Canjes y premios por entregar. Vigencia inicial: 30 dias. Compra minima: $20.000 COP. Ambos valores se pueden cambiar por premio.</p>'
   +(LOY.cargando?'<div class="meta">Cargando...</div>':'')
   +LOY.ruleta.map(adminRuletaPremioHtml).join("")
   +'<div class="foot"><span class="meta" id="lmsg-r" style="'+(ok100?'':'color:#e0457b;font-weight:700')+'">Suma de activos: '+suma+' %'+(ok100?' OK':' (debe ser 100)')+(LOY.msgR?' | '+esc(LOY.msgR):'')+'</span><button class="btn" id="l-norm">Ajustar a 100 %</button><button class="btn" id="l-add">Agregar premio</button><button class="btn primary" id="l-save">Guardar ruleta</button></div></div>';

  h+='<div class="bar"><b>Premios que se canjean con puntos</b></div><div class="box" style="padding:0;max-width:900px"><p class="meta">El cliente autenticado canjea desde su propia cartera. El costo y el stock se leen y validan siempre en la base de datos. Stock vacío = ilimitado.</p>'
   +LOY.premios.map(function(p,i){return'<div class="row" data-lp="'+i+'" style="display:grid;grid-template-columns:1.6fr 2fr .8fr .8fr auto auto auto;gap:6px;align-items:center"><input class="p-n" aria-label="Nombre del premio canjeable" maxlength="60" placeholder="Nombre" value="'+esc(p.nombre)+'"><input class="p-d" aria-label="Descripción del premio canjeable" maxlength="200" placeholder="Descripción" value="'+esc(p.descripcion)+'"><input class="p-c" aria-label="Costo del premio en puntos" type="number" min="1" step="1" placeholder="Puntos" value="'+esc(p.costo)+'"><input class="p-s" aria-label="Stock del premio canjeable" type="number" min="0" step="1" placeholder="Stock" value="'+esc(p.stock)+'"><label class="meta" style="white-space:nowrap"><input class="p-a" type="checkbox"'+(p.activo?' checked':'')+'> activo</label><button class="btn sm primary" data-ps="'+i+'">Guardar</button><button class="btn sm danger" data-pd="'+i+'">Borrar</button></div>'}).join("")
   +(LOY.premios.length||LOY.cargando?'':'<div class="meta">Aún no hay premios canjeables.</div>')
   +'<div class="foot"><span class="meta" id="lmsg-p">'+esc(LOY.msgP)+'</span><button class="btn" id="p-add">Agregar premio canjeable</button></div></div>';

  var pend=LOY.canjes.filter(function(c){return c.estado==="pendiente"}),resto=LOY.canjes.filter(function(c){return c.estado!=="pendiente"}).slice(0,15);
  h+='<div class="bar"><b>Canjes y premios por entregar ('+pend.length+')</b><button class="btn" id="l-ref">Actualizar</button></div>'
   +(LOY.msgC?'<div class="meta">'+esc(LOY.msgC)+'</div>':'')
   +(pend.length?'<div class="list">'+pend.map(function(c){return'<div class="row line"><span><b>'+esc(c.nombre)+'</b> <span class="meta">'+(c.user_id?'Cuenta '+esc(String(c.user_id).slice(0,8)):'')+(c.ff_id?' | ID de juego '+esc(c.ff_id):'')+' | '+(c.origen==="ruleta"?"ruleta":esc(c.costo)+" pts")+' • '+esc(fecha(c.creado))+'</span></span><span><button class="btn sm primary" data-ce="'+esc(c.id)+'" data-est="entregado">Entregado</button> <button class="btn sm danger" data-ce="'+esc(c.id)+'" data-est="cancelado">Cancelar</button></span></div>'}).join("")+'</div>':'<div class="empty"><p>No hay canjes pendientes.</p></div>')
   +(resto.length?'<div class="list">'+resto.map(function(c){return'<div class="row line"><span>'+esc(c.nombre)+' <span class="meta">ID '+esc(c.ff_id)+' • '+esc(fecha(c.creado))+'</span></span><span class="tag'+(c.estado==="entregado"?"":" off")+'">'+esc(c.estado)+'</span></div>'}).join("")+'</div>':'');

  h+='<div class="bar"><b>Cuentas cliente con puntos</b></div>'
   +(LOY.clientes.length?'<div class="list">'+LOY.clientes.map(function(c){return'<div class="row line"><span>Cuenta <span class="meta">UID '+esc(c.user_id)+'</span></span><span class="meta">'+esc(c.total_ganado)+' ganados</span><b>'+esc(c.puntos)+' pts</b></div>'}).join("")+'</div>':'<div class="empty"><p>'+(LOY.cargando?"Cargando…":"Aún no hay carteras de puntos asociadas a cuentas.")+'</p></div>')
   +(LOY.giros.length?'<div class="bar"><b>Últimos giros de la ruleta</b></div><div class="list">'+LOY.giros.map(function(g){return'<div class="row line"><span><b>'+esc(g.premio)+'</b> <span class="meta">ID '+esc(g.ff_id)+' • '+esc(fecha(g.creado))+'</span></span><span class="meta">costó '+esc(g.costo)+' pts'+(g.puntos_ganados>0?' • +'+esc(g.puntos_ganados):'')+'</span></div>'}).join("")+'</div>':'');
  $("panel").innerHTML=adminFrame(h);

  var recarga=function(){LOY.cargando=true;cargarLoy()};
  $("l-ref").addEventListener("click",function(){loyLeer();LOY.msgC="";recarga()});
  $("l-add").addEventListener("click",function(){loyLeer();if(LOY.ruleta.length>=24)LOY.msgR="Demasiados premios.";else LOY.ruleta.push({id:null,nombre:"",descripcion:"",tipo:"puntos",valor:"10",peso:"0",stock:"",vence:"30",minimo:"20000",activo:true});renderAdmin()});
  $("l-norm").addEventListener("click",function(){
    loyLeer();
    var act=LOY.ruleta.filter(function(p){return p.activo}),tot=act.reduce(function(a,p){return a+Math.max(0,Number(p.peso)||0)},0);
    if(!act.length){LOY.msgR="No hay premios activos.";renderAdmin();return}
    if(tot<=0){var b0=Math.floor(100/act.length);act.forEach(function(p,i){p.peso=String(b0+(i<100-b0*act.length?1:0))});LOY.msgR="Reparto igual entre los activos. Revisa y guarda.";renderAdmin();return}
    /* método del mayor resto: enteros que suman exactamente 100 */
    var q=act.map(function(p,i){var x=Math.max(0,Number(p.peso)||0)*100/tot;return{p:p,f:Math.floor(x),r:x-Math.floor(x),i:i}}),falta=100-q.reduce(function(a,x){return a+x.f},0);
    q.slice().sort(function(a,b){return b.r-a.r||a.i-b.i}).slice(0,falta).forEach(function(x){x.f++});
    q.forEach(function(x){x.p.peso=String(x.f)});
    LOY.msgR="Ajustado a 100 %. Revisa y guarda.";renderAdmin();
  });
  $("p-add").addEventListener("click",function(){loyLeer();LOY.premios.push({id:null,nombre:"",descripcion:"",costo:"",stock:"",activo:true});renderAdmin()});
  document.querySelectorAll("[data-lx]").forEach(function(b){b.addEventListener("click",function(){loyLeer();var q=LOY.ruleta.splice(Number(b.dataset.lx),1)[0];if(q&&q.id!=null)LOY.borrados.push(q.id);renderAdmin()})});
  document.querySelectorAll("[data-lr] input,[data-lr] select").forEach(function(el){el.addEventListener("change",function(){loyLeer();renderAdmin()})});

  $("l-cfg").addEventListener("click",function(){
    loyLeer();var L=LOY,m=function(t){L.msg=t;$("lmsg-cfg").textContent=t};
    if(L.obj<1||L.obj>1000000||L.cada<0||L.porCompra<0||L.bienvenida<0||L.porCompra>100000||L.bienvenida>100000)return m("Revisa las reglas: usa cantidades enteras no negativas y máximo 100.000 puntos.");
    if(L.activa&&L.cada===0&&L.porCompra===0&&L.bienvenida===0)return m("Configura al menos una regla de puntos antes de activar el programa.");
    m("Guardando…");
    var nuevo={activa:L.activa,cada:Math.floor(L.cada),por_compra:Math.floor(L.porCompra),bienvenida:Math.floor(L.bienvenida),objetivo:Math.floor(L.obj)};
    Backend.guardarAjuste("puntos",nuevo)
      .then(function(){cfg.pts=nuevo;m("Guardado.")})
      .catch(function(e){m("No se pudo guardar: "+e.message)});
  });

  $("l-save").addEventListener("click",function(){
    loyLeer();var L=LOY,m=function(t){L.msgR=t;$("lmsg-r").textContent=t};
    var act=L.ruleta.filter(function(p){return p.activo});
    if(L.ruleta.some(function(p){return!p.nombre}))return m("Todos los premios necesitan nombre.");
    if(L.ruleta.some(function(p){return Number(p.vence)<1||Number(p.vence)>365||Number(p.minimo)<0}))return m("Configura vigencia de 1 a 365 dias y compra minima no negativa.");
    if(act.length<2||act.length>12)return m("Debe haber entre 2 y 12 premios activos.");
    if(loySuma()!==100)return m("Las probabilidades activas deben sumar exactamente 100 %.");
    var lista=L.ruleta.map(function(p){return{id:p.id,nombre:p.nombre,descripcion:p.descripcion||"",tipo:p.tipo,valor:p.tipo==="nada"?"0":p.valor,peso:Math.floor(Number(p.peso)||0),stock:p.stock===""?null:Math.floor(Number(p.stock)),vence_dias:Math.floor(Number(p.vence)||30),compra_minima:Number(p.minimo),activo:p.activo,eliminar:false}})
      .concat(L.borrados.map(function(id){return{id:id,eliminar:true}}));
    m("Guardando…");
    Backend.guardarRuleta(lista).then(function(r){
      if(r&&r.error){m(r.error);return}
      L.msgR="Guardado. La tienda ya usa estas probabilidades.";L.cargando=true;cargarLoy();
    }).catch(function(e){m("No se pudo guardar: "+e.message)});
  });

  document.querySelectorAll("[data-ps]").forEach(function(b){b.addEventListener("click",function(){
    loyLeer();var p=LOY.premios[Number(b.dataset.ps)];if(!p)return;
    LOY.msgP="Guardando…";$("lmsg-p").textContent=LOY.msgP;
    Backend.guardarPremioCanje(p).then(function(r){
      if(r&&r.error){LOY.msgP=r.error;$("lmsg-p").textContent=r.error;return}
      LOY.msgP="Guardado.";LOY.cargando=true;cargarLoy();
    }).catch(function(e){LOY.msgP="No se pudo guardar: "+e.message;$("lmsg-p").textContent=LOY.msgP});
  })});
  document.querySelectorAll("[data-pd]").forEach(function(b){b.addEventListener("click",function(){
    loyLeer();var i=Number(b.dataset.pd),p=LOY.premios[i];if(!p)return;
    if(p.id==null){LOY.premios.splice(i,1);renderAdmin();return}
    if(!window.confirm('¿Borrar el premio "'+p.nombre+'"? Los canjes ya hechos se conservan.'))return;
    Backend.borrarPremioCanje(p.id).then(function(r){
      if(r&&r.error){LOY.msgP=r.error;renderAdmin();return}
      LOY.msgP="Premio borrado.";LOY.cargando=true;cargarLoy();
    }).catch(function(e){LOY.msgP="No se pudo borrar: "+e.message;renderAdmin()});
  })});
  document.querySelectorAll("[data-ce]").forEach(function(b){b.addEventListener("click",function(){
    var est=b.dataset.est;
    if(est==="cancelado"&&!window.confirm("¿Cancelar este canje? Se devuelven los puntos al cliente."))return;
    Backend.estadoCanje(Number(b.dataset.ce),est).then(function(r){
      LOY.msgC=r&&r.error?r.error:(est==="entregado"?"Marcado como entregado.":"Canje cancelado y puntos devueltos.");LOY.cargando=true;cargarLoy();
    }).catch(function(e){LOY.msgC="No se pudo actualizar: "+e.message;renderAdmin()});
  })});
}
