import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as turn } from "node:timers/promises";
import { Window } from "happy-dom";
import { OnlineClient, multiplayerUrl } from "../src/online-client.js";
import { mountMultiplayer } from "../src/multiplayer-ui.js";
import { drawDuel } from "../src/duel-view.js";
import { DuelGame } from "../shared/duel-game.js";

class Socket {
  constructor() {
    this.readyState = 0;
    this.handlers = new Map();
    this.sent = [];
  }
  addEventListener(type, handler) {
    const list = this.handlers.get(type) || [];
    list.push(handler);
    this.handlers.set(type, list);
  }
  emit(type, event = {}) {
    for (const handler of this.handlers.get(type) || []) handler(event);
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  receive(message) {
    this.emit("message", { data: JSON.stringify({ v: 1, ...message }) });
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}
const welcome = (slot) => ({
  type: "welcome",
  requestId: "r1",
  code: "ABC234",
  playerId: "p",
  slot,
  token: "opaque",
  matchId: null,
  nextInputSeq: 1,
});
const room = (ready = false) => ({
  type: "room",
  code: "ABC234",
  phase: "lobby",
  players: [0, 1].map((slot) => ({ slot, connected: true, ready })),
});
function snapshot(phase = "playing") {
  const g = new DuelGame({ seed: 1, matchId: "m" });
  g.start();
  for (let i = 0; i < 180; i++) g.step();
  return {
    type: "snapshot",
    matchId: "m",
    tick: 180,
    serverTime: 3000,
    phase,
    state: g.getState(),
  };
}
function fixture(
  t,
  {
    url = "ws://localhost:3001/ws",
    href = "http://localhost:5173/",
    wakeFactory = () => ({ wake: () => undefined, cancel: () => {} }),
  } = {},
) {
  const window = new Window({ url: href }),
    doc = window.document;
  doc.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
      /<script[\s\S]*?<\/script>/g,
      "",
    ),
  );
  const strokes = [];
  const draws = [],
    sockets = [],
    modes = [],
    sounds = [];
  const context = new Proxy(
    {
      fillRect: (...args) => draws.push(args),
      strokeRect: (...args) => strokes.push(args),
    },
    { get: (o, k) => o[k] || (() => {}), set: (o, k, v) => ((o[k] = v), true) },
  );
  window.HTMLCanvasElement.prototype.getContext = () => context;
  window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  window.HTMLCanvasElement.prototype.hasPointerCapture = () => false;
  let callback,
    clock = 0;
  window.requestAnimationFrame = (cb) => {
    callback = cb;
    return 1;
  };
  window.cancelAnimationFrame = () => {
    callback = null;
  };
  const ui = mountMultiplayer({
    document: doc,
    window,
    url,
    now: () => clock,
    onModeChange: (mode) => modes.push(mode),
    onSound: (sound) => sounds.push(sound),
    wakeFactory,
    clientFactory: (options) =>
      new OnlineClient({
        ...options,
        socketFactory: () => {
          const socket = new Socket();
          sockets.push(socket);
          return socket;
        },
      }),
  });
  t.after(() => {
    ui.client.disconnect();
    window.happyDOM.abort();
  });
  const $ = (id) => doc.getElementById(id);
  $("duel-game").getBoundingClientRect = () => ({
    x: 0,
    left: 0,
    top: 0,
    width: 800,
    height: 1000,
  });
  async function join(slot = 0) {
    ui.switchMode(true);
    $("duel-create").click();
    await turn();
    const socket = sockets.at(-1);
    socket.open();
    await turn();
    socket.receive(welcome(slot));
    socket.receive(room());
    await turn();
    return socket;
  }
  function frame(ms = 34) {
    clock += ms;
    callback?.(clock);
  }
  return {
    window,
    doc,
    $,
    ui,
    draws,
    strokes,
    sockets,
    modes,
    sounds,
    join,
    frame,
    setClock: (value) => {
      clock = value;
    },
  };
}

