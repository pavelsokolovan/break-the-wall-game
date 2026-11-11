import test from "node:test";
import assert from "node:assert/strict";
import { DuelGame } from "../shared/duel-game.js";
import { paddleBounce } from "../shared/game-helpers.js";
import {
  DUEL_RULES as R,
  worldToViewPoint,
  worldToViewVelocity,
} from "../shared/duel-rules.js";
import { validateServerMessage } from "../shared/duel-protocol.js";

const near = (a, b, message) =>
  assert(Math.abs(a - b) < 1e-6, `${message || ""}: ${a} != ${b}`);
const ticks = (g, count) => {
  for (let i = 0; i < count; i++) g.step();
};
function playing(seed = 1) {
  const g = new DuelGame({ seed, matchId: "match" });
  g.start();
  ticks(g, 180);
  g.drainEvents();
  return g;
}
function ball(g, overrides = {}) {
  return {
    id: g.nextEntityId++,
    x: 400,
    y: 500,
    vx: 100,
    vy: 340,
    r: 10,
    owner: 0,
    held: false,
    heldOffsetX: 0,
    autoReleaseRemainingMs: 0,
    ...overrides,
  };
}
function validate(g) {
  const s = validateServerMessage({
    v: 1,
    type: "snapshot",
    matchId: g.matchId,
    tick: g.tick,
    serverTime: (g.tick * 1000) / 60,
    phase: g.phase,
    state: g.getState(),
  });
  assert.equal(s.ok, true, JSON.stringify(s));
  const items = g.drainEvents();
  assert.equal(
    validateServerMessage({ v: 1, type: "events", matchId: g.matchId, items })
      .ok,
    true,
  );
  return items;
}
function goal(g, scorer) {
  g.state.balls = [
    ball(g, { y: scorer === 0 ? -11 : 1011, vy: scorer === 0 ? -360 : 360 }),
  ];
  g.step();
}

