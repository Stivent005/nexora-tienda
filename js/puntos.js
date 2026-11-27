
/* PUNTOS Y RULETA (lado del cliente).
   El ID de jugador identifica la cuenta de juego, no demuestra que quien consulta sea su titular.
   El acceso a saldos/historial queda desactivado hasta tener autenticaciÃ³n de titular verificada en servidor.
   - Canjear premios y girar la ruleta requieren ademÃ¡s el PIN; la autorizaciÃ³n del backend sigue pendiente.
   - Los puntos los suma y resta SOLA la base de datos cuando cambia el estado del pedido.
   - Costos, saldo, stock y el premio de la ruleta los decide siempre la base de datos; aquÃ­ solo se muestra y se anima.
   El PIN se guarda Ãºnicamente en memoria mientras la ventana estÃ¡ abierta (nunca en localStorage). */

/* Cerrado por defecto: no existe en el frontend un contexto de titular verificado por el servidor. */
var PUNTOS_PRIVADOS_AUTENTICADOS = false;

function ptsCfg() {
  var p = cfg.pts || {};

  return {
    cada: Number(p.cada) || 0,
    objetivo: Number(p.objetivo) || 0,
    porCompra: Number(p.por_compra) || 0,
    bienvenida: Number(p.bienvenida) || 0,
    activa: p.activa === true
  };
}

function puntosProgramaOn() {
  var c = ptsCfg();
  return REMOTO && c.activa;
}

function ptsAviso(total, promocionFF) {
  if (!promocionFF || !puntosProgramaOn()) return "";

  return '<p class="meta">ðŸŽ Los puntos de compras se acreditan a la cuenta Nexora autenticada cuando se confirma el pago. El ID de Free Fire es solo un dato de entrega y no permite consultar el saldo.</p>';
}

var COLORES = [
  "#22d3ee",
  "#e0457b",
  "#ffcf4a",
  "#8a5cf6",
  "#2dbd85",
  "#3b82f6"
];

var rueda = {
  rot: 0,
  cuenta: null,
  girando: false,
  ocupado: false,
  pin: null,
  pend: null,
  olvido: false
};

var MOT_PTS = {
  compra: "Compra",
  reversa_compra: "Compra cancelada",
  canje: "Canje de premio",
  canje_cancelado: "Canje cancelado",
  ruleta_giro: "Giro de ruleta",
  ruleta_premio: "Premio de la ruleta"
};

function ptsClave() {
  return "k" + Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6);
}

function ptsSoloNum(s) {
  return String(s || "").replace(/\D/g, "");
}

function ptsErr(e) {
  var m = String((e && e.message) || e || "");

  return /404|PGRST202|find the function|schema cache/i.test(m)
    ? "El programa de puntos todavÃ­a no estÃ¡ instalado en la base de datos."
    : "No se pudo completar. Revisa tu conexiÃ³n e intÃ©ntalo de nuevo.";
}

function ptsFecha(s) {
  var d = new Date(s);

  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      });
}

function ptsMsgErr(t) {
  return '<span class="err">' + esc(t) + '</span>';
}

/* Si el servidor dice que el PIN fallÃ³ o que hay bloqueo, se olvida el PIN en memoria. */
function ptsRevisaPin(texto) {
  if (/PIN|intentos/i.test(String(texto || ""))) rueda.pin = null;
}

/* ==========================================
   ABRIR MIS PUNTOS
   ========================================== */

function abrirPuntos() {
  var b = $("dbox");
  $("dlg").showModal();
  if (!Backend.accountsReady || !Backend.customer()) {
    b.innerHTML = '<h2>ðŸŽ Mis puntos</h2>' +
      '<p class="meta">El saldo se consulta con la cuenta autenticada de Nexora. El ID de Free Fire no sirve para iniciar sesiÃ³n ni consultar puntos.</p>' +
      '<div class="foot"><button class="btn" data-x="close">Cerrar</button>' +
      (Backend.accountsReady ? '<button class="btn primary" id="pt-auth">Iniciar sesiÃ³n / crear cuenta</button>' : '') + '</div>';
    var authButton = $("pt-auth");
    if (authButton) authButton.addEventListener("click", function () {
      $("dlg").close();
      abrirCuenta(false);
    });
    return;
  }
  b.innerHTML = '<h2>ðŸŽ Mis puntos</h2><p class="meta" role="status">Consultando tu saldo e historialâ€¦</p>' +
    '<div class="foot"><button class="btn" data-x="close">Cerrar</button></div>';
  cargarPuntosCliente();
}

function fechaMovimientoPuntos(valor) {
  var d = new Date(valor);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("es-CO", {dateStyle:"medium",timeStyle:"short"});
}