test("production never defaults to localhost and only accepts secure configured URLs", () => {
  const location = { protocol: "http:", hostname: "192.168.1.2" };
  assert.equal(multiplayerUrl({}, location), null);
  assert.equal(
    multiplayerUrl({ DEV: true }, location),
    "ws://192.168.1.2:3001/ws",
  );
  assert.equal(
    multiplayerUrl({ VITE_MULTIPLAYER_URL: "wss://duel.example/ws" }, location),
    "wss://duel.example/ws",
  );
  for (const value of [
    "ws://localhost:3001/ws",
    "https://duel.example/ws",
    "wss://duel.example/wrong",
    "wss://user:pass@duel.example/ws",
  ])
    assert.equal(
      multiplayerUrl({ VITE_MULTIPLAYER_URL: value }, location),
      null,
    );
});
test("unavailable backend leaves Solo selectable and mode switching does not touch saves", (t) => {
  const f = fixture(t, { url: null });
  f.window.localStorage.setItem("brickfall-blitz:v1", "keep");
  f.$("online-mode").click();
  assert(f.$("solo-panel").hidden);
  assert(!f.$("duel-panel").hidden);
  assert(f.$("duel-create").disabled);
  assert.match(f.$("duel-status").textContent, /unavailable/);
  f.$("solo-mode").click();
  assert(!f.$("solo-panel").hidden);
  assert(f.$("duel-panel").hidden);
  assert.deepEqual(f.modes, [true, false]);
  assert.equal(f.window.localStorage.getItem("brickfall-blitz:v1"), "keep");
});
test("create/join disable duplicate submissions, normalize codes and recover from room errors", async (t) => {
  const f = fixture(t);
  f.ui.switchMode(true);
  f.$("duel-code").value = "bad";
  f.$("duel-connect").dispatchEvent(
    new f.window.Event("submit", { cancelable: true }),
  );
  assert.match(f.$("duel-status").textContent, /six-character/);
  assert.equal(f.sockets.length, 0);
  f.$("duel-code").value = "abc234";
  f.$("duel-connect").dispatchEvent(
    new f.window.Event("submit", { cancelable: true }),
  );
  assert(f.$("duel-create").disabled);
  assert(f.$("duel-join").disabled);
  f.$("duel-create").click();
  await turn();
  assert.equal(f.sockets.length, 1);
  await turn();
  const socket = f.sockets[0];
  socket.open();
  await turn();
  assert.deepEqual(socket.sent[0], {
    v: 1,
    type: "join",
    requestId: "r1",
    code: "ABC234",
  });
  socket.receive({
    type: "error",
    code: "ROOM_NOT_FOUND",
    requestId: "r1",
    message: "Room not found.",
  });
  await turn();
  assert.match(f.$("duel-status").textContent, /not found/);
  assert(!f.$("duel-create").disabled);
  f.$("duel-create").click();
  await turn();
  socket.receive({ ...welcome(0), requestId: "r2" });
  socket.receive(room());
  await turn();
  assert.equal(f.$("duel-room-code").textContent, "ABC234");
  assert(!f.$("duel-ready").disabled);
  f.$("duel-ready").click();
  assert.deepEqual(socket.sent.at(-1), { v: 1, type: "ready", ready: true });
});
test("slot-one view shows own paddle below; countdown and results use authoritative state", async (t) => {
  const f = fixture(t),
    socket = await f.join(1),
    s = snapshot("countdown");
  s.state.countdownRemainingMs = 2000;
  s.state.players[0].x = 100;
  s.state.players[1].x = 700;
  socket.receive(s);
  f.frame();
  assert(!f.$("duel-game").hidden);
  assert(f.$("duel-action").disabled);
  assert(
    f.draws.some(
      (args) => args[0] === 20 && args[1] === 918 && args[2] === 160,
    ),
  ); // own canonical 700 becomes view 100
  assert(
    f.draws.some(
      (args) => args[0] === 620 && args[1] === 64 && args[2] === 160,
    ),
  );
  socket.receive({
    type: "result",
    matchId: "m",
    winner: 1,
    reason: "five_goals",
    goals: [3, 5],
    points: [0, 0],
    durationMs: 1000,
    waveCount: 1,
  });
  assert.match(f.$("duel-status").textContent, /YOU WIN.*5–3/);
  socket.close();
  assert.match(f.$("duel-status").textContent, /YOU WIN/);
});
test("touch tap actions differ from drags, cancelled touches and off-paddle taps; keyboard inputs are sequenced", async (t) => {
  const f = fixture(t),
    socket = await f.join();
  const actionable = snapshot();
  actionable.state.players[0].ammo = 5;
  socket.receive(actionable);
  const canvas = f.$("duel-game");
  const touch = (type, x, y) =>
    canvas.dispatchEvent(
      new f.window.PointerEvent(type, {
        pointerId: 1,
        isPrimary: true,
        pointerType: "touch",
        clientX: x,
        clientY: y,
      }),
    );
  touch("pointerdown", 400, 918);
  touch("pointerup", 400, 918);
  f.frame();
  assert.equal(socket.sent.at(-1).action, "release_fire");
  assert.equal(socket.sent.at(-1).seq, 1);
  touch("pointerdown", 400, 918);
  touch("pointermove", 500, 918);
  touch("pointerup", 500, 918);
  f.frame();
  assert.equal(socket.sent.at(-1).action, "none");
  touch("pointerdown", 400, 300);
  touch("pointerup", 400, 300);
  f.frame();
  assert.equal(socket.sent.at(-1).action, "none");
  touch("pointerdown", 400, 918);
  touch("pointercancel", 400, 918);
  touch("pointerup", 400, 918);
  f.frame();
  assert.equal(socket.sent.at(-1).action, "none");
  f.window.dispatchEvent(new f.window.KeyboardEvent("keydown", { key: "f" }));
  f.frame();
  assert.equal(socket.sent.at(-1).action, "fire");
  f.window.dispatchEvent(
    new f.window.KeyboardEvent("keydown", { key: "ArrowRight" }),
  );
  f.frame();
  const keyboard = socket.sent.at(-1);
  assert(keyboard.x > 0.5);
  assert.equal(keyboard.action, "none");
  f.window.dispatchEvent(new f.window.Event("blur"));
  const count = socket.sent.length;
  f.frame();
  assert.equal(socket.sent.length, count);
  socket.receive({ ...actionable, tick: 200 });
  f.$("duel-action").click();
  f.frame();
  assert.equal(socket.sent.at(-1).action, "release_fire");
  assert(
    socket.sent
      .filter((m) => m.type === "input")
      .every((m, i) => m.seq === i + 1),
  );
});
test("stale snapshots freeze inputs and event IDs deduplicate audio", async (t) => {
  const f = fixture(t),
    socket = await f.join();
  const actionable = snapshot();
  actionable.state.players[0].ammo = 5;
  socket.receive(actionable);
  const events = {
    type: "events",
    matchId: "m",
    items: [{ id: 1, tick: 180, type: "paddle_hit", slot: 0, ballId: 1 }],
  };
  socket.receive(events);
  socket.receive(events);
  assert.deepEqual(f.sounds, ["paddle"]);
  f.frame(300);
  assert.match(f.$("duel-status").textContent, /Waiting for server/);
  f.$("duel-action").click();
  f.frame();
  assert(!socket.sent.some((m) => m.type === "input"));
  socket.receive({ ...actionable, tick: 183 });
  f.$("duel-action").click();
  f.frame();
  assert(socket.sent.some((m) => m.type === "input"));
  f.window.confirm = () => false;
  f.$("solo-mode").click();
  assert(f.$("solo-panel").hidden);
  f.window.confirm = () => true;
  f.$("solo-mode").click();
  assert(!f.$("solo-panel").hidden);
  assert(socket.sent.some((m) => m.type === "leave"));
});
test("client cancellation rejects pending operations and ignores delayed old connections", async () => {
  const sockets = [],
    received = [];
  const client = new OnlineClient({
    socketFactory: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
    onMessage: (m) => received.push(m),
    timeoutMs: 20,
  });
  const first = client.connect("ws://local/ws");
  const rejection = assert.rejects(first, /cancel/);
  client.disconnect("cancel");
  await rejection;
  sockets[0].open();
  sockets[0].receive(welcome(0));
  assert.equal(received.length, 0);
  await assert.rejects(client.connect("ws://local/ws"), /timed out/);
  client.disconnect();
});
test("client enforces 30 Hz input and request timeout; malformed server data fails visibly", async () => {
  let clock = 0,
    socket;
  const statuses = [];
  const client = new OnlineClient({
    now: () => clock,
    socketFactory: () => (socket = new Socket()),
    onStatus: (s) => statuses.push(s),
    timeoutMs: 20,
  });
  const connected = client.connect("ws://local/ws");
  socket.open();
  await connected;
  assert(client.input(0.5));
  assert(!client.input(0.6));
  clock = 34;
  assert(client.input(0.6, "fire"));
  assert.deepEqual(
    socket.sent.filter((m) => m.type === "input").map((m) => m.seq),
    [1, 2],
  );
  const pending = client.request("create");
  await assert.rejects(pending, /timed out/);
  const reconnected = client.connect("ws://local/ws");
  socket.open();
  await reconnected;
  socket.emit("message", { data: "{" });
  assert.match(statuses.at(-1), /Invalid server/);
  assert.equal(client.socket, null);
  client.disconnect();
});