test("configuration validation and start are safe and one-shot", () => {
  for (const seed of [-1, 0x100000000, NaN, 0.5, "1", undefined])
    assert.throws(() => new DuelGame({ seed, matchId: "m" }));
  for (const matchId of ["", "x".repeat(129), undefined])
    assert.throws(() => new DuelGame({ seed: 1, matchId }));
  const g = new DuelGame({ seed: 0xffffffff, matchId: "m" });
  assert.equal(g.phase, "lobby");
  assert.equal(g.getResult(), null);
  g.step();
  assert.equal(g.tick, 0);
  assert(g.start());
  assert(!g.start());
  assert.equal(g.tick, 0);
});
test("exact initial and goal countdowns automatically serve from either end", () => {
  const servers = new Set();
  for (let seed = 0; seed < 10; seed++) {
    const g = new DuelGame({ seed, matchId: "m" });
    g.start();
    const slot = g.state.servingSlot;
    servers.add(slot);
    assert(!g.applyInput(slot, { seq: 1, x: 1, action: "fire" }));
    ticks(g, 179);
    assert.equal(g.phase, "countdown");
    assert.equal(g.state.balls.length, 0);
    g.step();
    assert.equal(g.phase, "playing");
    assert.equal(g.tick, 180);
    assert.equal(g.state.activeDurationMs, 0);
    assert.equal(g.state.countdownRemainingMs, 0);
    const b = g.state.balls[0],
      viewV = worldToViewVelocity(slot, b),
      viewP = worldToViewPoint(slot, b);
    assert.equal(b.owner, slot);
    assert.equal(viewP.y, 907);
    assert.equal(b.x, 400);
    near(Math.atan2(viewV.vx, -viewV.vy), Math.PI / 12);
    near(Math.hypot(b.vx, b.vy), 360);
    const id = b.id;
    goal(g, 1 - slot);
    assert.equal(g.state.servingSlot, slot);
    ticks(g, 119);
    assert.equal(g.phase, "goal_countdown");
    assert.equal(g.state.balls.length, 0);
    g.step();
    assert.equal(g.phase, "playing");
    assert(g.state.balls[0].id > id);
    const nextV = worldToViewVelocity(slot, g.state.balls[0]);
    near(Math.atan2(nextV.vx, -nextV.vy), -Math.PI / 12);
    near(Math.hypot(nextV.vx, nextV.vy), 360 * 1.12);
    validate(g);
  }
  assert.deepEqual([...servers].sort(), [0, 1]);
});
test("view inputs are sequenced, latest-target-only, clamped and speed-limited", () => {
  const g = playing();
  for (const slot of [0, 1])
    assert(g.applyInput(slot, { seq: 3, x: 1, action: "none" }));
  for (const seq of [3, 2, 0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1])
    assert(!g.applyInput(0, { seq, x: 0, action: "none" }));
  for (const x of [NaN, Infinity, "0.5", -1, 2])
    assert(!g.applyInput(0, { seq: 4, x, action: "none" }));
  assert(!g.applyInput(2, { seq: 4, x: 1, action: "none" }));
  assert(!g.applyInput(0, { seq: 4, x: 1, action: "launch" }));
  g.step();
  assert.equal(g.state.players[0].x, 420);
  assert.equal(g.state.players[1].x, 380);
  assert.equal(g.state.players[0].vx, 1200);
  assert.equal(g.state.players[1].vx, -1200);
  ticks(g, 15);
  assert.equal(g.state.players[0].x, 720);
  assert.equal(g.state.players[0].vx, 1200);
  assert(g.applyInput(0, { seq: 4, x: 0.89375, action: "none" })); // 715, actual final motion -5
  g.step();
  assert.equal(g.state.players[0].x, 715);
  assert.equal(g.state.players[0].vx, -300);
  assert(g.applyInput(0, { seq: 5, x: 1, action: "none" }));
  g.step();
  assert.equal(g.state.players[0].x, 720);
  assert.equal(g.state.players[0].vx, 300);
  g.step();
  assert.equal(g.state.players[0].vx, 0);
  assert(g.applyInput(0, { seq: 6, x: 0, action: "none" }));
  assert(g.applyInput(0, { seq: 7, x: 0.9, action: "fire" }));
  g.step();
  assert.equal(g.state.players[0].x, 720);
  assert.equal(g.state.players[0].lastAckInputSeq, 7);
  assert.equal(g.state.shots.length, 0);
  assert.equal(g.state.players[0].ammo, 0);
});
test("stationary, slow, and fast returns use owner-view contact position and stroke at both ends", () => {
  for (const slot of [0, 1])
    for (const travel of [0, 1, 20, -20]) {
      const g = playing(),
        sign = slot === 0 ? 1 : -1,
        p = g.state.players[slot];
      // The incoming center reaches the paddle face at exactly half a tick.
      g.state.balls = [
        ball(g, {
          x: slot === 0 ? 450 : 350,
          y: slot === 0 ? 905 : 95,
          vx: 0,
          vy: sign * 360,
          owner: 1 - slot,
        }),
      ];
      g.applyInput(slot, { seq: 1, x: (400 + travel) / 800, action: "none" });
      g.step();
      const b = g.state.balls[0],
        v = worldToViewVelocity(slot, b);
      assert.equal(b.owner, slot);
      assert(v.vy < 0);
      const expected = paddleBounce((50 - travel * 0.5) / 80, travel * 60);
      near(Math.atan2(v.vx, -v.vy), expected);
      near(Math.hypot(v.vx, v.vy), 360);
      assert(Math.abs(Math.atan2(v.vx, -v.vy)) <= 1.13);
      assert.equal(
        g.drainEvents().filter((e) => e.type === "paddle_hit").length,
        1,
      );
      g.step();
      assert.equal(
        g.drainEvents().filter((e) => e.type === "paddle_hit").length,
        0,
      );
      assert(Math.abs(p.vx) <= 1200);
    }
});
test("moving paddle collisions use contact-time coverage, not final tick position", () => {
  const g = playing();
  // Right edge travels 480->500, but the ball passes behind the face before
  // the moving corner gets within its radius. Final-position collision would catch it.
  g.state.balls = [ball(g, { x: 495, y: 917, vx: 0, vy: 360 })];
  g.applyInput(0, { seq: 1, x: 1, action: "none" });
  g.step();
  assert(g.state.balls[0].vy > 0);
  assert.equal(g.drainEvents().length, 0);
});
test("rounded corners can return approaching balls but back-side balls cannot be rescued", () => {
  for (const slot of [0, 1]) {
    const g = playing(),
      sign = slot === 0 ? 1 : -1;
    g.state.balls = [
      ball(g, {
        x: slot === 0 ? 485 : 315,
        y: slot === 0 ? 907 : 93,
        vx: 0,
        vy: sign * 360,
      }),
    ];
    g.step();
    assert(g.state.balls[0].vy * sign < 0);
    const missed = playing();
    missed.state.balls = [
      ball(missed, { x: 400, y: slot === 0 ? 924 : 76, vx: 0, vy: sign * 360 }),
    ];
    missed.step();
    assert(missed.state.balls[0].vy * sign > 0);
  }
});
test("maximum legal speed cannot tunnel and returns respect damaged width and owner speed", () => {
  for (const slot of [0, 1]) {
    const g = playing(),
      p = g.state.players[slot],
      sign = slot === 0 ? 1 : -1;
    g.state.wave = 10;
    p.damage = 3;
    p.width = 100;
    const speed = 585 * 1.36;
    g.state.balls = [
      ball(g, { x: 430, y: slot === 0 ? 900 : 100, vx: 0, vy: sign * speed }),
    ];
    g.step();
    const b = g.state.balls[0];
    assert(b.vy * sign < 0);
    near(Math.hypot(b.vx, b.vy), speed);
    const v = worldToViewVelocity(slot, b);
    near(Math.atan2(v.vx, -v.vy), paddleBounce((sign * 30) / 50, 0));
    validate(g);
  }
});
test("side walls reflect without changing speed or awarding goals", () => {
  for (const [x, vx] of [
    [11, -600],
    [789, 600],
  ]) {
    const g = playing();
    g.state.balls = [ball(g, { x, vx, vy: -200 })];
    g.step();
    const b = g.state.balls[0];
    assert(b.x >= 10 && b.x <= 790);
    assert.equal(Math.sign(b.vx), -Math.sign(vx));
    near(Math.hypot(b.vx, b.vy), Math.hypot(600, 200));
    assert.deepEqual(g.state.goals, [0, 0]);
  }
});
test("ball must fully exit; same-end exits count once, opposite exits replay independent of order", () => {
  for (const scorer of [0, 1]) {
    const g = playing(),
      sign = scorer === 0 ? -1 : 1;
    g.state.balls = [
      ball(g, { x: 0, y: scorer === 0 ? -9 : 1009, vx: 0, vy: sign * 30 }),
    ];
    g.step();
    assert.deepEqual(g.state.goals, [0, 0]);
    g.state.balls = [1, 2, 3].map(() =>
      ball(g, { y: scorer === 0 ? -11 : 1011, vy: sign * 360 }),
    );
    g.step();
    assert.equal(g.state.goals[scorer], 1);
    assert.equal(g.state.players[1 - scorer].damage, 1);
    assert.equal(g.state.servingSlot, 1 - scorer);
    assert.equal(g.state.balls.length, 0);
    assert.equal(g.drainEvents().filter((e) => e.type === "goal").length, 1);
  }
  for (const reverse of [false, true]) {
    const g = playing(),
      server = g.state.servingSlot;
    g.state.balls = [
      ball(g, { y: -11, vy: -360 }),
      ball(g, { y: 1011, vy: 360 }),
    ];
    if (reverse) g.state.balls.reverse();
    g.step();
    assert.deepEqual(g.state.goals, [0, 0]);
    assert.equal(g.state.servingSlot, server);
    assert.deepEqual(
      g.state.players.map((p) => p.damage),
      [0, 0],
    );
    assert.equal(g.phase, "goal_countdown");
    assert.equal(g.state.balls.length, 0);
    assert.deepEqual(
      g.drainEvents().map((e) => e.type),
      ["rally_replay"],
    );
  }
});
test("rally reset clears transient state while preserving damage, points and wall", () => {
  const g = playing();
  const p = g.state.players[0];
  Object.assign(p, {
    width: 240,
    points: 500,
    damage: 2,
    comboCount: 8,
    comboRemainingMs: 1000,
    ammo: 10,
    stickyCharges: 3,
    vestCharges: 2,
    shieldCharges: 1,
    fireCooldownMs: 250,
    wideRemainingMs: 1000,
    slowRemainingMs: 1000,
    shieldRemainingMs: 1000,
    invulnerabilityRemainingMs: 1000,
  });
  g.state.bricks.push({
    id: g.nextEntityId++,
    x: 20,
    y: 500,
    w: 86,
    h: 32,
    type: "armored",
    hp: 1,
    maxHp: 2,
  });
  g.state.drops.push({
    id: g.nextEntityId++,
    type: "gem",
    owner: 0,
    x: 10,
    y: 200,
    baseX: 10,
    motionPhase: 0,
  });
  g.state.shots.push({ id: g.nextEntityId++, owner: 0, x: 100, y: 300 });
  goal(g, 1);
  assert.equal(p.damage, 3);
  assert.equal(p.width, 100);
  assert.equal(p.points, 500);
  for (const key of [
    "comboCount",
    "comboRemainingMs",
    "ammo",
    "stickyCharges",
    "vestCharges",
    "shieldCharges",
    "fireCooldownMs",
    "wideRemainingMs",
    "slowRemainingMs",
    "shieldRemainingMs",
    "invulnerabilityRemainingMs",
    "vx",
  ])
    assert.equal(p[key], 0, key);
  assert.equal(p.targetX, p.x);
  assert.equal(g.state.bricks[0].hp, 1);
  assert.equal(g.state.drops.length, 0);
  assert.equal(g.state.shots.length, 0);
  ticks(g, 120);
  goal(g, 1);
  assert.equal(p.damage, 3);
  assert.equal(p.width, 100);
  validate(g);
});
test("five goals produce exactly one terminal result, which remains immutable through reads", () => {
  for (const winner of [0, 1]) {
    const g = playing();
    g.state.players[winner].points = 1234;
    for (let i = 0; i < 5; i++) {
      if (i) ticks(g, 120);
      goal(g, winner);
    }
    assert.equal(g.phase, "finished");
    assert.equal(g.state.balls.length, 0);
    const result = g.getResult();
    assert.equal(result.winner, winner);
    assert.equal(result.goals[winner], 5);
    assert.equal(result.reason, "five_goals");
    near(result.durationMs, (5 * 1000) / 60);
    assert.equal(validateServerMessage(result).ok, true);
    result.goals[winner] = 999;
    assert.equal(g.getResult().goals[winner], 5);
    assert.equal(
      g.drainEvents().filter((e) => e.type === "match_finished").length,
      1,
    );
    const final = g.getState(),
      tick = g.tick;
    ticks(g, 500);
    assert(!g.start());
    assert(!g.setPaused(true));
    assert(!g.applyInput(0, { seq: 1, x: 1, action: "none" }));
    assert.equal(g.tick, tick);
    assert.deepEqual(g.getState(), final);
    assert.deepEqual(g.drainEvents(), []);
  }
});
test("pause freezes ticks, countdowns and timers, discarding targets and paused inputs", () => {
  const g = new DuelGame({ seed: 1, matchId: "m" });
  g.start();
  ticks(g, 30);
  assert(g.setPaused(true));
  const left = g.state.countdownRemainingMs;
  ticks(g, 500);
  assert.equal(g.tick, 30);
  assert.equal(g.state.countdownRemainingMs, left);
  assert(g.setPaused(false));
  ticks(g, 150);
  assert.equal(g.phase, "playing");
  assert(g.applyInput(0, { seq: 1, x: 1, action: "none" }));
  g.step();
  assert(g.setPaused(true));
  const paused = g.getState(),
    tick = g.tick;
  assert(!g.applyInput(0, { seq: 2, x: 0, action: "fire" }));
  ticks(g, 500);
  assert.deepEqual(g.getState(), paused);
  assert.equal(g.tick, tick);
  assert(g.setPaused(false));
  g.step();
  assert.equal(g.state.players[0].x, paused.players[0].x);
  assert.equal(g.state.players[0].vx, 0);
  assert.equal(g.state.players[0].lastAckInputSeq, 1);
  goal(g, 0);
  ticks(g, 60);
  assert(g.setPaused(true));
  ticks(g, 200);
  assert(g.setPaused(false));
  ticks(g, 59);
  assert.equal(g.phase, "goal_countdown");
  g.step();
  assert.equal(g.phase, "playing");
  validate(g);
});
test("state/events detach and fixed seed plus inputs replay exactly", () => {
  const a = playing(123),
    b = playing(123);
  for (let i = 1; i <= 1200; i++) {
    for (const g of [a, b]) {
      for (const slot of [0, 1])
        g.applyInput(slot, {
          seq: i,
          x: (Math.sin(i * 0.03 + slot) + 1) / 2,
          action: "none",
        });
      g.step();
    }
    assert.deepEqual(a.getState(), b.getState());
    assert.deepEqual(a.drainEvents(), b.drainEvents());
  }
  const state = a.getState();
  state.players[0].x = -100;
  state.goals[0] = 99;
  assert.notEqual(a.state.players[0].x, -100);
  assert.notEqual(a.state.goals[0], 99);
  const g = playing();
  goal(g, 0);
  const event = g.drainEvents().find((e) => e.type === "goal");
  event.goals[0] = 99;
  assert.equal(g.state.goals[0], 1);
  assert.deepEqual(g.drainEvents(), []);
});
test("long automatic-paddle run stays finite, clamped and protocol-valid", () => {
  const g = playing(50);
  for (let i = 1; i <= 12000; i++) {
    for (const p of g.state.players) {
      const x = g.state.balls[0]?.x ?? 400;
      g.applyInput(p.slot, {
        seq: i,
        x: p.slot === 0 ? x / 800 : 1 - x / 800,
        action: "none",
      });
    }
    g.step();
    for (const p of g.state.players)
      assert(p.x >= p.width / 2 && p.x <= 800 - p.width / 2);
    for (const b of g.state.balls) {
      assert(Number.isFinite(b.x + b.y + b.vx + b.vy));
      assert(b.x >= b.r && b.x <= 800 - b.r);
    }
    if (i % 1000 === 0) validate(g);
  }
  assert(g.tick >= 10000);
  assert(g.state.activeDurationMs > 100000);
});