function pintarPuntosCliente(datos, aviso) {
  var b = $("dbox"), p = datos || {}, movimientos = Array.isArray(p.movimientos) ? p.movimientos : [], premios = Array.isArray(p.premios) ? p.premios : [];
  var ruleta=p.ruleta||{}, ruletaPremios=Array.isArray(ruleta.premios)?ruleta.premios:[], cupones=Array.isArray(p.cupones)?p.cupones:[], pendientes=Array.isArray(p.pendientes_ruleta)?p.pendientes_ruleta:[];
  var nombreMotivo = {compra:"Compra", bienvenida:"BonificaciÃ³n de bienvenida", reversa_compra:"ReversiÃ³n de compra", canje:"Canje", canje_cancelado:"Canje devuelto"};
  var html = '<h2>ðŸŽ Mis puntos</h2>' + (aviso ? '<p class="account-note" role="status">'+esc(aviso)+'</p>' : '');
  if(!aviso)html+='<p class="account-note" role="status"></p>';
  html += '<div class="box"><div class="meta">Saldo disponible</div><strong style="font-size:2rem">'+esc(p.puntos|0)+' puntos</strong>'+
    (p.activa ? '<p class="meta">Ganas '+esc(p.por_compra|0)+' puntos por compra y '+(p.cada>0?'1 punto por cada '+esc(fmt.format(p.cada))+' pagados.':'sin bonificaciÃ³n por monto configurada.')+'</p>' : '<p class="meta">El programa estÃ¡ pausado. Tu saldo e historial siguen disponibles.</p>')+'</div>';
  if (p.activa && premios.length) html += '<div class="bar"><b>Premios disponibles</b></div><div class="list">'+premios.map(function(x){
    return '<div class="row ptsl"><span><b>'+esc(x.nombre)+'</b><span class="meta">'+esc(x.descripcion||'')+' Â· '+esc(x.costo)+' puntos'+(x.disponible?'':' Â· agotado')+'</span></span>'+
      '<button class="btn sm" data-puntos-canje="'+esc(x.id)+'"'+(x.disponible&&(p.puntos|0)>=(x.costo|0)?'':' disabled')+'>Canjear</button></div>';
  }).join('')+'</div>';
  if(ruletaPremios.length)cfg.ruleta=ruletaPremios;
  if(p.activa&&ruleta.disponible&&ruletaPremios.length>1){
    html+='<div class="bar"><b>Ruleta de premios</b></div><p class="meta">Los descuentos generan un codigo de un uso. La vigencia y compra minima dependen de la regla indicada en cada cupon.</p>'+
      '<div class="wheelbox"><div class="pointer"></div><canvas id="wheel" width="600" height="600" aria-label="Ruleta de premios"></canvas></div>'+
      '<div class="foot"><button class="btn primary" id="pt-girar-auth"'+((p.puntos|0)<(ruleta.costo|0)||pendientes.length?' disabled':'')+'>Girar ruleta ('+esc(ruleta.costo|0)+' puntos)</button></div>';
  }
  if(pendientes.length){
    html+='<div class="bar"><b>Completa la entrega de tu premio</b></div><div class="list">'+pendientes.map(function(g){return '<div class="row ptsl"><span><b>'+esc(g.nombre)+'</b><span class="meta">Escribe tu ID de Free Fire para enviar el premio al administrador. Este dato solo se usa para la entrega.</span><input inputmode="numeric" maxlength="15" data-ff-premio="'+esc(g.id)+'" placeholder="ID de Free Fire"></span><button class="btn sm primary" data-enviar-premio="'+esc(g.id)+'">Enviar ID</button></div>';}).join('')+'</div>';
  }
  if(cupones.length)html+='<div class="bar"><b>Mis cupones de ruleta</b></div><div class="list">'+cupones.map(function(c){var vencido=Date.parse(c.vence)<=Date.now(),estado=c.usado?'Usado':c.reservado?'En un pedido':vencido?'Vencido':'Disponible';return '<div class="row ptsl"><span><b>'+esc(c.nombre)+'</b><span class="meta">'+esc(c.tipo==='pct'?c.valor+'% de descuento':fmt.format(c.valor))+' Ã‚Â· '+esc(estado)+' Ã‚Â· vence '+esc(fechaMovimientoPuntos(c.vence))+' Ã‚Â· mÃƒÂ­nimo '+esc(fmt.format(c.compra_minima||0))+'</span><br><code>'+esc(c.codigo)+'</code></span></div>';}).join('')+'</div>';
  var canjes = Array.isArray(p.canjes) ? p.canjes : [];
  if(canjes.length) html += '<div class="bar"><b>Mis canjes</b></div><div class="list">'+canjes.map(function(c){return '<div class="row ptsl"><span><b>'+esc(c.nombre)+'</b><span class="meta">'+esc(fechaMovimientoPuntos(c.creado))+' Â· '+esc(c.costo)+' pts</span></span><span class="tag'+(c.estado==='entregado'?'':' off')+'">'+esc(c.estado)+'</span></div>';}).join('')+'</div>';
  html += '<div class="bar"><b>Historial</b></div>'+(movimientos.length?'<div class="list">'+movimientos.map(function(m){var n=m.cantidad|0;return '<div class="row ptsl"><span><b>'+esc(nombreMotivo[m.motivo]||m.motivo)+'</b><span class="meta">'+esc(fechaMovimientoPuntos(m.creado))+(m.referencia?' Â· '+esc(m.referencia):'')+'</span></span><b>'+(n>0?'+':'')+esc(n)+'</b></div>';}).join('')+'</div>':'<div class="empty"><p>AÃºn no hay movimientos.</p></div>')+
    '<div class="foot"><button class="btn" data-x="close">Cerrar</button><button class="btn" id="pt-refresh">Actualizar</button></div>';
  b.innerHTML = html;
  if($("wheel"))dibujarRueda();
  var refresh = $("pt-refresh");
  if (refresh) refresh.addEventListener("click", cargarPuntosCliente);
  b.querySelectorAll("[data-puntos-canje]").forEach(function(button){button.addEventListener("click",function(){canjearPuntosCliente(button.getAttribute("data-puntos-canje"));});});
  var spin=$("pt-girar-auth");if(spin)spin.addEventListener("click",girarRuletaAutenticada);
  b.querySelectorAll("[data-enviar-premio]").forEach(function(button){button.addEventListener("click",function(){
    var id=button.getAttribute("data-enviar-premio"),input=b.querySelector('[data-ff-premio="'+id+'"]'),ff=String(input&&input.value||"").replace(/\D/g,"");
    if(!/^[0-9]{6,15}$/.test(ff)){if(input){input.setAttribute("aria-invalid","true");input.focus();}return;}
    button.disabled=true;
    Backend.completarPremioRuletaCliente(id,ff).then(function(){return cargarPuntosCliente("ID enviado. Tu premio quedÃƒÂ³ en la cola de entrega del administrador.");})
      .catch(function(e){button.disabled=false;var status=b.querySelector('[role="status"]');if(status)status.textContent=e.message;});
  });});
}

