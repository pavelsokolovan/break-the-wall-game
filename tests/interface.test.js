import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { Game } from "../src/game.js";

// Exercise the real interface module. Canvas and audio require actual browser QA;
// only those native surfaces are replaced here, not game or interface behavior.
test("interface starts, moves, launches, pauses, ends, saves and reloads results", async () => {
  const window = new Window({
    url: "https://example.test/break-the-wall-game/",
  });
  const doc = window.document;
  doc.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const context = new Proxy(
    {},
    { get: (o, k) => o[k] || (() => {}), set: (o, k, v) => ((o[k] = v), true) },
  );
  window.HTMLCanvasElement.prototype.getContext = () => context;
  window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  window.HTMLCanvasElement.prototype.hasPointerCapture = () => false;
  let frame;
  Object.assign(globalThis, {
    window,
    document: doc,
    localStorage: window.localStorage,
    matchMedia: () => ({ matches: false }),
    HTMLButtonElement: window.HTMLButtonElement,
    requestAnimationFrame: (f) => {
      frame = f;
      return 1;
    },
  });
  localStorage.setItem(
    "brickfall-blitz:v1",
    JSON.stringify({
      best: 5000,
      runs: [{ score: 1250, level: 2, win: false }],
      sound: false,
      motion: false,
    }),
  );
  await import("../src/main.js");
  const get = (id) => doc.getElementById(id);
  frame(performance.now() + 17);
  assert.equal(get("best").textContent, "005000");
  assert(get("records").textContent.includes("001250"));
  assert.equal(get("sound").textContent, "♪ SOUND OFF");
  get("primary").click();
  assert.equal(get("overlay").hidden, true);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: " " }));
  let now = performance.now();
  for (let i = 0; i < 100; i++) {
    now += 16.667;
    frame(now);
  }
  // Verify tap actions are distinct from touch dragging and off-paddle taps.
  let actions = 0,
    fires = 0;
  const action = Game.prototype.action,
    fire = Game.prototype.fire;
  Game.prototype.action = function () {
    actions++;
    return action.call(this);
  };
  Game.prototype.fire = function () {
    fires++;
    return fire.call(this);
  };
  get("game").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 640,
  });
  const touch = (type, x, y) =>
    get("game").dispatchEvent(
      new window.PointerEvent(type, {
        pointerId: 1,
        pointerType: "touch",
        clientX: x,
        clientY: y,
      }),
    );
  touch("pointerdown", 400, 586);
  touch("pointerup", 400, 586);
  assert.equal(actions, 1);
  touch("pointerdown", 400, 586);
  touch("pointermove", 500, 586);
  touch("pointerup", 500, 586);
  assert.equal(actions, 1);
  touch("pointerdown", 400, 300);
  touch("pointerup", 400, 300);
  assert.equal(actions, 1);
  const beforeFire = fires;
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f" }));
  assert.equal(fires, beforeFire + 1);
  Game.prototype.action = action;
  Game.prototype.fire = fire;
  get("legend-button").focus();
  get("legend-button").click();
  assert.equal(get("info-panel").hidden, false);
  assert.equal(get("scores-content").hidden, true);
  assert.equal(get("legend-content").hidden, false);
  assert.equal(doc.querySelector(".shell").inert, true);
  assert.equal(doc.activeElement, get("close-info"));
  const modalScore = get("score").textContent;
  for (let i = 0; i < 100; i++) {
    now += 16.667;
    frame(now);
  }
  assert.equal(get("score").textContent, modalScore);
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab" }));
  assert.equal(doc.activeElement, get("close-info"));
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(get("info-panel").hidden, true);
  assert.equal(get("overlay").hidden, true);
  assert.equal(doc.querySelector(".shell").inert, false);
  assert.equal(doc.activeElement, get("legend-button"));
  get("scores-button").click();
  assert.equal(get("scores-content").hidden, false);
  assert.equal(get("legend-content").hidden, true);
  get("close-info").click();
  get("pause").click();
  assert.equal(get("overlay-title").textContent, "ON A BREAK.");
  const score = get("score").textContent;
  for (let i = 0; i < 100; i++) {
    now += 16.667;
    frame(now);
  }
  assert.equal(get("score").textContent, score);
  get("primary").click();
  assert.equal(get("overlay").hidden, true);
  window.dispatchEvent(new window.Event("blur"));
  assert.equal(get("overlay-title").textContent, "ON A BREAK.");
  window.confirm = () => true;
  get("secondary").click();
  const stored = JSON.parse(localStorage.getItem("brickfall-blitz:v1"));
  assert.equal(stored.runs.length, 2);
  assert.equal(stored.runs[0].win, false);
  assert.equal(stored.best, 5000);
  get("sound").click();
  assert.equal(
    JSON.parse(localStorage.getItem("brickfall-blitz:v1")).sound,
    true,
  );
  assert.equal(get("motion"), null);
  assert.equal(doc.querySelector(".intro"), null);
  assert.equal(doc.querySelector(".game-name").textContent, "Brickfall Blitz");
  // Reinitializing the real module represents a new page using the same storage.
  await import("../src/main.js?reload");
  assert(
    get("records").textContent.includes(
      String(stored.runs[0].score).padStart(6, "0"),
    ),
  );
  assert.equal(get("sound").textContent, "♪ SOUND ON");
  await window.happyDOM.abort();
});