test("wall snapshots render mirrored bricks and update wave/points with deduplicated content audio", async (t) => {
  const f = fixture(t),
    socket = await f.join(1),
    s = snapshot();
  const brick = s.state.bricks[0];
  brick.type = "steel";
  brick.hp = null;
  brick.maxHp = null;
  s.state.players[1].points = 250;
  socket.receive(s);
  f.frame();
  assert.match(f.$("duel-points").textContent, /250 POINTS.*WAVE 1/);
  assert(
    f.draws.some(
      (args) =>
        args[0] === 800 - brick.x - brick.w &&
        args[1] === 1000 - brick.y - brick.h,
    ),
  );
  const events = {
    type: "events",
    matchId: "m",
    items: [
      {
        id: 1,
        tick: 180,
        type: "brick_hit",
        brickId: brick.id,
        owner: 0,
        hp: null,
      },
      {
        id: 2,
        tick: 180,
        type: "brick_destroyed",
        brickId: brick.id + 1,
        owner: 1,
        points: 150,
        x: 400,
        y: 500,
        brickType: "explosive",
      },
      {
        id: 3,
        tick: 180,
        type: "explosion",
        brickId: brick.id + 1,
        owner: 1,
        x: 400,
        y: 500,
      },
      { id: 4, tick: 180, type: "wave_cleared", wave: 1 },
      { id: 5, tick: 180, type: "wave_started", wave: 2 },
    ],
  };
  socket.receive(events);
  socket.receive(events);
  assert.deepEqual(f.sounds, ["hit", "brick", "explosion", "clear"]);
});

