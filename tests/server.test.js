import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setImmediate as turn } from "node:timers/promises";
import WebSocket from "ws";
import { createDuelServer } from "../server/index.js";
import { RoomManager } from "../server/rooms.js";
import { Bucket, send } from "../server/protocol.js";
import { validateServerMessage } from "../shared/duel-protocol.js";

const origin = "http://localhost:5173";
class Peer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.closed = once(socket, "close");
    socket.on("message", (data) => {
      const message = JSON.parse(data);
      assert.equal(validateServerMessage(message).ok, true, data.toString());
      this.messages.push(message);
    });
  }
  send(message) {
    this.socket.send(JSON.stringify({ v: 1, ...message }));
  }
  async next(type, predicate = () => true) {
    const deadline = performance.now() + 2500;
    while (performance.now() < deadline) {
      const index = this.messages.findIndex(
        (m) => m.type === type && predicate(m),
      );
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error(
      `Timed out waiting for ${type}: ${JSON.stringify(this.messages.slice(-3))}`,
    );
  }
}
async function fixture(t, options = {}) {
  let clock = 0;
  const app = await createDuelServer({
    host: "127.0.0.1",
    port: 0,
    origins: [origin],
    now: () => clock,
    autoSchedule: false,
    ...options,
  });
  t.after(() => app.close());
  async function peer() {
    const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws`, { origin });
    const p = new Peer(socket);
    await once(socket, "open");
    return p;
  }
  async function advance(count) {
    for (let i = 0; i < count; i++) {
      clock += 1000 / 60;
      app.manager.advance();
      if (i % 30 === 0) {
        for (const socket of app.wss.clients) socket.ping();
        await turn();
        await turn();
      }
    }
    await turn();
    await turn();
  }
  async function room() {
    const a = await peer(),
      b = await peer();
    a.send({ type: "create", requestId: "c" });
    const welcome = await a.next("welcome");
    b.send({ type: "join", requestId: "j", code: welcome.code.toLowerCase() });
    await b.next("welcome");
    await a.next("room", (r) => r.players.every((p) => p.connected));
    return { a, b, code: welcome.code };
  }
  return {
    app,
    peer,
    room,
    advance,
    setClock: (value) => {
      clock = value;
    },
  };
}

test(
  "real clients create, join, ready, move and complete a first-to-five match",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const { a, b, code } = await f.room();
    a.send({ type: "ready", ready: true });
    await turn();
    await turn();
    assert.equal(f.app.manager.rooms.get(code).game, null);
    b.send({ type: "ready", ready: true });
    await a.next("snapshot");
    await b.next("snapshot");
    await f.advance(180);
    await a.next("snapshot", (s) => s.phase === "playing");
    a.send({
      type: "input",
      seq: 2,
      x: 1,
      action: "none",
      slot: 1,
      score: 99999,
    });
    b.send({ type: "input", seq: 2, x: 1, action: "none" });
    await turn();
    await turn();
    await f.advance(1);
    const game = f.app.manager.rooms.get(code).game;
    assert.equal(game.state.players[0].x, 420);
    assert.equal(game.state.players[1].x, 380);
    assert.equal(game.state.players[0].points, 0);
    a.send({ type: "input", seq: 1, x: 0, action: "none" });
    await turn();
    await turn();
    await f.advance(1);
    assert.equal(game.state.players[0].lastAckInputSeq, 2);
    // Drive only player targets over real sockets; leave physics/goals to DuelGame.
    for (let i = 3; i < 500 && game.phase !== "finished"; i++) {
      const canonical = (game.state.balls[0]?.x ?? 400) < 400 ? 1 : 0;
      a.send({ type: "input", seq: i, x: canonical, action: "none" });
      b.send({ type: "input", seq: i, x: 1 - canonical, action: "none" });
      await turn();
      await turn();
      await f.advance(30);
    }
    const first = await a.next("result"),
      second = await b.next("result");
    assert.deepEqual(first, second);
    assert.equal(first.reason, "five_goals");
    assert.equal(Math.max(...first.goals), 5);
    assert.equal(a.messages.filter((m) => m.type === "result").length, 0);
  },
);

test(
  "request replay is idempotent; full, unknown, unauthorized and invalid-phase actions fail",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      a = await f.peer();
    a.send({ type: "create", requestId: "c" });
    const w = await a.next("welcome");
    a.send({ type: "create", requestId: "c" });
    assert.deepEqual(await a.next("welcome"), w);
    assert.equal(f.app.manager.rooms.size, 1);
    a.send({ type: "join", requestId: "c", code: w.code });
    assert.equal((await a.next("error")).code, "BAD_MESSAGE");
    const b = await f.peer();
    b.send({ type: "join", requestId: "j", code: w.code });
    const bw = await b.next("welcome");
    assert.notEqual(bw.token, w.token);
    const c = await f.peer();
    c.send({ type: "join", requestId: "full", code: w.code });
    assert.equal((await c.next("error")).code, "ROOM_FULL");
    c.send({ type: "join", requestId: "unknown", code: "AAAAAA" });
    assert.equal((await c.next("error")).code, "ROOM_NOT_FOUND");
    c.send({ type: "resume", requestId: "r", code: w.code, token: w.token });
    assert.equal((await c.next("error")).code, "AUTH_FAILED");
    a.send({ type: "input", seq: 1, x: 1, action: "none" });
    assert.equal((await a.next("error")).code, "INVALID_PHASE");
    const publicMessages = a.messages.filter((m) => m.type !== "welcome");
    assert(!JSON.stringify(publicMessages).includes(bw.token));
  },
);

test(
  "rooms are isolated and voluntary live leave yields one authoritative forfeit",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      first = await f.room();
    const other = await f.peer();
    other.send({ type: "create", requestId: "c2" });
    const w = await other.next("welcome");
    first.a.send({ type: "ready", ready: true });
    first.b.send({ type: "ready", ready: true });
    await first.a.next("snapshot");
    first.a.send({ type: "leave" });
    const result = await first.b.next("result");
    assert.equal(result.reason, "forfeit");
    assert.equal(result.winner, 1);
    assert.equal(f.app.manager.rooms.get(w.code).game, null);
    assert(
      !other.messages.some((m) => m.type === "snapshot" || m.type === "result"),
    );
    await f.advance(30);
    assert.equal(first.b.messages.filter((m) => m.type === "result").length, 0);
  },
);

test(
  "live disconnect interrupts without a fabricated result; lobby disconnect frees seat",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      { a, b, code } = await f.room();
    a.socket.close();
    await b.next("room", (r) => !r.players[0].connected);
    const c = await f.peer();
    c.send({ type: "join", requestId: "replacement", code });
    const w = await c.next("welcome");
    assert.equal(w.slot, 0);
    c.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await b.next("snapshot");
    c.socket.close();
    const error = await b.next("error");
    assert.match(error.message, /interrupted/i);
    await b.closed;
    assert.equal(f.app.manager.rooms.has(code), false);
    assert(!b.messages.some((m) => m.type === "result"));
  },
);

test(
  "health CORS and WebSocket origin/path checks use the same exact allowlist",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      base = `http://127.0.0.1:${f.app.port}`;
    const health = await fetch(`${base}/health`, {
      headers: { Origin: origin },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(await health.json(), { ok: true, v: 1 });
    assert.equal(
      (
        await fetch(`${base}/health`, {
          headers: { Origin: "https://evil.test" },
        })
      ).status,
      403,
    );
    for (const [path, headers, status] of [
      ["/ws", {}, 403],
      ["/ws", { origin: "https://evil.test" }, 403],
      ["/wrong", { origin }, 404],
    ]) {
      const socket = new WebSocket(
        base.replace("http:", "ws:") + path,
        headers,
      );
      const response = await new Promise((resolve) => {
        socket.on("unexpected-response", (_, response) => {
          response.resume();
          resolve(response.statusCode);
          socket.terminate();
        });
        socket.on("error", () => {});
      });
      assert.equal(response, status);
    }
  },
);

test(
  "malformed, binary, nonfinite-like and wrong-version messages fail; oversize closes",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      a = await f.peer();
    for (const text of [
      "{",
      '{"v":1,"type":"input","seq":1,"x":1e999,"action":"none"}',
      '{"v":1,"type":"input","seq":1,"x":".5","action":"none"}',
    ]) {
      a.socket.send(text);
      assert.equal((await a.next("error")).code, "BAD_MESSAGE");
    }
    a.socket.send(Buffer.from("{}"));
    assert.equal((await a.next("error")).code, "BAD_MESSAGE");
    a.send({ v: 2, type: "ping", id: 1, clientTime: 0 });
    assert.equal((await a.next("error")).code, "VERSION_MISMATCH");
    a.socket.send("x".repeat(8193));
    const [code] = await a.closed;
    assert.equal(code, 1009);
  },
);

test(
  "server room/socket/IP/message limits bound resources",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { maxRooms: 1, maxSockets: 3 }),
      a = await f.peer(),
      b = await f.peer();
    a.send({ type: "create", requestId: "c" });
    await a.next("welcome");
    b.send({ type: "create", requestId: "c" });
    assert.equal((await b.next("error")).code, "SERVER_BUSY");
    for (let i = 0; i < 4; i++) {
      b.send({ type: "join", requestId: `x${i}`, code: "AAAAAA" });
      assert.equal(
        (await b.next("error")).code,
        i === 3 ? "RATE_LIMITED" : "ROOM_NOT_FOUND",
      );
    }
    const c = await f.peer();
    const rejected = new WebSocket(`ws://127.0.0.1:${f.app.port}/ws`, {
      origin,
    });
    rejected.on("error", () => {});
    const status = await new Promise((resolve) =>
      rejected.on("unexpected-response", (_, response) => {
        response.resume();
        resolve(response.statusCode);
        rejected.terminate();
      }),
    );
    assert.equal(status, 503);
    for (let i = 0; i < 61; i++) c.send({ type: "ping", id: i, clientTime: 0 });
    assert.equal((await c.next("error")).code, "RATE_LIMITED");
    await c.closed;
  },
);

