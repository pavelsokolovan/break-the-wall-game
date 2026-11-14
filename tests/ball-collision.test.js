import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  advanceBallPairs,
  resolveBallPair,
  sweepBalls,
} from "../shared/ball-collision.js";
import { Game, MAX_SOLO_BALLS } from "../src/game.js";
import { ArenaGame } from "../shared/arena-game.js";
import { DuelGame } from "../shared/duel-game.js";
import { renderBonuses } from "../src/bonus-ui.js";
const near = (a, b, tolerance = 1e-6) =>
  assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const ball = (id, x, y, vx, vy, extra = {}) => ({
  id,
  x,
  y,
  vx,
  vy,
  r: 10,
  owner: id % 2,
  ...extra,
});
const energy = (balls) =>
  balls.reduce((s, b) => s + b.vx * b.vx + b.vy * b.vy, 0);
const momentum = (balls) => [
  balls.reduce((s, b) => s + b.vx, 0),
  balls.reduce((s, b) => s + b.vy, 0),
];
const ticks = (g, n) => {
  for (let i = 0; i < n; i++) g.step();
};

test("swept equal-mass impacts prevent high-speed crossing and preserve energy and momentum", () => {
  const a = ball(1, 300, 500, 12000, 0),
    b = ball(2, 500, 500, -12000, 0);
  const e = energy([a, b]),
    m = momentum([a, b]);
  near(sweepBalls(a, b, 1 / 60), 0.45);
  advanceBallPairs([a, b], 1 / 60);
  near(a.vx, -12000);
  near(b.vx, 12000);
  assert(a.x < b.x);
  near(energy([a, b]), e);
  assert.deepEqual(momentum([a, b]), m);
});
test("glancing impacts exchange only normal velocity; separating contact never bounces twice", () => {
  const a = ball(1, 0, 0, 100, 60),
    b = ball(2, 16, 12, -30, 10);
  const e = energy([a, b]),
    m = momentum([a, b]);
  const tangentBefore = [-a.vx * 0.6 + a.vy * 0.8, -b.vx * 0.6 + b.vy * 0.8];
  assert(resolveBallPair(a, b));
  near(energy([a, b]), e);
  momentum([a, b]).forEach((n, i) => near(n, m[i]));
  near(-a.vx * 0.6 + a.vy * 0.8, tangentBefore[0]);
  near(-b.vx * 0.6 + b.vy * 0.8, tangentBefore[1]);
  const after = [a.vx, a.vy, b.vx, b.vy];
  assert.equal(sweepBalls(a, b, 1), null);
  resolveBallPair(a, b);
  assert.deepEqual([a.vx, a.vy, b.vx, b.vy], after);
});
test("held balls are excluded and coincident spawn balls separate with finite motion", () => {
  const held = ball(1, 0, 0, 0, 0, { held: true }),
    free = ball(2, -30, 0, 100, 0);
  advanceBallPairs([held, free], 1);
  near(free.x, 70);
  near(held.x, 0);
  const a = ball(3, 100, 100, 100, 0),
    b = ball(4, 100, 100, -100, 0);
  advanceBallPairs([a, b], 0.1);
  assert(Math.hypot(a.x - b.x, a.y - b.y) >= 20);
  assert(Number.isFinite(energy([a, b])));
});
test("multi-contact chain is deterministic independent of entity array order", () => {
  const run = (reverse) => {
    const balls = [
      ball(1, 100, 100, 200, 0),
      ball(2, 140, 100, 0, 0),
      ball(3, 180, 100, -100, 0),
    ];
    const e = energy(balls),
      m = momentum(balls);
    if (reverse) balls.reverse();
    advanceBallPairs(balls, 0.3);
    near(energy(balls), e);
    momentum(balls).forEach((n, i) => near(n, m[i]));
    return balls.sort((a, b) => a.id - b.id);
  };
  assert.deepEqual(run(false), run(true));
});
test("Solo, Duel and both square arena sizes bounce colliding balls in actual simulation", () => {
  const solo = new Game({ random: () => 0 });
  solo.start();
  solo.launch();
  solo.bricks = [{ x: 10, y: 10, w: 32, h: 32, hp: 1, type: "standard" }];
  solo.balls = [
    ball(1, 380, 450, 360, 0, { trail: [] }),
    ball(2, 420, 450, -360, 0, { trail: [] }),
  ];
  const initial = energy(solo.balls);
  for (let i = 0; i < 6; i++) solo.update(1 / 120);
  assert(solo.balls[0].vx < 0 && solo.balls[1].vx > 0);
  near(energy(solo.balls), initial);
  // A glancing impact can leave the two balls with different speeds. Later frames
  // must preserve the exchanged momentum instead of renormalizing each ball.
  solo.balls = [
    ball(3, 380, 450, 360, 0, { trail: [], speedReference: solo.speed() }),
    ball(4, 400, 462, -200, 150, { trail: [], speedReference: solo.speed() }),
  ];
  const glancingEnergy = energy(solo.balls),
    glancingMomentum = momentum(solo.balls);
  for (let i = 0; i < 10; i++) solo.update(1 / 120);
  near(energy(solo.balls), glancingEnergy);
  momentum(solo.balls).forEach((n, i) => near(n, glancingMomentum[i]));
  const duel = new DuelGame({ seed: 1, matchId: "collision" });
  duel.start();
  ticks(duel, 180);
  duel.state.bricks = [
    {
      id: duel.nextEntityId++,
      x: 10,
      y: 450,
      w: 32,
      h: 32,
      hp: 1,
      maxHp: 1,
      type: "standard",
    },
  ];
  duel.state.balls = [
    ball(duel.nextEntityId++, 300, 700, 12000, 0),
    ball(duel.nextEntityId++, 500, 700, -12000, 0),
  ];
  const owners = duel.state.balls.map((b) => b.owner);
  duel.step();
  assert(duel.state.balls[0].vx < 0 && duel.state.balls[1].vx > 0);
  assert.deepEqual(
    duel.state.balls.map((b) => b.owner),
    owners,
  );
  for (const count of [3, 4]) {
    const arena = new ArenaGame(count, 1);
    ticks(arena, 180);
    arena.bricks = [];
    arena.balls = [ball(90, 380, 600, 340, 0), ball(91, 420, 600, -340, 0)];
    const e = energy(arena.balls);
    ticks(arena, 3);
    assert(arena.balls[0].vx < 0 && arena.balls[1].vx > 0);
    near(energy(arena.balls), e);
  }
});
test("repeated Solo multiball splits every source and caps at 27 with independent trails", () => {
  const g = new Game({ random: () => 0 });
  g.start();
  g.launch();
  for (const expected of [3, 9, 27]) {
    g.catchDrop({ type: "multi" });
    assert.equal(g.balls.length, expected);
    assert.equal(new Set(g.balls.map((b) => b.trail)).size, expected);
    assert(g.balls.every((b) => Number.isFinite(b.x + b.y + b.vx + b.vy)));
  }
  g.catchDrop({ type: "multi" });
  assert.equal(g.balls.length, MAX_SOLO_BALLS);
  assert.equal(g.score, 500);
  for (let i = 0; i < 120; i++) g.update(1 / 120);
  assert(g.balls.length <= MAX_SOLO_BALLS);
  assert(g.balls.every((b) => Number.isFinite(b.x + b.y + b.vx + b.vy)));
});
test("shared Solo/Duel bonus badges refresh bars and charges, reuse nodes and clear on expiry", () => {
  const win = new Window(),
    bar = win.document.createElement("div");
  const p = {
    wideRemainingMs: 6000,
    slowRemainingMs: 10000,
    shieldRemainingMs: 1000,
    shieldCharges: 0,
    vestCharges: 2,
    stickyCharges: 3,
    ammo: 5,
  };
  renderBonuses(bar, p);
  assert.equal(bar.children.length, 5);
  assert(bar.textContent.includes("WIDE 6s"));
  const wide = bar.firstElementChild;
  assert.equal(wide.lastElementChild.style.width, "50%");
  renderBonuses(bar, { ...p, wideRemainingMs: 12000, ammo: 4 });
  assert.equal(bar.firstElementChild, wide);
  assert.equal(wide.lastElementChild.style.width, "100%");
  assert(bar.textContent.includes("AMMO ×4"));
  renderBonuses(bar, {});
  assert.equal(bar.hidden, true);
  assert.equal(bar.children.length, 0);
});
