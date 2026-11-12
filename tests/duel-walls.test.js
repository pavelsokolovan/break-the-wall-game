import test from "node:test";
import assert from "node:assert/strict";
import { DuelGame } from "../shared/duel-game.js";
import { seeded } from "../shared/game-helpers.js";
import {
  makeDuelWall,
  wallBounds,
  canSpawnWall,
} from "../shared/duel-walls.js";
import { sweepCircleRect } from "../shared/duel-collision.js";
import { validateServerMessage } from "../shared/duel-protocol.js";

const near = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const ticks = (g, n) => {
  for (let i = 0; i < n; i++) g.step();
};
function game() {
  const g = new DuelGame({ seed: 27, matchId: "walls" });
  g.start();
  ticks(g, 180);
  g.drainEvents();
  g.state.balls = [ball(g, { x: 100, y: 200, vx: 0, vy: 0 })];
  return g;
}
function ball(g, fields = {}) {
  return {
    id: g.nextEntityId++,
    x: 400,
    y: 500,
    vx: 0,
    vy: 360,
    r: 10,
    owner: 0,
    held: false,
    heldOffsetX: 0,
    autoReleaseRemainingMs: 0,
    ...fields,
  };
}
function brick(g, type = "standard", fields = {}) {
  const hp =
    type === "steel"
      ? null
      : type === "armored"
        ? 2
        : type === "reinforced"
          ? 3
          : 1;
  return {
    id: g.nextEntityId++,
    r: 0,
    c: 0,
    x: 350,
    y: 500,
    w: 86,
    h: 32,
    type,
    hp,
    maxHp: hp,
    ...fields,
  };
}
function validate(g) {
  const s = validateServerMessage({
    v: 1,
    type: "snapshot",
    matchId: g.matchId,
    tick: g.tick,
    serverTime: 0,
    phase: g.phase,
    state: g.getState(),
  });
  assert(s.ok, JSON.stringify(s));
  const events = g.drainEvents();
  const e = validateServerMessage({
    v: 1,
    type: "events",
    matchId: g.matchId,
    items: events,
  });
  assert(e.ok, JSON.stringify(e));
  return events;
}
function cleared(g) {
  g.state.bricks = [];
  g.step();
  assert.equal(g.pendingWall.ticks, 120);
}