test(
  "scheduler caps catch-up and interrupts on a long stall without inventing goals",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      { a, b, code } = await f.room();
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await a.next("snapshot");
    f.setClock(200);
    f.app.manager.advance();
    const game = f.app.manager.rooms.get(code).game;
    assert.equal(game.tick, 5);
    f.setClock(1000);
    f.app.manager.advance();
    assert.equal(game.tick, 5);
    assert.deepEqual(game.state.goals, [0, 0]);
    assert.match((await b.next("error")).message, /stalled/i);
    assert.equal(f.app.manager.rooms.size, 0);
  },
);

test("limiter refill, send backpressure, expiry and heartbeat cleanup are bounded", () => {
  const bucket = new Bucket(2, 1, 0);
  assert(bucket.take(0));
  assert(bucket.take(0));
  assert(!bucket.take(0));
  assert(bucket.take(1000));
  let closeCode,
    terminated = false;
  const messages = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 70000,
    close: (code) => {
      closeCode = code;
    },
    send: (data) => messages.push(JSON.parse(data)),
    terminate: () => {
      terminated = true;
    },
  };
  assert(!send(socket, { type: "snapshot" }));
  assert.equal(closeCode, 1013);
  assert.equal(messages.length, 0);
  socket.bufferedAmount = 0;
  let now = 0;
  const manager = new RoomManager({ now: () => now });
  manager.attach(socket, "local");
  manager.handle(socket, { type: "create", v: 1, requestId: "c" });
  now = 600001;
  manager.maintenance(now);
  assert.equal(manager.rooms.size, 0);
  assert(terminated);
  assert.match(messages.at(-1).message, /expired/i);
  manager.attempt("other");
  now += 60001;
  manager.maintenance(now);
  assert.equal(manager.ipAttempts.size, 0);
  manager.close();
  assert.equal(manager.connections.size, 0);
});

