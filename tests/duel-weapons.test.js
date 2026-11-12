import test from "node:test";
import assert from "node:assert/strict";
import { DuelGame } from "../shared/duel-game.js";
import {
  WEAPON_RULES as W,
  shotBounds,
  shotSpawnY,
} from "../shared/duel-weapons.js";
import { paddleBounce } from "../shared/game-helpers.js";
import { worldToViewVelocity } from "../shared/duel-rules.js";
import { validateServerMessage } from "../shared/duel-protocol.js";

const near = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const ticks = (g, n) => {
  for (let i = 0; i < n; i++) g.step();
};
function ball(g, fields = {}) {
  return {
    id: g.nextEntityId++,
    x: 100,
    y: 200,
    vx: 0,
    vy: 0,
    r: 10,
    owner: 0,
    held: false,
    heldOffsetX: 0,
    autoReleaseRemainingMs: 0,
    ...fields,
  };
}
function brick(g, type = "standard", fields = {}) {
  const hp = {
    standard: 1,
    explosive: 1,
    armored: 2,
    reinforced: 3,
    steel: null,
  }[type];
  return {
    id: g.nextEntityId++,
    type,
    hp,
    maxHp: hp,
    x: 350,
    y: 500,
    w: 86,
    h: 32,
    r: 0,
    c: 0,
    ...fields,
  };
}
function game(seed = 18) {
  const g = new DuelGame({ seed, matchId: "weapons" });
  g.start();
  ticks(g, 180);
  g.drainEvents();
  g.random = () => 0;
  g.state.bricks = [brick(g, "standard", { x: 28 })];
  g.state.balls = [ball(g)];
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
function offer(g, type, owner = 0) {
  g.state.drops.push(drop(g, type, owner));
  g.step();
}
function held(g, owner, offset = 0) {
  return ball(g, {
    owner,
    held: true,
    heldOffsetX: offset,
    autoReleaseRemainingMs: 3000,
  });
}
function shot(g, owner = 0, fields = {}) {
  return {
    id: g.nextEntityId++,
    owner,
    x: 400,
    y: shotSpawnY(owner),
    ...fields,
  };
}
function catchBall(g, owner = 0, offset = 0) {
  const sign = owner === 0 ? 1 : -1;
  g.state.players[owner].stickyCharges = 1;
  g.state.balls = [
    ball(g, {
      x: 400 + sign * offset,
      y: owner === 0 ? 905 : 95,
      vy: sign * 360,
      owner: 1 - owner,
    }),
  ];
  g.step();
  assert(g.state.balls[0].held);
  return g.state.balls[0];
}
function validate(g) {
  assert.equal(
    validateServerMessage({
      v: 1,
      type: "snapshot",
      matchId: g.matchId,
      tick: g.tick,
      serverTime: 0,
      phase: g.phase,
      state: g.getState(),
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

test("sticky refills three catches and last-charge held balls follow both ends then release by current stroke", () => {
  for (const owner of [0, 1]) {
    const g = game();
    offer(g, "sticky", owner);
    assert.equal(g.state.players[owner].stickyCharges, 3);
    offer(g, "sticky", owner);
    assert.equal(g.state.players[owner].stickyCharges, 3);
    const b = catchBall(g, owner, 25),
      p = g.state.players[owner];
    assert.equal(p.stickyCharges, 0);
    assert.equal(b.owner, owner);
    assert.equal(b.autoReleaseRemainingMs, 3000);
    p.damage = 2;
    p.slowRemainingMs = 1000;
    assert(g.applyInput(owner, { seq: 1, x: 1, action: "release_fire" }));
    g.step();
    assert(!b.held);
    assert.equal(b.autoReleaseRemainingMs, 0);
    const v = worldToViewVelocity(owner, b);
    near(Math.atan2(v.vx, -v.vy), paddleBounce(25 / (p.width / 2), 1200));
    near(Math.hypot(b.vx, b.vy), 360 * 1.24 * 0.65);
    assert(v.vy < 0);
    ticks(g, 2);
    assert(!b.held);
    assert.equal(g.state.shots.length, 0);
    validate(g);
  }
});
test("three simultaneous catches consume exactly three charges; release-all launches every held ball and one shot", () => {
  for (const owner of [0, 1]) {
    const g = game(),
      p = g.state.players[owner],
      sign = owner === 0 ? 1 : -1;
    p.stickyCharges = 3;
    p.ammo = 1;
    g.state.balls = [-20, 0, 20].map((offset) =>
      ball(g, {
        x: 400 + offset,
        y: owner === 0 ? 905 : 95,
        vy: sign * 360,
        owner: 1 - owner,
      }),
    );
    g.step();
    assert(g.state.balls.every((b) => b.held));
    assert.equal(p.stickyCharges, 0);
    g.applyInput(owner, { seq: 1, x: 0.5, action: "release_fire" });
    g.step();
    assert(
      g.state.balls.every(
        (b) => !b.held && b.owner === owner && b.vy * sign < 0,
      ),
    );
    assert.equal(g.state.shots.length, 1);
    assert.equal(p.ammo, 0);
    const events = validate(g);
    assert.equal(events.filter((e) => e.type === "ball_released").length, 3);
    assert.equal(events.filter((e) => e.type === "shot_fired").length, 1);
  }
});
test("held offsets clamp on width expiry/damage, remain attached, and auto-release at exactly 180 ticks", () => {
  const g = game(),
    b = catchBall(g, 0, 70),
    p = g.state.players[0];
  p.wideRemainingMs = 1000;
  g.updatePaddleWidth(p);
  b.heldOffsetX = 110;
  g.followHeldBalls();
  assert.equal(b.x, 510);
  p.wideRemainingMs = 1000 / 60;
  g.step();
  assert.equal(p.width, 160);
  assert.equal(b.heldOffsetX, 70);
  g.state.drops = [drop(g, "bomb")];
  g.step();
  assert.equal(p.damage, 1);
  assert.equal(b.heldOffsetX, 60);
  assert(b.held);
  // Two playing ticks have elapsed since the original catch.
  ticks(g, 177);
  assert(b.held);
  near(b.autoReleaseRemainingMs, 1000 / 60);
  g.setPaused(true);
  const frozen = g.getState();
  ticks(g, 200);
  assert.deepEqual(g.getState(), frozen);
  g.setPaused(false);
  g.step();
  assert(!b.held);
  assert.equal(b.autoReleaseRemainingMs, 0);
  assert.equal(
    validate(g).filter((e) => e.type === "ball_released" && e.automatic).length,
    1,
  );
});
test("legacy multiball pickups award points without spawning balls", () => {
  const g = game();
  const before = g.state.balls.length;
  g.state.drops = [drop(g, "multi", 0), drop(g, "multi", 1)];
  g.step();
  assert.equal(g.state.balls.length, before);
  assert.equal(g.state.players[0].points, 500);
  assert.equal(g.state.players[1].points, 500);
});
test("ammo refills to fifteen, cooldown is exactly fifteen ticks, fire-only preserves held balls", () => {
  const g = game();
  for (let i = 0; i < 4; i++) offer(g, "bazooka");
  const p = g.state.players[0];
  assert.equal(p.ammo, 15);
  const b = catchBall(g);
  g.applyInput(0, { seq: 1, x: 0.5, action: "fire" });
  g.step();
  assert(b.held);
  assert.equal(p.ammo, 14);
  assert.equal(p.fireCooldownMs, 250);
  assert.equal(g.state.shots.length, 1);
  ticks(g, 14);
  assert(!g.fire(0));
  near(p.fireCooldownMs, 1000 / 60);
  g.step();
  assert.equal(p.fireCooldownMs, 0);
  assert(g.fire(0));
  assert.equal(p.ammo, 13);
  g.applyInput(0, { seq: 2, x: 0.5, action: "release_fire" });
  g.step();
  assert(!b.held);
  assert.equal(p.ammo, 13);
  validate(g);
});
test("sequenced action bursts coalesce and movement-only updates do not erase release or firing", () => {
  const g = game(),
    b = catchBall(g);
  g.state.players[0].ammo = 5;
  g.applyInput(0, { seq: 1, x: 0.5, action: "release_fire" });
  g.applyInput(0, { seq: 2, x: 0.5, action: "fire" });
  g.applyInput(0, { seq: 3, x: 0.5, action: "none" });
  assert(!g.applyInput(0, { seq: 1, x: 1, action: "release_fire" }));
  g.step();
  assert(!b.held);
  assert.equal(g.state.players[0].ammo, 4);
  assert.equal(g.state.players[0].lastAckInputSeq, 3);
  assert.equal(validate(g).filter((e) => e.type === "shot_fired").length, 1);
});
test("pause/countdown reject actions and freeze held/shot/cooldown state without queued resume fire", () => {
  const g = game(),
    b = catchBall(g);
  g.state.players[0].ammo = 5;
  g.fire(0);
  g.applyInput(0, { seq: 1, x: 1, action: "release_fire" });
  g.setPaused(true);
  const saved = g.getState();
  ticks(g, 90);
  assert.deepEqual(g.getState(), saved);
  assert(!g.applyInput(0, { seq: 2, x: 1, action: "release_fire" }));
  assert(!g.fire(0));
  assert(!g.releaseHeld(0));
  g.setPaused(false);
  g.step();
  assert(b.held);
  assert.equal(g.state.players[0].ammo, 4);
  const countdown = new DuelGame({ seed: 1, matchId: "countdown" });
  countdown.start();
  countdown.state.players[0].ammo = 5;
  assert(!countdown.fire(0));
  assert(!countdown.applyInput(0, { seq: 1, x: 1, action: "fire" }));
  ticks(countdown, 180);
  assert.equal(countdown.state.players[0].ammo, 5);
  assert.equal(countdown.state.shots.length, 0);
});
test("shots mirror, travel at 720, expire outside field and remain naturally bounded", () => {
  const g = game();
  g.state.players.forEach((p) => {
    p.ammo = 15;
  });
  for (let i = 1; i <= 500; i++) {
    for (const owner of [0, 1])
      g.applyInput(owner, { seq: i, x: 0.5, action: "fire" });
    g.step();
    assert(g.state.shots.length <= 12);
    if (i === 1) {
      near(g.state.shots[0].y, shotSpawnY(0) - 12);
      near(g.state.shots[1].y, shotSpawnY(1) + 12);
      near(g.state.shots[0].y + g.state.shots[1].y, 1000);
    }
  }
  assert.equal(g.state.shots.length, 0);
  assert(g.state.players.every((p) => p.ammo === 0));
  assert.deepEqual(g.state.goals, [0, 0]);
  validate(g);
});
test("shots damage every brick material once, stop at steel, and carry shooter through explosive chains", () => {
  for (const owner of [0, 1])
    for (const type of ["standard", "armored", "reinforced", "steel"]) {
      const g = game(),
        target = brick(g, type);
      g.state.bricks = [target];
      g.state.shots = [shot(g, owner, { y: owner === 0 ? 548 : 484 })];
      g.step();
      assert.equal(g.state.shots.length, 0);
      assert.equal(target.hp, type === "steel" ? null : target.maxHp - 1);
      assert.equal(
        g.state.players[owner].points,
        type === "standard" ? 100 : 0,
      );
      validate(g);
    }
  const g = game(),
    explosive = brick(g, "explosive"),
    neighbor = brick(g, "standard", { c: 1, x: 444 });
  g.state.bricks = [explosive, neighbor];
  g.state.shots = [shot(g, 1, { y: 484 })];
  g.step();
  assert.equal(g.state.players[1].points, 250);
  assert.equal(g.state.players[0].points, 0);
  assert.equal(g.state.bricks.length, 0);
  validate(g);
});
test("any shooter can intercept every hazard owner for unmultiplied points before paddle damage", () => {
  for (const owner of [0, 1])
    for (const victim of [0, 1])
      for (const type of ["bomb", "rocket", "worm"]) {
        const g = game();
        g.state.drops = [drop(g, type, victim, { y: owner === 0 ? 866 : 134 })];
        g.state.shots = [shot(g, owner)];
        g.step();
        assert.equal(g.state.drops.length, 0);
        assert.equal(g.state.shots.length, 0);
        assert.equal(g.state.players[owner].points, 100);
        assert.equal(g.state.players[owner].comboCount, 0);
        validate(g);
      }
  const g = game();
  g.state.players[0].ammo = 1;
  g.state.drops = [drop(g, "bomb")];
  g.applyInput(0, { seq: 1, x: 0.5, action: "fire" });
  g.step();
  assert.equal(g.state.players[0].damage, 0);
  assert.equal(g.state.players[0].points, 100);
  assert.equal(g.state.drops.length, 0);
});
test("each shot hits only one target and never damages prizes, balls, paddles or goals", () => {
  const g = game();
  g.state.drops = [
    drop(g, "bomb", 0, { y: 866 }),
    drop(g, "rocket", 0, { y: 800 }),
  ];
  g.state.shots = [shot(g)];
  g.step();
  assert.equal(g.state.drops.length, 1);
  assert.equal(g.state.drops[0].type, "rocket");
  assert.equal(g.state.players[0].points, 100);
  const safe = game();
  Object.assign(safe.state.balls[0], { x: 400, y: 700 });
  safe.state.drops = [drop(safe, "gem", 1, { y: 600 })];
  safe.state.shots = [shot(safe)];
  const before = structuredClone(safe.state.balls[0]);
  ticks(safe, 100);
  assert.deepEqual(safe.state.balls[0], before);
  assert.equal(safe.state.drops[0].type, "gem");
  assert(safe.state.players.every((p) => p.damage === 0 && p.points === 0));
  assert.deepEqual(safe.state.goals, [0, 0]);
});
test("two shooters resolve chronologically then by shot ID at ties, independent of array order", () => {
  for (const tie of [false, true])
    for (const reverse of [false, true]) {
      const g = game(),
        target = brick(g, "armored");
      g.state.bricks = [target];
      const a = shot(g, 0, { y: tie ? 548 : 551 }),
        b = shot(g, 1, { y: tie ? 484 : 487 });
      g.state.shots = reverse ? [b, a] : [a, b];
      g.step();
      assert.equal(g.state.players[tie ? 1 : 0].points, 250);
      assert.equal(g.state.players[tie ? 0 : 1].points, 0);
      assert.equal(g.state.shots.length, 0);
      validate(g);
    }
});
test("mixed ball/shot exact-time contact uses global entity ID and never damages a stale dead brick", () => {
  for (const shotFirst of [false, true]) {
    const g = game(),
      target = brick(g);
    g.state.bricks = [target];
    let b, s;
    const makeBall = () => ball(g, { x: 390, y: 486, vy: 360, owner: 0 });
    const makeShot = () => shot(g, 1, { x: 390, y: 482 });
    if (shotFirst) {
      s = makeShot();
      b = makeBall();
    } else {
      b = makeBall();
      s = makeShot();
    }
    g.state.balls = [b];
    g.state.shots = [s];
    g.step();
    assert.equal(g.state.players[shotFirst ? 1 : 0].points, 100);
    assert.equal(g.state.players[shotFirst ? 0 : 1].points, 0);
    assert.equal(b.vy > 0, shotFirst);
    assert.equal(g.state.shots.length, shotFirst ? 0 : 1);
    validate(g);
  }
});
test("wave repair preserves ammo/held/charges and live shots; correct shot bounds gate spawning", () => {
  const g = game();
  g.state.balls = [held(g, 0, 60)];
  g.followHeldBalls();
  g.state.players[0].ammo = 5;
  g.state.players[0].stickyCharges = 2;
  g.state.players[0].damage = 3;
  g.state.bricks = [];
  g.step();
  ticks(g, 119);
  assert.equal(g.pendingWall.ticks, 1);
  const projectile = shot(g, 1, { x: 200, y: 200 });
  g.state.shots = [projectile];
  g.step();
  assert.equal(g.state.wave, 2);
  assert(g.state.balls[0].held);
  assert.equal(g.state.players[0].damage, 0);
  assert.equal(g.state.players[0].ammo, 5);
  assert.equal(g.state.players[0].stickyCharges, 2);
  assert.equal(g.state.shots[0].id, projectile.id);
  validate(g);
  assert.deepEqual(shotBounds({ x: 400, y: 106, owner: 1 }), {
    x: 396,
    y: 89,
    w: 8,
    h: 27,
  });
});
test("any goal, including terminal goal with a last-brick shot, clears all weapons and held balls", () => {
  for (const terminal of [false, true]) {
    const g = game(),
      target = brick(g);
    g.state.bricks = [target];
    g.state.goals[1] = terminal ? 4 : 0;
    g.state.balls = [held(g, 0), ball(g, { y: 1011, vy: 360 })];
    g.followHeldBalls();
    g.state.players[0].ammo = 5;
    g.state.players[0].stickyCharges = 2;
    g.state.shots = [shot(g, 0, { y: 548 })];
    g.step();
    assert.equal(g.state.goals[1], terminal ? 5 : 1);
    assert.equal(g.state.players[0].points, 100);
    assert.equal(g.phase, "playing");
    assert.equal(g.state.balls.length, 1);
    Object.assign(g.state.balls[0], { held: false, y: 1011, vy: 360 });
    g.step();
    assert.equal(g.state.balls.length, 0);
    assert.equal(g.state.shots.length, 0);
    assert.equal(g.state.players[0].ammo, 0);
    assert.equal(g.state.players[0].stickyCharges, 0);
    assert.equal(g.state.players[0].fireCooldownMs, 0);
    assert(g.pendingActions.every((p) => !p.fire && !p.release));
    if (terminal) {
      assert.equal(g.getResult().points[0], 100);
      assert.equal(g.getResult().winner, 1);
    }
    validate(g);
  }
});
test("mixed seeded power/action replay is deterministic and bounded", () => {
  const a = game(123),
    b = game(123);
  let shotsObserved = false,
    splitObserved = false;
  for (let i = 1; i <= 1200; i++) {
    for (const g of [a, b]) {
      if (g.phase === "playing" && i % 90 === 1)
        for (const owner of [0, 1])
          for (const type of ["sticky", "bazooka", "multi"])
            g.state.drops.push(drop(g, type, owner));
      for (const owner of [0, 1])
        g.applyInput(owner, {
          seq: i,
          x: 0.5,
          action: i % 2 ? "fire" : "release_fire",
        });
      g.step();
      assert(g.state.balls.length <= 3);
      assert(g.state.shots.length <= 12);
      if (g.state.shots.length) shotsObserved = true;
      if (g.state.balls.length > 1) splitObserved = true;
    }
    assert.deepEqual(a.getState(), b.getState());
    assert.deepEqual(a.drainEvents(), b.drainEvents());
  }
  assert(shotsObserved);
  validate(a);
  validate(b);
});
