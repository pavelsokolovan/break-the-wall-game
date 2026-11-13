import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { ArenaGame, arenaPaddle } from "../shared/arena-game.js";
import { ArenaRooms, parseArenaMessage } from "../server/arena-rooms.js";
import { createDuelServer } from "../server/index.js";
const ticks = (g, n) => {
  for (let i = 0; i < n; i++) g.step();
};
const playing = (count = 4) => {
  const g = new ArenaGame(count, 4);
  ticks(g, 180);
  return g;
};
test("square arena starts with chosen count, square bricks and one ball per player", () => {
  for (const count of [3, 4]) {
    const g = playing(count);
    assert.equal(g.players.length, count);
    assert.equal(g.balls.length, count);
    assert(g.bricks.every((b) => b.w === b.h));
    assert.deepEqual(
      new Set(g.balls.map((b) => b.owner)),
      new Set(Array.from({ length: count }, (_, i) => i)),
    );
    assert.equal(g.phase, "playing");
  }
  assert.throws(() => new ArenaGame(2));
});
test("all four paddles return incoming balls and capture ownership", () => {
  for (let slot = 0; slot < 4; slot++) {
    const g = playing(),
      p = arenaPaddle(slot, 600);
    g.bricks = [];
    g.balls = [
      {
        id: 99,
        x: p.x + p.nx * 8,
        y: p.y + p.ny * 8,
        vx: -p.nx * 340,
        vy: -p.ny * 340,
        r: 9,
        owner: (slot + 1) % 4,
      },
    ];
    assert(g.input(slot, { seq: 1, x: 0.75 }));
    assert(!g.input(slot, { seq: 1, x: 0 }));
    g.step();
    const b = g.balls[0];
    assert.equal(b.owner, slot);
    assert(b.vx * p.nx + b.vy * p.ny > 0);
    assert.equal(g.players[slot].lives, 5);
  }
});
test("misses lose lives, respawn and eliminate; eliminated sides become walls", () => {
  for (let slot = 0; slot < 4; slot++) {
    const g = playing();
    g.bricks = [];
    const pose = arenaPaddle(slot, 200);
    g.balls = [
      {
        id: 99,
        x: slot === 1 ? 811 : slot === 3 ? -11 : 200,
        y: slot === 0 ? 811 : slot === 2 ? -11 : 200,
        vx: -pose.nx * 340,
        vy: -pose.ny * 340,
        r: 9,
        owner: slot,
      },
    ];
    g.step();
    assert.equal(g.players[slot].lives, 4);
    assert.equal(g.balls.length, 1);
    assert.equal(g.balls[0].owner, slot);
    g.players[slot].lives = 1;
    Object.assign(g.balls[0], {
      x: slot === 1 ? 811 : slot === 3 ? -11 : 200,
      y: slot === 0 ? 811 : slot === 2 ? -11 : 200,
      vx: -pose.nx * 340,
      vy: -pose.ny * 340,
    });
    g.step();
    assert.equal(g.players[slot].lives, 0);
    assert.equal(g.balls.length, 0);
    g.balls = [
      {
        id: 100,
        x: slot === 1 ? 795 : slot === 3 ? 5 : 200,
        y: slot === 0 ? 795 : slot === 2 ? 5 : 200,
        vx: -pose.nx * 340,
        vy: -pose.ny * 340,
        r: 9,
        owner: (slot + 1) % 4,
      },
    ];
    g.step();
    assert(g.balls[0].vx * pose.nx + g.balls[0].vy * pose.ny > 0);
  }
});
test("three-player unused side is solid and last survivor wins", () => {
  const g = playing(3);
  g.balls = [{ id: 99, x: 5, y: 200, vx: -340, vy: 0, r: 9, owner: 0 }];
  g.step();
  assert(g.balls[0].vx > 0);
  g.forfeit(0);
  g.forfeit(1);
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, 2);
  const state = g.snapshot();
  ticks(g, 100);
  assert.deepEqual(g.snapshot(), state);
});
test("seeded multi-ball simulation remains deterministic and finite", () => {
  const a = playing(),
    b = playing();
  for (let i = 1; i <= 18000 && a.phase !== "finished"; i++) {
    for (const g of [a, b]) {
      g.players.forEach((p) =>
        g.input(p.slot, { seq: i, x: (Math.sin(i * 0.03 + p.slot) + 1) / 2 }),
      );
      g.step();
      assert(g.balls.length <= 4);
      assert(
        g.balls.every((ball) =>
          Number.isFinite(ball.x + ball.y + ball.vx + ball.vy),
        ),
      );
    }
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});
test("arena protocol rejects invalid requests and discards forged state", () => {
  for (const m of [
    { v: 1, type: "create", count: 2 },
    { v: 1, type: "input", seq: 1, x: 2 },
    { v: 1, type: "ready", ready: "yes" },
  ])
    assert(!parseArenaMessage(JSON.stringify(m)).ok);
  const clean = parseArenaMessage(
    JSON.stringify({ v: 1, type: "input", seq: 1, x: 0.5, lives: 99, slot: 3 }),
  );
  assert.deepEqual(clean.value, { type: "input", seq: 1, x: 0.5 });
  assert(!parseArenaMessage("{").ok);
});
class Peer {
  constructor(ws) {
    this.ws = ws;
    this.messages = [];
    ws.on("message", (d) => this.messages.push(JSON.parse(d)));
  }
  send(m) {
    this.ws.send(JSON.stringify({ v: 1, ...m }));
  }
  async next(type, predicate = () => true) {
    const end = performance.now() + 2500;
    while (performance.now() < end) {
      const i = this.messages.findIndex((m) => m.type === type && predicate(m));
      if (i >= 0) return this.messages.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 2));
    }
    throw Error("Timed out: " + type);
  }
}
test(
  "real three/four-client rooms ready, play, forfeit and clean up",
  { timeout: 15000 },
  async (t) => {
    let clock = 0;
    const app = await createDuelServer({
      host: "127.0.0.1",
      port: 0,
      origins: ["http://localhost:5173"],
      now: () => clock,
      autoSchedule: false,
    });
    t.after(() => app.close());
    async function peer() {
      const ws = new WebSocket("ws://127.0.0.1:" + app.port + "/arena", {
        origin: "http://localhost:5173",
      });
      const p = new Peer(ws);
      await once(ws, "open");
      return p;
    }
    for (const count of [3, 4]) {
      const peers = [];
      for (let i = 0; i < count; i++) peers.push(await peer());
      peers[0].send({ type: "create", count });
      const welcome = await peers[0].next("arena_welcome"),
        lobby = await peers[0].next("arena");
      assert.equal(welcome.slot, 0);
      for (let i = 1; i < count; i++) {
        peers[i].send({ type: "join", code: lobby.code });
        assert.equal((await peers[i].next("arena_welcome")).slot, i);
      }
      for (const p of peers) p.send({ type: "ready", ready: true });
      await peers[0].next("arena", (m) => m.state?.phase === "countdown");
      for (let n = 0; n < 180; n++) {
        clock += 1000 / 60;
        app.arenaManager.advance();
      }
      await peers[0].next("arena", (m) => m.state?.phase === "playing");
      peers[count - 1].send({ type: "input", seq: 1, x: 0.75 });
      await new Promise((r) => setTimeout(r, 5));
      clock += 1000 / 60;
      app.arenaManager.advance();
      assert.equal(
        app.arenaManager.rooms.get(lobby.code).game.players[count - 1].t,
        600,
      );
      for (let i = 0; i < count - 1; i++) {
        peers[i].send({ type: "leave" });
        await new Promise((r) => setTimeout(r, 3));
      }
      const finished = await peers[count - 1].next(
        "arena",
        (m) => m.state?.phase === "finished",
      );
      assert.equal(finished.state.winner, count - 1);
      peers[count - 1].send({ type: "leave" });
      await new Promise((r) => setTimeout(r, 5));
      assert(!app.arenaManager.rooms.has(lobby.code));
      peers.forEach((p) => p.ws.close());
      clock += 60001;
      app.arenaManager.advance();
    }
  },
);

