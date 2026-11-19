
/* PUNTOS Y RULETA (lado del cliente).
   El ID de jugador identifica la cuenta de juego, no demuestra que quien consulta sea su titular.
   El acceso a saldos/historial queda desactivado hasta tener autenticación de titular verificada en servidor.
   - Canjear premios y girar la ruleta requieren además el PIN; la autorización del backend sigue pendiente.
   - Los puntos los suma y resta SOLA la base de datos cuando cambia el estado del pedido.
   - Costos, saldo, stock y el premio de la ruleta los decide siempre la base de datos; aquí solo se muestra y se anima.
   El PIN se guarda únicamente en memoria mientras la ventana está abierta (nunca en localStorage). */

/* Cerrado por defecto: no existe en el frontend un contexto de titular verificado por el servidor. */
var PUNTOS_PRIVADOS_AUTENTICADOS = false;

function ptsCfg() {
  var p = cfg.pts || {};

  return {
    cada: Number(p.cada) || 0,
    objetivo: Number(p.objetivo) || 0
  };
}

function ruletaOn() {
  var c = ptsCfg();

  return REMOTO &&
    c.cada > 0 &&
    c.objetivo > 0 &&
    Array.isArray(cfg.ruleta) &&
    cfg.ruleta.length >= 2;
}

