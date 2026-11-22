/* ADMINISTRACIÓN: productos, ofertas, pedidos, clientes, cupones, ajustes y respaldo */
/* ---------- ADMINISTRACIÓN ---------- */
var adminSearch={orders:"",products:"",customers:"",payments:""};
var adminProductType="",adminOrderTypeFilter="";
var ordersLoading=false;
var ADMIN_NAV=[
  ["dashboard","Resumen","▦"],["products","Productos","▣"],["orders","Pedidos","▤"],
  ["pay","Pagos","＄"],["customers","Clientes","♙"],["loyalty","Puntos y ruleta","✦"],
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
      return '<button class="admin-nav-item'+(active===x[0]?" is-active":"")+'" data-tab="'+x[0]+'" aria-current="'+(active===x[0]?"page":"false")+'"><span aria-hidden="true">'+x[2]+'</span><b>'+esc(x[1])+'</b></button>';
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

function adminOrderTypeLabel(o){
  return ({fisico:"Físico",digital:"Digital",mixto:"Mixto",sin_tipo:"Tipo no registrado"})[getAdminOrderType(o)]
}

function adminEstadoClass(estado){
  return String(estado||"").toLowerCase().replace(/[^a-z]/g,"")
}

function adminHistory(o){
  return Array.isArray(o.historial)?o.historial:[];
}

function adminPaymentEvidence(record,label){
  var image=safeImg(record&&record.comprobante);
  return image?'<img class="comp" src="'+image+'" alt="'+esc(label||"Evidencia de pago")+'">':'';
}

/* ---------- PAGOS ---------- */
/*
   Flujo nuevo:
   Pendiente -> confirmar pago completo -> Pagado -> Por entregar

   Ya NO se usan abonos para confirmar pedidos nuevos.
   Se conserva la lectura de datos históricos para no romper pedidos antiguos.
*/
function adminAbonosHtml(o){
  var total=Number(o.total)||0,estado=estadoDe(o);

  if(estado==="Pagado"){
    return '<b>Pago confirmado: '+fmt.format(total)+'</b>'+
      '<span>El pedido fue pagado completamente.</span>';
  }

  if(estado==="Pendiente"){
    return '<b>Total a pagar: '+fmt.format(total)+'</b>'+
      '<span>El pago debe recibirse completo para confirmar el pedido.</span>'+
      '<button class="btn sm primary" data-confirm-payment="'+esc(o.id)+'">Confirmar pago completo</button>';
  }

  return '<b>Total del pedido: '+fmt.format(total)+'</b>'+
    '<span>Estado: '+esc(estado)+'</span>';
}

function confirmarPagoCompleto(id){
  var o=orders.find(function(x){
    return String(x.id)===String(id);
  });

  if(!o)return;

  var total=Number(o.total)||0;

  if(!(total>0)){
    alert("El pedido no tiene un total valido.");
    return;
  }

  if(estadoDe(o)!=="Pendiente"){
    alert("Este pedido ya no esta pendiente.");
    return;
  }

  if(!window.confirm(
    "¿Confirmas que recibiste el pago COMPLETO de "+
    fmt.format(total)+
    "?\n\nEl pedido pasara a PAGADO."
  ))return;

  var metodo=window.prompt(
    "Metodo de pago:",
    o.pago||"Pago manual"
  );

  if(metodo===null)return;

  var referencia=window.prompt(
    "Referencia o constancia del pago (opcional):",
    o.referencia||""
  );

  if(referencia===null)return;

  var comprobante=window.prompt(
    "Comprobante o evidencia (opcional):",
    o.comprobante||""
  );

  if(comprobante===null)return;

  var nota=window.prompt(
    "Nota administrativa (opcional):",
    ""
  );

  if(nota===null)return;

  Backend.confirmarPagoCompleto(
    id,
    total,
    metodo.trim()||"Pago manual",
    referencia.trim(),
    comprobante.trim(),
    nota.trim()
  )
  .then(function(r){
    if(!r||r.ok!==true){
      throw new Error(
        (r&&r.error)||
        "El servidor no pudo confirmar el pago."
      );
    }

    ordersErr="";
    return cargarPedidos();
  })
  .catch(function(e){
    ordersErr="No se pudo confirmar el pago: "+e.message;
    renderAdmin();
  });
}

/* ---------- REINTEGROS HISTÓRICOS ---------- */

function registrarReintegro(abonoId){
  var pedido=null,abono=null;

  orders.some(function(o){
    var found=(o.abonos||[]).find(function(a){
      return String(a.id)===String(abonoId);
    });

    if(found){
      pedido=o;
      abono=found;
      return true;
    }

    return false;
  });

  if(!pedido||!abono||abono.estado!=="verificado")return;

  var reintegros=Array.isArray(abono.reintegros)?
    abono.reintegros:[];

  var usado=reintegros
    .filter(function(r){
      return r.estado==="pendiente"||r.estado==="verificado";
    })
    .reduce(function(s,r){
      return s+(Number(r.monto)||0);
    },0);

  var disponible=Math.max(
    0,
    Number(abono.monto)-usado
  );

  if(!disponible){
    alert("Este abono ya tiene reintegros registrados por su valor total.");
    return;
  }

  var monto=window.prompt(
    "Monto que vas a reintegrar (máximo: "+
    fmt.format(disponible)+")",
    String(disponible)
  );

  if(monto===null)return;

  var n=Number(monto);

  if(!(n>0)||n>disponible){
    alert("Escribe un monto mayor que cero y no superior al disponible.");
    return;
  }

  var referencia=window.prompt(
    "Referencia o constancia del reintegro que se pueda comprobar en su fuente:",
    ""
  );

  if(referencia===null||!referencia.trim()){
    alert("La referencia es necesaria para verificar el reintegro.");
    return;
  }

  Backend.registrarReintegro(
    abono.id,
    n,
    abono.metodo||"Reintegro manual",
    referencia.trim(),
    "",
    ""
  )
  .then(cargarPedidos)
  .catch(function(e){
    ordersErr="No se pudo registrar el reintegro: "+e.message;
    renderAdmin();
  });
}

function revisarReintegro(id,aprobar,pedidoId){
  var o=orders.find(function(x){
    return String(x.id)===String(pedidoId);
  });

  if(!o)return;

  if(
    aprobar&&
    !window.confirm(
      "Comprueba el reintegro en su fuente. Si el pedido ya está pagado, se deben verificar todos los reintegros por el total para cancelar y revertir puntos e inventario. ¿Confirmas la revisión?"
    )
  )return;

  var request=
    Backend.secureCheckout&&estadoDe(o)==="Pagado"
      ?Backend.verificarReintegrosPedido(o.id,aprobar)
      :Backend.verificarReintegro(id,aprobar);

  request
    .then(function(){
      ordersErr="";
      return cargarPedidos();
    })
    .catch(function(e){
      ordersErr="No se pudo revisar el reintegro: "+e.message;
      renderAdmin();
    });
}

/* ---------- ENTREGAS ---------- */

function actualizarEntrega(id,tipo){
  var datos={};

  if(tipo==="digital"){
    var confirmacion=window.prompt(
      "Escribe la confirmacion o referencia de la recarga/entrega digital:",
      ""
    );

    if(confirmacion===null)return;

    if(confirmacion.trim().length<3){
      alert("La confirmacion debe tener al menos 3 caracteres.");
      return;
    }

    datos.confirmacion=confirmacion.trim();
  }

  if(!window.confirm(
    tipo==="digital"
      ?"¿Confirmas que completaste la entrega digital?"
      :"¿Confirmas que entregaste este producto?"
  ))return;

  Backend.actualizarEntrega(
    id,
    "entregado",
    datos
  )
  .then(cargarPedidos)
  .catch(function(e){
    ordersErr="No se pudo actualizar la entrega: "+e.message;
    renderAdmin();
  });
}

function adminEntregasHtml(o){
  if(!Backend.secureCheckout||estadoDe(o)!=="Pagado")return "";

  if(!Array.isArray(o.entregas)||!o.entregas.length){
    return '<div class="admin-note is-muted">No hay entregas registradas para este pedido.</div>';
  }

  return '<div class="admin-order-deliveries"><b>Entregas</b>'+
    o.entregas.map(function(d){
      var item=(o.items||[]).find(function(i){
        return i.id===d.productoId;
      });

      var cerrada=
        d.estado==="entregado"||
        d.estado==="cancelado";

      return '<div class="admin-delivery-row">'+
        '<span>'+
          esc(item&&item.n||d.productoId)+
          ' · '+
          (d.tipo==="digital"?"Digital":"Fisica")+
          ' · '+
          esc(d.estado)+
          ' · '+
          d.cantidad+
        '</span>'+
        (
          cerrada
          ?""
          :
          '<button class="btn sm primary" data-delivery="'+
          esc(d.id)+
          '" data-kind="'+
          esc(d.tipo)+
          '">'+
          (d.tipo==="digital"
            ?"Confirmar recarga"
            :"Confirmar entrega")+
          '</button>'
        )+
      '</div>';
    }).join("")+
  '</div>';
}

/* ---------- GRÁFICA ---------- */

function renderSalesChart(){
  if(ordersLoading){
    return '<div class="admin-empty" role="status">Cargando datos de ventas…</div>';
  }

  if(ordersErr){
    return '<div class="admin-empty" role="status">No se pudo actualizar la gráfica. Revisa el estado de pedidos.</div>';
  }

  var now=new Date(),
      days=[],
      totals={};

  for(var i=6;i>=0;i--){
    var d=new Date(now);

    d.setHours(0,0,0,0);
    d.setDate(d.getDate()-i);

    var key=
      d.getFullYear()+
      "-"+
      String(d.getMonth()+1).padStart(2,"0")+
      "-"+
      String(d.getDate()).padStart(2,"0");

    days.push({
      key:key,
      label:d.toLocaleDateString(
        "es-CO",
        {weekday:"short"}
      )
    });

    totals[key]=0;
  }

  orders
    .filter(function(o){
      return estadoDe(o)==="Pagado"||
             estadoDe(o)==="Entregado";
    })
    .forEach(function(o){
      var d=new Date(o.fecha);

      var key=
        d.getFullYear()+
        "-"+
        String(d.getMonth()+1).padStart(2,"0")+
        "-"+
        String(d.getDate()).padStart(2,"0");

      if(Object.prototype.hasOwnProperty.call(totals,key)){
        totals[key]+=Number(o.total)||0;
      }
    });

  var max=Math.max.apply(
    null,
    days.map(function(d){
      return totals[d.key];
    })
  );

  if(!max){
    return '<div class="admin-empty">Sin ventas confirmadas en los últimos 7 días.</div>';
  }

  return '<div class="admin-chart" role="img" aria-label="Ventas confirmadas por día durante los últimos siete días">'+
    days.map(function(d){
      var amount=totals[d.key],
          height=amount?
            Math.max(5,Math.round(amount/max*100)):
            0;

      return '<div class="admin-chart-day">'+
        '<div class="admin-chart-track">'+
          '<span class="'+
            (amount?'':'is-zero')+
            '" style="height:'+height+'%"></span>'+
        '</div>'+
        '<b>'+esc(d.label)+'</b>'+
        '<small>'+fmt.format(amount)+'</small>'+
      '</div>';
    }).join("")+
  '</div>';
}

/* ---------- RESTO DEL ADMIN ---------- */

function adminProductCard(p){
  var stock=p.ilimitado?"Ilimitado":String(p.stock);
  return '<article class="admin-card">'+
    '<div class="admin-card-top">'+
      '<div>'+
        '<span class="tag '+(p.activo?"":"off")+'">'+
          (p.activo?"Activo":"Inactivo")+
        '</span>'+
        '<h3>'+esc(p.nombre)+'</h3>'+
      '</div>'+
      '<b>'+fmt.format(Number(p.price)||0)+'</b>'+
    '</div>'+
    '<div class="admin-meta">'+
      '<span>Tipo: '+esc(p.tipo||"")+'</span>'+
      '<span>Stock: '+esc(stock)+'</span>'+
    '</div>'+
    '<div class="admin-actions">'+
      '<button class="btn sm primary" data-edit-product="'+esc(p.id)+'">Editar</button>'+
      '<button class="btn sm danger" data-delete-product="'+esc(p.id)+'">Eliminar</button>'+
    '</div>'+
  '</article>';
}

function renderProducts(){
  var h='<div class="admin-panel-head">'+
    '<div>'+
      '<span class="admin-eyebrow">CATÁLOGO</span>'+
      '<h2>Productos</h2>'+
    '</div>'+
    '<button class="btn primary" data-x="newp">＋ Nuevo producto</button>'+
  '</div>';

  h+='<div class="admin-toolbar-row">'+
    '<input class="admin-search" id="admin-product-search" placeholder="Buscar producto..." value="'+esc(adminSearch.products||"")+'">'+
    '<select id="admin-product-type">'+
      '<option value="">Todos los tipos</option>'+
      '<option value="fisico"'+(adminProductType==="fisico"?" selected":"")+'>Físicos</option>'+
      '<option value="digital"'+(adminProductType==="digital"?" selected":"")+'>Digitales</option>'+
    '</select>'+
  '</div>';

  var q=String(adminSearch.products||"").toLowerCase();

  var list=products.filter(function(p){
    var text=String(p.nombre||"").toLowerCase();
    var type=String(p.tipo||"").toLowerCase();

    return (!q||text.indexOf(q)>=0)&&
      (!adminProductType||type===adminProductType);
  });

  h+=list.length
    ?'<div class="admin-card-grid">'+list.map(adminProductCard).join("")+'</div>'
    :'<div class="admin-empty">No hay productos que coincidan.</div>';

  $("panel").innerHTML=adminFrame(h);

  bindAdminSearch("#admin-product-search","products");

  var typeSelect=$("#admin-product-type");

  if(typeSelect){
    typeSelect.addEventListener("change",function(){
      adminProductType=typeSelect.value;
      renderAdmin();
    });
  }

  document.querySelectorAll("[data-edit-product]").forEach(function(b){
    b.addEventListener("click",function(){
      editarProducto(b.dataset.editProduct);
    });
  });

  document.querySelectorAll("[data-delete-product]").forEach(function(b){
    b.addEventListener("click",function(){
      eliminarProducto(b.dataset.deleteProduct);
    });
  });
}

/* ---------- PEDIDOS ---------- */

function orderRow(o){
  var e=estadoDe(o),
      solo=o.items.length>0&&o.items.every(function(i){return i.v}),
      b="",
      kind=getAdminOrderType(o),
      hist=adminHistory(o);

  b+='<article class="admin-order-row">'+
    '<div class="admin-order-main">'+
      '<div class="admin-order-title">'+
        '<div>'+
          '<span class="tag st-'+adminEstadoClass(e)+'">'+esc(e)+'</span>'+
          '<h3>'+esc(o.nombre||o.cliente&&o.cliente.nombre||"Cliente")+'</h3>'+
        '</div>'+
        '<strong>'+fmt.format(Number(o.total)||0)+'</strong>'+
      '</div>'+
      '<div class="admin-meta">'+
        '<span>ID: '+esc(o.id)+'</span>'+
        '<span>'+esc(adminOrderTypeLabel(o))+'</span>'+
        '<span>'+esc(fecha(o.fecha))+'</span>'+
      '</div>';

  if(o.tel){
    b+='<div class="admin-meta"><span>Tel: '+esc(o.tel)+'</span></div>';
  }

  if(o.direccion){
    b+='<div class="admin-meta"><span>Entrega: '+esc(
      o.direccion.city||
      o.direccion.zone||
      o.direccion.street||
      ""
    )+'</span></div>';
  }

  if(e==="Pendiente"){
    b+=Backend.secureCheckout
      ?'<button class="btn sm primary" data-tab="pay">Confirmar pago completo</button>'
      :'<button class="btn sm primary" data-oa="pagado" data-id="'+
        esc(o.id)+
        '" title="Revisa evidencia o confirma la recepción antes de marcarlo">Registrar pago verificado</button>';
  }

  if(e==="Pagado"&&Backend.secureCheckout){
    b+=adminEntregasHtml(o);
  }

  if(!solo&&e==="Pagado"){
    b+='<div class="admin-note is-muted">Pedido listo para entrega.</div>';
  }

  if(
    (!Backend.secureCheckout&&(e==="Pendiente"||e==="Pagado"))||
    (Backend.secureCheckout&&e==="Pendiente")
  ){
    b+='<button class="btn sm danger" data-oa="cancelar" data-id="'+
      esc(o.id)+
      '">Cancelar pedido</button>';
  }

  b+='<button class="btn sm danger" data-od="'+
    esc(o.id)+
    '">'+
    (pdel===o.id?"Confirmar":"Eliminar")+
    '</button>';

  b+='</div>';

  b+='<div class="admin-order-side">'+
    '<div class="admin-order-items">'+
      (o.items||[]).map(function(i){
        return '<div class="admin-item-line">'+
          '<span>'+esc(i.name||i.n||i.id)+'</span>'+
          '<span>x'+esc(i.q)+'</span>'+
          '<b>'+fmt.format(Number(i.subtotal||i.price||0))+'</b>'+
        '</div>';
      }).join("")+
    '</div>';

  if(hist.length){
    b+='<details class="admin-history">'+
      '<summary>Historial</summary>'+
      '<ul>'+
      hist.map(function(x){
        return '<li>'+
          '<b>'+esc(x.estado||x.accion||"")+'</b> '+
          '<span>'+esc(x.nota||"")+'</span>'+
          '<small>'+esc(x.fecha||"")+'</small>'+
        '</li>';
      }).join("")+
      '</ul>'+
    '</details>';
  }

  b+='</div></article>';

  return b;
}

function renderOrders(){
  var h='<div class="admin-panel-head">'+
    '<div>'+
      '<span class="admin-eyebrow">VENTAS</span>'+
      '<h2>Pedidos</h2>'+
    '</div>'+
    '<button class="btn sm" data-refresh-orders>Actualizar</button>'+
  '</div>';

  h+='<div class="admin-toolbar-row">'+
    '<input class="admin-search" id="admin-order-search" placeholder="Buscar pedido..." value="'+esc(adminSearch.orders||"")+'">'+
    '<select id="admin-order-type">'+
      '<option value="">Todos los tipos</option>'+
      '<option value="fisico"'+(adminOrderTypeFilter==="fisico"?" selected":"")+'>Físicos</option>'+
      '<option value="digital"'+(adminOrderTypeFilter==="digital"?" selected":"")+'>Digitales</option>'+
      '<option value="mixto"'+(adminOrderTypeFilter==="mixto"?" selected":"")+'>Mixtos</option>'+
    '</select>'+
  '</div>';

  if(ordersErr){
    h+='<div class="admin-note is-error">'+esc(ordersErr)+'</div>';
  }

  if(ordersLoading){
    h+='<div class="admin-empty">Cargando pedidos…</div>';
  }else{
    var q=String(adminSearch.orders||"").toLowerCase();

    var list=orders.filter(function(o){
      var text=[
        o.id,
        o.nombre,
        o.tel,
        o.estado,
        o.cliente&&o.cliente.nombre
      ].join(" ").toLowerCase();

      return (!q||text.indexOf(q)>=0)&&
        (!adminOrderTypeFilter||
         getAdminOrderType(o)===adminOrderTypeFilter);
    });

    h+=list.length
      ?'<div class="admin-order-list">'+list.map(orderRow).join("")+'</div>'
      :'<div class="admin-empty">No hay pedidos que coincidan.</div>';
  }

  $("panel").innerHTML=adminFrame(h);

  bindAdminSearch("#admin-order-search","orders");

  var typeSelect=$("#admin-order-type");

  if(typeSelect){
    typeSelect.addEventListener("change",function(){
      adminOrderTypeFilter=typeSelect.value;
      renderAdmin();
    });
  }

  document.querySelectorAll("[data-refresh-orders]").forEach(function(b){
    b.addEventListener("click",function(){
      cargarPedidos();
    });
  });

  document.querySelectorAll("[data-confirm-payment]").forEach(function(b){
    b.addEventListener("click",function(){
      confirmarPagoCompleto(
        b.dataset.confirmPayment
      );
    });
  });

  document.querySelectorAll("[data-delivery]").forEach(function(b){
    b.addEventListener("click",function(){
      actualizarEntrega(
        b.dataset.delivery,
        b.dataset.kind
      );
    });
  });

  document.querySelectorAll("[data-tab]").forEach(function(b){
    b.addEventListener("click",function(){
      atab=b.dataset.tab;
      renderAdmin();
    });
  });

  document.querySelectorAll("[data-oa]").forEach(function(b){
    b.addEventListener("click",function(){
      var action=b.dataset.oa,
          id=b.dataset.id;

      if(action==="cancelar"){
        if(!window.confirm("¿Cancelar este pedido?"))return;

        Backend.cancelarPedido(id)
          .then(function(){
            ordersErr="";
            return cargarPedidos();
          })
          .catch(function(e){
            ordersErr="No se pudo cancelar: "+e.message;
            renderAdmin();
          });
      }

      if(action==="pagado"){
        var o=orders.find(function(x){
          return String(x.id)===String(id);
        });

        if(!o)return;

        confirmarPagoCompleto(id);
      }
    });
  });

  document.querySelectorAll("[data-od]").forEach(function(b){
    b.addEventListener("click",function(){
      var id=b.dataset.od;

      if(pdel!==id){
        pdel=id;
        renderAdmin();
        return;
      }

      Backend.eliminar(id)
        .then(function(){
          pdel="";
          ordersErr="";
          return cargarPedidos();
        })
        .catch(function(e){
          pdel="";
          ordersErr="No se pudo eliminar: "+e.message;
          renderAdmin();
        });
    });
  });
}

/* ---------- PAGOS ---------- */

function renderPayments(){
  var h='<section class="admin-panel admin-payment-panel">'+
    '<div class="admin-panel-head">'+
      '<div>'+
        '<span class="admin-eyebrow">PEDIDOS Y PAGOS</span>'+
        '<h2>Pagos registrados</h2>'+
      '</div>'+
      '<button class="btn sm" data-tab="orders">Abrir pedidos</button>'+
    '</div>';

  h+='<div class="admin-note">'+
    'La tienda registra el método, referencia y comprobante enviados con cada pedido. La confirmación del pago es manual.'+
  '</div>';

  if(Backend.secureCheckout){
    h+='<div class="admin-note is-muted">'+
      'El pago debe recibirse completo. El servidor solo acepta un monto exactamente igual al total del pedido y cambia el pedido a Pagado. No se habilitan entregas con saldo pendiente.'+
    '</div>';
  }

  var payOrders=orders.filter(function(o){
    return o.estado==="Pendiente"||
           o.estado==="Pagado"||
           o.estado==="Entregado";
  });

  if(!payOrders.length){
    h+='<div class="admin-empty">No hay pedidos para revisar.</div>';
  }else{
    h+='<div class="admin-order-list">'+
      payOrders.map(function(o){
        var estado=estadoDe(o);

        return '<article class="admin-order-row">'+
          '<div class="admin-order-main">'+
            '<div class="admin-order-title">'+
              '<div>'+
                '<span class="tag st-'+adminEstadoClass(estado)+'">'+
                  esc(estado)+
                '</span>'+
                '<h3>'+esc(
                  o.nombre||
                  o.cliente&&o.cliente.nombre||
                  "Cliente"
                )+'</h3>'+
              '</div>'+
              '<strong>'+fmt.format(Number(o.total)||0)+'</strong>'+
            '</div>'+
            '<div class="admin-meta">'+
              '<span>ID: '+esc(o.id)+'</span>'+
              '<span>'+esc(fecha(o.fecha))+'</span>'+
            '</div>'+
            adminAbonosHtml(o)+
            '<button class="btn sm" data-review-order="'+
              esc(o.id)+
            '">Ver pedido</button>'+
          '</div>'+
        '</article>';
      }).join("")+
    '</div>';
  }

  $("panel").innerHTML=adminFrame(h);

  document.querySelectorAll("[data-review-order]").forEach(function(b){
    b.addEventListener("click",function(){
      adminSearch.orders=b.dataset.reviewOrder;
      adminOrderTypeFilter="";
      pedidoFiltro="";
      atab="orders";
      renderAdmin();
    });
  });

  document.querySelectorAll("[data-confirm-payment]").forEach(function(b){
    b.addEventListener("click",function(){
      confirmarPagoCompleto(
        b.dataset.confirmPayment
      );
    });
  });

  document.querySelectorAll("[data-tab]").forEach(function(b){
    b.addEventListener("click",function(){
      atab=b.dataset.tab;
      renderAdmin();
    });
  });
}

/* ---------- RESUMEN ---------- */

function renderDashboard(){
  var pendientes=orders.filter(function(o){
    return estadoDe(o)==="Pendiente";
  }).length;

  var pagados=orders.filter(function(o){
    return estadoDe(o)==="Pagado";
  }).length;

  var entregados=orders.filter(function(o){
    return estadoDe(o)==="Entregado";
  }).length;

  var total=orders
    .filter(function(o){
      return estadoDe(o)==="Pagado"||
             estadoDe(o)==="Entregado";
    })
    .reduce(function(s,o){
      return s+(Number(o.total)||0);
    },0);

  var h='<div class="admin-dashboard-grid">'+
    '<article class="admin-stat">'+
      '<span>Pedidos pendientes</span>'+
      '<b>'+pendientes+'</b>'+
    '</article>'+
    '<article class="admin-stat">'+
      '<span>Pagados</span>'+
      '<b>'+pagados+'</b>'+
    '</article>'+
    '<article class="admin-stat">'+
      '<span>Entregados</span>'+
      '<b>'+entregados+'</b>'+
    '</article>'+
    '<article class="admin-stat">'+
      '<span>Ventas confirmadas</span>'+
      '<b>'+fmt.format(total)+'</b>'+
    '</article>'+
  '</div>';

  h+='<section class="admin-panel">'+
    '<div class="admin-panel-head">'+
      '<div>'+
        '<span class="admin-eyebrow">VENTAS</span>'+
        '<h2>Últimos 7 días</h2>'+
      '</div>'+
    '</div>'+
    renderSalesChart()+
  '</section>';

  h+='<section class="admin-panel">'+
    '<div class="admin-panel-head">'+
      '<div>'+
        '<span class="admin-eyebrow">PEDIDOS</span>'+
        '<h2>Últimos pedidos</h2>'+
      '</div>'+
      '<button class="btn sm" data-tab="orders">Ver todos</button>'+
    '</div>';

  var recientes=orders.slice(0,5);

  h+=recientes.length
    ?'<div class="admin-order-list">'+
      recientes.map(orderRow).join("")+
      '</div>'
    :'<div class="admin-empty">No hay pedidos todavía.</div>';

  h+='</section>';

  $("panel").innerHTML=adminFrame(h);

  document.querySelectorAll("[data-tab]").forEach(function(b){
    b.addEventListener("click",function(){
      atab=b.dataset.tab;
      renderAdmin();
    });
  });

  document.querySelectorAll("[data-confirm-payment]").forEach(function(b){
    b.addEventListener("click",function(){
      confirmarPagoCompleto(
        b.dataset.confirmPayment
      );
    });
  });

  document.querySelectorAll("[data-oa]").forEach(function(b){
    b.addEventListener("click",function(){
      var action=b.dataset.oa,
          id=b.dataset.id;

      if(action==="cancelar"){
        if(!window.confirm("¿Cancelar este pedido?"))return;

        Backend.cancelarPedido(id)
          .then(cargarPedidos)
          .catch(function(e){
            ordersErr="No se pudo cancelar: "+e.message;
            renderAdmin();
          });
      }
    });
  });

  document.querySelectorAll("[data-od]").forEach(function(b){
    b.addEventListener("click",function(){
      var id=b.dataset.od;

      if(pdel!==id){
        pdel=id;
        renderAdmin();
        return;
      }

      Backend.eliminar(id)
        .then(function(){
          pdel="";
          return cargarPedidos();
        })
        .catch(function(e){
          pdel="";
          ordersErr="No se pudo eliminar: "+e.message;
          renderAdmin();
        });
    });
  });
}

/* ---------- CLIENTES ---------- */

function renderCustomers(){
  var q=String(adminSearch.customers||"").toLowerCase();

  var list=customers.filter(function(c){
    var text=[
      c.nombre,
      c.email,
      c.tel,
      c.id
    ].join(" ").toLowerCase();

    return !q||text.indexOf(q)>=0;
  });

  var h='<div class="admin-panel-head">'+
    '<div>'+
      '<span class="admin-eyebrow">CLIENTES</span>'+
      '<h2>Clientes</h2>'+
    '</div>'+
  '</div>';

  h+='<input class="admin-search" id="admin-customer-search" placeholder="Buscar cliente..." value="'+esc(adminSearch.customers||"")+'">';

  h+=list.length
    ?'<div class="admin-card-grid">'+
      list.map(function(c){
        return '<article class="admin-card">'+
          '<h3>'+esc(c.nombre||"Sin nombre")+'</h3>'+
          '<div class="admin-meta">'+
            '<span>'+esc(c.email||"")+'</span>'+
            '<span>'+esc(c.tel||"")+'</span>'+
          '</div>'+
        '</article>';
      }).join("")+
      '</div>'
    :'<div class="admin-empty">No hay clientes.</div>';

  $("panel").innerHTML=adminFrame(h);

  bindAdminSearch(
    "#admin-customer-search",
    "customers"
  );
}

/* ---------- NAVEGACIÓN ---------- */

function renderAdmin(){
  if(atab==="dashboard"){
    renderDashboard();
    return;
  }

  if(atab==="products"){
    renderProducts();
    return;
  }

  if(atab==="orders"){
    renderOrders();
    return;
  }

  if(atab==="pay"){
    renderPayments();
    return;
  }

  if(atab==="customers"){
    renderCustomers();
    return;
  }

  /*
     El resto de módulos conserva su implementación
     existente en el archivo original.
  */

  if(typeof renderLoyalty==="function"&&atab==="loyalty"){
    renderLoyalty();
    return;
  }

  if(typeof renderCoupons==="function"&&atab==="coupons"){
    renderCoupons();
    return;
  }

  if(typeof renderSettings==="function"&&atab==="settings"){
    renderSettings();
    return;
  }

  if(typeof renderBackup==="function"&&atab==="backup"){
    renderBackup();
    return;
  }

  if(typeof renderSecurity==="function"&&atab==="security"){
    renderSecurity();
    return;
  }

  renderDashboard();
}