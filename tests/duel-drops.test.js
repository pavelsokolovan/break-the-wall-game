import test from "node:test";
import assert from "node:assert/strict";
import { DuelGame } from "../shared/duel-game.js";
import {
  duelDropType,
  dropHalfExtents,
  moveDuelDrop,
  DROP_RULES,
  HAZARDS,
} from "../shared/duel-drops.js";
import { canSpawnWall } from "../shared/duel-walls.js";
import { validateServerMessage } from "../shared/duel-protocol.js";

const near = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const ticks = (g, n) => {
  for (let i = 0; i < n; i++) g.step();
};
function game(seed = 5) {
  const g = new DuelGame({ seed, matchId: "drops" });
  g.start();
  ticks(g, 180);
  g.drainEvents();
  Object.assign(g.state.balls[0], { x: 100, y: 200, vx: 0, vy: 0 });
  return g;
}
function drop(g, type, owner = 0, fields = {}) {
  return {
    id: g.nextEntityId++,
    type,
    owner,
    x: 400,
    y: owner === 0 ? 906 : 94,
    baseX: fields.x ?? 400,
    motionPhase: 0,
    ...fields,
  };
}
function offer(g, type, owner = 0, fields = {}) {
  const d = drop(g, type, owner, fields);
  g.state.drops.push(d);
  g.step();
  return d;
}
function brick(g, type = "standard", fields = {}) {
  const hp = type === "steel" ? null : type === "armored" ? 2 : 1;
  return {
    id: g.nextEntityId++,
    type,
    hp,
    maxHp: hp,
    x: 350,
    y: 500,
    r: 0,
    c: 0,
    w: 86,
    h: 32,
    ...fields,
  };
}
function validate(g) {
  const clean = g.getState();
  assert.equal(
    validateServerMessage({
      v: 1,
      type: "snapshot",
      matchId: g.matchId,
      tick: g.tick,
      serverTime: 0,
      phase: g.phase,
      state: clean,
    }).ok,
    true,
  );
  const events = g.drainEvents();
  assert.equal(
    validateServerMessage({
      v: 1,
      type: "events",
      matchId: g.matchId,
      items: events,
    }).ok,
    true,
  );
  return events;
}

