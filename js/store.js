
/* TIENDA: catálogo, carrito, cupones y registro del pedido.
   Todos los textos que ve el cliente salen de js/textos.js (función T / TH).
   Las mejoras visuales no modifican las reglas de compra ni los pagos.
*/

/* ---------- TIENDA ---------- */

function renderStore() {
  if (ADMIN_PAGE && !authed) {
    $("app").innerHTML =
      '<div class="empty"><h2>Panel de administración</h2>' +
      '<p>Inicia sesión para administrar tu tienda.</p></div>';

    updateCount();
    return;
  }

  var qv = $("q") ? $("q").value.toLowerCase() : "";

  var act = items.filter(function (p) {
    return p.active || authed;
  });

  var cats = [...new Set(
    act.filter(function (p) {
      return !tipoF || (p.tipo === "virtual") === (tipoF === "virtual");
    }).map(function (p) {
      return p.category;
    }).filter(Boolean)
  )].sort();

  if (cat && cats.indexOf(cat) < 0) cat = "";

  var sort = $("sort") ? $("sort").value : "new";

  var v = act.filter(function (p) {
    return (!cat || p.category === cat) &&
      (!tipoF || (p.tipo === "virtual") === (tipoF === "virtual")) &&
      (!favoritosSolo || favoritos.has(String(p.id))) &&
      (!qv || (p.name + " " + p.description + " " + p.category + " " + p.brand + " " + p.sku + " " + p.unit + " " + p.valorDigital + " " + p.digital.game + " " + p.digital.packageLabel + " " + p.specifications.map(function(x){return x.name+" "+x.value}).join(" ") + " " + p.tipo).toLowerCase().indexOf(qv) > -1);
  });

  v.sort(function (a, b) {
    return sort === "low"
      ? eff(a) - eff(b)
      : sort === "high"
        ? eff(b) - eff(a)
        : sort === "offer"
          ? (!!b.offer - !!a.offer)
          : (b.createdAt || 0) - (a.createdAt || 0);
  });

  var h =
    '<section class="hero hero-x">' +
      '<i class="scan"></i>' +
      '<div class="hud-tag"><i></i>NEXORA // TECNOLOGÍA Y GAMING</div>' +
      '<h1>' + esc(cfg.nombre || "NEXORA") + '</h1>' +
      '<p class="hero-tagline">' + esc(cfg.lema || "Tecnología y gaming para tu día a día") + '</p>' +
      '<p>' + esc(T("hero.subtitulo")) + '</p>' +
      '<div class="hero-cta">' +
        '<button class="btn primary" data-go="1">VER PRODUCTOS</button>' +
      '</div>' +
      '<div class="core" aria-hidden="true">' +
        '<div class="cube"><b></b><b></b><b></b><b></b><b></b><b></b></div>' +
        '<div class="orb"></div>' +
      '</div>' +
    '</section>' +

    (catalogoCargando
      ? '<div class="msg" role="status">Conectando con la tienda…</div>'
      : catalogoError
        ? '<div class="msg err" role="alert"><span>' + esc(catalogoError) + '</span> <button class="btn sm" data-x="catalog-retry">Reintentar</button></div>'
        : '') +

    '<div class="trust-strip">' +
      '<div class="trust-item"><span class="t-ico">01</span><div class="t-info"><b>Detalles por producto</b><small>Revisa existencia y condiciones</small></div></div>' +
      '<div class="trust-item"><span class="t-ico">02</span><div class="t-info"><b>Entrega según el producto</b><small>Consulta modalidad, cobertura y plazo</small></div></div>' +
      '<div class="trust-item"><span class="t-ico">03</span><div class="t-info"><b>Compra informada</b><small>Confirma los detalles antes de pagar</small></div></div>' +
    '</div>' +

    '<div class="bar">' +
      '<h2>' + esc(T("catalogo.titulo")) + '</h2>' +
      '<select id="sort" aria-label="' + esc(T("orden.etiqueta")) + '">' +
        [
          ["new", "orden.nuevos"],
          ["low", "orden.menor"],
          ["high", "orden.mayor"],
          ["offer", "orden.ofertas"]
        ].map(function (o) {
          return '<option value="' + o[0] + '">' +
            esc(T(o[1])) +
          '</option>';
        }).join("") +
      '</select>' +
    '</div>';

  if (act.some(function (p) {
    return p.tipo === "virtual";
  })) {
    h += '<div class="chips" role="group" aria-label="Filtrar por tipo de producto">' +
      [
        ["", "filtro.todos"],
        ["fisico", "filtro.fisicos"],
        ["virtual", "filtro.virtuales"]
      ].map(function (t) {
        return '<button class="chip" aria-pressed="' +
          (tipoF === t[0]) +
          '" data-t="' + t[0] + '">' +
          esc(T(t[1])) +
        '</button>';
      }).join("") +
    '</div>';
  }

  if (!ADMIN_PAGE) {
    h += '<div class="chips favorite-filters" role="group" aria-label="Filtrar productos guardados">' +
      '<button id="favorites-filter" class="chip" aria-pressed="' + favoritosSolo + '" data-favfilter="1">' +
        (favoritosSolo ? '★ ' : '☆ ') + esc(T("filtro.favoritos")) +
      '</button>' +
      '<span class="favorite-local-note">' + esc(T("favorito.local")) + '</span>' +
    '</div>';
    if (favoritosError) h += '<p class="msg err" role="alert">' + esc(favoritosError) + '</p>';
  }

  var catChipLabel = function(c) {
    var lc = String(c || "").toLowerCase();
    var ico = "🎮 ";
    if (/diamante|gem/i.test(lc)) ico = "💎 ";
    else if (/pase|ticket|pass/i.test(lc)) ico = "🎫 ";
    else if (/arma|skin|caja/i.test(lc)) ico = "🔫 ";
    else if (/tarjeta|sub|membres/i.test(lc)) ico = "💳 ";
    else if (/ropa|traje|personaje/i.test(lc)) ico = "👕 ";
    return ico + esc(c);
  };

  if (cats.length) {
    h += '<div class="chips" role="group" aria-label="Filtrar por categoría">' +
      '<button class="chip" aria-pressed="' + (!cat) +
      '" data-c="">⚡ ' + esc(T("filtro.todo")) + '</button>' +

      cats.map(function (c) {
        return '<button class="chip" aria-pressed="' +
          (cat === c) +
          '" data-c="' + esc(c) + '">' +
          catChipLabel(c) +
        '</button>';
      }).join("") +
    '</div>';
  }

  h += fxSections(act, cats);

  if (!v.length && !authed) {
    if (!catalogoCargando && !catalogoError) {
      var emptyFavoriteScope = favoritosSolo && !qv && !cat && !tipoF;
      var emptyKey = emptyFavoriteScope ? "vacio.sinFavoritos" : (act.length ? "vacio.sinResultados" : "vacio.sinProductos");
      var emptyDescriptionKey = emptyFavoriteScope ? "vacio.sinFavoritosDesc" : (act.length ? "vacio.sinResultadosDesc" : "vacio.sinProductosDesc");
      h += '<div class="empty" role="status" aria-live="polite">' +
        '<h2>' + esc(T(emptyKey)) + '</h2>' +
        '<p>' + esc(T(emptyDescriptionKey)) + '</p>' +
      '</div>';
    }
  } else {
    h += '<div class="grid">' +

      (authed
        ? '<button class="card addcard" data-x="newp">' +
            '＋ Agregar producto' +
          '</button>'
        : '') +

      v.map(function (p, idx) {
        var off = p.offer && p.offerPrice > 0;
        var out = agotado(p);
        var im = safeImg(p.image);
        var pid = esc(p.id);

        return '<article class="card product-card-3d tilt-card ' +
          fxRar(p) +
          '" data-tilt="card" data-product-id="' + pid + '"' +
          (p.active ? '' : ' style="opacity:.6"') +
          '>' +

          '<div class="pic product-visual" data-tilt-image>' +

            (im
              ? '<img src="' + im +
                '" alt="' + esc(T("producto.fotoAlt", {
                  nombre: p.name
                })) +
                '" loading="lazy" decoding="async" draggable="false">'
              : (p.tipo === "virtual"
                ? '✦'
                : esc(T("producto.sinFoto")))) +

            (p.tipo === "virtual"
              ? '<span class="badge virt">' +
                  esc(T("producto.virtual")) +
                '</span>'
              : '') +

            (p.active
              ? ''
              : '<span class="badge" style="background:#555;left:auto;right:10px">Oculto</span>') +

            (off
              ? '<span class="badge">' +
                  esc(T("producto.oferta")) +
                '</span>'
              : '') +

            fxBadges(p, off) +
            botonFavorito(p) +

          '</div>' +

          '<div class="info product-info">' +

            '<span class="product-type ' + (p.tipo === "virtual" ? "is-digital" : "is-physical") + '">' +
              esc(T(p.tipo === "virtual" ? "producto.tipoDigital" : "producto.tipoFisico")) +
            '</span>' +

            '<h3>' + esc(p.name) + '</h3>' +

            ((p.brand || p.sku || p.unit !== "unidad")
              ? '<p class="product-identifiers">' + [p.brand, p.sku ? "SKU " + p.sku : "", p.unit !== "unidad" ? "Unidad: " + p.unit : ""].filter(Boolean).map(esc).join(" · ") + '</p>'
              : '') +

            (p.tipo === "virtual" && p.digital.game
              ? '<p class="product-digital-game">' + esc(p.digital.game) + (p.digital.packageLabel ? ' · ' + esc(p.digital.packageLabel) : '') + '</p>'
              : '') +

            '<p>' + esc(p.description) + '</p>' +

            '<div class="price">' +

              (off
                ? '<s>' + fmt.format(p.price) + '</s>' +
                  '<b class="o">' + fmt.format(p.offerPrice) + '</b>'
                : '<b>' + fmt.format(p.price) + '</b>') +

            '</div>' +

            fxDetails(p) +

            '<button class="btn primary product-add-btn" data-add="' +
              pid + '"' +
              (out ? ' disabled' : '') +
            '>' +
              (out ? '🚫 ' : '🛒 ') +
              esc(T(out
                ? "producto.agotado"
                : "producto.agregar")) +
            '</button>' +

            (authed
              ? '<div class="acts admin-acts">' +

                  '<button class="btn sm" data-a="edit" data-id="' +
                    pid + '">Editar</button>' +

                  '<button class="btn sm" data-a="vis" data-id="' +
                    pid + '">' +
                    (p.active ? "Ocultar" : "Mostrar") +
                  '</button>' +

                  '<button class="btn sm danger" data-a="del" data-id="' +
                    pid + '">' +
                    (pdel === p.id ? "Confirmar" : "Eliminar") +
                  '</button>' +

                '</div>' +

                '<div class="meta">Stock: ' +
                  (ilim(p) ? "ilimitado" : (Number(p.stock) || 0)) +
                '</div>'
              : '') +

          '</div>' +
        '</article>';
      }).join("") +

    '</div>';
  }

  $("app").innerHTML = h;

  $("sort").value = sort;
  $("sort").addEventListener("change", renderStore);

  updateCount();
}

