/* Efectos decorativos y entradas. No controla interacciones ni acciones de compra. */
(function () {
  "use strict";

  var motionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  var reducedMotion = !!(motionQuery && motionQuery.matches);
  var motionActive = false;
  var seen = Object.create(null);
  var observers = [];
  var intersectionObserver = null;
  var dbObserver = null;
  var db = document.getElementById("dbox");
  var header = document.querySelector("header");
  var cardFrame = 0;
  var scrollFrame = 0;
  var pendingPointer = null;
  var activeCard = null;
  var countAnimations = [];
  var timeouts = [];
  var flyAnimations = [];
  var lastDialogTitle = "";

  function formatCount(value, element) {
    if (element.hasAttribute("data-plain")) return String(value);
    if (typeof fmt !== "undefined" && fmt && typeof fmt.format === "function") {
      return fmt.format(value);
    }
    return new Intl.NumberFormat("es-CO").format(value);
  }

  function writeCount(element, value) {
    var rounded = Math.round(value);
    element.textContent = formatCount(rounded, element);
  }

  function removeCountAnimation(animation) {
    var index = countAnimations.indexOf(animation);
    if (index !== -1) countAnimations.splice(index, 1);
  }

  function animateCounts() {
    if (!db) return;

    db.querySelectorAll("[data-count]").forEach(function (element) {
      var target = Number(element.dataset.count) || 0;
      var startedAt = performance.now();
      var animation = { id: 0, element: element, target: target };
      countAnimations.push(animation);

      function step(now) {
        animation.id = 0;
        if (!motionActive || reducedMotion) {
          writeCount(element, target);
          removeCountAnimation(animation);
          return;
        }

        var progress = Math.min(1, (now - startedAt) / 900);
        var value = Math.round(target * (1 - Math.pow(1 - progress, 3)));
        writeCount(element, value);

        if (progress < 1) {
          animation.id = requestAnimationFrame(step);
        } else {
          removeCountAnimation(animation);
        }
      }

      animation.id = requestAnimationFrame(step);
    });
  }

  function clearCardGlow(card) {
    if (!card) return;
    card.style.removeProperty("--mx");
    card.style.removeProperty("--my");
  }

  function updateCardGlow() {
    cardFrame = 0;
    if (!motionActive || reducedMotion) return;

    var pointer = pendingPointer;
    pendingPointer = null;
    var card = pointer && pointer.card;

    if (activeCard !== card) clearCardGlow(activeCard);
    activeCard = card || null;
    if (!card || !card.isConnected) return;

    var rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    var x = (pointer.x - rect.left) + "px";
    var y = (pointer.y - rect.top) + "px";
    if (card.style.getPropertyValue("--mx") !== x) card.style.setProperty("--mx", x);
    if (card.style.getPropertyValue("--my") !== y) card.style.setProperty("--my", y);
  }

  function onCardMouseMove(event) {
    if (!motionActive || reducedMotion) return;
    var card = event.target.closest && event.target.closest(".card");
    pendingPointer = card ? { card: card, x: event.clientX, y: event.clientY } : null;
    if (!cardFrame) cardFrame = requestAnimationFrame(updateCardGlow);
  }

  function watch(id, selector) {
    var root = document.getElementById(id);
    if (!root) return;

    var scan = function () {
      if (!motionActive || reducedMotion) return;
      var old = seen[id] || Object.create(null);
      var now = Object.create(null);
      var order = 0;

      root.querySelectorAll(selector).forEach(function (element, index) {
        var button = element.querySelector("[data-add],[data-od],[data-oa]");
        var key = button
          ? (button.dataset.add || button.dataset.od || button.dataset.id)
          : "k" + index;
        key = key || "k" + index;
        now[key] = true;

        if (!old[key]) {
          element.classList.add("enter");
          element.style.setProperty("--i", Math.min(order++, 10));
          if (intersectionObserver) intersectionObserver.observe(element);
          else element.classList.add("vis");
        }
      });
      seen[id] = now;
    };

    var observer = new MutationObserver(scan);
    observer.observe(root, { childList: true });
    observers.push(observer);
    scan();
  }

  function onDialogChange() {
    if (!db || !motionActive || reducedMotion) return;
    var title = db.querySelector("h2");
    var nextTitle = title ? title.textContent : "";
    if (nextTitle === lastDialogTitle) return;
    lastDialogTitle = nextTitle;

    db.classList.remove("swap");
    void db.offsetWidth;
    db.classList.add("swap");
    animateCounts();
  }

  function onScroll() {
    if (header) header.classList.toggle("scrolled", window.scrollY > 12);
    if (!motionActive || reducedMotion || scrollFrame) return;

    scrollFrame = requestAnimationFrame(function () {
      scrollFrame = 0;
      if (!motionActive || reducedMotion) return;
      var hero = document.querySelector(".hero");
      if (hero) hero.style.setProperty("--sy", (window.scrollY * 0.18) + "px");
    });
  }

  function removeTimeout(timer) {
    var index = timeouts.indexOf(timer);
    if (index !== -1) timeouts.splice(index, 1);
  }

  function flyToCart(button) {
    var cart = document.getElementById("opencart");
    if (!cart || typeof button.animate !== "function") return;

    var from = button.getBoundingClientRect();
    var to = cart.getBoundingClientRect();
    var dot = document.createElement("div");
    dot.className = "fly";
    dot.style.left = (from.left + from.width / 2 - 9) + "px";
    dot.style.top = (from.top + from.height / 2 - 9) + "px";
    document.body.appendChild(dot);

    var animation = dot.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      {
        transform: "translate(" + (to.left + to.width / 2 - from.left - from.width / 2) + "px," +
          (to.top + to.height / 2 - from.top - from.height / 2) + "px) scale(.3)",
        opacity: 0.4
      }
    ], { duration: 650, easing: "cubic-bezier(.5,-.2,.7,.4)" });

    var record = { animation: animation, node: dot };
    flyAnimations.push(record);
    animation.onfinish = function () {
      var index = flyAnimations.indexOf(record);
      if (index !== -1) flyAnimations.splice(index, 1);
      dot.remove();
      if (!motionActive || reducedMotion || !cart.isConnected) return;
      cart.classList.remove("bump");
      void cart.offsetWidth;
      cart.classList.add("bump");
    };
  }

  function onDecorativeClick(event) {
    if (!motionActive || reducedMotion) return;
    var button = event.target.closest && event.target.closest(".btn,.chip,.paytile");
    if (!button) return;

    var rect = button.getBoundingClientRect();
    var diameter = Math.max(rect.width, rect.height) * 2;
    var ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.cssText = "width:" + diameter + "px;height:" + diameter + "px;left:" +
      (event.clientX - rect.left - diameter / 2) + "px;top:" +
      (event.clientY - rect.top - diameter / 2) + "px";
    button.appendChild(ripple);

    var timer = window.setTimeout(function () {
      ripple.remove();
      removeTimeout(timer);
    }, 600);
    timeouts.push(timer);

    if (button.dataset && button.dataset.add) flyToCart(button);
  }

  function startMotion() {
    if (motionActive || reducedMotion) return;
    motionActive = true;

    intersectionObserver = "IntersectionObserver" in window
      ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!motionActive || reducedMotion || !intersectionObserver) return;
          if (!entry.isIntersecting) return;
          entry.target.classList.add("vis");
          intersectionObserver.unobserve(entry.target);
        });
      }, { threshold: 0.06 })
      : null;

    watch("app", ".card:not(.addcard)");
    watch("panel", ".row.order,.stat");
    if (db && typeof MutationObserver === "function") {
      dbObserver = new MutationObserver(onDialogChange);
      dbObserver.observe(db, { childList: true });
    }

    document.addEventListener("mousemove", onCardMouseMove, { passive: true });
    document.addEventListener("click", onDecorativeClick, true);
    onScroll();
  }

  function stopMotion() {
    if (!motionActive) return;
    motionActive = false;

    document.removeEventListener("mousemove", onCardMouseMove);
    document.removeEventListener("click", onDecorativeClick, true);
    observers.forEach(function (observer) { observer.disconnect(); });
    observers = [];
    if (dbObserver) dbObserver.disconnect();
    dbObserver = null;
    if (intersectionObserver) intersectionObserver.disconnect();
    intersectionObserver = null;

    if (cardFrame) cancelAnimationFrame(cardFrame);
    cardFrame = 0;
    pendingPointer = null;
    clearCardGlow(activeCard);
    activeCard = null;

    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    var hero = document.querySelector(".hero");
    if (hero) hero.style.removeProperty("--sy");

    countAnimations.forEach(function (animation) {
      if (animation.id) cancelAnimationFrame(animation.id);
      writeCount(animation.element, animation.target);
    });
    countAnimations = [];

    flyAnimations.forEach(function (record) {
      record.animation.cancel();
      record.node.remove();
    });
    flyAnimations = [];
    timeouts.forEach(function (timer) { window.clearTimeout(timer); });
    timeouts = [];
    document.querySelectorAll(".ripple").forEach(function (node) { node.remove(); });
    var cart = document.getElementById("opencart");
    if (cart) cart.classList.remove("bump");

    document.querySelectorAll(".enter").forEach(function (element) {
      element.classList.add("vis");
    });
  }

  function onMotionPreferenceChange(event) {
    var nextReduced = !!event.matches;
    if (nextReduced === reducedMotion) return;
    reducedMotion = nextReduced;
    if (reducedMotion) stopMotion();
    else startMotion();
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  if (motionQuery) {
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", onMotionPreferenceChange);
    } else if (typeof motionQuery.addListener === "function") {
      motionQuery.addListener(onMotionPreferenceChange);
    }
  }

  if (reducedMotion) {
    if (header) header.classList.toggle("scrolled", window.scrollY > 12);
  } else {
    startMotion();
  }
})();
