import test from "node:test";
import assert from "node:assert/strict";
import { DuelSync, ServerClock } from "../src/duel-sync.js";
import { OnlineClient, ONLINE_SESSION_KEY } from "../src/online-client.js";
import { DuelGame } from "../shared/duel-game.js";

const near = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function snapshot(time = 1000, fields = {}) {
  const g = new DuelGame({ seed: 1, matchId: "sync" });
  g.start();
  for (let i = 0; i < 180; i++) g.step();
  const s = {
    v: 1,
    type: "snapshot",
    matchId: "sync",
    tick: 180,
    serverTime: time,
    phase: "playing",
    state: g.getState(),
  };
  s.state.players[0].x = 400;
  s.state.players[0].targetX = 400;
  Object.assign(s.state.balls[0], {
    owner: 0,
    x: 100,
    y: 200,
    vx: 300,
    vy: 300,
  });
  return Object.assign(s, fields);
}
class Timers {
  constructor() {
    this.now = 0;
    this.next = 0;
    this.jobs = new Map();
  }
  set = (fn, delay) => {
    const id = ++this.next;
    this.jobs.set(id, { fn, at: this.now + delay, repeat: 0 });
    return id;
  };
  repeat = (fn, delay) => {
    const id = this.set(fn, delay);
    this.jobs.get(id).repeat = delay;
    return id;
  };
  clear = (id) => this.jobs.delete(id);
  async advance(ms) {
    const end = this.now + ms;
    for (let n = 0; n < 10000; n++) {
      const first = [...this.jobs]
        .filter(([, j]) => j.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!first) break;
      const [id, j] = first;
      this.now = j.at;
      if (j.repeat) j.at += j.repeat;
      else this.jobs.delete(id);
      j.fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.now = end;
    await Promise.resolve();
    await Promise.resolve();
  }
}
class Socket {
  constructor() {
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
  }
  addEventListener(type, fn) {
    const a = this.listeners.get(type) || [];
    a.push(fn);
    this.listeners.set(type, a);
  }
  emit(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) fn(event);
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  receive(message) {
    this.emit("message", { data: JSON.stringify({ v: 1, ...message }) });
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.emit("close", { code: 1000 });
  }
  lost() {
    this.readyState = 3;
    this.emit("close", { code: 1006 });
  }
}
const welcome = (id = "r1", token = "a".repeat(32), next = 1) => ({
  type: "welcome",
  requestId: id,
  code: "ABC234",
  playerId: "p0",
  slot: 0,
  token,
  matchId: "sync",
  nextInputSeq: next,
  resumed: false,
});
const storage = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
};
function fixture(t, options = {}) {
  const timers = new Timers(),
    sockets = [],
    statuses = [],
    messages = [];
  const client = new OnlineClient({
    now: () => timers.now,
    setTimer: timers.set,
    clearTimer: timers.clear,
    setRepeater: timers.repeat,
    clearRepeater: timers.clear,
    storage: storage(),
    socketFactory: () => {
      const s = new Socket();
      sockets.push(s);
      return s;
    },
    onStatus: (m) => statuses.push(m),
    onMessage: (m) => messages.push(m),
    ...options,
  });
  t.after(() => client.disconnect());
  return { client, timers, sockets, statuses, messages };
}
async function joined(f) {
  const connected = f.client.connect("ws://local.test/ws");
  f.sockets[0].open();
  await connected;
  const pending = f.client.request("create");
  f.sockets[0].receive(welcome());
  await pending;
}