function girarRuletaAutenticada(){
  var button=$("pt-girar-auth");if(!button||button.disabled)return;
  var user=Backend.customer()||{},storeKey="nexora_ruleta_clave_"+String(user.id||"cliente"),key="";
  try{key=sessionStorage.getItem(storeKey)||"";if(!key){key=ptsClave();sessionStorage.setItem(storeKey,key);}}catch(e){key=ptsClave();}
  button.disabled=true;button.textContent="Girandoâ€¦";
  Backend.girarRuletaCliente(key).then(function(r){
    if(!r||r.error)throw new Error(r&&r.error||"No se pudo completar el giro.");
    try{sessionStorage.removeItem(storeKey);}catch(e){}
    var aviso=r.tipo==="nada"?"Esta vez no hubo premio. Â¡Sigue acumulando puntos!":
      r.tipo==="puntos"?"Ganaste "+r.valor+" puntos. Ya estÃ¡n en tu saldo.":
      r.tipo==="manual"?"Ganaste "+r.nombre+". Escribe tu ID de Free Fire para enviar el premio al administrador.":
      "Ganaste "+r.nombre+". Tu cupÃ³n de un uso es "+r.codigo+".";
    var canvas=$("wheel"),n=(cfg.ruleta||[]).length,finish=function(){cargarPuntosCliente(aviso);};
    if(!canvas||!n||Number(r.segmentos)!==n){finish();return;}
    var seg=360/n,index=Math.max(0,Math.min(n-1,Number(r.indice)||0)),reduced=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
    rueda.rot=(Math.floor(rueda.rot/360)+6)*360-(index+.5)*seg;
    canvas.style.transition=reduced?"none":"transform 4s cubic-bezier(.12,.7,.12,1)";
    requestAnimationFrame(function(){canvas.style.transform="rotate("+rueda.rot+"deg)";});
    setTimeout(finish,reduced?0:4200);
  }).catch(function(e){button.disabled=false;button.textContent="Reintentar giro";var status=$("dbox").querySelector('[role="status"]');if(status)status.textContent=e&&e.message||"No se pudo completar el giro.";});
}

function cargarPuntosCliente(aviso) {
  if (!Backend.customer()) return Promise.resolve(false);
  return Backend.misPuntosCliente().then(function(datos){pintarPuntosCliente(datos,aviso);return datos;})
    .catch(function(e){var b=$("dbox");b.innerHTML='<h2>ðŸŽ Mis puntos</h2><p class="err" role="alert">'+esc(e&&e.message||"No se pudieron consultar los puntos.")+'</p><div class="foot"><button class="btn" data-x="close">Cerrar</button><button class="btn" id="pt-refresh">Reintentar</button></div>';$("pt-refresh").addEventListener("click",function(){cargarPuntosCliente();});return false;});
}

function canjearPuntosCliente(id) {
  if (!window.confirm("Â¿Confirmas canjear este premio? El saldo y el stock se validan en el servidor.")) return;
  var clave=ptsClave();
  Backend.canjearPuntosCliente(id,clave).then(function(r){return cargarPuntosCliente(r&&r.nombre?"Canje registrado: "+r.nombre:"Canje registrado.");})
    .catch(function(e){cargarPuntosCliente(e&&e.message||"No se pudo completar el canje.");});
}

/* ==========================================
   CONSULTAR CUENTA (requiere autenticaciÃ³n verificada del titular)
   ========================================== */

function ptsAplicar(a, r) {
  a.existe = !!r.existe;
  a.tienePin = !!r.tiene_pin;
  a.puntos = r.puntos | 0;
  a.total = r.total_ganado | 0;
  a.mov = r.movimientos || [];
  a.canjeables = r.premios || [];

  /* La ruleta se dibuja con lo que hay HOY en la base de datos. */
  if (r.ruleta && Array.isArray(r.ruleta.premios)) {
    cfg.ruleta = r.ruleta.premios;
    cfg.pts = Object.assign({}, cfg.pts || {}, {
      objetivo: Number(r.ruleta.costo) || 0
    });
  }
}

