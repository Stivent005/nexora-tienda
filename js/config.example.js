/*
 * Plantilla de configuracion del cliente NEXORA.
 * No se carga desde index.html ni admin.html; el sitio actual usa js/config.js.
 * url y anonKey/publicable son visibles para cualquier visitante del navegador.
 * La seguridad depende de Auth, privilegios y RLS, nunca de ocultar esta clave.
 * No agregues aqui una service_role/secret key ni una clave local de administrador.
 */
var CONFIG={
  nombre:"NEXORA",
  lema:"",
  whatsapp:"",
  nequi:"",
  banco:"",
  moneda:"COP",
  supabase:{
    enabled:false,
    // Activar solo cuando supabase/05_seguridad_compras_pagos.sql esté aplicado.
    secureCheckout:false,
    customerAccounts:false,
    url:"",
    anonKey:""
  }
};
