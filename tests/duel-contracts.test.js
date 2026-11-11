import test from "node:test";
import assert from "node:assert/strict";
import {
  DUEL_RULES,
  worldToViewPoint,
  viewToWorldPoint,
  worldToViewRect,
  worldToViewVelocity,
  viewInputToWorldX,
  normalizeRoomCode,
} from "../shared/duel-rules.js";
import {
  parseClientMessage,
  validateServerMessage,
  toPublicDuelState,
} from "../shared/duel-protocol.js";

function state() {
  return {
    wave: 1,
    goals: [0, 0],
    servingSlot: 0,
    countdownRemainingMs: 3000,
    activeDurationMs: 0,
    pause: null,
    players: [0, 1].map((slot) => ({
      slot,
      x: 400,
      targetX: 400,
      vx: 0,
      width: 160,
      damage: 0,
      points: 0,
      comboCount: 0,
      comboRemainingMs: 0,
      shieldCharges: 0,
      vestCharges: 0,
      stickyCharges: 0,
      ammo: 0,
      fireCooldownMs: 0,
      wideRemainingMs: 0,
      slowRemainingMs: 0,
      shieldRemainingMs: 0,
      invulnerabilityRemainingMs: 0,
      connected: true,
      lastAckInputSeq: 0,
    })),
    balls: [],
    bricks: [],
    drops: [],
    shots: [],
  };
}
const snapshot = (s = state()) => ({
  v: 1,
  type: "snapshot",
  matchId: "m1",
  tick: 0,
  serverTime: 10,
  phase: "countdown",
  state: s,
});
const brick = (type = "standard") => ({
  id: 2,
  x: 28,
  y: 500,
  w: 86,
  h: 32,
  type,
  hp: 1,
  maxHp: 1,
});
const ball = {
  id: 1,
  x: 400,
  y: 900,
  vx: 20,
  vy: -360,
  r: 10,
  owner: 0,
  held: false,
  heldOffsetX: 0,
  autoReleaseRemainingMs: 0,
};