function verPuntos(ff, msg) {
  if (!PUNTOS_PRIVADOS_AUTENTICADOS) {
    var blocked = $("pt-err");
    if (blocked) blocked.textContent = "El ID del juego no autoriza consultar saldo ni historial.";
    return Promise.resolve(false);
  }

  var el = $("pt-ff");
  var v = ptsSoloNum(ff || (el && el.value));

  if (v.length < 6 || v.length > 15) {
    if ($("pt-err")) {
      $("pt-err").textContent =
        "Escribe tu ID de Free Fire (solo nÃºmeros).";
    }
    return;
  }

  if ($("pt-err")) $("pt-err").textContent = "Consultandoâ€¦";

  Backend.rpc("consultar_puntos", { p_ff: v })
    .then(function (r) {
      if (!r || r.error) {
        if ($("pt-err")) {
          $("pt-err").textContent =
            (r && r.error) || "No se pudo consultar.";
        }
        return;
      }

      var prev = rueda.cuenta && rueda.cuenta.ff === r.ff_id
        ? rueda.cuenta
        : null;

      rueda.cuenta = {
        ff: r.ff_id,
        premios: prev ? prev.premios : [],
        canjes: prev ? prev.canjes : []
      };

      if (!prev) rueda.pin = null;

      if (r && r.ff_id) {
        var sd = Cookies.ok("preferencias") ? lsGet("tienda_datos", {}) : {};
        recordarDatos(sd.n || "", sd.t || "", r.ff_id);
      }

      ptsAplicar(rueda.cuenta, r);
      pintarCuenta(msg);
    })
    .catch(function (e) {
      if ($("pt-err")) $("pt-err").textContent = ptsErr(e);
    });
}

/* Vuelve a leer la cuenta (y los datos privados si hay PIN) y la dibuja. */
function recargarCuenta(msg) {
  if (!PUNTOS_PRIVADOS_AUTENTICADOS) return Promise.resolve(false);

  var a = rueda.cuenta;

  if (!a) return;

  Backend.rpc("consultar_puntos", { p_ff: a.ff })
    .then(function (r) {
      if (!r || r.error) throw new Error((r && r.error) || "x");

      ptsAplicar(a, r);

      if (!rueda.pin) return null;

      return Backend.rpc("detalle_cuenta", {
        p_ff: a.ff,
        p_pin: rueda.pin
      }).then(function (d) {
        if (d && !d.error) {
          a.premios = d.cupones || [];
          a.canjes = d.canjes || [];
        } else {
          rueda.pin = null;
        }
      });
    })
    .then(function () {
      pintarCuenta(msg);
    })
    .catch(function (e) {
      pintarCuenta(ptsMsgErr(ptsErr(e)));
    });
}

/* ==========================================
   FORMULARIOS DE ACCESO (crear cuenta, activar, PIN)
   ========================================== */

function ptsInputPin(id, ph, lbl) {
  return '<div class="form-field" id="grp-' + id + '">' +
    (lbl ? '<label class="field-label" for="' + id + '">' + esc(lbl) + ' *</label>' : '') +
    '<div class="input-wrap">' +
      '<input id="' + id + '" type="password" inputmode="numeric" ' +
        'maxlength="6" autocomplete="off" placeholder="' + esc(ph) + '">' +
      '<span class="field-icon" aria-hidden="true"></span>' +
    '</div>' +
    '<div class="field-msg"></div>' +
  '</div>';
}

function ptsFormAcceso(a) {
  if (!a.existe) {
    return '<div class="box"><div class="meta">' +
        'Este ID todavÃ­a no tiene cuenta. Crea un <b>PIN de 4 a 6 nÃºmeros</b> ' +
        'para poder canjear premios y girar la ruleta. No lo compartas.</div>' +
      '<div class="f">' + ptsInputPin("pt-pin1", "Crea tu PIN (4 a 6 nÃºmeros)", "PIN de seguridad (4 a 6 nÃºmeros)") + '</div>' +
      '<div class="foot"><button class="btn primary" id="pt-crear">Crear mi cuenta</button></div></div>';
  }

  if (!a.tienePin || rueda.olvido) {
    return '<div class="box"><div class="meta">' +
        (a.tienePin
          ? 'Para cambiar tu PIN escribe el nÃºmero de un pedido tuyo hecho con este ID.'
          : 'Este ID ya tiene puntos de tus compras. ActÃ­valo con el nÃºmero de un pedido tuyo hecho con este ID y crea tu PIN.') +
      '</div>' +
      '<div class="f">' +
        '<div class="form-field" id="grp-pt-ped">' +
          '<label class="field-label" for="pt-ped">NÃºmero de pedido *</label>' +
          '<div class="input-wrap">' +
            '<input id="pt-ped" maxlength="12" autocomplete="off" placeholder="Ej: A1B2C3">' +
            '<span class="field-icon" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="field-msg"></div>' +
        '</div>' +
        ptsInputPin("pt-pin1", "Nuevo PIN (4 a 6 nÃºmeros)", "Nuevo PIN") +
      '</div>' +
      '<div class="foot">' +
        (a.tienePin ? '<button class="btn" id="pt-olv0">Cancelar</button>' : '') +
        '<button class="btn primary" id="pt-act">Guardar PIN</button>' +
      '</div></div>';
  }

  if (!rueda.pin) {
    return '<div class="box"><div class="meta">Escribe tu PIN para canjear premios o girar la ruleta.</div>' +
      '<div class="f">' + ptsInputPin("pt-pin", "Tu PIN (4 a 6 nÃºmeros)", "PIN de acceso") + '</div>' +
      '<div class="foot">' +
        '<button class="btn" id="pt-olv">OlvidÃ© mi PIN</button>' +
        '<button class="btn primary" id="pt-unl">Desbloquear</button>' +
      '</div></div>';
  }

  return '<div class="meta">ðŸ”“ PIN verificado. ' +
    '<button class="btn sm" id="pt-bloq">Bloquear</button></div>';
}

/* ==========================================
   PERFIL, CANJES, RULETA E HISTORIAL
   ========================================== */

