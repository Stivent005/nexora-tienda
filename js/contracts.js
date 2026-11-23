/* Contratos locales versionados de producto y pedido.
   Este módulo limpia y conserva datos; no autoriza pagos ni calcula importes de checkout. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NexoraContracts = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var DIGITAL_KEYS = ["playerId", "displayName", "region", "server"];
  var PHYSICAL_STATES = ["pending", "reserved", "preparing", "shipped", "delivered", "return_requested", "returned", "incident", "cancelled"];
  var DIGITAL_STATES = ["pending", "paid_verified", "queued", "processing", "delivered", "incident", "cancelled"];

  function text(value, max) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function number(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function normalizeDigitalFields(source) {
    var seen = Object.create(null);
    if (!Array.isArray(source)) return [];
    return source.slice(0, 4).map(function (field) {
      field = field && typeof field === "object" ? field : {};
      var key = DIGITAL_KEYS.indexOf(field.key) >= 0 ? field.key : "";
      if (!key || seen[key]) return null;
      seen[key] = true;
      var validation = ["text", "digits", "digits_6_15", "alphanumeric"].indexOf(field.validation) >= 0
        ? field.validation : "text";
      return {
        key: key,
        label: text(field.label, 60) || key,
        required: field.required !== false,
        validation: validation,
        maxLength: Math.max(1, Math.min(120, Math.floor(number(field.maxLength, 80))))
      };
    }).filter(Boolean);
  }

  function defaultDigitalFields(product) {
    var digital = product && product.digital && typeof product.digital === "object" ? product.digital : {};
    return [
      { key: "playerId", label: text(digital.playerIdLabel, 60) || "ID del jugador o cuenta", required: true, validation: digital.playerIdValidation || "text", maxLength: 80 },
      { key: "displayName", label: text(digital.displayNameLabel, 60) || "Nombre visible de la cuenta", required: true, validation: "text", maxLength: 80 }
    ].concat(digital.serverMode === "optional" || digital.serverMode === "required" ? [
      { key: "server", label: text(digital.serverLabel, 60) || "Servidor o región", required: digital.serverMode === "required", validation: "text", maxLength: 60 }
    ] : []);
  }

  function normalizeDigital(product) {
    var raw = product.digital && typeof product.digital === "object" ? product.digital : {};
    var fields = normalizeDigitalFields(raw.fields);

    if (product.tipo === "virtual") {
      var defaults = normalizeDigitalFields(defaultDigitalFields(product)), configured = fields;

      fields = defaults.map(function (field) {
        var custom = configured.find(function (item) {
          return item.key === field.key;
        });

        if (custom) {
          field = Object.assign({}, field, custom, { required: true });
        }

        return field;
      });

      configured.forEach(function (field) {
        if (!fields.some(function (item) {
          return item.key === field.key;
        })) {
          fields.push(field);
        }
      });
    }

    return {
      game: text(raw.game, 80),
      packageLabel: text(raw.packageLabel || product.valorDigital, 120),
      playerIdLabel: text(raw.playerIdLabel, 60) || "ID del jugador o cuenta",
      playerIdValidation: ["text", "digits", "digits_6_15", "alphanumeric"].indexOf(raw.playerIdValidation) >= 0
        ? raw.playerIdValidation
        : "text",
      displayNameLabel: text(raw.displayNameLabel, 60) || "Nombre visible de la cuenta",
      serverMode: ["none", "optional", "required"].indexOf(raw.serverMode) >= 0
        ? raw.serverMode
        : "none",
      serverLabel: text(raw.serverLabel, 60) || "Servidor o región",
      fields: fields
    };
  }

  function normalizeSpecifications(source) {
    if (!Array.isArray(source)) return [];

    return source.slice(0, 20).map(function (item) {
      item = item && typeof item === "object" ? item : {};

      return {
        name: text(item.name, 50),
        value: text(item.value, 120)
      };
    }).filter(function (item) {
      return item.name && item.value;
    });
  }

  function normalizeVariants(source) {
    if (!Array.isArray(source)) return [];

    return source.slice(0, 50).map(function (item, index) {
      item = item && typeof item === "object" ? item : {};

      var id = /^[A-Za-z0-9_-]{1,40}$/.test(String(item.id || ""))
        ? String(item.id)
        : "variant-" + (index + 1);

      return {
        id: id,
        sku: text(item.sku, 40),
        name: text(item.name, 80),
        price: number(item.price, 0),
        offerPrice: number(item.offerPrice, 0),
        stock: Math.floor(number(item.stock, 0)),
        active: item.active !== false
      };
    });
  }

  function normalizeProduct(source, options) {
    var p = source && typeof source === "object" ? source : {};
    var opts = options || {};

    var validId = /^[A-Za-z0-9_-]{1,40}$/.test(String(p.id || ""));

    var id = validId
      ? String(p.id)
      : (typeof opts.makeId === "function" ? opts.makeId() : "product-unknown");

    var tipo = p.tipo === "virtual" ? "virtual" : "fisico";

    var safeImage = typeof opts.safeImage === "function"
      ? opts.safeImage(p.image)
      : "";

    return {
      schemaVersion: 2,
      id: id,
      name: text(p.name, 80),
      description: text(p.description, 500),
      price: number(p.price, 0),
      stock: Math.floor(number(p.stock, 0)),
      tipo: tipo,
      ilimitado: !!p.ilimitado,
      category: text(p.category, 40),
      brand: text(p.brand, 60),
      sku: text(p.sku, 40),
      unit: text(p.unit, 30) || "unidad",
      specifications: normalizeSpecifications(p.specifications),
      variants: normalizeVariants(p.variants),
      digital: normalizeDigital(Object.assign({}, p, { tipo: tipo })),
      envio: text(p.envio, 200),
      garantia: text(p.garantia, 200),
      valorDigital: text(p.valorDigital, 120),
      tiempoDigital: text(p.tiempoDigital, 100),
      offer: !!p.offer,
      offerPrice: number(p.offerPrice, 0),
      active: p.active !== false,
      image: safeImage,
      createdAt: number(p.createdAt, Date.now()) || Date.now()
    };
  }

  function digitalFields(product) {
    return normalizeDigital(product || {}).fields;
  }

  function validateDigitalValues(fields, values) {
    values = values && typeof values === "object" ? values : {};

    var errors = [];

    normalizeDigitalFields(fields).forEach(function (field) {
      var value = text(values[field.key], field.maxLength);
      var valid = true;

      if (field.required && !value) {
        valid = false;
      }

      if (value && field.validation === "digits") {
        valid = /^\d+$/.test(value);
      }

      if (value && field.validation === "digits_6_15") {
        valid = /^\d{6,15}$/.test(value);
      }

      if (value && field.validation === "alphanumeric") {
        valid = /^[A-Za-z0-9_-]+$/.test(value);
      }

      if (!valid) {
        errors.push(field.label);
      }
    });

    return errors;
  }

  function sanitizeDigitalValues(fields, values) {
    values = values && typeof values === "object" ? values : {};

    var out = {};

    normalizeDigitalFields(fields).forEach(function (field) {
      if (values[field.key] != null) {
        out[field.key] = text(values[field.key], field.maxLength);
      }
    });

    return out;
  }

  function normalizeAddress(source, legacy) {
    var a = source && typeof source === "object" ? source : {};
    var l = legacy && typeof legacy === "object" ? legacy : {};

    var method = a.method === "pickup" || l.punto
      ? "pickup"
      : "home";

    return {
      method: method,
      street: text(a.street || l.dir, 300),
      city: text(a.city, 80),
      department: text(a.department, 80),
      zone: text(a.zone, 100),
      reference: text(a.reference, 160),
      pickupPoint: text(a.pickupPoint || l.punto, 200),
      tariffVersion: text(a.tariffVersion, 40)
    };
  }

  function validateAddress(source) {
    var a = normalizeAddress(source);
    var errors = [];

    if (a.method === "pickup") {
      if (!a.pickupPoint) {
        errors.push("punto de recogida");
      }

      return errors;
    }

    if (!a.street) {
      errors.push("dirección");
    }

    if (!a.city) {
      errors.push("ciudad");
    }

    if (!a.department) {
      errors.push("departamento");
    }

    return errors;
  }

  function normalizeOrderLine(source, index) {
    var line = source && typeof source === "object" ? source : {};
    var digital = !!line.v;
    var allowedStates = digital ? DIGITAL_STATES : PHYSICAL_STATES;
    var fulfillment = line.fulfillment && typeof line.fulfillment === "object"
      ? line.fulfillment
      : {};

    /*
     * Los pedidos nuevos pueden llegar con:
     *   name  -> nombre del producto
     *   price -> precio del producto
     *
     * Los pedidos antiguos usan:
     *   n     -> nombre
     *   pr    -> precio
     *
     * Se aceptan ambos formatos para mantener compatibilidad.
     */
    var name = line.n != null && line.n !== ""
      ? line.n
      : line.name;

    var price = line.pr != null && line.pr !== ""
      ? line.pr
      : line.price;

    var status = allowedStates.indexOf(fulfillment.status) >= 0
      ? fulfillment.status
      : "pending";

    return {
      lineId: text(line.lineId, 80) || "legacy-" + text(line.id, 40) + "-" + (Number(index) + 1),
      id: text(line.id, 40),
      n: text(name, 120),
      q: Math.floor(number(line.q, 0)),
      pr: number(price, 0),
      v: digital,
      puntos: typeof line.puntos === "number" && Number.isFinite(line.puntos) && line.puntos >= 0
        ? Math.floor(line.puntos)
        : null,
      sku: text(line.sku, 40),
      brand: text(line.brand, 60),
      unit: text(line.unit, 30) || "unidad",
      variantId: text(line.variantId, 40),
      fulfillment: {
        type: digital ? "digital" : "physical",
        status: status,
        carrier: text(fulfillment.carrier, 80),
        trackingNumber: text(fulfillment.trackingNumber, 100),
        evidenceRef: text(fulfillment.evidenceRef, 100)
      },
      digitalData: digital
        ? sanitizeDigitalValues(line.digitalFields, line.digitalData)
        : {}
    };
  }

  function variantIdentityErrors(source) {
    var variants = normalizeVariants(source);
    var ids = Object.create(null);
    var skus = Object.create(null);
    var errors = [];

    variants.forEach(function (variant) {
      if (ids[variant.id]) {
        errors.push("ID de variante duplicado: " + variant.id);
      }

      ids[variant.id] = true;

      if (variant.sku && skus[variant.sku.toLowerCase()]) {
        errors.push("SKU de variante duplicado: " + variant.sku);
      }

      if (variant.sku) {
        skus[variant.sku.toLowerCase()] = true;
      }
    });

    return errors;
  }

  function normalizeFavoriteIds(source) {
    if (!Array.isArray(source)) return [];

    var seen = Object.create(null);
    var ids = [];

    source.slice(0, 2000).forEach(function (value) {
      var id = typeof value === "string" ? value : "";

      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || seen[id]) {
        return;
      }

      seen[id] = true;

      if (ids.length < 1000) {
        ids.push(id);
      }
    });

    return ids;
  }

  function toggleFavoriteId(source, value) {
    var ids = normalizeFavoriteIds(source);
    var id = typeof value === "string" ? value : "";

    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
      return {
        ids: ids,
        active: false,
        changed: false
      };
    }

    var index = ids.indexOf(id);

    if (index >= 0) {
      ids.splice(index, 1);

      return {
        ids: ids,
        active: false,
        changed: true
      };
    }

    if (ids.length >= 1000) {
      return {
        ids: ids,
        active: false,
        changed: false,
        limit: true
      };
    }

    ids.push(id);

    return {
      ids: ids,
      active: true,
      changed: true
    };
  }

  return {
    normalizeProduct: normalizeProduct,
    normalizeDigitalFields: normalizeDigitalFields,
    digitalFields: digitalFields,
    validateDigitalValues: validateDigitalValues,
    sanitizeDigitalValues: sanitizeDigitalValues,
    normalizeAddress: normalizeAddress,
    validateAddress: validateAddress,
    normalizeOrderLine: normalizeOrderLine,
    variantIdentityErrors: variantIdentityErrors,
    normalizeFavoriteIds: normalizeFavoriteIds,
    toggleFavoriteId: toggleFavoriteId
  };
});