test("1200 seeded walls are symmetric, varied, centered, durable and safely traversable around steel", () => {
  const variations = new Set(),
    seen = new Map();
  for (let wave = 1; wave <= 12; wave++)
    for (let seed = 0; seed < 100; seed++) {
      let id = 1;
      const wall = makeDuelWall(wave, seeded(seed), () => id++);
      const rows = Math.min(4 + Math.floor(wave / 3), 6),
        cells = new Map(wall.map((b) => [`${b.r}:${b.c}`, b]));
      assert(wall.some((b) => b.type !== "steel"));
      assert.equal(new Set(wall.map((b) => b.id)).size, wall.length);
      for (const b of wall) {
        const partner = cells.get(`${rows - 1 - b.r}:${7 - b.c}`);
        assert(partner);
        assert.equal(partner.x, 800 - b.x - b.w);
        assert.equal(partner.y, 1000 - b.y - b.h);
        assert.equal(partner.type, b.type);
        assert.equal(partner.hp, b.hp);
        assert.equal(partner.color, b.color);
        assert(b.x >= 28 && b.x + b.w <= 772 && b.y >= 384 && b.y + b.h <= 616);
        assert.equal(b.w, 86);
        assert.equal(b.h, 32);
        const unlock = {
          standard: 1,
          armored: 2,
          explosive: 3,
          steel: 4,
          reinforced: 5,
        }[b.type];
        assert(wave >= unlock);
        assert.equal(
          b.hp,
          { standard: 1, armored: 2, explosive: 1, steel: null, reinforced: 3 }[
            b.type
          ],
        );
        seen.set(b.type, true);
        if (b.type === "steel")
          for (const other of wall)
            if (other !== b && other.type === "steel")
              assert(
                Math.abs(b.r - other.r) > 1 || Math.abs(b.c - other.c) > 1,
              );
      }
      const bounds = wallBounds(wall);
      near(bounds.x + bounds.w / 2, 400);
      near(bounds.y + bounds.h / 2, 500);
      // After breakables are removed, every nonsteel grid cell has an exterior route.
      // Empty cells are >=32px tall; the 28px side margins also fit a 20px ball.
      const reachable = new Set(["-1:-1"]),
        queue = [[-1, -1]];
      for (let i = 0; i < queue.length; i++) {
        const [r, c] = queue[i];
        for (const [nr, nc] of [
          [r - 1, c],
          [r + 1, c],
          [r, c - 1],
          [r, c + 1],
        ]) {
          const key = `${nr}:${nc}`;
          if (
            nr < -1 ||
            nr > rows ||
            nc < -1 ||
            nc > 8 ||
            reachable.has(key) ||
            cells.get(key)?.type === "steel"
          )
            continue;
          reachable.add(key);
          queue.push([nr, nc]);
        }
      }
      assert(
        wall
          .filter((b) => b.type !== "steel")
          .every((b) => reachable.has(`${b.r}:${b.c}`)),
      );
      variations.add(JSON.stringify(wall.map((b) => [b.r, b.c, b.type])));
      let secondId = 1;
      assert.deepEqual(
        wall,
        makeDuelWall(wave, seeded(seed), () => secondId++),
      );
    }
  assert(variations.size > 30);
  assert.equal(seen.size, 5);
});
test("durability awards only destruction points and steel never joins a combo", () => {
  const g = game();
  for (const [type, hp, points] of [
    ["standard", 1, 100],
    ["armored", 2, 250],
    ["reinforced", 3, 450],
    ["explosive", 1, 150],
  ]) {
    const b = brick(g, type);
    g.state.bricks = [b];
    const before = g.state.players[1].points;
    for (let i = 1; i <= hp; i++) {
      assert(g.hitBrick(b.id, 1));
      assert.equal(g.state.players[1].points, before + (i === hp ? points : 0));
    }
    assert(!g.hitBrick(b.id, 0));
    assert.equal(g.state.players[0].points, 0);
  }
  const b = brick(g, "steel");
  g.state.bricks = [b];
  const count = g.state.players[1].comboCount;
  for (let i = 0; i < 10; i++) g.hitBrick(b.id, 1);
  assert.equal(b.hp, null);
  assert.equal(g.state.players[1].comboCount, count);
  assert(!g.hitBrick(b.id, 2));
  validate(g);
});
test("combo thresholds are independent per player and expire after exactly 120 active ticks", () => {
  const g = game();
  g.state.bricks = Array.from({ length: 20 }, (_, c) =>
    brick(g, "standard", { c, x: 28 + c * 94 }),
  );
  const ids = g.state.bricks.map((b) => b.id);
  for (let i = 0; i < 15; i++) g.hitBrick(ids[i], 0);
  assert.equal(g.state.players[0].points, 3300);
  assert.equal(g.state.players[0].comboCount, 15);
  g.hitBrick(ids[15], 1);
  assert.equal(g.state.players[1].points, 100);
  assert.equal(g.state.players[1].comboCount, 1);
  ticks(g, 119);
  assert(g.state.players[0].comboRemainingMs > 0);
  g.setPaused(true);
  ticks(g, 100);
  assert.equal(g.state.players[0].comboCount, 15);
  g.setPaused(false);
  g.step();
  assert.equal(g.state.players[0].comboRemainingMs, 0);
  assert.equal(g.state.players[0].comboCount, 0);
  g.hitBrick(ids[16], 0);
  assert.equal(g.state.players[0].points, 3400);
  assert.equal(g.state.players[0].comboCount, 1);
  validate(g);
});
test("explosive queues carry ownership, hit diagonal neighbors, and detonate each explosive once", () => {
  const run = (reverse) => {
    const g = game();
    const a = brick(g, "explosive", { r: 0, c: 0 }),
      b = brick(g, "explosive", { r: 0, c: 1, x: 444 });
    const armor = brick(g, "armored", { r: 1, c: 1, x: 444, y: 540 }),
      steel = brick(g, "steel", { r: 1, c: 0, y: 540 });
    const far = brick(g, "standard", { r: 3, c: 3, x: 632, y: 620 });
    g.state.bricks = [a, b, armor, steel, far];
    if (reverse) g.state.bricks.reverse();
    g.hitBrick(a.id, 1);
    assert.equal(g.state.players[1].points, 550);
    assert.equal(g.state.players[0].points, 0);
    assert.equal(g.state.bricks.length, 2);
    assert.equal(steel.hp, null);
    assert.equal(far.hp, 1);
    const events = validate(g);
    assert.equal(events.filter((e) => e.type === "explosion").length, 2);
    assert(
      events
        .filter((e) => e.type === "brick_destroyed")
        .every((e) => e.owner === 1),
    );
    return events;
  };
  assert.deepEqual(run(false), run(true));
});
test("swept faces and true corners reflect maximum-speed balls without duplicate brick damage", () => {
  for (const type of ["standard", "armored", "reinforced", "steel"])
    for (const fromTop of [false, true]) {
      const g = game(),
        b = brick(g, type);
      g.state.bricks = [b];
      const incoming = ball(g, {
        x: 400,
        y: fromTop ? 484 : 548,
        vy: fromTop ? 795.6 : -795.6,
        owner: 1,
      });
      g.state.balls = [incoming];
      g.step();
      assert(incoming.vy * (fromTop ? 1 : -1) < 0);
      near(Math.hypot(incoming.vx, incoming.vy), 795.6);
      assert.equal(b.hp, type === "steel" ? null : b.maxHp - 1);
      ticks(g, 2);
      assert.equal(b.hp, type === "steel" ? null : b.maxHp - 1);
      validate(g);
    }
  const g = game(),
    b = brick(g, "armored");
  g.state.bricks = [b];
  const incoming = ball(g, {
    x: 339,
    y: 489,
    vx: 795.6 / Math.sqrt(2),
    vy: 795.6 / Math.sqrt(2),
  });
  g.state.balls = [incoming];
  g.step();
  assert(incoming.vx < 0 && incoming.vy < 0);
  near(Math.hypot(incoming.vx, incoming.vy), 795.6);
  assert.equal(b.hp, 1);
  assert.equal(sweepCircleRect({ x: 341, y: 491, r: 10 }, 0, 1, b), null);
});
test("two-ball contact ordering is chronological, then stable by ball ID for exact ties", () => {
  for (const simultaneous of [false, true])
    for (const reverse of [false, true]) {
      const g = game(),
        b = brick(g, "armored");
      g.state.bricks = [b];
      const first = ball(g, {
        x: 390,
        y: simultaneous ? 486 : 485,
        vy: 360,
        owner: 0,
      });
      const second = ball(g, {
        x: 390,
        y: simultaneous ? 546 : 544,
        vy: -360,
        owner: 1,
      });
      g.state.balls = reverse ? [second, first] : [first, second];
      g.step();
      assert.equal(g.state.players[simultaneous ? 1 : 0].points, 250);
      assert.equal(g.state.players[simultaneous ? 0 : 1].points, 0);
      validate(g);
    }
});
test("destroyed collision candidates are recomputed before a later ball arrives", () => {
  const g = game(),
    b = brick(g);
  g.state.bricks = [b];
  const early = ball(g, { x: 390, y: 489, vy: 360, owner: 1 }),
    late = ball(g, { x: 400, y: 546, vy: -360, owner: 0 });
  g.state.balls = [late, early];
  g.step();
  assert(early.vy < 0);
  assert(late.vy < 0);
  assert.equal(g.state.players[1].points, 100);
  assert.equal(g.state.players[0].points, 0);
  validate(g);
});
test("a returned ball gives subsequent brick points to its new paddle owner", () => {
  const g = game(),
    b = brick(g);
  g.state.bricks = [b];
  const incoming = ball(g, { x: 400, y: 905, vy: 360, owner: 1 });
  g.state.balls = [incoming];
  g.step();
  assert.equal(incoming.owner, 0);
  incoming.x = 400;
  incoming.y = 548;
  incoming.vx = 0;
  incoming.vy = -795.6;
  g.step();
  assert.equal(g.state.players[0].points, 100);
  assert.equal(g.state.players[1].points, 0);
});
test("natural clear removes remaining steel, delays 120 ticks and repairs without resetting live play", () => {
  const g = game(),
    b = brick(g),
    steel = brick(g, "steel", { x: 600, c: 3 });
  g.state.bricks = [b, steel];
  g.state.balls = [ball(g, { x: 400, y: 548, vy: -795.6 })];
  g.step();
  assert.equal(g.pendingWall.ticks, 120);
  assert.equal(g.state.bricks.length, 0);
  const incoming = g.state.balls[0];
  incoming.x = 100;
  incoming.y = 200;
  incoming.vx = 120;
  incoming.vy = 0;
  const p = g.state.players[0];
  Object.assign(p, {
    damage: 3,
    width: 150,
    wideRemainingMs: 10000,
    slowRemainingMs: 10000,
    ammo: 5,
    stickyCharges: 2,
    vestCharges: 1,
    points: 500,
  });
  ticks(g, 119);
  assert.equal(g.state.wave, 1);
  const id = incoming.id,
    speed = Math.hypot(incoming.vx, incoming.vy);
  g.step();
  assert.equal(g.state.wave, 2);
  assert.equal(g.phase, "playing");
  assert.equal(g.state.balls[0].id, id);
  assert.equal(p.damage, 0);
  assert.equal(p.width, 240);
  assert.equal(p.points, 500);
  assert.equal(p.ammo, 5);
  assert.equal(p.stickyCharges, 2);
  assert.equal(p.vestCharges, 1);
  near(p.wideRemainingMs, 8000);
  near(Math.hypot(incoming.vx, incoming.vy), speed);
  assert.equal(g.ballSpeed(0), 385 * 0.65);
  validate(g);
});
test("all blocker types postpone cached wall spawn without RNG or entity-ID changes", () => {
  for (const kind of ["ball", "drop", "shot"]) {
    const g = game();
    cleared(g);
    const candidate = structuredClone(g.pendingWall.bricks),
      bounds = wallBounds(candidate),
      nextId = g.nextEntityId;
    ticks(g, 119);
    if (kind === "ball" || kind === "held")
      Object.assign(g.state.balls[0], {
        x: bounds.x - 10,
        y: bounds.y + 10,
        held: kind === "held",
      });
    if (kind === "drop")
      g.state.drops = [
        {
          id: g.nextEntityId++,
          type: "gem",
          owner: 0,
          x: bounds.x - 11,
          y: bounds.y + 10,
          baseX: bounds.x - 11,
          motionPhase: 0,
        },
      ];
    if (kind === "shot")
      g.state.shots = [
        { id: g.nextEntityId++, owner: 0, x: bounds.x - 4, y: bounds.y + 10 },
      ];
    const allocated = g.nextEntityId;
    ticks(g, kind === "shot" ? 1 : 30);
    assert.equal(g.state.wave, 1);
    assert.equal(g.pendingWall.ticks, 0);
    assert.deepEqual(g.pendingWall.bricks, candidate);
    assert.equal(g.nextEntityId, allocated);
    g.state.balls[0].x = 100;
    g.state.balls[0].y = 200;
    g.state.drops = [];
    g.state.shots = [];
    g.step();
    assert.equal(g.state.wave, 2);
    assert.deepEqual(g.state.bricks, candidate);
    assert(g.nextEntityId >= nextId);
    validate(g);
  }
});
test("pause/countdown freezes pending replacement and a goal on its due tick wins precedence", () => {
  const g = game();
  cleared(g);
  ticks(g, 119);
  assert.equal(g.pendingWall.ticks, 1);
  g.setPaused(true);
  ticks(g, 300);
  assert.equal(g.pendingWall.ticks, 1);
  g.setPaused(false);
  g.state.balls = [ball(g, { y: 1011 })];
  g.step();
  assert.equal(g.state.goals[1], 1);
  assert.equal(g.state.wave, 1);
  assert.equal(g.pendingWall.ticks, 1);
  assert.equal(g.state.players[0].damage, 1);
  ticks(g, 120);
  assert.equal(g.pendingWall.ticks, 1);
  assert.equal(g.state.wave, 1);
  g.step();
  assert.equal(g.state.wave, 2);
  assert.equal(g.state.players[0].damage, 0);
  validate(g);
});
test("last-brick/goal and last-brick/victory ties keep points but cannot repair or cancel goals", () => {
  for (const terminal of [false, true]) {
    const g = game(),
      b = brick(g);
    g.state.bricks = [b];
    if (terminal) g.state.goals[1] = 4;
    g.state.balls = [
      ball(g, { x: 400, y: 548, vy: -795.6, owner: 0 }),
      ball(g, { y: 1011, owner: 1 }),
    ];
    g.step();
    assert.equal(g.state.players[0].points, 100);
    assert.equal(g.state.players[0].damage, 1);
    assert.equal(g.state.wave, 1);
    assert.equal(g.pendingWall, null);
    assert.equal(g.state.goals[1], terminal ? 5 : 1);
    assert.equal(g.phase, "playing");
    Object.assign(g.state.balls[0], { y: 1011, vy: 360 });
    g.step();
    assert.equal(g.phase, terminal ? "finished" : "goal_countdown");
    if (terminal) {
      assert.equal(g.getResult().winner, 1);
      assert.equal(g.getResult().points[0], 100);
    }
    const events = validate(g);
    assert(!events.some((e) => e.type === "wave_cleared"));
  }
});
test("spawn guard covers empty cells inside the bounding band, not just occupied bricks", () => {
  const wall = [
    { x: 100, y: 400, w: 86, h: 32 },
    { x: 600, y: 560, w: 86, h: 32 },
  ];
  assert(
    !canSpawnWall(wall, {
      balls: [{ x: 400, y: 500, r: 10 }],
      drops: [],
      shots: [],
    }),
  );
  assert(
    canSpawnWall(wall, {
      balls: [{ x: 400, y: 200, r: 10 }],
      drops: [],
      shots: [],
    }),
  );
});