function pintarCuenta(msg) {
  var a = rueda.cuenta;
  var c = ptsCfg();

  if (!a) return;

  var pct = c.objetivo > 0
    ? Math.min(100, Math.round(a.puntos * 100 / c.objetivo))
    : 0;

  var listo = c.objetivo > 0 && a.puntos >= c.objetivo;
  var puede = listo && !!rueda.pin;

  var h = '<h2>PLAYER PROFILE</h2>' +
    perfilHUD(a, c, pct, listo) +
    '<div id="pt-res" class="pres">' + (msg || "") + '</div>' +
    ptsFormAcceso(a);

  /* Premios que se pueden canjear (precio y stock vienen de la base de datos) */
  if (a.canjeables && a.canjeables.length) {
    h += '<div class="bar"><b>Canjear premios</b></div><div class="list">' +
      a.canjeables.map(function (p) {
        var alcanza = a.puntos >= (p.costo | 0);
        var ok = p.disponible && alcanza;

        return '<div class="row ptsl"><span><b>' + esc(p.nombre) + '</b> ' +
            '<span class="meta">' + esc(p.descripcion || "") + ' â€¢ ' +
            esc(p.costo) + ' pts' +
            (p.disponible ? '' : ' â€¢ agotado') + '</span></span>' +
          '<button class="btn sm" data-canje="' + esc(p.id) + '"' +
            (ok ? '' : ' disabled') + '>Canjear</button></div>';
      }).join("") + '</div>';
  }

  h += '<div class="wheelbox">' +
      '<div class="pointer"></div>' +
      '<canvas id="wheel" width="600" height="600" ' +
        'aria-label="Ruleta de premios"></canvas>' +
    '</div>';

  /* Cupones y canjes: solo con PIN */
  if (rueda.pin && a.premios && a.premios.length) {
    h += '<div class="meta">Tus cupones disponibles (Ãºsalos en el carrito):</div>' +
      a.premios.map(function (p) {
        return '<div class="line">' +
          '<span><b>' + esc(p.codigo) + '</b> ' +
            '<span class="meta">' + esc(p.nombre) + '</span></span>' +
          '<button class="btn sm" data-copy="' + esc(p.codigo) + '">Copiar</button>' +
        '</div>';
      }).join("");
  }

  if (rueda.pin && a.canjes && a.canjes.length) {
    h += '<div class="bar"><b>Mis canjes y premios</b></div><div class="list">' +
      a.canjes.map(function (x) {
        return '<div class="row ptsl"><span>' + esc(x.nombre) +
          ' <span class="meta">' + esc(ptsFecha(x.creado)) + '</span></span>' +
          '<span class="tag' + (x.estado === "entregado" ? "" : " off") + '">' +
          esc(x.estado) + '</span></div>';
      }).join("") + '</div>';
  }

  /* Historial de movimientos (sin nÃºmeros de pedido) */
  h += '<div class="bar"><b>Historial</b></div>' +
    (a.mov && a.mov.length
      ? '<div class="list">' + a.mov.slice(0, 15).map(function (m) {
          var n = m.cantidad | 0;

          return '<div class="row ptsl"><span>' +
              esc(MOT_PTS[m.motivo] || m.motivo) +
              ' <span class="meta">' + esc(ptsFecha(m.creado)) + '</span></span>' +
            '<b>' + (n > 0 ? "+" : "") + n + '</b></div>';
        }).join("") + '</div>'
      : '<div class="empty"><p>AÃºn no hay movimientos. Tus puntos se suman cuando confirmamos el pago de un pedido hecho con este ID.</p></div>');

  h += '<div class="foot">' +
      '<button class="btn" data-x="close">Cerrar</button>' +
      '<button class="btn primary" id="pt-girar"' +
        (puede ? "" : " disabled") +
      '>ðŸŽ° Girar ruleta (' + c.objetivo + ' pts)</button>' +
    '</div>';

  $("dbox").innerHTML = h;

  dibujarRueda();
  ptsEnlazar();
}

function ptsEnlazar() {
  var on = function (id, fn) {
    var el = $(id);
    if (el) el.addEventListener("click", fn);
  };

  on("pt-girar", girarRuleta);
  on("pt-crear", crearCuentaPts);
  on("pt-act", activarPin);
  on("pt-unl", desbloquearPin);

  on("pt-olv", function () {
    rueda.olvido = true;
    pintarCuenta();
  });

  on("pt-olv0", function () {
    rueda.olvido = false;
    pintarCuenta();
  });

  on("pt-bloq", function () {
    rueda.pin = null;
    pintarCuenta();
  });

  document.querySelectorAll("[data-canje]").forEach(function (b) {
    b.addEventListener("click", function () {
      canjearPremio(Number(b.getAttribute("data-canje")));
    });
  });

  var pin1 = $("pt-pin1");
  if (pin1) {
    var valPin1 = function() {
      var v = pin1.value.trim();
      if (!v) setFieldValidation(pin1, false, "Ingresa un PIN numÃ©rico");
      else if (!ptsPinValido(v)) setFieldValidation(pin1, false, "El PIN debe tener 4 a 6 nÃºmeros");
      else setFieldValidation(pin1, true, "", "PIN vÃ¡lido");
    };
    pin1.addEventListener("input", valPin1);
    pin1.addEventListener("blur", valPin1);
    pin1.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        if ($("pt-crear")) crearCuentaPts();
        else if ($("pt-act")) activarPin();
      }
    });
  }

  var ped = $("pt-ped");
  if (ped) {
    var valPed = function() {
      var v = ped.value.trim().replace(/^#/, "");
      if (!v) setFieldValidation(ped, false, "Ingresa el nÃºmero de tu pedido");
      else if (v.length < 4) setFieldValidation(ped, false, "NÃºmero de pedido incompleto");
      else setFieldValidation(ped, true, "", "Formato vÃ¡lido");
    };
    ped.addEventListener("input", valPed);
    ped.addEventListener("blur", valPed);
  }

  var pin = $("pt-pin");
  if (pin) {
    var valPin = function() {
      var v = pin.value.trim();
      if (!v) setFieldValidation(pin, false, "Ingresa tu PIN");
      else if (!ptsPinValido(v)) setFieldValidation(pin, false, "El PIN debe tener 4 a 6 nÃºmeros");
      else setFieldValidation(pin, true, "", "PIN listo");
    };
    pin.addEventListener("input", valPin);
    pin.addEventListener("blur", valPin);
    pin.addEventListener("keydown", function (e) {
      if (e.key === "Enter") desbloquearPin();
    });
  }
}