test("coordinate transforms preserve geometry and round-trip for both seats", () => {
  for (const slot of [0, 1]) {
    const p = { x: 123, y: 456 },
      rect = { x: 100, y: 64, w: 160, h: 18 },
      v = { vx: 50, vy: -360 };
    assert.deepEqual(viewToWorldPoint(slot, worldToViewPoint(slot, p)), p);
    assert.deepEqual(worldToViewRect(slot, worldToViewRect(slot, rect)), rect);
    assert.deepEqual(
      worldToViewVelocity(slot, worldToViewVelocity(slot, v)),
      v,
    );
    assert.notEqual(worldToViewPoint(slot, p), p);
    assert.deepEqual(
      [0, 0.5, 1].map((x) => viewInputToWorldX(slot, x)),
      slot === 0 ? [0, 400, 800] : [800, 400, 0],
    );
  }
  assert.deepEqual(worldToViewRect(1, { x: 100, y: 64, w: 160, h: 18 }), {
    x: 540,
    y: 918,
    w: 160,
    h: 18,
  });
  assert.deepEqual(worldToViewVelocity(1, { vx: 50, vy: -360 }), {
    vx: -50,
    vy: 360,
  });
  assert(Object.isFrozen(DUEL_RULES));
  assert(Object.isFrozen(DUEL_RULES.paddleTopY));
});
test("programmer geometry errors reject non-finite, coerced and out-of-range values", () => {
  for (const slot of [-1, 2, "0", null])
    assert.throws(() => worldToViewPoint(slot, { x: 0, y: 0 }));
  for (const x of [NaN, Infinity, -Infinity, "5", undefined]) {
    assert.throws(() => worldToViewPoint(0, { x, y: 0 }));
    assert.throws(() => worldToViewRect(0, { x: 0, y: 0, w: x, h: 18 }));
    assert.throws(() => worldToViewVelocity(0, { vx: x, vy: 0 }));
    assert.throws(() => viewInputToWorldX(0, x));
  }
  for (const x of [-0.01, 1.01]) assert.throws(() => viewInputToWorldX(1, x));
});
test("room code normalization enforces the unambiguous alphabet", () => {
  assert.equal(normalizeRoomCode(" abc234 "), "ABC234");
  for (const value of [
    "ABC23",
    "ABC2345",
    "ABI234",
    "ABO234",
    "ABC014",
    "AB C23",
    null,
    123456,
  ])
    assert.equal(normalizeRoomCode(value), null);
});
test("all client types validate and project only known fields", () => {
  const fixtures = [
    { type: "create", requestId: "c1" },
    { type: "join", requestId: "j1", code: " abc234 " },
    { type: "resume", requestId: "r1", code: "ABC234", token: "opaque" },
    { type: "ready", ready: true },
    ...["none", "release_fire", "fire"].map((action) => ({
      type: "input",
      seq: 1,
      x: 0.5,
      action,
    })),
    { type: "pause", requested: true },
    { type: "resume_play" },
    { type: "rematch", ready: false },
    { type: "leave" },
    { type: "ping", id: 0, clientTime: 123 },
  ];
  for (const fixture of fixtures) {
    const result = parseClientMessage(
      JSON.stringify({ v: 1, ...fixture, score: 999 }),
    );
    assert.equal(result.ok, true, fixture.type);
    assert(!Object.hasOwn(result.value, "score"));
    if (fixture.code) assert.equal(result.value.code, "ABC234");
  }
});
test("malformed client data fails safely with bounded errors", () => {
  const invalid = [
    "{",
    "null",
    "[]",
    "42",
    "{}",
    JSON.stringify({ v: 1, type: "toString" }),
  ];
  for (const changes of [
    { seq: 0 },
    { seq: -1 },
    { seq: 1.5 },
    { seq: Number.MAX_SAFE_INTEGER + 1 },
    { x: "0.5" },
    { x: 1.01 },
    { x: -0.1 },
    { x: null },
    { action: "launch" },
  ])
    invalid.push(
      JSON.stringify({
        v: 1,
        type: "input",
        seq: 1,
        x: 0.5,
        action: "none",
        ...changes,
      }),
    );
  for (const text of invalid)
    assert.equal(parseClientMessage(text).code, "BAD_MESSAGE");
  for (const [field, size] of [
    ["requestId", 65],
    ["token", 257],
  ]) {
    const message = {
      v: 1,
      type: "resume",
      requestId: "r",
      code: "ABC234",
      token: "t",
      [field]: "x".repeat(size),
    };
    assert.equal(parseClientMessage(JSON.stringify(message)).ok, false);
  }
  assert.equal(
    parseClientMessage('{"v":2,"type":"leave"}').code,
    "VERSION_MISMATCH",
  );
  assert.equal(parseClientMessage({ v: 1, type: "leave" }).ok, false);
});
test("all server types and Stage 2 events validate", () => {
  const fixtures = [
    {
      type: "welcome",
      requestId: "c1",
      code: "ABC234",
      playerId: "p0",
      slot: 0,
      token: "opaque",
      matchId: null,
      nextInputSeq: 1,
    },
    {
      type: "room",
      code: "ABC234",
      phase: "lobby",
      players: [0, 1].map((slot) => ({
        slot,
        connected: slot === 0,
        ready: false,
      })),
    },
    snapshot(),
    {
      type: "events",
      matchId: "m1",
      items: [
        { id: 1, tick: 1, type: "serve", servingSlot: 0 },
        { id: 2, tick: 2, type: "paddle_hit", slot: 1, ballId: 1 },
        { id: 3, tick: 3, type: "goal", scorer: 0, goals: [1, 0] },
        { id: 4, tick: 4, type: "rally_replay", servingSlot: 0 },
        {
          id: 5,
          tick: 5,
          type: "match_finished",
          winner: 0,
          reason: "five_goals",
        },
      ],
    },
    {
      type: "result",
      matchId: "m1",
      winner: null,
      reason: "time_limit",
      goals: [2, 2],
      points: [50, 20],
      durationMs: 900000,
      waveCount: 2,
    },
    { type: "error", code: "AUTH_FAILED", message: "Unable to resume." },
    { type: "pong", id: 1, clientTime: 5, serverTime: 10 },
  ];
  for (const fixture of fixtures)
    assert.equal(
      validateServerMessage({ v: 1, ...fixture }).ok,
      true,
      fixture.type,
    );
  assert.equal(
    validateServerMessage({ v: 2, type: "pong" }).code,
    "VERSION_MISMATCH",
  );
  assert.equal(
    validateServerMessage({
      v: 1,
      type: "error",
      code: "BAD_MESSAGE",
      message: "x".repeat(257),
    }).ok,
    false,
  );
});
test("complete entity snapshots and pause state serialize as detached public data", () => {
  const s = state();
  s.balls.push({ ...ball });
  s.bricks.push({
    ...brick("steel"),
    hp: Infinity,
    maxHp: Infinity,
    token: "private",
  });
  s.drops.push({
    id: 3,
    type: "repair",
    owner: 1,
    x: 200,
    y: 500,
    baseX: 200,
    motionPhase: 0,
  });
  s.shots.push({ id: 4, owner: 0, x: 400, y: 800 });
  s.pause = {
    reason: "reconnect",
    deadlineServerTime: 30000,
    resumePhase: "playing",
  };
  s.token = "secret";
  s.rng = () => 0;
  s.players[0].socket = { private: true };
  const clean = toPublicDuelState(s);
  assert.equal(validateServerMessage(snapshot(clean)).ok, true);
  assert.equal(clean.bricks[0].hp, null);
  assert(!JSON.stringify(clean).includes("private"));
  assert(!Object.hasOwn(clean, "token"));
  assert(!Object.hasOwn(clean, "rng"));
  clean.players[0].x = 12;
  clean.goals[0] = 3;
  clean.balls[0].x = 12;
  clean.pause.reason = "manual";
  assert.equal(s.players[0].x, 400);
  assert.equal(s.goals[0], 0);
  assert.equal(s.balls[0].x, 400);
  assert.equal(s.pause.reason, "reconnect");
});
test("invalid nested snapshots, duplicate IDs and unordered events are rejected", () => {
  const variants = [
    (s) => {
      s.players[0].slot = 1;
    },
    (s) => {
      s.players[0].vx = Infinity;
    },
    (s) => {
      s.bricks.push(brick("steel"));
    },
    (s) => {
      s.bricks.push({ ...brick(), hp: null });
    },
    (s) => {
      s.balls.push({ ...ball }, { ...ball });
    },
    (s) => {
      s.balls.push({ ...ball, id: 2 });
      s.bricks.push(brick());
    },
    (s) => {
      s.shots.push({ id: 4, owner: 2, x: 1, y: 1 });
    },
    (s) => {
      s.balls = Array(1);
    },
  ];
  for (const mutate of variants) {
    const s = state();
    mutate(s);
    assert.equal(validateServerMessage(snapshot(s)).ok, false);
  }
  const s = state();
  s.players[0].x = NaN;
  assert.throws(() => toPublicDuelState(s));
  assert.equal(
    validateServerMessage({
      v: 1,
      type: "events",
      matchId: "m1",
      items: [2, 1].map((id) => ({
        id,
        tick: 1,
        type: "serve",
        servingSlot: 0,
      })),
    }).ok,
    false,
  );
});

test("shared modules bundle for browsers through Vite without output files", async () => {
  const { build } = await import("vite");
  const { fileURLToPath } = await import("node:url");
  const entry = (name) =>
    fileURLToPath(new URL(`../shared/${name}.js`, import.meta.url));
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: {
          rules: entry("duel-rules"),
          protocol: entry("duel-protocol"),
          simulation: entry("duel-game"),
        },
        formats: ["es"],
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  assert(
    outputs.some((result) =>
      result.output.some(
        (chunk) =>
          chunk.type === "chunk" && chunk.code.includes("class DuelGame"),
      ),
    ),
  );
  assert(
    outputs.some((result) =>
      result.output.some(
        (chunk) =>
          chunk.type === "chunk" &&
          chunk.code.includes("validateServerMessage"),
      ),
    ),
  );
});