function ptsAviso(total, promocionFF) {
  if (!promocionFF || !ruletaOn()) return "";

  var c = ptsCfg();
  var g = Math.floor(Number(total) / c.cada);

  return '<p class="meta">🎁 ' +
    (g > 0
      ? 'Tras confirmar el pago, el programa calculará los puntos que correspondan. '
      : '') +
    'El saldo y el historial están protegidos: el ID de juego por sí solo no autoriza una consulta.</p>';
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
    ? "El programa de puntos todavía no está instalado en la base de datos."
    : "No se pudo completar. Revisa tu conexión e inténtalo de nuevo.";
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

/* Si el servidor dice que el PIN falló o que hay bloqueo, se olvida el PIN en memoria. */
function ptsRevisaPin(texto) {
  if (/PIN|intentos/i.test(String(texto || ""))) rueda.pin = null;
}

/* ==========================================
   ABRIR MIS PUNTOS
   ========================================== */

function abrirPuntos() {
  var b = $("dbox");

  if (!ruletaOn()) {
    b.innerHTML =
      '<h2>🎁 Mis puntos</h2>' +
      '<p class="meta">El programa de puntos aún no está disponible.</p>' +
      '<div class="foot">' +
        '<button class="btn" data-x="close">Cerrar</button>' +
      '</div>';

    $("dlg").showModal();
    return;
  }

  if (!PUNTOS_PRIVADOS_AUTENTICADOS) {
    b.innerHTML =
      '<h2>🎁 Mis puntos</h2>' +
      '<p class="msg" role="status">La consulta de saldo e historial está temporalmente protegida. El ID de Free Fire identifica la cuenta del juego, pero no demuestra que quien consulta sea su titular. El acceso se habilitará cuando exista autenticación privada verificada.</p>' +
      '<div class="foot"><button class="btn" data-x="close">Cerrar</button></div>';
    $("dlg").showModal();
    return;
  }

  var c = ptsCfg();
  var sd = Cookies.ok("preferencias")
    ? lsGet("tienda_datos", {})
    : {};

  rueda.cuenta = null;
  rueda.pin = null;
  rueda.pend = null;
  rueda.olvido = false;

  b.innerHTML =
    '<h2>🎁 Mis puntos</h2>' +
    '<p class="meta">Ganas <b>1 punto por cada ' +
      fmt.format(c.cada) +
    '</b> de tus compras pagadas. Para consultar el saldo se requerirá una sesión verificada del titular; el ID de Free Fire solo identifica la cuenta del juego. ' +
    'Los canjes y giros seguirán requiriendo un PIN y autorización del servidor.</p>' +

    '<div class="f">' +
      '<div class="form-field" id="grp-pt-ff">' +
        '<label class="field-label" for="pt-ff">ID de jugador Free Fire *</label>' +
        '<div class="input-wrap">' +
          '<input id="pt-ff" inputmode="numeric" maxlength="20" ' +
            'autocomplete="off" placeholder="Ej: 123456789 (solo números)" ' +
            'value="' + esc(sd.ff || "") + '">' +
          '<span class="field-icon" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="field-msg"></div>' +
      '</div>' +
    '</div>' +

    '<div class="err" id="pt-err"></div>' +

    '<div class="foot">' +
      '<button class="btn" data-x="close">Cerrar</button>' +
      '<button class="btn primary" id="pt-ver">Ver mis puntos</button>' +
    '</div>';

  var ptFF = $("pt-ff");
  if (ptFF) {
    var valPtFF = function() {
      var v = ptsSoloNum(ptFF.value);
      if (!ptFF.value.trim()) setFieldValidation(ptFF, false, "Ingresa tu ID de jugador Free Fire");
      else if (v.length < 6 || v.length > 15) setFieldValidation(ptFF, false, "El ID debe tener entre 6 y 15 números");
      else setFieldValidation(ptFF, true, "", "ID válido");
    };
    ptFF.addEventListener("input", valPtFF);
    ptFF.addEventListener("blur", valPtFF);
    if (ptFF.value.trim()) valPtFF();
  }

  $("pt-ver").addEventListener("click", function () {
    verPuntos();
  });

  $("pt-ff").addEventListener("keydown", function (e) {
    if (e.key === "Enter") verPuntos();
  });

  $("dlg").showModal();
}

/* ==========================================
   CONSULTAR CUENTA (requiere autenticación verificada del titular)
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
        "Escribe tu ID de Free Fire (solo números).";
    }
    return;
  }

  if ($("pt-err")) $("pt-err").textContent = "Consultando…";

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
        'Este ID todavía no tiene cuenta. Crea un <b>PIN de 4 a 6 números</b> ' +
        'para poder canjear premios y girar la ruleta. No lo compartas.</div>' +
      '<div class="f">' + ptsInputPin("pt-pin1", "Crea tu PIN (4 a 6 números)", "PIN de seguridad (4 a 6 números)") + '</div>' +
      '<div class="foot"><button class="btn primary" id="pt-crear">Crear mi cuenta</button></div></div>';
  }

  if (!a.tienePin || rueda.olvido) {
    return '<div class="box"><div class="meta">' +
        (a.tienePin
          ? 'Para cambiar tu PIN escribe el número de un pedido tuyo hecho con este ID.'
          : 'Este ID ya tiene puntos de tus compras. Actívalo con el número de un pedido tuyo hecho con este ID y crea tu PIN.') +
      '</div>' +
      '<div class="f">' +
        '<div class="form-field" id="grp-pt-ped">' +
          '<label class="field-label" for="pt-ped">Número de pedido *</label>' +
          '<div class="input-wrap">' +
            '<input id="pt-ped" maxlength="12" autocomplete="off" placeholder="Ej: A1B2C3">' +
            '<span class="field-icon" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="field-msg"></div>' +
        '</div>' +
        ptsInputPin("pt-pin1", "Nuevo PIN (4 a 6 números)", "Nuevo PIN") +
      '</div>' +
      '<div class="foot">' +
        (a.tienePin ? '<button class="btn" id="pt-olv0">Cancelar</button>' : '') +
        '<button class="btn primary" id="pt-act">Guardar PIN</button>' +
      '</div></div>';
  }

  if (!rueda.pin) {
    return '<div class="box"><div class="meta">Escribe tu PIN para canjear premios o girar la ruleta.</div>' +
      '<div class="f">' + ptsInputPin("pt-pin", "Tu PIN (4 a 6 números)", "PIN de acceso") + '</div>' +
      '<div class="foot">' +
        '<button class="btn" id="pt-olv">Olvidé mi PIN</button>' +
        '<button class="btn primary" id="pt-unl">Desbloquear</button>' +
      '</div></div>';
  }

  return '<div class="meta">🔓 PIN verificado. ' +
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
            '<span class="meta">' + esc(p.descripcion || "") + ' • ' +
            esc(p.costo) + ' pts' +
            (p.disponible ? '' : ' • agotado') + '</span></span>' +
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
    h += '<div class="meta">Tus cupones disponibles (úsalos en el carrito):</div>' +
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

  /* Historial de movimientos (sin números de pedido) */
  h += '<div class="bar"><b>Historial</b></div>' +
    (a.mov && a.mov.length
      ? '<div class="list">' + a.mov.slice(0, 15).map(function (m) {
          var n = m.cantidad | 0;

          return '<div class="row ptsl"><span>' +
              esc(MOT_PTS[m.motivo] || m.motivo) +
              ' <span class="meta">' + esc(ptsFecha(m.creado)) + '</span></span>' +
            '<b>' + (n > 0 ? "+" : "") + n + '</b></div>';
        }).join("") + '</div>'
      : '<div class="empty"><p>Aún no hay movimientos. Tus puntos se suman cuando confirmamos el pago de un pedido hecho con este ID.</p></div>');

  h += '<div class="foot">' +
      '<button class="btn" data-x="close">Cerrar</button>' +
      '<button class="btn primary" id="pt-girar"' +
        (puede ? "" : " disabled") +
      '>🎰 Girar ruleta (' + c.objetivo + ' pts)</button>' +
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
      if (!v) setFieldValidation(pin1, false, "Ingresa un PIN numérico");
      else if (!ptsPinValido(v)) setFieldValidation(pin1, false, "El PIN debe tener 4 a 6 números");
      else setFieldValidation(pin1, true, "", "PIN válido");
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
      if (!v) setFieldValidation(ped, false, "Ingresa el número de tu pedido");
      else if (v.length < 4) setFieldValidation(ped, false, "Número de pedido incompleto");
      else setFieldValidation(ped, true, "", "Formato válido");
    };
    ped.addEventListener("input", valPed);
    ped.addEventListener("blur", valPed);
  }

  var pin = $("pt-pin");
  if (pin) {
    var valPin = function() {
      var v = pin.value.trim();
      if (!v) setFieldValidation(pin, false, "Ingresa tu PIN");
      else if (!ptsPinValido(v)) setFieldValidation(pin, false, "El PIN debe tener 4 a 6 números");
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
    if ($("pt-pin1")) setFieldValidation($("pt-pin1"), false, "El PIN debe tener de 4 a 6 números");
    $("pt-res").innerHTML = ptsMsgErr("El PIN debe tener de 4 a 6 números.");
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
    if (ped.length < 4 && $("pt-ped")) setFieldValidation($("pt-ped"), false, "Número de pedido no válido");
    if (!ptsPinValido(pin) && $("pt-pin1")) setFieldValidation($("pt-pin1"), false, "El PIN debe tener 4 a 6 números");
    $("pt-res").innerHTML = ptsMsgErr(
      "Escribe el número de tu pedido y un PIN de 4 a 6 números."
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
    if ($("pt-pin")) setFieldValidation($("pt-pin"), false, "El PIN debe tener de 4 a 6 números");
    $("pt-res").innerHTML = ptsMsgErr("El PIN debe tener de 4 a 6 números.");
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
      pintarCuenta("🔓 PIN verificado. Ya puedes canjear premios o girar la ruleta.");
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

  if (!window.confirm('¿Canjear "' + p.nombre + '" por ' + p.costo + ' puntos?')) return;

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
        '¡Canjeaste <b>' + esc(r.nombre) + '</b>! Te lo entregaremos pronto.'
      );
    })
    .catch(function (e) {
      rueda.ocupado = false;
      $("pt-res").innerHTML = ptsMsgErr(ptsErr(e));
    });
}