/* ---------- CONTADOR Y TOTALES ---------- */

function updateCount() {
  var n = lines().reduce(function (sum, l) { return sum + l.n; }, 0);

  if ($("count")) $("count").textContent = n;
}

function stockLimit(p) {
  if (!p) return 0;
  return ilim(p) ? 9999 : Math.max(0, Math.min(9999, Math.floor(Number(p.stock) || 0)));
}

function lines() {
  return Object.keys(cart).map(function (id) {
    var p = items.find(function (x) {
      return x.id === id;
    });

    var q = Math.min(stockLimit(p), Math.max(0, Math.floor(Number(cart[id]) || 0)));
    return p && q ? { p: p, n: q } : null;
  }).filter(Boolean);
}

function digitalFieldsHtml(L) {
  var products = [];
  L.forEach(function (line) {
    if (esV(line) && !products.some(function (p) { return p.id === line.p.id; })) products.push(line.p);
  });
  if (!products.length) return "";
  return '<section class="digital-data-groups" aria-label="Datos necesarios para productos digitales">' +
    products.map(function (p) {
      var fields = NexoraContracts.digitalFields(p), saved = chk.digital[p.id] || {};
      return '<fieldset class="digital-data-group"><legend>' + esc(p.name) + '</legend>' +
        (p.digital.game ? '<p class="meta">' + esc(p.digital.game) + (p.digital.packageLabel ? ' · ' + esc(p.digital.packageLabel) : '') + '</p>' : '') +
        fields.map(function (field) {
          var id = "digital-" + p.id + "-" + field.key;
          return '<div class="form-field"><label class="field-label" for="' + esc(id) + '">' + esc(field.label) + (field.required ? ' *' : ' (opcional)') + '</label>' +
            '<input id="' + esc(id) + '" maxlength="' + field.maxLength + '" autocomplete="off" data-digital-product="' + esc(p.id) + '" data-digital-field="' + esc(field.key) + '"' +
            (field.required ? ' required' : '') + ' value="' + esc(saved[field.key] || '') + '"></div>';
        }).join("") +
        '<p class="meta">No escribas contraseñas ni códigos de acceso de tu cuenta.</p></fieldset>';
    }).join("") +
  '</section>';
}