test("drops and armor render in both views with deduplicated pickup/block/damage sounds", async (t) => {
  const f = fixture(t),
    socket = await f.join(1),
    s = snapshot();
  s.state.drops = [
    {
      id: 1001,
      type: "repair",
      owner: 1,
      x: 200,
      y: 300,
      baseX: 200,
      motionPhase: 0,
    },
    {
      id: 1002,
      type: "rocket",
      owner: 0,
      x: 500,
      y: 700,
      baseX: 500,
      motionPhase: 0,
    },
  ];
  Object.assign(s.state.players[1], {
    shieldCharges: 1,
    shieldRemainingMs: 15000,
    vestCharges: 2,
    wideRemainingMs: 12000,
    slowRemainingMs: 10000,
    width: 240,
  });
  socket.receive(s);
  f.frame();
  assert(f.draws.some((args) => args[0] === 588 && args[1] === 688)); // Repair center (600,700), frame x-12,y-12
  assert(
    f.strokes.some(
      (args) => args[0] === 276 && args[1] === 914 && args[2] === 248,
    ),
  );
  const events = {
    type: "events",
    matchId: "m",
    items: [
      {
        id: 1,
        tick: 180,
        type: "drop_spawned",
        dropId: 1001,
        owner: 1,
        dropType: "repair",
        x: 200,
        y: 300,
      },
      {
        id: 2,
        tick: 180,
        type: "pickup",
        dropId: 1001,
        owner: 1,
        dropType: "repair",
        points: 1000,
      },
      {
        id: 3,
        tick: 180,
        type: "hazard_blocked",
        dropId: 1002,
        owner: 1,
        defense: "shield",
      },
      {
        id: 4,
        tick: 180,
        type: "hazard_damage",
        dropId: 1003,
        owner: 1,
        damage: 1,
      },
    ],
  };
  socket.receive(events);
  socket.receive(events);
  assert.deepEqual(f.sounds, ["pickup", "shield", "damage"]);
});