test("both aiming edges obey the angle cap and ownership controls speed on return", () => {
  for (const slot of [0, 1])
    for (const edge of [-1, 1]) {
      const g = playing(),
        sign = slot === 0 ? 1 : -1,
        p = g.state.players[slot];
      p.damage = 1;
      p.width = 140;
      p.slowRemainingMs = 1000;
      g.state.players[1 - slot].damage = 3;
      g.state.balls = [
        ball(g, {
          x: 400 + sign * edge * 68,
          y: slot === 0 ? 905 : 95,
          vx: 0,
          vy: sign * 360,
          owner: 1 - slot,
        }),
      ];
      g.applyInput(slot, {
        seq: 1,
        x: (400 + edge * 20) / 800,
        action: "none",
      });
      g.step();
      const b = g.state.balls[0],
        v = worldToViewVelocity(slot, b);
      assert.equal(b.owner, slot);
      assert.equal(Math.sign(v.vx), edge);
      near(Math.abs(Math.atan2(v.vx, -v.vy)), 1.13);
      near(Math.hypot(v.vx, v.vy), 360 * 1.12 * 0.65);
      // A new opponent power/damage value cannot alter this ball between returns.
      g.state.players[1 - slot].slowRemainingMs = 1000;
      g.step();
      near(Math.hypot(b.vx, b.vy), 360 * 1.12 * 0.65);
    }
});
test("opposite exits at different microsteps of one tick still cancel each other", () => {
  for (const reverse of [false, true]) {
    const g = playing();
    g.state.balls = [
      ball(g, { y: -10.1, vy: -360 }),
      ball(g, { y: 1009, vy: 360 }),
    ];
    if (reverse) g.state.balls.reverse();
    g.step();
    assert.deepEqual(g.state.goals, [0, 0]);
    assert.deepEqual(
      g.drainEvents().map((e) => e.type),
      ["rally_replay"],
    );
  }
});