function discount() {
  if (!coupon) return 0;

  /* Vista previa del carrito. El servidor debe volver a calcular el descuento y el total. */
  var sb = Number(subtotal()), value = Number(coupon.valor);
  if (!Number.isFinite(sb) || sb <= 0 || !Number.isFinite(value) || value <= 0) return 0;
  if (Number(coupon.compra_minima||0)>sb) return 0;
  if (coupon.tipo === "pct") return value <= 100 ? Math.min(sb, Math.round(sb * value / 100)) : 0;
  if (coupon.tipo !== "fijo") return 0;
  return Math.min(sb, Math.floor(value));
}

function total() {
  return subtotal() - discount();
}

function subtotal() {
  return lines().reduce(function (a, l) {
    return a + eff(l.p) * l.n;
  }, 0);
}

/* ---------- CARRITO Y PAGO ---------- */

var chk = {
  nombre: "",
  tel: "",
  idJuego: "",
  digital: {},
  modo: "dom",
  addr: "",
  city: "",
  department: "",
  zone: "",
  reference: "",
  punto: "",
  ref: "",
  pay: ""
};

var cupMsg = "";

function resetChk() {
  var sd = Cookies.ok("preferencias")
    ? lsGet("tienda_datos", {})
    : {};

  chk = {
    nombre: String(sd.n || ""),
    tel: String(sd.t || ""),
    idJuego: String(sd.ff || ""),
    digital: {},
    modo: "dom",
    addr: "",
    city: "",
    department: "",
    zone: "",
    reference: "",
    punto: "",
    ref: "",
    pay: ""
  };

  compImg = "";
  cupMsg = "";
}

resetChk();

function ico(m) {
  return m.tipo === "efectivo"
    ? "💵"
    : m.tipo === "link"
      ? "💳"
      : "📲";
}

function esV(l) {
  return l.p.tipo === "virtual";
}

function disponibles(L) {
  var hv = L.some(esV);

  return pagos().filter(function (m) {
    return !(
      (m.gateway === "mercadopago" && (!Backend.remote || !Backend.accountsReady)) ||
      (m.tipo === "efectivo" && hv) ||
      (m.tipo === "link" && !safeUrl(m.enlace)) ||
      (m.tipo === "transfer" && !m.cuenta && !safeImg(m.qr))
    );
  });
}

function stepper(n) {
  return '<div class="steps">' +
    ["paso.carrito", "paso.datos", "paso.pago"].map(function (k, i) {
      return '<span class="stp' +
        (i + 1 === n ? " on" : "") +
        (i + 1 < n ? " done" : "") +
        '"><b>' +
        (i + 1 < n ? "✓" : i + 1) +
        '</b>' + esc(T(k)) +
      '</span>';
    }).join("") +
  '</div>';
}

function validarDatos(L) {
  var hv = L.some(esV);
  var hp = L.some(function (l) {
    return !esV(l);
  });
  var f = [];

  if (!chk.nombre.trim() || chk.nombre.trim().length < 2) f.push(T("falta.nombre"));
  var telDigits = ptsSoloNum(chk.tel);
  if (!chk.tel.trim() || telDigits.length < 7) f.push(T("falta.celular"));

  var ffDigits = ptsSoloNum(chk.idJuego);
  if (chk.idJuego.trim() && (ffDigits.length < 6 || ffDigits.length > 15)) {
    f.push("ID de Free Fire inválido (debe tener entre 6 y 15 números)");
  }

  if (hp) {
    var addressErrors = NexoraContracts.validateAddress({
      method: chk.modo === "punto" ? "pickup" : "home",
      street: chk.addr,
      city: chk.city,
      department: chk.department,
      zone: chk.zone,
      reference: chk.reference,
      pickupPoint: chk.punto
    });
    addressErrors.forEach(function (field) {
      f.push(field === "punto de recogida" ? T("falta.punto") :
        field === "dirección" ? T("falta.direccion") : field);
    });
  }

  if (hv) {
    var seen = Object.create(null);
    L.forEach(function (line) {
      if (!esV(line) || seen[line.p.id]) return;
      seen[line.p.id] = true;
      NexoraContracts.validateDigitalValues(NexoraContracts.digitalFields(line.p), chk.digital[line.p.id]).forEach(function (field) {
        f.push(line.p.name + ": " + field);
      });
    });
  }

  return f;
}