test("weapon action labels follow authoritative held/ammo/cooldown state and release wins queued actions", async (t) => {
  const f = fixture(t),
    socket = await f.join(),
    s = snapshot();
  const b = s.state.balls[0];
  Object.assign(b, {
    owner: 0,
    held: true,
    heldOffsetX: 0,
    autoReleaseRemainingMs: 3000,
    vx: 0,
    vy: 0,
    x: 400,
    y: 907,
  });
  s.state.players[0].ammo = 2;
  socket.receive(s);
  assert.equal(f.$("duel-action").textContent, "RELEASE / FIRE (2)");
  assert(!f.$("duel-action").disabled);
  f.window.dispatchEvent(new f.window.KeyboardEvent("keydown", { key: "f" }));
  f.frame();
  assert.equal(socket.sent.at(-1).action, "fire");
  // No optimistic release/ammo consumption: only the next snapshot changes UI state.
  assert.equal(f.$("duel-action").textContent, "RELEASE / FIRE (2)");
  f.window.dispatchEvent(new f.window.KeyboardEvent("keydown", { key: " " }));
  f.window.dispatchEvent(new f.window.KeyboardEvent("keydown", { key: "f" }));
  f.frame();
  assert.equal(socket.sent.at(-1).action, "release_fire");
  const next = structuredClone(s);
  next.tick++;
  next.state.balls[0].held = false;
  next.state.players[0].ammo = 1;
  next.state.players[0].fireCooldownMs = 250;
  socket.receive(next);
  assert.equal(f.$("duel-action").textContent, "FIRE (1)");
  assert(f.$("duel-action").disabled);
  next.tick++;
  next.state.players[0].fireCooldownMs = 0;
  socket.receive(next);
  assert(!f.$("duel-action").disabled);
  next.tick++;
  next.state.players[0].ammo = 0;
  socket.receive(next);
  assert.equal(f.$("duel-action").textContent, "AUTO SERVE");
  assert(f.$("duel-action").disabled);
  next.tick++;
  next.state.balls[0].held = true;
  next.state.players[0].fireCooldownMs = 250;
  socket.receive(next);
  assert.equal(f.$("duel-action").textContent, "RELEASE");
  assert(!f.$("duel-action").disabled);
});

test("shots, cannons and held balls mirror for slot one and weapon effects deduplicate", async (t) => {
  const f = fixture(t),
    socket = await f.join(1),
    s = snapshot();
  s.state.players.forEach((p) => {
    p.ammo = 5;
    p.stickyCharges = 2;
  });
  Object.assign(s.state.balls[0], {
    owner: 1,
    held: true,
    heldOffsetX: 0,
    autoReleaseRemainingMs: 3000,
    x: 400,
    y: 93,
    vx: 0,
    vy: 0,
  });
  s.state.shots = [
    { id: 1001, owner: 0, x: 200, y: 700 },
    { id: 1002, owner: 1, x: 600, y: 300 },
  ];
  socket.receive(s);
  f.frame();
  assert(
    f.draws.some(
      (a) => a[0] === 596 && a[1] === 293 && a[2] === 8 && a[3] === 17,
    ),
  );
  assert(
    f.draws.some(
      (a) => a[0] === 196 && a[1] === 690 && a[2] === 8 && a[3] === 17,
    ),
  );
  assert(f.draws.some((a) => a[0] === 389 && a[1] === 99 && a[2] === 22));
  assert(f.draws.some((a) => a[0] === 389 && a[1] === 894 && a[2] === 22));
  const events = {
    type: "events",
    matchId: "m",
    items: [
      {
        id: 1,
        tick: 180,
        type: "ball_held",
        ballId: s.state.balls[0].id,
        owner: 1,
      },
      {
        id: 2,
        tick: 180,
        type: "ball_released",
        ballId: s.state.balls[0].id,
        owner: 1,
        automatic: false,
      },
      {
        id: 3,
        tick: 180,
        type: "shot_fired",
        shotId: 1001,
        owner: 0,
        x: 200,
        y: 700,
      },
      {
        id: 4,
        tick: 180,
        type: "hazard_intercepted",
        shotId: 1001,
        dropId: 1003,
        owner: 0,
        points: 100,
        x: 200,
        y: 700,
      },
    ],
  };
  socket.receive(events);
  socket.receive(events);
  assert.deepEqual(f.sounds, ["pickup", "launch", "fire", "explosion"]);
});

test("reconnect freezes actions, preserves Solo saves, and confirmed Solo escape cancels retries", async (t) => {
  const f = fixture(t),
    socket = await f.join(),
    s = snapshot();
  s.state.players[0].ammo = 5;
  socket.receive(s);
  f.frame();
  f.window.localStorage.setItem("brickfall-blitz:v1", "solo-unchanged");
  socket.close();
  assert(f.ui.client.recovering);
  assert.match(f.$("duel-status").textContent, /Reconnecting/);
  assert(f.$("duel-action").disabled);
  const count = socket.sent.length;
  f.$("duel-action").click();
  f.frame();
  assert.equal(socket.sent.length, count);
  f.window.confirm = () => false;
  f.$("solo-mode").click();
  assert(!f.$("duel-panel").hidden);
  f.window.confirm = () => true;
  f.$("solo-mode").click();
  assert(!f.$("solo-panel").hidden);
  assert(!f.ui.client.recovering);
  assert.equal(
    f.window.localStorage.getItem("brickfall-blitz:v1"),
    "solo-unchanged",
  );
  assert.equal(
    f.window.sessionStorage.getItem("brickfall-blitz:duel:session:v1"),
    null,
  );
});