function ptsPinValido(v) {
  return /^[0-9]{4,6}$/.test(String(v || ""));
}

function crearCuentaPts() {
  var a = rueda.cuenta;
  var pin = $("pt-pin1").value.trim();

  if (!a || rueda.ocupado) return;

  if (!ptsPinValido(pin)) {
    if ($("pt-pin1")) setFieldValidation($("pt-pin1"), false, "El PIN debe tener de 4 a 6 nÃºmeros");
    $("pt-res").innerHTML = ptsMsgErr("El PIN debe tener de 4 a 6 nÃºmeros.");
    return;
  }

  rueda.ocupado = true;

  Backend.rpc("crear_cuenta", { p_ff: a.ff, p_pin: pin })
    .then(function (r) {
      rueda.ocupado = false;

      if (!r || r.error) {
        if ($("pt-pin1")) setFieldValidation($("pt-pin1"), false, (r && r.error) || "No se pudo crear");
        $("pt-res").innerHTML = ptsMsgErr((r && r.error) || "No se pudo crear.");
        return;
      }

      rueda.pin = pin;
      recargarCuenta("Cuenta creada. Ya puedes canjear y girar cuando tengas puntos.");
    })
    .catch(function (e) {
      rueda.ocupado = false;
      $("pt-res").innerHTML = ptsMsgErr(ptsErr(e));
    });
}