function copiar(txt, btn) {
  var ok = function () {
    var o = btn.textContent;
    btn.textContent = T("pago.copiado");

    setTimeout(function () {
      btn.textContent = o;
    }, 1400);
  };

  var fb = function () {
    var t = document.createElement("textarea");
    t.value = txt;
    document.body.appendChild(t);
    t.select();

    try {
      document.execCommand("copy");
      ok();
    } catch (e) {}

    document.body.removeChild(t);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(ok, fb);
  } else {
    fb();
  }
}

function detallePago(m) {
  var h = '<div class="paybox">';
  var qr = safeImg(m.qr);
  var lk = safeUrl(m.enlace);

  if (m.gateway === "mercadopago") {
    return h + '<div><b>Checkout seguro de Mercado Pago</b></div>' +
      '<div class="meta">Al confirmar, te llevaremos a Mercado Pago para elegir tarjeta, PSE u otro medio disponible.</div>' +
      '<div class="meta">Valor exacto: <b>' + fmt.format(total()) + '</b> COP</div>' +
      '<div class="payment-evidence-note" role="note">El pedido se marcará como pagado cuando Mercado Pago confirme la transacción. El resultado de la pantalla de regreso no confirma el pago.</div></div>';
  }

  if (m.tipo === "efectivo") {
    h += '<div>' + esc(m.instr || T("pago.efectivoDefecto")) + '</div>';
  } else {
    if (m.tipo === "transfer") {
      if (m.cuenta) {
        h += '<div class="meta">' + esc(T("pago.envia")) + '</div>' +
          '<div class="acct"><span>' + esc(m.cuenta) + '</span>' +
          '<button class="btn sm" data-copy="' + esc(m.cuenta) + '">' +
            esc(T("pago.copiar")) +
          '</button></div>' +
          (m.titular
            ? '<div class="meta">' +
                esc(T("pago.aNombre", { titular: m.titular })) +
              '</div>'
            : '');
      }

      if (qr) {
        h += '<img class="qr" src="' + qr +
          '" alt="' + esc(T("pago.qrAlt")) + '">';
      }
    }

    if (m.tipo === "link" && lk) {
      h += '<a class="btn primary" href="' + esc(lk) +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(T("pago.enLinea")) +
      '</a>';
    }

    if (m.instr) {
      h += '<div class="meta">' + esc(m.instr) + '</div>';
    }

    h += '<div class="meta">' +
      esc(T("pago.valorExacto")) +
      ' <b>' + fmt.format(total()) + '</b> ' +
      '<button class="btn sm" data-copy="' + total() + '">' +
        esc(T("pago.copiarValor")) +
      '</button></div>' +

      '<div class="meta">' + esc(T("pago.cuandoPagues")) + '</div>' +
      '<p class="payment-evidence-note" role="note">' + esc(T("pago.evidenciaAviso")) + '</p>' +

      '<div class="f">' +
        '<label class="field-label" for="c-ref">' + esc(T("pago.referencia")) + '</label>' +
        '<input id="c-ref" maxlength="100" ' +
          'placeholder="' + esc(T("pago.referencia")) +
          '" value="' + esc(chk.ref) + '">' +

        '<label>' + esc(T("pago.captura")) +
          '<input id="c-file" type="file" accept="image/*">' +
        '</label>' +

        '<div class="meta" id="c-fmsg">' +
          (compImg ? esc(T("pago.capturaLista")) : "") +
        '</div>' +
      '</div>';
  }

  return h + '</div>';
}

function avisoWhatsApp() {
  return cfg.whatsapp
    ? '<p class="meta"><a href="https://wa.me/' +
      esc(String(cfg.whatsapp).replace(/\D/g, "")) +
      '" target="_blank" rel="noopener noreferrer">' +
      esc(T("cerrada.dudas")) +
      '</a></p>'
    : '<p class="meta">' + esc(T("cerrada.dudas")) + '</p>';
}

