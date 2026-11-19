/* FASE 2A · HUD: loader, fondo con partículas, barra de progreso, toasts, skeletons y título animado.
   Se carga DESPUÉS de store.js y ANTES de main.js (necesita envolver renderStore y Backend.catalogo antes del arranque). */
(function(){
  var motionQuery=window.matchMedia?window.matchMedia("(prefers-reduced-motion: reduce)"):null,
      RM=!!(motionQuery&&motionQuery.matches),
      mob=innerWidth<760||/Mobi|Android/i.test(navigator.userAgent),
      $=function(i){return document.getElementById(i)};

  /* ---- Loader: se quita en cuanto carga la página (mínimo 650 ms para que se vea) ---- */
  var t0=performance.now(),b0=$("boot");
  function hideBoot(){
    var b=b0;if(!b)return;b0=null;
    setTimeout(function(){b.classList.add("out");setTimeout(function(){b.remove()},700)},Math.max(0,650-(performance.now()-t0)));
  }
  addEventListener("load",hideBoot);setTimeout(hideBoot,3000);

  /* ---- Skeletons: mientras Supabase responde se muestran tarjetas fantasma en vez de la tienda vacía ---- */
  var loading=typeof REMOTO!=="undefined"&&!!REMOTO;
  if(loading&&typeof Backend!=="undefined"&&Backend.catalogo){
    var bc=Backend.catalogo,catalogTimer=setTimeout(function(){
      if(!loading)return;
      loading=false;
      if(typeof window.catalogoCargando!=="undefined")window.catalogoCargando=false;
      if(!window.catalogoError){
        window.catalogoError=window.items&&window.items.some(function(p){return p.active})
          ?"No pudimos actualizar el catálogo. Se muestran los productos guardados en este dispositivo."
          :"No se pudo conectar con la tienda en línea. Revisa tu conexión y vuelve a intentarlo.";
      }
      if(typeof window.renderStore==="function")window.renderStore();
    },14000);
    Backend.catalogo=function(){
      var p=bc.apply(Backend,arguments),d=function(){loading=false;clearTimeout(catalogTimer)};
      p.then(d,d);return p;
    };
  }
  var rs=window.renderStore;
  window.renderStore=function(){
    if(loading){
      var s="";for(var i=0;i<6;i++)s+='<div class="skel"><div class="sk-pic"></div><div class="sk-l"></div><div class="sk-l s"></div><div class="sk-b"></div></div>';
      $("app").innerHTML='<section class="hero hero-x sk-hero"><div class="hud-tag"><i></i>CARGANDO CATÁLOGO...</div></section><div class="skel-grid" aria-busy="true">'+s+'</div>';
      return;
    }
    return rs.apply(this,arguments);
  };

  /* ---- Toasts (reemplazan al alert() del sistema actual) ---- */
  window.toast=function(msg,type){
    var c=$("toasts");
    if(!c){c=document.createElement("div");c.id="toasts";c.setAttribute("role","status");c.setAttribute("aria-live","polite");document.body.appendChild(c)}
    var t=document.createElement("div"),i=document.createElement("b"),s=document.createElement("span"),p=document.createElement("u");
    t.className="toast"+(type==="err"?" err":"");i.textContent=type==="err"?"⚠":"✓";s.textContent=msg;
    t.appendChild(i);t.appendChild(s);t.appendChild(p);c.appendChild(t);
    while(c.children.length>4)c.firstChild.remove();
    setTimeout(function(){t.classList.add("out");setTimeout(function(){t.remove()},400)},type==="err"?5000:3200);
  };
  window.alert=function(m){toast(String(m),"err")};
  document.addEventListener("click",function(e){
    var t=e.target.closest&&e.target.closest("[data-add],[data-go]");if(!t)return;
    if(t.dataset.add)toast("PRODUCTO AGREGADO");
    else{var c=document.querySelector("#app .card,#app .skel");if(c)c.scrollIntoView({behavior:RM?"auto":"smooth",block:"center"})}
  });

  /* ---- Título del hero palabra por palabra (se repite en cada render porque la tienda se repinta) ---- */
  function split(){
    var h=document.querySelector(".hero-x h1:not(.sp)");if(!h||RM)return;
    var w=h.textContent.trim().split(/\s+/);h.classList.add("sp");h.setAttribute("aria-label",h.textContent);h.textContent="";
    w.forEach(function(t,i){var a=document.createElement("span"),b=document.createElement("span");a.className="w";a.style.setProperty("--w",i);a.setAttribute("aria-hidden","true");b.textContent=t;a.appendChild(b);h.appendChild(a);h.appendChild(document.createTextNode(" "))});
  }
  if($("app")){new MutationObserver(split).observe($("app"),{childList:true});split()}

  /* ---- Barra de progreso de scroll: se conserva como feedback estático ---- */
  var bar=document.createElement("div"),sk=0;bar.id="hud-prog";bar.setAttribute("aria-hidden","true");document.body.appendChild(bar);
  function onScroll(){if(sk)return;sk=1;requestAnimationFrame(function(){sk=0;var h=document.documentElement;bar.style.transform="scaleX("+(scrollY/Math.max(1,h.scrollHeight-innerHeight))+")"})}
  addEventListener("scroll",onScroll,{passive:true});

  /* ---- Efectos de puntero y fondo: se conectan/desconectan al cambiar la preferencia ---- */
  var pointerActive=false,heroFrame=0,heroPending=null,fx=null;
  var lite=(navigator.hardwareConcurrency||8)<=4||(navigator.deviceMemory||8)<=2;
  if(lite)document.documentElement.classList.add("lite");

  function onPointerMove(event){
    if(RM||mob)return;
    if(fx&&fx.active)fx.setPointer(event.clientX/Math.max(1,innerWidth)-.5,event.clientY/Math.max(1,innerHeight)-.5);
    var hero=event.target.closest&&event.target.closest(".hero-x");
    if(!hero)return;
    heroPending={element:hero,x:event.clientX,y:event.clientY};
    if(heroFrame)return;
    heroFrame=requestAnimationFrame(function(){
      heroFrame=0;
      if(RM||!heroPending)return;
      var pending=heroPending;heroPending=null;
      var rect=pending.element.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      pending.element.style.setProperty("--rx",(-((pending.y-rect.top)/rect.height-.5)*40)+"deg");
      pending.element.style.setProperty("--ry",(((pending.x-rect.left)/rect.width-.5)*60)+"deg");
    });
  }

  function makeBackdrop(){
    var grid=document.createElement("div");grid.id="hud-grid";grid.setAttribute("aria-hidden","true");grid.appendChild(document.createElement("i"));document.body.prepend(grid);
    var canvas=document.createElement("canvas");canvas.id="bg-fx";canvas.setAttribute("aria-hidden","true");document.body.prepend(canvas);
    var ctx=canvas.getContext("2d");
    var dpr=Math.min(devicePixelRatio||1,1.5),width=0,height=0;
    var count=(mob||lite)?24:60,particles=[],raf=0,resizeTimer=0,active=false;
    var lastTime=0,slowFrames=0,mx=0,my=0;

    function resize(){width=canvas.width=Math.round(innerWidth*dpr);height=canvas.height=Math.round(innerHeight*dpr)}
    resize();
    for(var i=0;i<count;i++)particles.push({x:Math.random()*width,y:Math.random()*height,vx:(Math.random()-.5)*.25*dpr,vy:(Math.random()-.5)*.25*dpr,r:(Math.random()*1.4+.6)*dpr,z:Math.random()+.2,c:i%4?"34,211,238":"139,92,246"});

    function frame(time){
      raf=0;
      if(!active||RM||document.hidden||!ctx)return;
      if(lastTime&&time){if(time-lastTime>34){if(++slowFrames>45&&count>14){count=Math.max(14,count>>1);particles.length=count;slowFrames=0}}else if(slowFrames>0)slowFrames--}
      lastTime=time||lastTime;
      ctx.clearRect(0,0,width,height);var limit=(mob?90:130)*dpr,a,b,d,p;
      for(a=0;a<count;a++){
        p=particles[a];p.x+=p.vx;p.y+=p.vy;if(p.x<0)p.x=width;else if(p.x>width)p.x=0;if(p.y<0)p.y=height;else if(p.y>height)p.y=0;
        p.px=p.x+mx*p.z*28*dpr;p.py=p.y+my*p.z*28*dpr;
        ctx.fillStyle="rgba("+p.c+",.75)";ctx.beginPath();ctx.arc(p.px,p.py,p.r,0,6.283);ctx.fill();
      }
      ctx.lineWidth=dpr*.6;
      for(a=0;a<count;a++)for(b=a+1;b<count;b++){
        d=Math.hypot(particles[a].px-particles[b].px,particles[a].py-particles[b].py);
        if(d<limit){ctx.strokeStyle="rgba(34,211,238,"+(.2*(1-d/limit))+")";ctx.beginPath();ctx.moveTo(particles[a].px,particles[a].py);ctx.lineTo(particles[b].px,particles[b].py);ctx.stroke()}
      }
      if(active&&!RM&&!document.hidden)raf=requestAnimationFrame(frame);
    }

    function go(){if(active&&!RM&&!document.hidden&&!raf&&ctx)raf=requestAnimationFrame(frame)}
    function onVisibility(){if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0}else go()}
    function onResize(){clearTimeout(resizeTimer);resizeTimer=setTimeout(resize,200)}
    return {
      grid:grid,canvas:canvas,active:false,
      setPointer:function(x,y){mx=x;my=y},
      start:function(){
        active=true;this.active=true;grid.hidden=false;canvas.hidden=false;
        document.addEventListener("visibilitychange",onVisibility);
        window.addEventListener("resize",onResize,{passive:true});
        go();
      },
      stop:function(){
        active=false;this.active=false;
        if(raf)cancelAnimationFrame(raf);raf=0;
        clearTimeout(resizeTimer);resizeTimer=0;
        document.removeEventListener("visibilitychange",onVisibility);
        window.removeEventListener("resize",onResize);
        mx=0;my=0;grid.hidden=true;canvas.hidden=true;
      }
    };
  }

  function startMotion(){
    if(RM)return;
    if(!fx)fx=makeBackdrop();
    if(!pointerActive&&!mob){document.addEventListener("mousemove",onPointerMove,{passive:true});pointerActive=true}
    fx.start();
  }

  function stopMotion(){
    if(pointerActive){document.removeEventListener("mousemove",onPointerMove);pointerActive=false}
    if(heroFrame)cancelAnimationFrame(heroFrame);heroFrame=0;heroPending=null;
    document.querySelectorAll(".hero-x").forEach(function(hero){hero.style.removeProperty("--rx");hero.style.removeProperty("--ry")});
    if(fx)fx.stop();
  }

  function onMotionPreferenceChange(event){
    var next=!!event.matches;if(next===RM)return;RM=next;
    if(RM)stopMotion();else startMotion();
  }

  if(motionQuery){
    if(typeof motionQuery.addEventListener==="function")motionQuery.addEventListener("change",onMotionPreferenceChange);
    else if(typeof motionQuery.addListener==="function")motionQuery.addListener(onMotionPreferenceChange);
  }
  if(RM)stopMotion();else startMotion();
})();