test("request replay cache stays bounded and retains the original successful response", () => {
  let now = 0;
  const messages = [],
    socket = {
      readyState: 1,
      bufferedAmount: 0,
      send: (text) => messages.push(JSON.parse(text)),
      close() {},
      terminate() {},
    };
  const manager = new RoomManager({ now: () => now });
  manager.attach(socket, "local");
  manager.handle(socket, { v: 1, type: "create", requestId: "initial" });
  const original = messages.find((m) => m.type === "welcome");
  for (let i = 1; i <= 64; i++) {
    now += 12001;
    manager.handle(socket, { v: 1, type: "create", requestId: `r${i}` });
  }
  assert.equal(manager.connections.get(socket).cache.size, 64);
  assert.equal(messages.at(-1).code, "RATE_LIMITED");
  manager.handle(socket, { v: 1, type: "create", requestId: "initial" });
  assert.deepEqual(
    messages.filter((m) => m.type === "welcome").at(-1),
    original,
  );
  assert.equal(manager.rooms.size, 1);
  manager.close();
});

test(
  "shutdown notifies live clients and releases sockets and rooms",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      { a, b } = await f.room();
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await a.next("snapshot");
    const closed = f.app.close();
    assert.match((await b.next("error")).message, /shutting down/i);
    await closed;
    assert.equal(f.app.manager.rooms.size, 0);
    assert.equal(f.app.wss.clients.size, 0);
    assert(!b.messages.some((m) => m.type === "result"));
  },
);