function drawCart() {
  var L = lines();
  var b = $("dbox");
  var hv = L.some(esV);
  var hp = L.some(function (l) {
    return !esV(l);
  });

  if (!L.length) {
    b.innerHTML =
      '<h2>' + esc(T("carrito.titulo")) + '</h2>' +
      '<p class="meta" role="status" aria-live="polite">' + esc(T("carrito.vacio")) + '</p>' +
      '<div class="foot"><button class="btn" data-x="close">' +
        esc(T("carrito.cerrar")) +
      '</button></div>';

    return;
  }

  if (step === "cart") {
    b.innerHTML =
      stepper(1) +
      '<h2>' + esc(T("carrito.titulo")) + '</h2>' +
      (hv && hp ? '<p class="cart-mix-note">' + esc(T("carrito.combinado")) + '</p>' : '') +

      L.map(function (l) {
        return '<div class="line cart-product-line">' +
          '<div class="n"><b>' + esc(l.p.name) + '</b>' +
            ' <span class="product-type ' + (esV(l) ? "is-digital" : "is-physical") + '">' +
              esc(T(esV(l) ? "producto.tipoDigital" : "producto.tipoFisico")) +
            '</span>' +
            '<div class="cart-line-price"><span class="meta">' + esc(T("carrito.precioUnitario")) + ': ' + fmt.format(eff(l.p)) + '</span>' +
            '<b>' + esc(T("carrito.subtotalLinea")) + ': ' + fmt.format(eff(l.p) * l.n) + '</b></div>' +
          '</div>' +

          '<div class="qty">' +
            '<button data-q="-1" data-id="' + esc(l.p.id) +
              '" aria-label="' + esc(T("carrito.quitar")) + '">−</button>' +
            '<input class="qty-input" type="number" min="1" max="' + stockLimit(l.p) + '" aria-label="' + esc(T("carrito.cantidadDe", { nombre: l.p.name })) + '" ' +
              'value="' + l.n + '" data-qty="1" data-id="' +
              esc(l.p.id) + '">' +
            '<button data-q="1" data-id="' + esc(l.p.id) +
              '" aria-label="' + esc(T("carrito.agregar")) + '">+</button>' +
          '</div>' +
        '</div>';
      }).join("") +

      '<div class="line">' +
        '<label class="sr-only" for="c-cup">' + esc(T("carrito.cupon")) + '</label>' +
        '<input id="c-cup" maxlength="40" ' +
          'placeholder="' + esc(T("carrito.cupon")) + '" ' +
          'value="' + (coupon ? esc(coupon.codigo) : "") + '">' +
        '<button class="btn" data-x="cup">' +
          esc(T("carrito.aplicar")) +
        '</button>' +
      '</div>' +

      '<div class="meta" role="status" aria-live="polite">' + esc(cupMsg) + '</div>' +

      (discount() > 0
        ? '<div class="line meta"><span>' +
            esc(T("carrito.subtotal")) + '</span><span>' +
            fmt.format(subtotal()) + '</span></div>' +
          '<div class="line meta"><span>' +
            esc(T("carrito.descuento")) + '</span><span>-' +
            fmt.format(discount()) + '</span></div>'
        : '') +

      '<div class="line total"><span>' +
        esc(T("carrito.total")) + '</span><span>' +
        fmt.format(total()) + '</span></div>' +

      (Backend.ready
        ? ""
        : '<p class="err">' + esc(T("cerrada.aviso")) + '</p>' +
          avisoWhatsApp()) +

      '<div class="foot">' +
        '<button class="btn" data-x="close">' +
          esc(T("carrito.seguir")) +
        '</button>' +
        '<button class="btn primary" data-x="to-datos"' +
          (Backend.ready ? "" : " disabled") + '>' +
          esc(T("carrito.continuar")) +
        '</button>' +
      '</div>';

  } else if (step === "datos") {
    var pts = (cfg.puntos || "")
      .split("\n")
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);

    b.innerHTML =
      stepper(2) +
      '<h2>' + esc(T("datos.titulo")) + '</h2>' +

      '<div class="f">' +
        '<div class="form-field" id="grp-name">' +
          '<label class="field-label" for="c-name">' + esc(T("datos.nombre")) + ' *</label>' +
          '<div class="input-wrap">' +
            '<input id="c-name" maxlength="80" placeholder="Ej: Juan Pérez" autocomplete="name" value="' + esc(chk.nombre) + '">' +
            '<span class="field-icon" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="field-msg"></div>' +
        '</div>' +

        '<div class="form-field" id="grp-phone">' +
          '<label class="field-label" for="c-phone">' + esc(T("datos.celular")) + ' *</label>' +
          '<div class="input-wrap">' +
            '<input id="c-phone" maxlength="20" placeholder="Ej: 300 123 4567" inputmode="tel" autocomplete="tel" value="' + esc(chk.tel) + '">' +
            '<span class="field-icon" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="field-msg"></div>' +
        '</div>' +

        '<div class="form-field" id="grp-ffid">' +
          '<label class="field-label" for="c-ffid">' + esc(T("datos.idPuntos")) + '</label>' +
          '<div class="input-wrap">' +
            '<input id="c-ffid" maxlength="20" inputmode="numeric" placeholder="Ej: 123456789 (solo números)" value="' + esc(chk.idJuego) + '">' +
            '<span class="field-icon" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="field-msg"></div>' +
        '</div>' +
      '</div>' +

      (hp
        ? '<div class="meta" style="margin-top:6px"><b>' + esc(T("datos.comoRecibir")) + '</b></div>' +
          '<div class="paygrid" role="group" aria-label="' + esc(T("datos.comoRecibir")) + '">' +
            '<button class="paytile' +
              (chk.modo === "dom" ? " on" : "") +
              '" aria-pressed="' + (chk.modo === "dom") + '" data-modo="dom"><span class="ico">🏠</span><b>' +
              esc(T("datos.domicilio")) + '</b></button>' +

            '<button class="paytile' +
              (chk.modo === "punto" ? " on" : "") +
              '" aria-pressed="' + (chk.modo === "punto") + '" data-modo="punto"><span class="ico">📍</span><b>' +
              esc(T("datos.recoger")) + '</b></button>' +
          '</div>' +

          (chk.modo === "dom"
            ? '<div class="form-field" id="grp-addr"><label class="field-label" for="c-addr">' + esc(T("datos.direccion")) + ' *</label><div class="input-wrap"><textarea id="c-addr" rows="2" maxlength="300" placeholder="Calle, número, barrio y ciudad">' +
                esc(chk.addr) + '</textarea><span class="field-icon" aria-hidden="true"></span></div><div class="field-msg"></div></div>'
            : '<div class="form-field" id="grp-punto"><label class="field-label" for="c-punto">' + esc(T("datos.punto")) + ' *</label><div class="input-wrap"><input id="c-punto" maxlength="150" list="c-puntos" placeholder="' + esc(T("datos.punto")) + '" value="' +
                esc(chk.punto) + '"><span class="field-icon" aria-hidden="true"></span></div><div class="field-msg"></div>' +
              '<datalist id="c-puntos">' +
                pts.map(function (x) {
                  return '<option value="' + esc(x) + '">';
                }).join("") +
              '</datalist></div>')
        : '') +

      (hp && chk.modo === "dom"
        ? '<div class="two address-fields"><label for="c-city">Ciudad *</label><input id="c-city" maxlength="80" autocomplete="address-level2" value="' + esc(chk.city) + '"><label for="c-department">Departamento *</label><input id="c-department" maxlength="80" autocomplete="address-level1" value="' + esc(chk.department) + '"><label for="c-zone">Zona o barrio</label><input id="c-zone" maxlength="100" value="' + esc(chk.zone) + '"><label for="c-reference">Referencia de entrega</label><input id="c-reference" maxlength="160" value="' + esc(chk.reference) + '"></div><p class="meta">' + esc(T("datos.envioPendiente")) + '</p>'
        : '') +

      digitalFieldsHtml(L) +

      '<div class="err" id="err" role="alert" aria-live="assertive" tabindex="-1"></div>' +

      '<div class="foot">' +
        '<button class="btn" data-x="back-cart">' +
          esc(T("datos.volver")) +
        '</button>' +
        '<button class="btn primary" data-x="to-pago">' +
          esc(T("carrito.continuar")) +
        '</button>' +
      '</div>';

    bindCheckoutValidation();

  } else {
    var P = disponibles(L);

    if (!P.some(function (x) {
      return x.id === chk.pay;
    })) {
      chk.pay = P.length ? P[0].id : "";
    }

    var m = P.find(function (x) {
      return x.id === chk.pay;
    });

    b.innerHTML =
      stepper(3) +
      '<h2>' + esc(T("pago.titulo")) + '</h2>' +

      '<div class="paytotal"><span>' +
        esc(T("pago.totalAPagar")) + '</span><b>' +
        fmt.format(total()) + '</b></div>' +

      (P.length
        ? '<div class="paygrid" role="group" aria-label="' + esc(T("pago.titulo")) + '">' +
            P.map(function (x) {
              return '<button class="paytile' +
                (x.id === chk.pay ? " on" : "") +
                '" aria-pressed="' + (x.id === chk.pay) + '" data-pm="' + esc(x.id) + '">' +
                '<span class="ico">' + ico(x) + '</span>' +
                '<b>' + esc(x.nombre) + '</b>' +
              '</button>';
            }).join("") +
          '</div>' + detallePago(m)
        : '<p class="err">' + esc(T("pago.sinMetodos")) + '</p>') +

      '<div class="err" id="err" role="alert" aria-live="assertive" tabindex="-1"></div>' +

      '<div class="foot">' +
        '<button class="btn" data-x="back-datos">' +
          esc(T("datos.volver")) +
        '</button>' +
        '<button class="btn primary" data-x="send"' +
          (P.length && Backend.ready ? "" : " disabled") + '>' +
          esc(T("pago.confirmar")) +
        '</button>' +
      '</div>';

    if ($("c-file")) {
      $("c-file").addEventListener("change", function () {
        if (!this.files[0]) return;

        $("c-fmsg").textContent = T("pago.procesando");

        resizeImg(this.files[0], 900, "image/jpeg", function (u) {
          if(!u){compImg="";$("c-fmsg").textContent="No se pudo procesar la captura. Prueba con otra imagen.";return;}
          compImg = u;
          $("c-fmsg").textContent = T("pago.capturaLista");
        }, 680000);
      });
    }
  }
}