test("duel roll ranges enable all outcomes with their exact probabilities", () => {
  const counts = {};
  for (let i = 0; i < 10000; i++) {
    const type = duelDropType((i + 0.5) / 10000);
    counts[type] = (counts[type] || 0) + 1;
  }
  assert.deepEqual(counts, {
    null: 5600,
    sticky: 300,
    bazooka: 300,
    multi: 400,
    gem: 1000,
    wide: 500,
    slow: 600,
    shield: 300,
    repair: 100,
    vest: 300,
    bomb: 200,
    rocket: 200,
    worm: 200,
  });
  assert.deepEqual(
    [0.56, 0.59, 0.62, 0.72, 0.77, 0.83, 0.86, 0.9, 0.91, 0.94, 0.96, 0.98].map(
      (r) => duelDropType(r),
    ),
    [
      "sticky",
      "bazooka",
      "gem",
      "wide",
      "slow",
      "shield",
      "multi",
      "repair",
      "vest",
      "bomb",
      "rocket",
      "worm",
    ],
  );
  for (const r of [NaN, Infinity, -1, 1, "0.5", undefined])
    assert.throws(() => duelDropType(r));
  for (const r of [0.95, 0.97, 0.99]) assert.equal(duelDropType(r, true), null);
  assert.equal(duelDropType(0.65, true), "gem");
});
test("exactly one roll per destroyed brick, none for armor/steel hits; blast drops inherit owner", () => {
  const g = game();
  let rolls = 0;
  g.random = () => {
    rolls++;
    return 0.65;
  };
  const armor = brick(g, "armored"),
    steel = brick(g, "steel", { c: 4 });
  g.state.bricks = [armor, steel];
  g.hitBrick(armor.id, 0);
  g.hitBrick(steel.id, 0);
  assert.equal(rolls, 0);
  g.hitBrick(armor.id, 0);
  assert.equal(rolls, 1);
  assert.equal(g.state.drops[0].owner, 0);
  const explosive = brick(g, "explosive"),
    neighbor = brick(g, "standard", { c: 1, x: 444 });
  g.state.bricks = [explosive, neighbor];
  g.hitBrick(explosive.id, 1);
  assert.equal(rolls, 3);
  assert.deepEqual(
    g.state.drops.map((d) => d.owner),
    [0, 1, 1],
  );
  assert.equal(new Set(g.state.drops.map((d) => d.id)).size, 3);
  assert.equal(g.state.drops[1].x, explosive.x + explosive.w / 2);
  validate(g);
});
test("three hazards per owner are enforced independently without rerolling suppressed outcomes", () => {
  const g = game();
  let rolls = 0;
  g.random = () => {
    rolls++;
    return 0.99;
  };
  for (const owner of [0, 1])
    for (let i = 0; i < 5; i++) {
      const b = brick(g);
      g.state.bricks = [b];
      g.hitBrick(b.id, owner);
    }
  assert.equal(rolls, 10);
  for (const owner of [0, 1])
    assert.equal(g.state.drops.filter((d) => d.owner === owner).length, 3);
  g.random = () => 0.65;
  const b = brick(g);
  g.state.bricks = [b];
  g.hitBrick(b.id, 0);
  assert.equal(g.state.drops.at(-1).type, "gem");
  validate(g);
});
test("drop speeds and worm weaving mirror for both owners; misses leave without penalty", () => {
  for (const [type, speed] of [
    ["gem", 150],
    ["bomb", 150],
    ["rocket", 260],
    ["worm", 110],
  ]) {
    const a = { type, owner: 0, x: 100, baseX: 100, y: 500, motionPhase: 0 },
      b = { ...a, owner: 1, x: 700, baseX: 700 };
    for (let i = 0; i < 60; i++) {
      moveDuelDrop(a, 1 / 60);
      moveDuelDrop(b, 1 / 60);
      near(a.x + b.x, 800);
      near(a.y + b.y, 1000);
      assert(
        a.x >= dropHalfExtents(type).x && b.x <= 800 - dropHalfExtents(type).x,
      );
    }
    near(a.y, 500 + speed);
    if (type === "worm") assert.notEqual(a.x, a.baseX);
    const g = game();
    for (const owner of [0, 1])
      g.state.drops.push(
        drop(g, type, owner, {
          x: 100,
          y:
            owner === 0
              ? 1001 + dropHalfExtents(type).y
              : -1 - dropHalfExtents(type).y,
        }),
      );
    g.step();
    assert.equal(g.state.drops.length, 0);
    assert.deepEqual(g.state.goals, [0, 0]);
    assert(g.state.players.every((p) => p.points === 0 && p.damage === 0));
  }
});
test("gems and Repair conversions give unmultiplied points without refreshing combos", () => {
  const g = game();
  g.random = () => 0;
  g.hitBrick(g.state.bricks[0].id, 0);
  const before = g.state.players[0].points;
  offer(g, "gem");
  const p = g.state.players[0];
  assert.equal(p.points, before + 500);
  assert.equal(p.comboCount, 1);
  near(p.comboRemainingMs, 2000 - 1000 / 60);
  offer(g, "repair");
  assert.equal(p.points, before + 1500);
  assert.equal(p.comboCount, 1);
  assert.equal(p.damage, 0);
  assert(!Object.hasOwn(g.state, "lives"));
  validate(g);
});
test("wide uses damaged base, refreshes without stacking, expires exactly and freezes on pause", () => {
  const g = game(),
    p = g.state.players[0];
  p.damage = 3;
  offer(g, "wide");
  assert.equal(p.width, 150);
  assert.equal(p.wideRemainingMs, 12000);
  ticks(g, 60);
  near(p.wideRemainingMs, 11000);
  offer(g, "wide");
  assert.equal(p.width, 150);
  assert.equal(p.wideRemainingMs, 12000);
  ticks(g, 719);
  assert(p.wideRemainingMs > 0);
  assert.equal(p.width, 150);
  g.setPaused(true);
  const left = p.wideRemainingMs;
  ticks(g, 200);
  assert.equal(p.wideRemainingMs, left);
  g.setPaused(false);
  g.step();
  assert.equal(p.wideRemainingMs, 0);
  assert.equal(p.width, 100);
  validate(g);
});
test("Repair removes one damage, honors wide, clamps geometry and never alters flight speed", () => {
  const g = game(),
    p = g.state.players[0];
  p.damage = 2;
  p.x = 60;
  p.targetX = 60;
  const b = g.state.balls[0];
  b.vx = 120;
  offer(g, "wide", 0, { x: 100 });
  assert.equal(p.width, 180);
  assert.equal(p.x, 90);
  assert.equal(p.vx, 0);
  offer(g, "repair", 0, { x: 100 });
  assert.equal(p.damage, 1);
  assert.equal(p.width, 210);
  assert.equal(p.x, 105);
  near(Math.hypot(b.vx, b.vy), 120);
  offer(g, "repair", 0, { x: 110 });
  assert.equal(p.damage, 0);
  assert.equal(p.width, 240);
  assert.equal(p.x, 120);
  validate(g);
});
test("slow belongs to return owner, refreshes/expires, and never changes existing flight velocity", () => {
  for (const owner of [0, 1]) {
    const g = game(),
      p = g.state.players[owner],
      b = g.state.balls[0];
    b.owner = owner;
    b.vx = 120;
    offer(g, "slow", owner);
    assert.equal(p.slowRemainingMs, 10000);
    near(Math.hypot(b.vx, b.vy), 120);
    near(g.ballSpeed(owner), 360 * 0.65);
    near(g.ballSpeed(1 - owner), 360);
    offer(g, "slow", owner);
    assert.equal(p.slowRemainingMs, 10000);
    Object.assign(b, {
      x: 400,
      y: owner === 0 ? 906 : 94,
      vx: 0,
      vy: owner === 0 ? 360 : -360,
      owner: 1 - owner,
    });
    g.step();
    assert.equal(b.owner, owner);
    near(Math.hypot(b.vx, b.vy), 360 * 0.65);
    Object.assign(b, { x: 100, y: 200, vx: 120, vy: 0 });
    p.slowRemainingMs = 1000 / 60;
    g.step();
    assert.equal(p.slowRemainingMs, 0);
    near(Math.hypot(b.vx, b.vy), 120);
    near(g.ballSpeed(owner), 360);
  }
});
test("simultaneous shield/vest pickups protect before hazards in stable order, shield first", () => {
  for (const reverse of [false, true]) {
    const g = game();
    g.state.drops = ["bomb", "rocket", "worm", "vest", "shield"].map((type) =>
      drop(g, type),
    );
    if (reverse) g.state.drops.reverse();
    g.step();
    const p = g.state.players[0];
    assert.equal(p.damage, 0);
    assert.equal(p.shieldCharges, 0);
    assert.equal(p.vestCharges, 0);
    assert.equal(g.state.drops.length, 0);
    assert.deepEqual(
      validate(g)
        .filter((e) => e.type === "hazard_blocked")
        .map((e) => e.defense),
      ["shield", "vest", "vest"],
    );
  }
});
test("shield refresh/expiry and vest refill/persistence are independent", () => {
  const g = game(),
    p = g.state.players[0];
  offer(g, "shield");
  ticks(g, 30);
  offer(g, "shield");
  assert.equal(p.shieldCharges, 1);
  assert.equal(p.shieldRemainingMs, 15000);
  ticks(g, 899);
  assert(p.shieldRemainingMs > 0);
  g.step();
  assert.equal(p.shieldRemainingMs, 0);
  assert.equal(p.shieldCharges, 0);
  offer(g, "vest");
  ticks(g, 1000);
  assert.equal(p.vestCharges, 2);
  offer(g, "bomb");
  assert.equal(p.vestCharges, 1);
  assert.equal(p.damage, 0);
  offer(g, "vest");
  assert.equal(p.vestCharges, 2);
  validate(g);
});
test("hazards damage at most once per player per tick without resetting rally, with exact invulnerability", () => {
  const g = game(),
    ballId = g.state.balls[0].id;
  for (const owner of [0, 1])
    for (const type of ["bomb", "rocket", "worm"])
      g.state.drops.push(drop(g, type, owner));
  g.step();
  assert.deepEqual(
    g.state.players.map((p) => p.damage),
    [1, 1],
  );
  assert(g.state.players.every((p) => p.invulnerabilityRemainingMs === 1000));
  assert.equal(g.phase, "playing");
  assert.equal(g.state.balls[0].id, ballId);
  assert.deepEqual(g.state.goals, [0, 0]);
  assert.equal(validate(g).filter((e) => e.type === "hazard_damage").length, 2);
  ticks(g, 58);
  offer(g, "vest");
  assert.equal(g.state.players[0].invulnerabilityRemainingMs > 0, true);
  // This is the 60th playing tick after damage: expiry permits another hit.
  offer(g, "bomb");
  assert.equal(g.state.players[0].damage, 1);
  assert.equal(g.state.players[0].vestCharges, 1);
  g.state.players[0].vestCharges = 0;
  offer(g, "bomb");
  assert.equal(g.state.players[0].damage, 2);
  offer(g, "vest");
  offer(g, "rocket");
  assert.equal(g.state.players[0].vestCharges, 2); // invulnerability does not waste armor
  g.state.players[0].invulnerabilityRemainingMs = 0;
  g.state.players[0].vestCharges = 0;
  g.state.players[0].damage = 3;
  offer(g, "worm");
  assert.equal(g.state.players[0].damage, 3);
  assert.equal(g.state.players[0].width, 100);
  assert.equal(g.state.players[0].invulnerabilityRemainingMs, 1000);
  validate(g);
});
test("opponent overlaps never catch or damage; swept moving-paddle catches work at both ends", () => {
  for (const owner of [0, 1]) {
    const g = game(),
      opponent = g.state.players[1 - owner];
    opponent.shieldCharges = 1;
    opponent.shieldRemainingMs = 10000;
    for (const type of ["gem", "repair", "bomb", "rocket", "worm"])
      g.state.drops.push(drop(g, type, owner, { y: owner === 0 ? 73 : 927 }));
    g.step();
    assert.equal(g.state.drops.length, 5);
    assert.equal(opponent.shieldCharges, 1);
    assert.equal(opponent.damage, 0);
    assert(g.state.players.every((p) => p.points === 0));
    g.state.drops = [
      drop(g, "rocket", owner, {
        x: owner === 0 ? 322 : 478,
        y: owner === 0 ? 898 : 102,
      }),
    ];
    g.applyInput(owner, { seq: 1, x: 1, action: "none" });
    g.step();
    assert.equal(g.state.players[owner].damage, 1);
    assert.equal(g.state.drops.length, 0);
    validate(g);
  }
});
test("wide pickup expands same-tick hazard coverage after beneficial catches", () => {
  const g = game();
  g.state.drops = [drop(g, "bomb", 0, { x: 510 }), drop(g, "wide")];
  g.step();
  assert.equal(g.state.players[0].damage, 1);
  assert.equal(g.state.players[0].width, 210);
  assert.equal(g.state.players[0].wideRemainingMs, 12000);
  assert.equal(g.state.drops.length, 0);
});
test("goal suppresses hazard damage/armor use while keeping pickup points and Repair-before-goal", () => {
  const g = game(),
    p = g.state.players[0];
  p.shieldCharges = 1;
  p.shieldRemainingMs = 10000;
  p.damage = 2;
  g.state.drops = [drop(g, "bomb"), drop(g, "gem"), drop(g, "repair")];
  Object.assign(g.state.balls[0], { y: 1011, vy: 360 });
  g.step();
  assert.equal(p.damage, 2);
  assert.equal(p.points, 500);
  assert.equal(p.shieldCharges, 0);
  assert.equal(p.invulnerabilityRemainingMs, 0);
  assert.equal(g.state.goals[1], 1);
  const events = validate(g);
  assert(
    !events.some(
      (e) => e.type === "hazard_damage" || e.type === "hazard_blocked",
    ),
  );
  assert.equal(g.state.drops.length, 0);
});
test("countdown and pause freeze all powers and drop motion; wave guards honor actual hazard sizes", () => {
  const g = new DuelGame({ seed: 1, matchId: "frozen" });
  g.start();
  const p = g.state.players[0];
  Object.assign(p, {
    shieldCharges: 1,
    shieldRemainingMs: 10000,
    wideRemainingMs: 10000,
    slowRemainingMs: 10000,
    invulnerabilityRemainingMs: 1000,
  });
  g.state.drops = [drop(g, "worm", 0, { y: 600 })];
  const saved = structuredClone(g.state.drops);
  ticks(g, 180);
  assert.deepEqual(g.state.drops, saved);
  assert.equal(p.wideRemainingMs, 10000);
  g.setPaused(true);
  const paused = g.getState();
  ticks(g, 100);
  assert.deepEqual(g.getState(), paused);
  const wall = [{ x: 100, y: 400, w: 86, h: 32 }];
  assert(
    !canSpawnWall(wall, {
      balls: [],
      shots: [],
      drops: [{ type: "worm", x: 76, y: 410 }],
    }),
  );
  assert(
    !canSpawnWall(wall, {
      balls: [],
      shots: [],
      drops: [{ type: "rocket", x: 120, y: 382 }],
    }),
  );
});
test("seeded destruction/drop/motion replay stays identical with bounded per-owner hazards", () => {
  const a = game(88),
    b = game(88);
  let observed = false;
  for (let i = 0; i < 1800; i++) {
    for (const g of [a, b]) {
      if (i % 10 === 0) {
        const target = g.state.bricks.find((b) => b.type !== "steel");
        if (target) g.hitBrick(target.id, Math.floor(i / 10) % 2);
      }
      g.step();
      if (g.state.drops.length) observed = true;
      for (const owner of [0, 1])
        assert(
          g.state.drops.filter((d) => d.owner === owner && HAZARDS.has(d.type))
            .length <= DROP_RULES.hazardsPerOwner,
        );
    }
    assert.deepEqual(a.getState(), b.getState());
    assert.deepEqual(a.drainEvents(), b.drainEvents());
  }
  assert(observed);
  validate(a);
  validate(b);
});