function activarPin() {
  var a = rueda.cuenta;
  var ped = $("pt-ped").value.trim().replace(/^#/, "");
  var pin = $("pt-pin1").value.trim();

  if (!a || rueda.ocupado) return;

  if (ped.length < 4 || !ptsPinValido(pin)) {
    if (ped.length < 4 && $("pt-ped")) setFieldValidation($("pt-ped"), false, "NÃºmero de pedido no vÃ¡lido");
    if (!ptsPinValido(pin) && $("pt-pin1")) setFieldValidation($("pt-pin1"), false, "El PIN debe tener 4 a 6 nÃºmeros");
    $("pt-res").innerHTML = ptsMsgErr(
      "Escribe el nÃºmero de tu pedido y un PIN de 4 a 6 nÃºmeros."
    );
    return;
  }

  rueda.ocupado = true;

  Backend.rpc("definir_pin", { p_ff: a.ff, p_pedido: ped, p_pin: pin })
    .then(function (r) {
      rueda.ocupado = false;

      if (!r || r.error) {
        if ($("pt-ped")) setFieldValidation($("pt-ped"), false, "Pedido no coincide con este ID");
        $("pt-res").innerHTML = ptsMsgErr((r && r.error) || "No se pudo guardar.");
        return;
      }

      rueda.pin = pin;
      rueda.olvido = false;
      recargarCuenta("PIN guardado.");
    })
    .catch(function (e) {
      rueda.ocupado = false;
      $("pt-res").innerHTML = ptsMsgErr(ptsErr(e));
    });
}

function desbloquearPin() {
  var a = rueda.cuenta;
  var pin = $("pt-pin").value.trim();

  if (!a || rueda.ocupado) return;

  if (!ptsPinValido(pin)) {
    if ($("pt-pin")) setFieldValidation($("pt-pin"), false, "El PIN debe tener de 4 a 6 nÃºmeros");
    $("pt-res").innerHTML = ptsMsgErr("El PIN debe tener de 4 a 6 nÃºmeros.");
    return;
  }

  rueda.ocupado = true;

  Backend.rpc("detalle_cuenta", { p_ff: a.ff, p_pin: pin })
    .then(function (r) {
      rueda.ocupado = false;

      if (!r || r.error) {
        ptsRevisaPin(r && r.error);
        if ($("pt-pin")) setFieldValidation($("pt-pin"), false, (r && r.error) || "PIN incorrecto");
        $("pt-res").innerHTML = ptsMsgErr((r && r.error) || "PIN incorrecto.");
        return;
      }

      rueda.pin = pin;
      a.premios = r.cupones || [];
      a.canjes = r.canjes || [];
      pintarCuenta("ðŸ”“ PIN verificado. Ya puedes canjear premios o girar la ruleta.");
    })
    .catch(function (e) {
      rueda.ocupado = false;
      $("pt-res").innerHTML = ptsMsgErr(ptsErr(e));
    });
}

/* ==========================================
   CANJEAR UN PREMIO
   ========================================== */

function canjearPremio(id) {
  var a = rueda.cuenta;
  var p = null;

  if (!a || rueda.ocupado || rueda.girando) return;

  (a.canjeables || []).forEach(function (x) {
    if (Number(x.id) === id) p = x;
  });

  if (!p) return;

  if (!rueda.pin) {
    $("pt-res").innerHTML = ptsMsgErr("Escribe tu PIN y pulsa Desbloquear para canjear.");
    return;
  }

  if (!window.confirm('Â¿Canjear "' + p.nombre + '" por ' + p.costo + ' puntos?')) return;

  rueda.ocupado = true;

  /* La misma clave se reutiliza si hay que reintentar: un canje repetido no se cobra dos veces. */
  if (!rueda.pend || rueda.pend.t !== "c" + id) {
    rueda.pend = { t: "c" + id, k: ptsClave() };
  }

  Backend.rpc("canjear_premio", {
    p_ff: a.ff,
    p_pin: rueda.pin,
    p_premio: id,
    p_clave: rueda.pend.k
  })
    .then(function (r) {
      rueda.ocupado = false;
      rueda.pend = null;

      if (!r || r.error) {
        ptsRevisaPin(r && r.error);
        recargarCuenta(ptsMsgErr((r && r.error) || "No se pudo canjear."));
        return;
      }

      recargarCuenta(
        'Â¡Canjeaste <b>' + esc(r.nombre) + '</b>! Te lo entregaremos pronto.'
      );
    })
    .catch(function (e) {
      rueda.ocupado = false;
      $("pt-res").innerHTML = ptsMsgErr(ptsErr(e));
    });
}

/* ==========================================
   DIBUJAR RULETA â€” NEÃ“N GAMING
   ========================================== */

function dibujarRueda() {
  var cv = $("wheel");

  if (!cv) return;

  var g = cv.getContext("2d");
  var R = cfg.ruleta || [];
  var n = R.length;

  if (!g || !n) return;

  var r = 300;
  var s = (Math.PI * 2) / n;
  var total = Math.PI * 2;

  cv.style.transform = "rotate(" + rueda.rot + "deg)";

  g.clearRect(0, 0, 600, 600);

  // Base oscura con profundidad.
  g.save();

  g.beginPath();
  g.arc(r, r, 296, 0, total);

  g.fillStyle = "#080d1b";
  g.shadowColor = "#8b5cf6";
  g.shadowBlur = 24;
  g.fill();

  g.restore();

  // Segmentos con degradados y separaciÃ³n luminosa.
  R.forEach(function (p, i) {
    var a0 = -Math.PI / 2 + i * s;
    var a1 = a0 + s;
    var color = COLORES[i % COLORES.length];

    g.save();

    g.beginPath();
    g.moveTo(r, r);
    g.arc(r, r, 278, a0, a1);
    g.closePath();

    var grad = g.createRadialGradient(
      r, r, 35,
      r, r, 280
    );

    grad.addColorStop(0, color);
    grad.addColorStop(0.65, color);
    grad.addColorStop(1, "#101629");

    g.fillStyle = grad;
    g.fill();

    g.strokeStyle = "rgba(255,255,255,.72)";
    g.lineWidth = 2.5;
    g.stroke();

    // LÃ­nea luminosa interior.
    g.beginPath();

    g.moveTo(
      r + Math.cos(a0) * 48,
      r + Math.sin(a0) * 48
    );

    g.lineTo(
      r + Math.cos(a0) * 272,
      r + Math.sin(a0) * 272
    );

    g.strokeStyle = "rgba(255,255,255,.2)";
    g.lineWidth = 1;
    g.stroke();

    // Texto orientado para facilitar su lectura.
    g.translate(r, r);

    var medio = a0 + s / 2;
    var invertido = Math.cos(medio) < 0;

    g.rotate(medio);

    if (invertido) {
      g.rotate(Math.PI);
    }

    var nombre = String(p.nombre || "Premio").trim();
    var max = n > 10 ? 12 : n > 7 ? 15 : 19;

    var texto = nombre.length > max
      ? nombre.slice(0, max - 1) + "â€¦"
      : nombre;

    g.textAlign = invertido ? "left" : "right";
    g.textBaseline = "middle";

    g.font =
      "700 " + (n > 9 ? 18 : 23) +
      "px Rajdhani, sans-serif";

    g.lineJoin = "round";
    g.strokeStyle = "rgba(0,0,0,.8)";
    g.lineWidth = 5;

    g.strokeText(
      texto,
      invertido ? -248 : 248,
      0,
      190
    );

    g.fillStyle = "#ffffff";
    g.shadowColor = "rgba(0,0,0,.8)";
    g.shadowBlur = 7;

    g.fillText(
      texto,
      invertido ? -248 : 248,
      0,
      190
    );

    g.restore();
  });

  // Aro exterior oscuro y borde de neÃ³n.
  g.save();

  g.beginPath();
  g.arc(r, r, 291, 0, total);
  g.strokeStyle = "#050812";
  g.lineWidth = 16;
  g.stroke();

  g.beginPath();
  g.arc(r, r, 289, 0, total);
  g.strokeStyle = "#22d3ee";
  g.lineWidth = 3;
  g.shadowColor = "#22d3ee";
  g.shadowBlur = 18;
  g.stroke();

  g.beginPath();
  g.arc(r, r, 278, 0, total);
  g.strokeStyle = "rgba(255,255,255,.6)";
  g.lineWidth = 2;
  g.shadowBlur = 0;
  g.stroke();

  g.restore();

  // PequeÃ±as luces alrededor de la ruleta.
  for (var j = 0; j < 36; j++) {
    var ang = (j / 36) * total;
    var radio = j % 3 === 0 ? 285 : 286;

    var x = r + Math.cos(ang) * radio;
    var y = r + Math.sin(ang) * radio;

    g.save();

    g.beginPath();
    g.arc(
      x,
      y,
      j % 3 === 0 ? 3 : 1.5,
      0,
      total
    );

    g.fillStyle = j % 3 === 0
      ? "#ffffff"
      : "#22d3ee";

    g.shadowColor = "#22d3ee";
    g.shadowBlur = 8;
    g.fill();

    g.restore();
  }

  // Centro metÃ¡lico.
  g.save();

  var centro = g.createRadialGradient(
    280, 276, 2,
    r, r, 48
  );

  centro.addColorStop(0, "#ffffff");
  centro.addColorStop(0.16, "#22d3ee");
  centro.addColorStop(0.42, "#263b60");
  centro.addColorStop(0.76, "#080d1b");
  centro.addColorStop(1, "#8b5cf6");

  g.beginPath();
  g.arc(r, r, 46, 0, total);

  g.fillStyle = centro;
  g.shadowColor = "#8b5cf6";
  g.shadowBlur = 22;
  g.fill();

  g.strokeStyle = "#ffffff";
  g.lineWidth = 3;
  g.stroke();

  g.beginPath();
  g.arc(r, r, 32, 0, total);

  g.strokeStyle = "#22d3ee";
  g.lineWidth = 2;
  g.shadowColor = "#22d3ee";
  g.shadowBlur = 12;
  g.stroke();

  g.shadowBlur = 0;
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "900 17px Rajdhani, sans-serif";
  g.fillText("SPIN", r, r);

  g.restore();
}

/* ==========================================
   GIRAR RULETA
   El resultado siempre viene de Supabase;
   la animaciÃ³n solo lo representa.
   ========================================== */

function girarRuleta() {
  var a = rueda.cuenta;

  if (!a || rueda.girando || rueda.ocupado) return;

  if (!rueda.pin) {
    $("pt-res").innerHTML = ptsMsgErr("Escribe tu PIN y pulsa Desbloquear para girar.");
    return;
  }

  rueda.girando = true;

  $("pt-girar").disabled = true;
  $("pt-res").textContent = "Girandoâ€¦";

  /* La misma clave se reutiliza si hay que reintentar: un giro repetido no se cobra dos veces. */
  if (!rueda.pend || rueda.pend.t !== "g") {
    rueda.pend = { t: "g", k: ptsClave() };
  }

  Backend.rpc("girar_ruleta", {
    p_ff: a.ff,
    p_pin: rueda.pin,
    p_clave: rueda.pend.k
  })
    .then(function (r) {
      if (!r || r.error) {
        rueda.girando = false;
        rueda.pend = null;
        ptsRevisaPin(r && r.error);

        recargarCuenta(
          ptsMsgErr((r && r.error) || "No se pudo girar.")
        );

        return;
      }

      rueda.pend = null;

      var cv = $("wheel");
      var n = (cfg.ruleta || []).length;
      var seg = n ? 360 / n : 360;

      /* Si el administrador cambiÃ³ la ruleta mientras girabas, no se anima el Ã¡ngulo: solo se muestra el resultado. */
      var coincide = n > 0 && (r.segmentos | 0) === n;

      var i = Math.max(
        0,
        Math.min(Math.max(n - 1, 0), r.indice | 0)
      );

      var quieto = window.matchMedia &&
        matchMedia("(prefers-reduced-motion: reduce)").matches;

      var fin = function () {
        rueda.girando = false;

        a.puntos = r.puntos | 0;

        var txt = r.tipo === "nada"
          ? "Esta vez no hubo premio. Â¡Sigue acumulando puntos!"
          : r.tipo === "puntos"
            ? 'Â¡Ganaste <b>' + esc(r.nombre) + '</b>! Ya estÃ¡ en tu saldo.'
            : r.tipo === "manual"
              ? 'Â¡Ganaste <b>' + esc(r.nombre) +
                '</b>! Te lo entregaremos pronto.'
              : 'Â¡Ganaste <b>' + esc(r.nombre) +
                '</b>! Tu cupÃ³n: <b>' + esc(r.codigo) +
                '</b> (Ãºsalo en el carrito).';

        recargarCuenta(txt);
      };

      if (!coincide || !cv) {
        fin();
        return;
      }

      rueda.rot =
        (Math.floor(rueda.rot / 360) + 6) * 360 -
        (i + 0.5) * seg;

      // Respeta la preferencia de movimiento reducido.
      if (quieto) {
        cv.style.transition = "none";
        cv.style.transform =
          "rotate(" + rueda.rot + "deg)";

        fin();
        return;
      }

      var hecho = false;

      var una = function () {
        if (hecho) return;

        hecho = true;
        fin();
      };

      cv.addEventListener("transitionend", una, {
        once: true
      });

      // Respaldo por si el navegador no dispara transitionend.
      setTimeout(una, 5200);

      requestAnimationFrame(function () {
        cv.style.transform =
          "rotate(" + rueda.rot + "deg)";
      });
    })
    .catch(function (e) {
      rueda.girando = false;

      /* No se borra rueda.pend: si el giro sÃ­ se hizo, el reintento devuelve el mismo resultado sin cobrar de nuevo. */
      pintarCuenta(ptsMsgErr(ptsErr(e)));
    });
}