function bindCheckoutValidation() {
  var nm = $("c-name"), ph = $("c-phone"), ff = $("c-ffid"), ad = $("c-addr"), pu = $("c-punto");

  var valNm = function() {
    if (!nm) return;
    var v = nm.value.trim();
    if (!v) setFieldValidation(nm, false, "Ingresa tu nombre completo");
    else if (v.length < 2) setFieldValidation(nm, false, "Nombre demasiado corto");
    else setFieldValidation(nm, true, "", "Nombre válido");
  };

  var valPh = function() {
    if (!ph) return;
    var v = ptsSoloNum(ph.value);
    if (!ph.value.trim()) setFieldValidation(ph, false, "Ingresa tu número de celular");
    else if (v.length < 7) setFieldValidation(ph, false, "Mínimo 7 dígitos (ej: 300 123 4567)");
    else setFieldValidation(ph, true, "", "Celular válido");
  };

  var valFF = function() {
    if (!ff) return;
    var v = ptsSoloNum(ff.value);
    if (!ff.value.trim()) {
      setFieldValidation(ff, null);
    } else if (v.length < 6 || v.length > 15) {
      setFieldValidation(ff, false, "El ID de Free Fire debe tener entre 6 y 15 números");
    } else {
      setFieldValidation(ff, true, "", "ID válido");
    }
  };

  var valAd = function() {
    if (!ad) return;
    var v = ad.value.trim();
    if (!v) setFieldValidation(ad, false, "Ingresa la dirección completa");
    else if (v.length < 4) setFieldValidation(ad, false, "Dirección demasiado corta");
    else setFieldValidation(ad, true, "", "Dirección lista");
  };

  var valPu = function() {
    if (!pu) return;
    var v = pu.value.trim();
    if (!v) setFieldValidation(pu, false, "Escribe el punto de recogida");
    else setFieldValidation(pu, true, "", "Punto listo");
  };

  if (nm) { nm.addEventListener("input", valNm); nm.addEventListener("blur", valNm); if (nm.value) valNm(); }
  if (ph) { ph.addEventListener("input", valPh); ph.addEventListener("blur", valPh); if (ph.value) valPh(); }
  if (ff) { ff.addEventListener("input", valFF); ff.addEventListener("blur", valFF); if (ff.value) valFF(); }
  if (ad) { ad.addEventListener("input", valAd); ad.addEventListener("blur", valAd); if (ad.value) valAd(); }
  if (pu) { pu.addEventListener("input", valPu); pu.addEventListener("blur", valPu); if (pu.value) valPu(); }
}