/* ==========================================
   DIBUJAR RULETA — NEÓN GAMING
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

  // Segmentos con degradados y separación luminosa.
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

    // Línea luminosa interior.
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
      ? nombre.slice(0, max - 1) + "…"
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

  // Aro exterior oscuro y borde de neón.
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

  // Pequeñas luces alrededor de la ruleta.
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

  // Centro metálico.
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
   la animación solo lo representa.
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
  $("pt-res").textContent = "Girando…";

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

      /* Si el administrador cambió la ruleta mientras girabas, no se anima el ángulo: solo se muestra el resultado. */
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
          ? "Esta vez no hubo premio. ¡Sigue acumulando puntos!"
          : r.tipo === "puntos"
            ? '¡Ganaste <b>' + esc(r.nombre) + '</b>! Ya está en tu saldo.'
            : r.tipo === "manual"
              ? '¡Ganaste <b>' + esc(r.nombre) +
                '</b>! Te lo entregaremos pronto.'
              : '¡Ganaste <b>' + esc(r.nombre) +
                '</b>! Tu cupón: <b>' + esc(r.codigo) +
                '</b> (úsalo en el carrito).';

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

      /* No se borra rueda.pend: si el giro sí se hizo, el reintento devuelve el mismo resultado sin cobrar de nuevo. */
      pintarCuenta(ptsMsgErr(ptsErr(e)));
    });
}