test("recovery countdown shows the frozen deadline, disables actions and deduplicates effects after resync", async (t) => {
  const f = fixture(t),
    socket = await f.join(),
    s = snapshot();
  s.state.players[0].ammo = 5;
  socket.receive(s);
  const events = {
    type: "events",
    matchId: "m",
    items: [
      {
        id: 1,
        tick: 180,
        type: "paddle_hit",
        slot: 0,
        ballId: s.state.balls[0].id,
      },
    ],
  };
  socket.receive(events);
  socket.receive({ ...welcome(0), resumed: true });
  const countdown = structuredClone(s);
  countdown.phase = "countdown";
  countdown.state.pause = {
    reason: "reconnect",
    deadlineServerTime: 6000,
    resumePhase: "playing",
  };
  countdown.state.countdownRemainingMs = 3000;
  socket.receive(countdown);
  f.frame();
  assert.match(f.$("duel-status").textContent, /resuming in 3/);
  assert(f.$("duel-action").disabled);
  const count = socket.sent.length;
  f.window.dispatchEvent(new f.window.KeyboardEvent("keydown", { key: " " }));
  f.frame();
  assert.equal(socket.sent.length, count);
  socket.receive(events);
  assert.deepEqual(f.sounds, ["paddle"]);
});

test("duel panels share pause budget, block inputs and close with only local consent", async (t) => {
  const f = fixture(t),
    socket = await f.join();
  socket.receive(snapshot());
  f.$("duel-legend").click();
  assert(!f.$("duel-info").hidden);
  assert.equal(socket.sent.at(-1).reason, "panel");
  const count = socket.sent.filter((m) => m.type === "input").length;
  f.$("duel-action").click();
  f.frame();
  assert.equal(socket.sent.filter((m) => m.type === "input").length, count);
  const s = snapshot("paused");
  s.state.pause = {
    reason: "panel",
    deadlineServerTime: 33000,
    resumePhase: "playing",
    consents: [false, false],
  };
  socket.receive(s);
  f.$("duel-info-close").click();
  assert.equal(socket.sent.at(-1).type, "resume_play");
  assert.equal(f.$("duel-pause").textContent, "RESUME");
  assert.match(f.$("duel-status").textContent, /Paused/);
  f.$("duel-pause").click();
  assert.equal(socket.sent.at(-1).type, "resume_play");
});
test("background requests shared pause and foreground supplies consent without movement", async (t) => {
  const f = fixture(t),
    socket = await f.join();
  socket.receive(snapshot());
  Object.defineProperty(f.doc, "hidden", { value: true, configurable: true });
  f.doc.dispatchEvent(new f.window.Event("visibilitychange"));
  assert.equal(socket.sent.at(-1).reason, "background");
  f.frame();
  assert.equal(socket.sent.at(-1).type, "pause");
  const s = snapshot("paused");
  s.state.pause = {
    reason: "background",
    deadlineServerTime: 33000,
    resumePhase: "playing",
    consents: [false, false],
  };
  socket.receive(s);
  Object.defineProperty(f.doc, "hidden", { value: false, configurable: true });
  f.doc.dispatchEvent(new f.window.Event("visibilitychange"));
  assert.equal(socket.sent.at(-1).type, "resume_play");
});
test("result saves once before rematch swaps view and resets sequence; Solo saves survive", async (t) => {
  const f = fixture(t),
    socket = await f.join();
  socket.receive(snapshot());
  f.window.localStorage.setItem("brickfall-blitz:v1", "keep");
  const r = {
    type: "result",
    matchId: "m",
    winner: 0,
    reason: "forfeit",
    goals: [1, 0],
    points: [20, 10],
    durationMs: 1000,
    waveCount: 1,
  };
  socket.receive(r);
  socket.receive(r);
  assert.equal(f.ui.history.read().length, 1);
  f.$("duel-rematch").click();
  assert.deepEqual(socket.sent.at(-1), { v: 1, type: "rematch", ready: true });
  f.ui.client.nextSeq = 90;
  socket.receive({
    ...welcome(1),
    requestId: "rematch:new",
    matchId: "new",
    token: "rotated",
    rematch: true,
  });
  const s = snapshot("countdown");
  s.matchId = "new";
  s.tick = 0;
  socket.receive(s);
  assert.equal(f.ui.client.nextSeq, 1);
  assert.equal(f.ui.client.slot, 1);
  assert(f.$("duel-rematch").hidden);
  assert.match(f.$("duel-status").textContent, /Get ready/);
  f.$("duel-history").click();
  assert.match(f.$("duel-info-body").textContent, /WIN.*1–0/);
  assert.equal(f.window.localStorage.getItem("brickfall-blitz:v1"), "keep");
});
test("connected voluntary leave waits for authoritative forfeit history before clearing identity", async (t) => {
  const f = fixture(t),
    socket = await f.join();
  socket.receive(snapshot());
  const leaving = f.ui.leave();
  assert.equal(socket.sent.at(-1).type, "leave");
  socket.receive({
    type: "result",
    matchId: "m",
    winner: 1,
    reason: "forfeit",
    goals: [0, 0],
    points: [0, 0],
    durationMs: 1000,
    waveCount: 1,
  });
  await leaving;
  assert.equal(f.ui.client.session, null);
  assert.equal(f.ui.history.read()[0].outcome, "loss");
  assert(f.$("duel-game").hidden);
});