test("clock uses verified midpoint samples and the best bounded RTT window", () => {
  const clock = new ServerClock();
  clock.observe(1000, 100);
  near(clock.serverNow(200), 1100);
  assert(clock.sample(100, 1100, 140));
  near(clock.offset, 980);
  clock.sample(200, 1190, 220);
  near(clock.offset, 980);
  assert(!clock.sample(300, 1300, 200));
  assert(!clock.sample(NaN, 1, 2));
  for (let i = 0; i < 20; i++) clock.sample(300 + i, 1300 + i, 350 + i);
  assert.equal(clock.samples.length, 8);
});
test("remote positions interpolate 100ms behind, use latest discrete state and never extrapolate", () => {
  const sync = new DuelSync(),
    a = snapshot(),
    b = snapshot(1050);
  b.tick++;
  b.state.balls[0].x = 150;
  b.state.balls[0].y = 250;
  b.state.players[1].x = 450;
  b.state.players[1].points = 500;
  sync.push(a, 0, 0);
  sync.push(b, 50, 0);
  const view = sync.frame(125).snapshot;
  near(view.state.balls[0].x, 125);
  near(view.state.players[1].x, 425);
  assert.equal(view.state.players[1].points, 500);
  const frozen = sync.frame(301);
  assert(frozen.stale);
  near(frozen.snapshot.state.balls[0].x, 150);
  assert.equal(b.state.balls[0].x, 150);
});
test("phase/goal/wave and owner/held/ID changes prevent interpolation across discontinuities", () => {
  for (const change of ["phase", "goal", "wave", "owner", "held", "id"]) {
    const sync = new DuelSync(),
      a = snapshot(),
      b = snapshot(1050);
    b.tick++;
    b.state.balls[0].x = 700;
    if (change === "phase") b.phase = "countdown";
    if (change === "goal") b.state.goals[1] = 1;
    if (change === "wave") b.state.wave = 2;
    if (change === "owner") b.state.balls[0].owner = 1;
    if (change === "held") b.state.balls[0].held = true;
    if (change === "id") b.state.balls[0].id += 100;
    sync.push(a, 0, 0);
    sync.push(b, 50, 0);
    const out = sync.frame(125).snapshot;
    if (change === "held")
      near(
        out.state.balls[0].x,
        out.state.players[0].x + b.state.balls[0].heldOffsetX,
      );
    else near(out.state.balls[0].x, 700);
  }
});
test("local paddle predicts before send, prunes acks, replays pending movement and reconciles smoothly", () => {
  const sync = new DuelSync(),
    a = snapshot();
  sync.push(a, 0, 0);
  sync.setTarget(0.9, 0);
  const immediate = sync.frame(10).snapshot.state.players[0].x;
  near(immediate, 412);
  assert.equal(sync.pending.length, 0);
  sync.recordInput({ seq: 1, x: 0.9, at: 10 });
  sync.frame(20);
  const b = snapshot(1010);
  Object.assign(b.state.players[0], {
    x: 406,
    targetX: 720,
    lastAckInputSeq: 0,
  });
  sync.push(b, 20, 0);
  const corrected = sync.frame(20).snapshot.state.players[0].x;
  near(corrected, 424);
  assert.equal(sync.pending.length, 1);
  const later = sync.frame(60).snapshot.state.players[0].x;
  assert(later > corrected && later - corrected <= 48);
  const c = snapshot(1050);
  Object.assign(c.state.players[0], {
    x: 460,
    targetX: 720,
    lastAckInputSeq: 1,
  });
  sync.push(c, 70, 0);
  assert.equal(sync.pending.length, 0);
  const next = sync.frame(70).snapshot.state.players[0].x;
  assert(Math.abs(next - later) <= 12 + 1e-6);
});
test("prediction clamps field, held visuals follow only authoritative catches, and loss freezes display", () => {
  const sync = new DuelSync(),
    a = snapshot();
  Object.assign(a.state.balls[0], { held: true, heldOffsetX: 20 });
  sync.push(a, 0, 1);
  sync.setTarget(1, 0);
  const frame = sync.frame(50).snapshot;
  near(frame.state.players[1].x, 340);
  assert.equal(frame.state.balls[0].owner, 0);
  for (let i = 0; i < 200; i++) sync.recordInput({ seq: i + 1, x: 1, at: 50 });
  assert.equal(sync.pending.length, 128);
  const frozen = sync.frame(100, false).snapshot;
  assert.deepEqual(frozen, frame);
  sync.reset();
  assert.equal(sync.frame(100), null);
});
test("same-seat retry uses bounded 1/2/4/8 second backoff and a hard 30-second deadline", async (t) => {
  const f = fixture(t);
  await joined(f);
  f.sockets[0].lost();
  assert(f.client.recovering);
  assert.equal(f.client.input(0.5), false);
  const times = [];
  for (const at of [1000, 3000, 7000, 15000, 23000]) {
    await f.timers.advance(at - f.timers.now);
    times.push(f.timers.now);
    const s = f.sockets.at(-1);
    assert.equal(s.readyState, 0);
    s.emit("error");
    await Promise.resolve();
  }
  assert.deepEqual(times, [1000, 3000, 7000, 15000, 23000]);
  await f.timers.advance(7000);
  assert(!f.client.recovering);
  assert.equal(f.client.session, null);
  assert.match(f.statuses.at(-1), /timed out/i);
  assert.equal(f.timers.jobs.size, 0);
});
test("resume restores rotated token/sequence and rejects delayed callbacks from replaced sockets", async (t) => {
  const f = fixture(t);
  await joined(f);
  f.client.input(0.4);
  await f.timers.advance(34);
  f.client.input(0.6);
  const old = f.sockets[0];
  old.lost();
  await f.timers.advance(1000);
  const current = f.sockets[1];
  current.open();
  await Promise.resolve();
  await Promise.resolve();
  const request = current.sent.find((m) => m.type === "resume");
  assert(request);
  assert(!current.sent.some((m) => m.type === "create" || m.type === "join"));
  current.receive({
    ...welcome(request.requestId, "b".repeat(32), 2),
    resumed: true,
  });
  await Promise.resolve();
  assert(!f.client.recovering);
  assert.equal(f.client.nextSeq, 3);
  assert.equal(f.client.session.token, "b".repeat(32));
  old.receive(welcome("late", "c".repeat(32)));
  assert.equal(f.client.session.token, "b".repeat(32));
  const saved = JSON.parse(f.client.storage.getItem(ONLINE_SESSION_KEY));
  assert.equal(saved.token, "b".repeat(32));
  assert(!f.statuses.some((s) => s.includes(saved.token)));
});
test("saved session requires explicit resume gesture, binds backend URL, and storage failures allow in-memory recovery", async (t) => {
  const shared = storage(),
    f = fixture(t, { storage: shared });
  await joined(f);
  f.client.stopSocket("reload");
  const restored = fixture(t, { storage: shared });
  assert.equal(restored.sockets.length, 0);
  assert(!restored.client.resumeSaved("ws://other.test/ws"));
  assert(restored.client.resumeSaved("ws://local.test/ws"));
  await restored.timers.advance(0);
  assert.equal(restored.sockets.length, 1);
  const unavailable = fixture(t, {
    storage: {
      getItem() {
        throw Error();
      },
      setItem() {
        throw Error();
      },
      removeItem() {
        throw Error();
      },
    },
  });
  await joined(unavailable);
  unavailable.sockets[0].lost();
  assert(unavailable.client.recovering);
  assert(unavailable.client.session);
  for (const text of [
    "null",
    "{",
    "{}",
    JSON.stringify({
      url: "https://wrong/",
      code: "ABC234",
      token: "x",
      playerId: "p",
      slot: 0,
      nextSeq: 1,
    }),
  ]) {
    const bad = storage();
    bad.setItem(ONLINE_SESSION_KEY, text);
    assert.equal(new OnlineClient({ storage: bad }).session, null);
  }
});
test("auth/room failure stops retry, and intentional Solo cancellation clears identity and timers", async (t) => {
  const f = fixture(t);
  await joined(f);
  f.sockets[0].lost();
  await f.timers.advance(1000);
  const s = f.sockets.at(-1);
  s.open();
  await Promise.resolve();
  await Promise.resolve();
  const request = s.sent.find((m) => m.type === "resume");
  s.receive({
    type: "error",
    requestId: request.requestId,
    code: "ROOM_NOT_FOUND",
    message: "Match interrupted.",
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.client.session, null);
  assert(!f.client.recovering);
  const cancel = fixture(t);
  await joined(cancel);
  cancel.sockets[0].lost();
  cancel.client.disconnect();
  await cancel.timers.advance(30000);
  assert.equal(cancel.sockets.length, 1);
  assert.equal(cancel.timers.jobs.size, 0);
  assert.equal(cancel.client.storage.getItem(ONLINE_SESSION_KEY), null);
});
test("only outstanding matching pongs change the clock, ping history remains bounded", async (t) => {
  const f = fixture(t);
  await joined(f);
  const socket = f.sockets[0],
    ping = socket.sent.find((m) => m.type === "ping");
  await f.timers.advance(50);
  socket.receive({
    type: "pong",
    id: ping.id + 100,
    clientTime: ping.clientTime,
    serverTime: 1000,
  });
  assert.equal(f.client.clock.offset, null);
  socket.receive({
    type: "pong",
    id: ping.id,
    clientTime: ping.clientTime,
    serverTime: 1000,
  });
  near(f.client.clock.offset, 975);
  for (let i = 0; i < 10; i++) f.client.ping();
  assert.equal(f.client.pings.size, 4);
});

test("recovery retries socket constructor failures and heartbeat silence starts recovery", async (t) => {
  const failed = fixture(t);
  await joined(failed);
  failed.client.socketFactory = () => {
    throw new Error("offline");
  };
  failed.sockets[0].lost();
  await failed.timers.advance(1000);
  await Promise.resolve();
  await Promise.resolve();
  assert(failed.client.recovering);
  assert(failed.timers.jobs.size > 0);
  const silent = fixture(t);
  await joined(silent);
  await silent.timers.advance(30000);
  assert(silent.client.recovering);
  assert.equal(silent.client.state, "reconnecting");
});

test("bounce reversals use confirmed position instead of blending through a paddle", () => {
  const sync = new DuelSync({ interpolationMs: 50, correctionMs: 40 });
  const before = snapshot(1000),
    after = snapshot(1050);
  Object.assign(before.state.balls[0], { x: 400, y: 895, vx: 0, vy: 360 });
  Object.assign(after.state.balls[0], { x: 400, y: 890, vx: 0, vy: -360 });
  sync.push(before, 1000, 0);
  sync.push(after, 1050, 0);
  const displayed = sync.frame(1075).snapshot.state.balls[0];
  assert.equal(displayed.y, 890);
  assert.equal(displayed.vy, -360);
});

test("contact presentation pairs confirmed ball and paddle despite input prediction and network delay", () => {
  for (const slot of [0, 1]) {
    const sync = new DuelSync({ authoritativeContact: true });
    const s = snapshot(1000);
    s.state.players[slot].x = 200;
    const b = s.state.balls[0];
    Object.assign(b, {
      x: 600,
      y: slot === 0 ? 910 : 90,
      vy: slot === 0 ? 360 : -360,
    });
    sync.push(s, 1100, slot);
    sync.setTarget(slot === 0 ? 0.9 : 0.1, 1100);
    const out = sync.frame(1140).snapshot;
    assert.equal(out.state.players[slot].x, 200);
    assert.equal(out.state.balls[0].x, 600);
    assert.equal(out.state.balls[0].y, b.y);
  }
});
