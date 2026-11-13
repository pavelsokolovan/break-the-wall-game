import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { ArenaBot } from "../shared/arena-bot.js";
import {
  ARENA_FORMATIONS,
  ArenaGame,
  arenaPaddle,
} from "../shared/arena-game.js";
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
    ...[0, 1, 4, 2.5, "2", null].map((bots) => ({
      v: 1,
      type: "practice",
      bots,
    })),
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

test("arena bots use ordinary side inputs with limited travel and never alter physics", () => {
  for (let slot = 0; slot < 4; slot++) {
    const game = playing(4),
      bot = new ArenaBot(slot, 42),
      pose = arenaPaddle(slot, 650);
    game.balls = [
      {
        id: 100,
        x: pose.x + pose.nx * 200,
        y: pose.y + pose.ny * 200,
        vx: -pose.nx * 340,
        vy: -pose.ny * 340,
        r: 9,
        owner: 0,
      },
    ];
    const before = game.snapshot();
    bot.update(game);
    assert.equal(game.players[slot].seq, 1);
    assert(Math.abs(game.players[slot].target - 400) <= 100);
    assert.notEqual(game.players[slot].target, 400);
    assert.equal(game.players[slot].t, 400);
    assert.deepEqual(game.balls, before.balls);
    assert.deepEqual(game.bricks, before.bricks);
    assert.deepEqual(
      game.players.map((p) => [p.lives, p.points]),
      before.players.map((p) => [p.lives, p.points]),
    );
    bot.update(game);
    assert.equal(
      game.players[slot].seq,
      1,
      "reaction delay prevents perfect per-tick tracking",
    );
    game.players[slot].lives = 0;
    game.activeTicks += 60;
    bot.update(game);
    assert.equal(
      game.players[slot].seq,
      1,
      "eliminated bot stops sending input",
    );
  }
});
test("seeded arena bots return balls, lose lives and finish matches deterministically", () => {
  for (const count of [3, 4]) {
    const run = () => {
      const g = playing(count),
        bots = g.players.map((p) => new ArenaBot(p.slot, p.slot + 45));
      let returned = false;
      for (let i = 0; i < 36001 && g.phase !== "finished"; i++) {
        const owners = new Map(g.balls.map((b) => [b.id, b.owner]));
        bots.forEach((b) => b.update(g));
        g.step();
        if (
          g.balls.some((b) => owners.has(b.id) && owners.get(b.id) !== b.owner)
        )
          returned = true;
      }
      assert(returned, "bots can return balls");
      assert(
        g.players.some((p) => p.lives < 5),
        "bots can miss balls",
      );
      assert.equal(g.phase, "finished");
      return g.snapshot();
    };
    assert.deepEqual(run(), run());
  }
});
test(
  "real two/three-bot arena practice auto-starts, moves bots, rejects joins and cleans up",
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
    const connect = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${app.port}/arena`, {
        origin: "http://localhost:5173",
      });
      const peer = new Peer(ws);
      await once(ws, "open");
      return peer;
    };
    for (const bots of [2, 3]) {
      const human = await connect(),
        outsider = await connect();
      human.send({ type: "practice", bots });
      await human.next("arena_welcome");
      const lobby = await human.next(
        "arena",
        (m) => m.state?.phase === "countdown",
      );
      assert.equal(lobby.count, bots + 1);
      assert.equal(lobby.practice, true);
      assert.equal(lobby.players.filter((p) => p.bot).length, bots);
      assert(lobby.players.every((p) => p.ready));
      outsider.send({ type: "join", code: lobby.code });
      assert.match(
        (await outsider.next("arena_error")).message,
        /full|started/,
      );
      for (let i = 0; i < 240; i++) {
        clock += 1000 / 60;
        app.arenaManager.advance();
      }
      const game = app.arenaManager.rooms.get(lobby.code).game;
      assert.equal(game.phase, "playing");
      assert(game.players.slice(1).every((p) => p.seq > 0));
      assert(game.players.slice(1).some((p) => p.t !== 400));
      if (bots === 2) human.send({ type: "leave" });
      else human.ws.close();
      const end = performance.now() + 2500;
      while (app.arenaManager.rooms.has(lobby.code) && performance.now() < end)
        await new Promise((r) => setTimeout(r, 2));
      assert.equal(app.arenaManager.rooms.size, 0, "no orphan bot-only room");
      human.ws.close();
      outsider.ws.close();
    }
  },
);

test("arena seeds generate varied safe square formations with equal access from every side", () => {
  const seen = new Map();
  for (let seed = 1; seed <= 100; seed++) {
    const a = new ArenaGame(4, seed),
      b = new ArenaGame(3, seed);
    assert.deepEqual(a.bricks, b.bricks, "room size does not skew formation");
    assert.deepEqual(
      a.bricks,
      new ArenaGame(4, seed).bricks,
      "seed is reproducible",
    );
    const positions = new Set(a.bricks.map((brick) => `${brick.x},${brick.y}`));
    assert.equal(positions.size, a.bricks.length);
    assert(a.bricks.length >= 16 && a.bricks.length <= 33);
    for (const brick of a.bricks) {
      assert.equal(brick.w, 32);
      assert.equal(brick.h, 32);
      assert(brick.x >= 264 && brick.x + brick.w <= 536);
      assert(brick.y >= 264 && brick.y + brick.h <= 536);
      assert(
        positions.has(`${800 - brick.y - brick.h},${brick.x}`),
        "quarter-turn symmetry",
      );
    }
    seen.set(a.formation, JSON.stringify([...positions].sort()));
  }
  assert.deepEqual(new Set(seen.keys()), new Set(ARENA_FORMATIONS));
  assert.equal(new Set(seen.values()).size, 5, "all five formations differ");
});
