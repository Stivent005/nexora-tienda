/* FASE 4 · cursor personalizado opcional (solo PC) y pausa del hero fuera de pantalla. */
(function () {
  "use strict";

  var motionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  var cursorQuery = window.matchMedia
    ? window.matchMedia("(hover:hover) and (pointer:fine)")
    : null;
  var reducedMotion = !!(motionQuery && motionQuery.matches);
  var cursorSupported = !!(cursorQuery && cursorQuery.matches && innerWidth >= 760);
  var app = document.getElementById("app");

  /* El hero pausa sus animaciones cuando no está visible. */
  if (app && window.IntersectionObserver) {
    var heroObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle("off", !entry.isIntersecting);
      });
    });
    var watchHero = function () {
      var hero = document.querySelector(".hero-x:not(.w8)");
      if (hero) {
        hero.classList.add("w8");
        heroObserver.observe(hero);
      }
    };
    new MutationObserver(watchHero).observe(app, { childList: true });
    watchHero();
  }

  /* Cursor personalizado: también se apaga si la preferencia cambia en esta sesión. */
  var H = document.documentElement;
  var KEY = "fx_cursor";
  var on = true;
  var mx = -100, my = -100, rx = -100, ry = -100, raf = 0;
  var dialogList = [].slice.call(document.querySelectorAll("dialog"));
  var dot = null, ring = null, toggle = null, cursorActive = false;

  try { on = localStorage.getItem(KEY) !== "off"; } catch (error) {}

  function syncCursor() {
    H.classList.toggle("cur-on", on && !dialogList.some(function (dialog) { return dialog.open; }));
  }

  function tick() {
    raf = 0;
    if (!cursorActive || reducedMotion || !dot || !ring) return;
    rx += (mx - rx) * 0.2;
    ry += (my - ry) * 0.2;
    dot.style.transform = "translate(" + mx + "px," + my + "px)";
    ring.style.transform = "translate(" + rx + "px," + ry + "px)";
    if (Math.abs(mx - rx) > 0.3 || Math.abs(my - ry) > 0.3) raf = requestAnimationFrame(tick);
  }

  function onMouseMove(event) {
    if (!cursorActive || !on || reducedMotion) return;
    mx = event.clientX;
    my = event.clientY;
    syncCursor();
    if (!raf) raf = requestAnimationFrame(tick);
    var target = event.target.closest &&
      event.target.closest("a,button,.card,.chip,input,select,textarea,[data-add]");
    ring.classList.toggle("hot", !!target && !target.disabled);
  }

  function onMouseLeave() {
    H.classList.remove("cur-on");
  }

  function onToggle() {
    on = !on;
    toggle.setAttribute("aria-pressed", on);
    syncCursor();
    if (typeof Cookies !== "undefined" && Cookies.ok && Cookies.ok("preferencias")) {
      try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (error) {}
    }
  }

  function startCursor() {
    if (cursorActive || reducedMotion || !cursorSupported) return;
    cursorActive = true;
    function makeElement(tag, id) {
      var element = document.createElement(tag);
      element.id = id;
      element.setAttribute("aria-hidden", "true");
      document.body.appendChild(element);
      return element;
    }
    dot = makeElement("div", "cur-dot");
    ring = makeElement("div", "cur-ring");
    toggle = document.createElement("button");
    toggle.id = "cur-tg";
    toggle.type = "button";
    toggle.textContent = "◎";
    toggle.title = "Cursor personalizado: activar/desactivar";
    toggle.setAttribute("aria-label", "Activar o desactivar el cursor personalizado");
    toggle.setAttribute("aria-pressed", on);
    document.body.appendChild(toggle);
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);
    toggle.addEventListener("click", onToggle);
    syncCursor();
  }

  function stopCursor() {
    if (!cursorActive) return;
    cursorActive = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseleave", onMouseLeave);
    if (toggle) toggle.removeEventListener("click", onToggle);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    H.classList.remove("cur-on");
    if (dot) dot.remove();
    if (ring) ring.remove();
    if (toggle) toggle.remove();
    dot = ring = toggle = null;
  }

  function onMotionPreferenceChange(event) {
    var next = !!event.matches;
    if (next === reducedMotion) return;
    reducedMotion = next;
    if (reducedMotion) stopCursor();
    else startCursor();
  }

  if (motionQuery) {
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", onMotionPreferenceChange);
    } else if (typeof motionQuery.addListener === "function") {
      motionQuery.addListener(onMotionPreferenceChange);
    }
  }

  startCursor();
})();