function checkoutFingerprint(L, referencia, comprobante) {
  var value=JSON.stringify({user:(Backend.customer?Backend.customer()||{}:{}).id||"",items:L.map(function(l){return{id:l.p.id,q:l.n,price:eff(l.p),digital:esV(l),data:chk.digital[l.p.id]||{}}}),name:chk.nombre.trim(),tel:chk.tel.trim(),gameId:ptsSoloNum(chk.idJuego),mode:chk.modo,address:[chk.addr,chk.city,chk.department,chk.zone,chk.reference,chk.punto],pay:chk.pay,reference:referencia,proof:comprobante,coupon:coupon?coupon.codigo:"",subtotal:subtotal(),discount:discount()}),hash=2166136261;
  for(var i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return ("00000000"+(hash>>>0).toString(16)).slice(-8);
}

function pendingOrderKey(fingerprint) {
  var key="";
  try{var saved=JSON.parse(sessionStorage.getItem("nexora_pedido_pendiente")||"null");if(saved&&saved.fingerprint===fingerprint&&/^[A-Za-z0-9_-]{8,80}$/.test(saved.key))key=saved.key}catch(e){}
  if(!key){key=uid();try{sessionStorage.setItem("nexora_pedido_pendiente",JSON.stringify({fingerprint:fingerprint,key:key}))}catch(e){}}
  return key;
}

function clearPendingOrderKey(){try{sessionStorage.removeItem("nexora_pedido_pendiente")}catch(e){}}

function sendOrder() {
  if (typeof ADMIN_PAGE !== "undefined" && !ADMIN_PAGE && Backend.remote && Backend.accountsReady && !Backend.customer()) {
    abrirCuenta(true);
    return;
  }
  if (!Backend.ready) return;

  var L = lines();
  var hv = L.some(esV);
  var hp = L.some(function (l) {
    return !esV(l);
  });
  var hff = L.some(function (l) {
    return esDigitalFreeFire(l.p);
  });

  var m = disponibles(L).find(function (x) {
    return x.id === chk.pay;
  });
  var esMercadoPago = !!(m && m.gateway === "mercadopago");
  var referencia = esMercadoPago ? "NEXORA_MP_PENDING" : chk.ref.trim();
  var comprobante = m && m.tipo !== "efectivo" && !esMercadoPago ? compImg : "";

  var f = validarDatos(L);

  if (!m) {
    f.push(T("falta.formaPago"));
  } else if (
    m.tipo !== "efectivo" &&
    !esMercadoPago &&
    !referencia &&
    !comprobante
  ) {
    f.push(T("falta.referencia"));
  }

  if (f.length) {
    $("err").textContent = T("falta.prefijo", {
      lista: f.join(", ")
    });
    $("err").focus();
    return;
  }

  var fingerprint=typeof checkoutFingerprint==="function"?checkoutFingerprint(L, referencia, comprobante):"";
  var fechaPedido=Date.now(), pedidoId=typeof pendingOrderKey==="function"?pendingOrderKey(fingerprint):uid();
  var o = {
    version: 2,
    id: pedidoId,
    fecha: fechaPedido,
    estado: "Pendiente",
    historial: [{ de: "", a: "Pendiente", fecha: fechaPedido }],
    nombre: chk.nombre.trim(),
    tel: chk.tel.trim(),
    email: (Backend.customer?Backend.customer()||{}:{}).email||"",
    idJuego: ptsSoloNum(chk.idJuego),

    items: L.map(function (l, index) {
      var digitalFields = esV(l) ? NexoraContracts.digitalFields(l.p) : [];
      return {
        id: l.p.id,
        n: l.p.name,
        q: l.n,
        pr: eff(l.p),
        v: esV(l),
        lineId: pedidoId + "-" + (index + 1),
        sku: l.p.sku || "",
        brand: l.p.brand || "",
        unit: l.p.unit || "unidad",
        variantId: "",
        digitalFields: digitalFields,
        digitalData: esV(l) ? NexoraContracts.sanitizeDigitalValues(digitalFields, chk.digital[l.p.id]) : {},
        fulfillment: {
          type: esV(l) ? "digital" : "physical",
          status: "pending",
          carrier: "",
          trackingNumber: "",
          evidenceRef: ""
        },
        puntos: l.p.puntosPersonalizados
          ? Math.max(0, Math.floor(Number(l.p.puntosCompra) || 0))
          : null
      };
    }),

    subtotal: subtotal(),
    descuento: discount(),
    cupon: coupon ? coupon.codigo : "",
    total: total(),

    pago: m.nombre,
    pagoId: m.id,
    referencia: referencia,
    comprobante: comprobante,

    dir: hp && chk.modo === "dom" ? chk.addr.trim() : "",
    punto: hp && chk.modo === "punto" ? chk.punto.trim() : "",
    direccion: NexoraContracts.normalizeAddress({
      method: chk.modo === "punto" ? "pickup" : "home",
      street: hp && chk.modo === "dom" ? chk.addr : "",
      city: hp && chk.modo === "dom" ? chk.city : "",
      department: hp && chk.modo === "dom" ? chk.department : "",
      zone: hp && chk.modo === "dom" ? chk.zone : "",
      reference: hp && chk.modo === "dom" ? chk.reference : "",
      pickupPoint: hp && chk.modo === "punto" ? chk.punto : "",
      tariffVersion: ""
    }),
    cuenta: null
  };

  var btn = document.querySelector('[data-x=send]');

  btn.disabled = true;
  btn.textContent = T("pago.enviando");

  Backend.crear(o).then(function () {
    if (esMercadoPago) {
      return Backend.iniciarPagoMercadoPago(o.id).then(function (checkout) {
        if (typeof clearPendingOrderKey === "function") clearPendingOrderKey();
        if (typeof guardarUltimoPedido === "function") guardarUltimoPedido(o);
        recordarDatos(o.nombre, o.tel, o.idJuego);
        cart = {};
        coupon = null;
        resetChk();
        lsSet("tienda_carrito", cart);
        step = "cart";
        window.location.assign(checkout.checkoutUrl);
      });
    }
    if(typeof clearPendingOrderKey==="function")clearPendingOrderKey();
    if (typeof guardarUltimoPedido === "function") guardarUltimoPedido(o);
    recordarDatos(o.nombre, o.tel, o.idJuego);

    cart = {};
    coupon = null;
    resetChk();

    lsSet("tienda_carrito", cart);
    step = "cart";

    renderStore();

    var num = '<b>#' + esc(o.id.slice(-6).toUpperCase()) + '</b>';
    var wa = String(cfg.whatsapp || "").replace(/\D/g, "");

    $("dbox").innerHTML =
      okAnim() +
      '<h2>' + esc(T("ok.titulo")) + '</h2>' +
      '<p>' + TH(
        m.tipo === "efectivo" ? "ok.cuerpoEfectivo" : "ok.cuerpoPago",
        { num: num }
      ) + '</p>' +

      reciboCompleto(o) +

      (hv
        ? '<p class="meta">' + esc(T("ok.virtual")) + '</p>'
        : '') +

      ptsAviso(o.total, L.some(function (l) { return esDigitalFreeFire(l.p); })) +

      (Backend.remote
        ? ""
        : '<p class="err">' + esc(T("ok.pruebaLocal")) + '</p>') +

      (wa
        ? '<p class="meta">' +
            TH("ok.dudas", {
              enlace: '<a href="https://wa.me/' + wa +
                '" target="_blank" rel="noopener noreferrer">' +
                esc(T("ok.dudasEnlace")) + '</a>'
            }) +
          '</p>'
        : '') +

      '<div class="foot">' +
        '<button class="btn" data-x="invoice-last">Ver / imprimir comprobante</button>' +
        '<button class="btn primary" data-x="close">' +
          esc(T("carrito.cerrar")) +
        '</button>' +
      '</div>';

    var successHeading = $("dbox").querySelector("h2");
    if (successHeading) { successHeading.tabIndex = -1; successHeading.focus(); }

  }).catch(function (e) {
    btn.disabled = false;
    btn.textContent = T("pago.confirmar");

    var errorMessage=String(e&&e.message||"");
    var errorCode=String(e&&e.code||"");
    if (/referencia de checkout ya se uso/i.test(errorMessage)&&typeof clearPendingOrderKey==="function") clearPendingOrderKey();

    if(/referencia de checkout ya se uso/i.test(errorMessage)){
      $("err").textContent="Los datos del pedido cambiaron. Confirma de nuevo para crear el pedido.";
    }else if(errorMessage){
      $("err").textContent="No se pudo enviar el pedido: "+errorMessage+
        (errorCode?" ["+errorCode+"]":"")+
        (e&&e.details?" Detalle: "+e.details:"");
    }else{
      $("err").textContent="El checkout fallo sin recibir detalles del servidor. Recarga la tienda e intenta de nuevo.";
    }
    $("err").focus();
  });
}

function mostrarAvisoRetornoMercadoPago() {
  if (typeof ADMIN_PAGE !== "undefined" && ADMIN_PAGE) return;
  var url = new URL(window.location.href);
  if (!url.searchParams.has("mp_return")) return;
  url.searchParams.delete("mp_return");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  var panel = $("panel");
  if (panel) panel.innerHTML = '<div class="payment-return-notice" role="status"><b>Estamos comprobando tu pago</b><span>El regreso desde Mercado Pago no confirma el resultado. El estado real aparecerá en Mis compras cuando recibamos la notificación segura.</span></div>';
}

function applyCoupon() {
  var c = $("c-cup").value.trim().toUpperCase();

  var k = (cfg.cupones || []).find(function (x) {
    return x.activo && x.codigo === c;
  });

  var fin = function (cp, msg) {
    coupon = cp;
    cupMsg = msg;
    drawCart();
  };

  if (!c) return fin(null, "");

  if (k) return fin(k, T("carrito.cuponOk"));

  if (!Backend.remote) {
    return fin(null, T("carrito.cuponNo"));
  }

  /* Cupones de la ruleta: se validan en la base de datos y son de un solo uso. */
  Backend.rpc("validar_premio_cliente", {
    p_codigo: c
  }).then(function (r) {
    if (
      r &&
      (r.tipo === "pct" || r.tipo === "fijo") &&
      Number(r.valor) > 0
    ) {
      var minimo=Number(r.compra_minima)||0;
      if(minimo>subtotal()){
        return fin(null,"Este cupón requiere una compra mínima de "+fmt.format(minimo)+" COP.");
      }
      fin({
        codigo: c,
        tipo: r.tipo,
        valor: Number(r.valor),
        compra_minima:minimo,
        activo: true
      }, T("carrito.cuponOk"));
    } else {
      fin(null, T("carrito.cuponNo"));
    }
  }).catch(function () {
    fin(null, T("carrito.cuponNo"));
  });
}