test("invitation stays in Solo until explicit entry/join; sharing has a selectable fallback", async (t) => {
  const f = fixture(t, { href: "http://localhost:5173/?duel=abc234" });
  assert.equal(f.sockets.length, 0);
  assert(!f.$("solo-panel").hidden);
  assert.equal(f.$("duel-code").value, "ABC234");
  f.$("online-mode").click();
  assert.equal(f.sockets.length, 0);
  assert.match(f.$("duel-status").textContent, /Invitation/);
  f.$("duel-connect").requestSubmit();
  await turn();
  const socket = f.sockets[0];
  socket.open();
  await turn();
  assert.equal(socket.sent[0].type, "join");
  socket.receive(welcome(0));
  socket.receive(room());
  await turn();
  Object.defineProperty(f.window.navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
  Object.defineProperty(f.window.navigator, "share", {
    value: undefined,
    configurable: true,
  });
  f.$("duel-share").click();
  await turn();
  assert(!f.$("duel-invite-fallback").hidden);
  const link = f.$("duel-invite-link").value;
  assert.equal(new URL(link).searchParams.get("duel"), "ABC234");
  assert(!link.includes("opaque"));
});

test("cold wake blocks duplicate create, cancellation restores Solo and ignores a late health response", async (t) => {
  const calls = [];
  let resolve,
    cancelCount = 0;
  const f = fixture(t, {
    wakeFactory: (options) => ({
      wake: () => {
        calls.push("health");
        options.onStatus("Waking server… 90s remaining");
        return new Promise((r) => (resolve = r));
      },
      cancel: () => cancelCount++,
    }),
  });
  assert.equal(calls.length, 0);
  f.ui.switchMode(true);
  assert.equal(calls.length, 0);
  f.$("duel-create").click();
  f.$("duel-create").click();
  assert.equal(calls.length, 1);
  assert.equal(f.sockets.length, 0);
  assert.match(f.$("duel-status").textContent, /Waking server/);
  assert(!f.$("duel-cancel").hidden);
  f.$("solo-mode").click();
  assert(!f.$("solo-panel").hidden);
  assert(cancelCount > 0);
  resolve();
  await turn();
  assert.equal(f.sockets.length, 0);
});
test("wake errors expose retry, cancel aborts the pending attempt and successful retry sends create once", async (t) => {
  let attempt = 0,
    finish;
  const f = fixture(t, {
    wakeFactory: () => ({
      wake: () => {
        attempt++;
        if (attempt === 1)
          return Promise.reject(Error("Server did not wake. Retry."));
        return new Promise((r) => (finish = r));
      },
      cancel: () => {},
    }),
  });
  f.ui.switchMode(true);
  f.$("duel-create").click();
  await turn();
  assert(!f.$("duel-retry").hidden);
  assert(!f.$("duel-create").disabled);
  assert.equal(f.sockets.length, 0);
  f.$("duel-retry").click();
  f.$("duel-cancel").click();
  finish();
  await turn();
  assert.equal(f.sockets.length, 0);
  f.$("duel-retry").click();
  finish();
  await turn();
  assert.equal(f.sockets.length, 1);
  const socket = f.sockets[0];
  socket.open();
  await turn();
  assert.equal(socket.sent.filter((m) => m.type === "create").length, 1);
  socket.receive(welcome(0));
  socket.receive(room());
  await turn();
  assert(f.$("duel-cancel").hidden);
  assert(f.$("duel-retry").hidden);
});

test("Duel drag strip moves immediately without firing and action control is above the field", async (t) => {
  const f = fixture(t),
    socket = await f.join();
  const s = snapshot();
  s.state.players[0].ammo = 5;
  socket.receive(s);
  const area = f.$("duel-drag-area");
  assert(!area.hidden);
  area.setPointerCapture = () => {};
  area.hasPointerCapture = () => false;
  area.dispatchEvent(
    new f.window.PointerEvent("pointerdown", {
      pointerId: 5,
      isPrimary: true,
      clientX: 650,
      clientY: 1050,
      pointerType: "touch",
    }),
  );
  assert.equal(socket.sent.at(-1).type, "input");
  assert.equal(socket.sent.at(-1).x, 650 / 800);
  assert.equal(socket.sent.at(-1).action, "none");
  assert(
    f.$("duel-action").compareDocumentPosition(f.$("duel-game")) &
      f.window.Node.DOCUMENT_POSITION_FOLLOWING,
  );
  area.dispatchEvent(
    new f.window.PointerEvent("pointercancel", { pointerId: 5 }),
  );
  const count = socket.sent.length;
  area.dispatchEvent(
    new f.window.PointerEvent("pointermove", {
      pointerId: 5,
      clientX: 100,
      clientY: 1050,
    }),
  );
  assert.equal(socket.sent.length, count);
});

test("practice is explicit, uses a real server request, labels bot and excludes competitive history", async (t) => {
  const f = fixture(t);
  f.ui.switchMode(true);
  f.$("duel-practice").click();
  await turn();
  const socket = f.sockets[0];
  socket.open();
  await turn();
  assert.equal(socket.sent[0].type, "practice");
  socket.receive(welcome(0));
  socket.receive({ ...room(), practice: true });
  socket.receive(snapshot());
  assert.match(f.$("duel-status").textContent, /Practice vs bot/);
  assert(f.$("duel-share").hidden);
  socket.receive({
    type: "result",
    matchId: "m",
    winner: 0,
    reason: "forfeit",
    goals: [2, 0],
    points: [0, 0],
    durationMs: 1000,
    waveCount: 1,
  });
  assert.equal(f.ui.history.read().length, 0);
});

test("loading indicator covers room requests and clears after server response or cancellation", async (t) => {
  const f = fixture(t);
  f.ui.switchMode(true);
  assert(f.$("duel-loading").hidden);
  f.$("duel-create").click();
  assert(!f.$("duel-loading").hidden);
  assert.equal(f.$("duel-panel").getAttribute("aria-busy"), "true");
  await turn();
  const socket = f.sockets[0];
  socket.open();
  await turn();
  assert.match(f.$("duel-loading-text").textContent, /Creating room/);
  socket.receive(welcome(0));
  socket.receive(room());
  await turn();
  assert(f.$("duel-loading").hidden);
  f.$("duel-ready").click();
  assert(!f.$("duel-loading").hidden);
  assert(f.$("duel-ready").disabled);
  socket.receive(room(true));
  assert(f.$("duel-loading").hidden);
  socket.receive(snapshot());
  f.$("duel-pause").click();
  assert(!f.$("duel-loading").hidden);
  socket.receive({
    type: "error",
    code: "INVALID_PHASE",
    message: "Pause unavailable.",
  });
  assert(f.$("duel-loading").hidden);
});

test("centered result announces win/loss/draw and offers working rematch and leave actions", async (t) => {
  for (const winner of [0, 1, null]) {
    const f = fixture(t),
      socket = await f.join();
    socket.receive(snapshot());
    socket.receive({
      type: "result",
      matchId: "m",
      winner,
      reason: "five_goals",
      goals: [5, 3],
      points: [100, 20],
      durationMs: 1000,
      waveCount: 1,
    });
    assert(!f.$("duel-result").hidden);
    assert.match(
      f.$("duel-result-title").textContent,
      winner === null ? /DRAW/ : winner === 0 ? /YOU WIN/ : /YOU LOSE/,
    );
    assert.equal(f.$("duel-result-score").textContent, "5 – 3");
    assert.equal(f.doc.activeElement, f.$("duel-result-rematch"));
    f.$("duel-result-rematch").click();
    assert.equal(socket.sent.at(-1).type, "rematch");
    const consent = room();
    consent.phase = "finished";
    consent.players[0].rematchReady = true;
    socket.receive(consent);
    assert.match(
      f.$("duel-result-note").textContent,
      /Waiting for your opponent/,
    );
    f.$("duel-result-leave").click();
    await turn();
    assert(f.$("duel-result").hidden);
  }
});