test("simultaneous final misses draw without favouring ball processing order", () => {
  const g = playing(3);
  g.players.forEach((p) => (p.lives = p.slot === 2 ? 0 : 1));
  g.bricks = [];
  g.balls = [
    { id: 90, x: 200, y: 811, vx: 0, vy: 340, r: 9, owner: 0 },
    { id: 91, x: 811, y: 200, vx: 340, vy: 0, r: 9, owner: 1 },
  ];
  g.step();
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, null);
  assert.equal(g.balls.length, 0);
});
test("arena requires all seats ready, rejects outsiders and cleans expired rooms", () => {
  let clock = 0;
  const manager = new ArenaRooms({ now: () => clock });
  const peer = (ip) => {
    const socket = {
      readyState: 1,
      bufferedAmount: 0,
      messages: [],
      send(text) {
        this.messages.push(JSON.parse(text));
      },
      close() {},
      terminate() {},
    };
    manager.attach(socket, ip);
    return socket;
  };
  const peers = [peer("a"), peer("b"), peer("c"), peer("d")];
  manager.handle(peers[0], { type: "create", count: 3 });
  const room = [...manager.rooms.values()][0];
  manager.handle(peers[0], { type: "ready", ready: true });
  assert.equal(room.game, null);
  manager.handle(peers[3], { type: "input", seq: 1, x: 0.5 });
  assert.equal(peers[3].messages.at(-1).type, "arena_error");
  for (const p of peers.slice(1, 3))
    manager.handle(p, { type: "join", code: room.code });
  manager.handle(peers[3], { type: "join", code: room.code });
  assert.match(peers[3].messages.at(-1).message, /full/);
  manager.handle(peers[1], { type: "ready", ready: true });
  assert.equal(room.game, null);
  manager.handle(peers[2], { type: "ready", ready: true });
  assert.equal(room.game.phase, "countdown");
  manager.handle(peers[3], { type: "input", seq: 2, x: 0.1 });
  assert.equal(room.game.players[0].target, 400);
  for (const p of peers.slice(0, 3)) manager.detach(p);
  assert.equal(manager.rooms.size, 0);
  manager.handle(peers[3], { type: "create", count: 4 });
  clock = 600001;
  manager.maintenance(clock);
  assert.equal(manager.rooms.size, 0);
});
test("arena shares room capacity and IP request buckets with Duel", () => {
  const manager = new ArenaRooms({
    maxRooms: 1,
    roomCount: () => 1,
    now: () => 0,
  });
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    messages: [],
    send(text) {
      this.messages.push(JSON.parse(text));
    },
  };
  manager.attach(socket, "same-ip");
  manager.handle(socket, { type: "create", count: 3 });
  assert.equal(manager.rooms.size, 0);
  assert.match(socket.messages.at(-1).message, /busy/);
  const sharedBucket = manager.attempts.get("same-ip");
  while (sharedBucket.take(0)) {}
  manager.roomCount = () => 0;
  manager.handle(socket, { type: "create", count: 4 });
  assert.match(socket.messages.at(-1).message, /Too many/);
  assert.equal(manager.rooms.size, 0);
});
