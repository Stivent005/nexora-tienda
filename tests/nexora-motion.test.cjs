const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const motionSource = fs.readFileSync(path.join(__dirname, "../js/motion.js"), "utf8");

class EventHub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
  }

  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }

  count(type) {
    return (this.listeners.get(type) || []).length;
  }
}

function createEnvironment(initialReducedMotion) {
  const frames = new Map();
  const cancelledFrames = [];
  let nextFrame = 0;
  const media = new EventHub();
  media.matches = initialReducedMotion;
  media.change = (matches) => {
    media.matches = matches;
    media.dispatch("change", { matches });
  };

  const window = new EventHub();
  window.scrollY = 0;
  window.matchMedia = () => media;
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};

  const document = new EventHub();
  document.getElementById = () => null;
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  let applicationClicks = 0;
  document.addEventListener("click", () => { applicationClicks += 1; });

  const styleValues = new Map();
  const card = {
    isConnected: true,
    style: {
      setProperty: (name, value) => styleValues.set(name, value),
      getPropertyValue: (name) => styleValues.get(name) || "",
      removeProperty: (name) => styleValues.delete(name)
    },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 60 })
  };

  const context = {
    window,
    document,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    performance: { now: () => 0 },
    requestAnimationFrame(callback) {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame(id) {
      cancelledFrames.push(id);
      frames.delete(id);
    }
  };
  vm.runInNewContext(motionSource, context, { filename: "js/motion.js" });

  function flushFrames() {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(16);
  }

  function moveCard(x = 50, y = 50) {
    document.dispatch("mousemove", {
      target: { closest: (selector) => selector === ".card" ? card : null },
      clientX: x,
      clientY: y
    });
  }

  return { media, document, card, styleValues, frames, cancelledFrames, flushFrames, moveCard, get applicationClicks() { return applicationClicks; } };
}

test("movimiento reducido al inicio desactiva efectos y el cambio en vivo los restaura una sola vez", () => {
  const env = createEnvironment(true);
  assert.equal(env.document.count("mousemove"), 0);
  assert.equal(env.document.count("click"), 1); // Only the essential application listener.
  assert.equal(env.media.count("change"), 1);

  env.document.dispatch("click", { target: { closest: () => null } });
  assert.equal(env.applicationClicks, 1);

  env.media.change(false);
  env.media.change(false);
  assert.equal(env.document.count("mousemove"), 1);
  assert.equal(env.document.count("click"), 2);
  assert.equal(env.media.count("change"), 1);

  env.flushFrames();
  env.moveCard(42, 55);
  env.flushFrames();
  assert.equal(env.styleValues.get("--mx"), "32px");
  assert.equal(env.styleValues.get("--my"), "35px");
});

test("activar movimiento reducido cancela el frame pendiente, limpia el brillo y retira un listener", () => {
  const env = createEnvironment(false);
  assert.equal(env.document.count("mousemove"), 1);
  env.flushFrames();
  env.moveCard(42, 55);
  env.flushFrames();
  assert.equal(env.styleValues.get("--mx"), "32px");

  env.moveCard(60, 70);
  const pendingFrame = [...env.frames.keys()][0];
  assert.ok(pendingFrame);
  env.media.change(true);

  assert.equal(env.document.count("mousemove"), 0);
  assert.deepEqual(env.cancelledFrames, [pendingFrame]);
  assert.equal(env.frames.size, 0);
  assert.equal(env.styleValues.has("--mx"), false);
  assert.equal(env.styleValues.has("--my"), false);
  env.moveCard();
  assert.equal(env.frames.size, 0);
  env.document.dispatch("click", { target: { closest: () => null } });
  assert.equal(env.applicationClicks, 1);

  env.media.change(false);
  assert.equal(env.document.count("mousemove"), 1);
  env.media.change(false);
  assert.equal(env.document.count("mousemove"), 1);
});

test("la hoja de movimiento contiene el modo CSS reduced y conserva el contenido de transiciones esenciales", () => {
  const css = fs.readFileSync(path.join(__dirname, "../css/motion.css"), "utf8");
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /\.card::after\s*\{\s*display:\s*none!important/);
  assert.match(css, /\.btn:active\s*\{\s*transform:\s*none!important/);
});