test(
  "real clients see identical generated walls and naturally earned owner points",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      { a, b, code } = await f.room();
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    const initialA = await a.next("snapshot"),
      initialB = await b.next("snapshot");
    assert.deepEqual(initialA.state.bricks, initialB.state.bricks);
    assert(initialA.state.bricks.length > 0);
    assert(initialA.state.bricks.every((brick) => brick.type === "standard"));
    const g = f.app.manager.rooms.get(code).game;
    await f.advance(180);
    for (let i = 0; i < 20 && g.state.players.every((p) => p.points === 0); i++)
      await f.advance(30);
    assert(g.state.players.some((p) => p.points > 0));
    const earnedA = await a.next("snapshot", (s) =>
      s.state.players.some((p) => p.points > 0),
    );
    const earnedB = await b.next("snapshot", (s) => s.tick === earnedA.tick);
    assert.deepEqual(earnedA.state, earnedB.state);
    const eventA = await a.next("events", (m) =>
      m.items.some((e) => e.type === "brick_destroyed"),
    );
    const eventB = await b.next("events", (m) =>
      m.items.some((e) => e.type === "brick_destroyed"),
    );
    assert.deepEqual(eventA, eventB);
    const destroyed = eventA.items.find((e) => e.type === "brick_destroyed");
    assert.equal(
      earnedA.state.players[destroyed.owner].points,
      destroyed.points,
    );
  },
);

test(
  "real clients receive owner-directed drops, pickups, shield absorption and hazard damage",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      { a, b, code } = await f.room();
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await a.next("snapshot");
    await f.advance(180);
    const g = f.app.manager.rooms.get(code).game;
    Object.assign(g.state.balls[0], { x: 100, y: 200, vx: 0, vy: 0 });
    g.random = () => 0.65;
    g.hitBrick(g.state.bricks[0].id, 1);
    await f.advance(3);
    const spawned = await a.next("snapshot", (s) => s.state.drops.length > 0);
    assert.equal(spawned.state.drops[0].owner, 1);
    const reward = g.state.drops[0];
    reward.x = 400;
    reward.y = 94;
    await f.advance(3);
    const picked = await b.next(
      "snapshot",
      (s) => s.state.players[1].points >= 600,
    );
    assert.equal(picked.state.players[0].points, 0);
    const add = (type) =>
      g.state.drops.push({
        id: g.nextEntityId++,
        type,
        owner: 0,
        x: 400,
        y: 906,
        baseX: 400,
        motionPhase: 0,
      });
    add("shield");
    add("bomb");
    await f.advance(3);
    const protectedEvents = await a.next("events", (m) =>
      m.items.some((e) => e.type === "hazard_blocked"),
    );
    assert.equal(
      protectedEvents.items.find((e) => e.type === "hazard_blocked").defense,
      "shield",
    );
    assert.equal(g.state.players[0].damage, 0);
    add("rocket");
    add("worm");
    await f.advance(3);
    const damagedA = await a.next(
        "snapshot",
        (s) => s.state.players[0].damage === 1,
      ),
      damagedB = await b.next("snapshot", (s) => s.tick === damagedA.tick);
    assert.deepEqual(damagedA.state, damagedB.state);
    assert.equal(damagedA.phase, "playing");
    assert(damagedA.state.players[0].invulnerabilityRemainingMs > 0);
    assert.deepEqual(damagedA.state.goals, [0, 0]);
  },
);

