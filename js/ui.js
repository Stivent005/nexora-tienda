/* INTERFAZ COMÚN: barra superior. La tienda y la administración viven en la misma página. */
function renderTop(){
  $("fname").textContent=T("pie.derechos",{nombre:cfg.nombre});
  document.title=cfg.nombre+(ADMIN_PAGE?" · Administración":"");

  if($("adminlink"))
    $("adminlink").textContent=T("pie.admin");

  $("topbar").innerHTML=
    '<span class="logo">'+
    (
      safeImg(cfg.logo)
      ?'<img src="'+safeImg(cfg.logo)+'" alt="" style="height:34px;vertical-align:middle;margin-right:8px">'
      :''
    )+
    esc(cfg.nombre)+
    '</span>'+
    '<div class="grow">'+
      '<input type="search" id="q" placeholder="'+
      esc(T("top.buscar"))+
      '" aria-label="'+
      esc(T("top.buscar"))+
      '">'+
    '</div>'+
    (
      ADMIN_PAGE
      ?
        (
          authed
          ?'<span class="tag off">'+esc(T("top.modoAdmin"))+'</span>'
          :'<button class="btn" id="toadmin">'+esc(T("top.admin"))+'</button>'
        )
      :
        '<button class="btn" id="pts">🎁 Mis puntos</button>'
    )+
    '<button class="btn" id="opencart">'+
      esc(T("top.carrito"))+
      '<b id="count">0</b>'+
    '</button>';

  if(!ADMIN_PAGE){
    var accountUser=Backend.customer?Backend.customer():null;

    $("topbar").insertAdjacentHTML(
      "beforeend",
      '<button class="btn" type="button" data-x="account" aria-label="Mi cuenta'+
      (accountUser?': '+esc(accountUser.email):'')+
      '">'+
      (accountUser?'Mi cuenta':'Iniciar sesión')+
      '</button>'
    );
  }

  $("q").addEventListener("input",renderStore);

  /*
    askPin está definido en admin.js.
    ui.js puede ejecutarse antes que admin.js, por eso no
    se referencia directamente durante la carga.
  */
  if(ADMIN_PAGE&&!authed){
    $("toadmin").addEventListener("click",function(){
      if(typeof askPin==="function"){
        askPin();
      }else{
        alert("No se pudo cargar el módulo de administración.");
      }
    });
  }

  if($("pts"))
    $("pts").addEventListener("click",abrirPuntos);

  $("opencart").addEventListener("click",function(){
    step="cart";
    drawCart();
    $("dlg").showModal();
  });

  if($("adminlink"))
    $("adminlink").style.display=authed?"none":"";
}

function renderAll(){
  renderTop();
  renderStore();

  if(ADMIN_PAGE)
    renderAdmin();
}

function refresh(){
  renderStore();

  if(ADMIN_PAGE)
    renderAdmin();
}