test(
  "real input messages fire without releasing, release after final charge, split and intercept",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      { a, b, code } = await f.room();
    a.send({ type: "ready", ready: true });
    b.send({ type: "ready", ready: true });
    await a.next("snapshot");
    await f.advance(180);
    const g = f.app.manager.rooms.get(code).game;
    Object.assign(g.state.balls[0], { x: 100, y: 200, vx: 0, vy: 0 });
    const add = (type, owner = 0) =>
      g.state.drops.push({
        id: g.nextEntityId++,
        type,
        owner,
        x: 400,
        y: owner === 0 ? 906 : 94,
        baseX: 400,
        motionPhase: 0,
      });
    add("sticky");
    add("bazooka");
    await f.advance(3);
    assert.equal(g.state.players[0].ammo, 5);
    g.state.players[0].stickyCharges = 1;
    Object.assign(g.state.balls[0], {
      x: 400,
      y: 905,
      vx: 0,
      vy: 360,
      owner: 1,
    });
    await f.advance(3);
    const caught = await a.next("snapshot", (s) =>
      s.state.balls.some((b) => b.held),
    );
    assert.equal(caught.state.players[0].stickyCharges, 0);
    a.send({ type: "input", seq: 1, x: 0.5, action: "fire" });
    await turn();
    await turn();
    await f.advance(3);
    const fired = await b.next("snapshot", (s) => s.state.shots.length > 0);
    assert(fired.state.balls[0].held);
    assert.equal(fired.state.players[0].ammo, 4);
    a.send({ type: "input", seq: 2, x: 0.5, action: "release_fire" });
    a.send({ type: "input", seq: 3, x: 0.5, action: "none" });
    await turn();
    await turn();
    await f.advance(3);
    const released = await a.next(
      "snapshot",
      (s) => s.tick > fired.tick && s.state.balls.every((b) => !b.held),
    );
    assert.equal(released.state.players[0].ammo, 4);
    add("multi", 1);
    await f.advance(3);
    const split = await b.next("snapshot", (s) => s.state.balls.length === 3);
    assert.equal(split.state.balls.length, 3);
    await f.advance(15);
    // Isolate interception scoring from the older fired shot and split balls still
    // traveling toward the wall; their unrelated brick hits are valid gameplay.
    g.state.shots = [];
    for (const ball of g.state.balls)
      if (!ball.held) Object.assign(ball, { x: 100, y: 200, vx: 0, vy: 0 });
    const points = g.state.players[0].points;
    add("bomb");
    a.send({ type: "input", seq: 4, x: 0.5, action: "fire" });
    await turn();
    await turn();
    await f.advance(3);
    const intercepted = await a.next("events", (m) =>
      m.items.some((e) => e.type === "hazard_intercepted"),
    );
    assert.equal(
      intercepted.items.find((e) => e.type === "hazard_intercepted").points,
      100,
    );
    assert.equal(g.state.players[0].points, points + 100);
    assert.equal(g.state.players[0].damage, 0);
  },
);
