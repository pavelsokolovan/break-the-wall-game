import test from "node:test";
import assert from "node:assert/strict";
import {
  Game,
  makeLevel,
  dropType,
  seeded,
  PADDLE_Y,
  paddleBounce,
  HAZARDS,
} from "../src/game.js";
function playing() {
  const g = new Game({ random: () => 0 });
  g.start();
  g.launch();
  return g;
}
test("ten valid levels have targets, bounded geometry, and safe lower clearance", () => {
  for (let n = 1; n <= 10; n++) {
    const a = makeLevel(n);
    assert(a.some((b) => b.type !== "steel"));
    assert(
      a.every(
        (b) => b.x >= 0 && b.x + b.w <= 800 && b.y + b.h <= PADDLE_Y - 260,
      ),
    );
    assert.equal(new Set(a.map((b) => b.id)).size, a.length);
  }
});
test("seeded generator is repeatable; item probabilities and bomb cap have correct boundaries", () => {
  const a = seeded(3),
    b = seeded(3);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
  assert.deepEqual(
    [
      0.1, 0.56, 0.59, 0.62, 0.72, 0.77, 0.83, 0.86, 0.9, 0.91, 0.94, 0.96,
      0.98,
    ].map((n) => dropType(n, false)),
    [
      null,
      "sticky",
      "bazooka",
      "gem",
      "wide",
      "slow",
      "shield",
      "multi",
      "life",
      "vest",
      "bomb",
      "rocket",
      "worm",
    ],
  );
  assert.equal(dropType(0.99, true), null);
});
test("armored hits only score when destroyed; fifth combo destruction doubles points", () => {
  const g = playing();
  const armored = makeLevel(2).find((b) => b.type === "armored");
  g.hitBrick(armored);
  assert.equal(g.score, 0);
  g.hitBrick(armored);
  assert.equal(g.score, 250);
  for (let i = 0; i < 4; i++)
    g.hitBrick({ ...g.bricks[0], hp: 1, type: "standard" });
  assert.equal(g.score, 750);
});
test("explosive chains destroy each brick once", () => {
  const g = playing();
  g.bricks = [0, 1, 2].map((c) => ({
    id: c,
    r: 0,
    c,
    x: 100 + c * 67,
    y: 80,
    w: 61,
    h: 23,
    hp: 1,
    type: c < 2 ? "explosive" : "standard",
    color: "#fff",
  }));
  g.hitBrick(g.bricks[0]);
  assert.equal(g.stats.bricks, 3);
  assert.equal(g.score, 400);
  assert(g.bricks.every((b) => b.hp === 0));
});
test("miss shrinks paddle, resets powers, preserves brick damage; next level repairs", () => {
  const g = playing();
  g.powers.wide = 10;
  g.bricks[0].hp = 0;
  g.balls[0].y = 700;
  g.update(1 / 120);
  assert.equal(g.lives, 2);
  assert.equal(g.state, "ready");
  assert.equal(g.paddle.w, 140);
  assert.deepEqual(g.powers, {});
  assert.equal(g.bricks[0].hp, 0);
  g.level++;
  g.nextLevel();
  assert.equal(g.paddle.w, 160);
});
test("paddle never shrinks below 100 pixels", () => {
  const g = playing();
  g.lives = 20;
  for (let i = 0; i < 10; i++) {
    g.launch();
    g.lose("bomb");
  }
  assert.equal(g.baseWidth(), 100);
});
test("shield pickup protects against simultaneous bomb; unshielded bomb and miss cost one life", () => {
  const g = playing();
  g.drops = ["bomb", "shield"].map((type) => ({
    type,
    x: 400,
    y: PADDLE_Y - 10,
  }));
  g.update(1 / 120);
  assert.equal(g.lives, 3);
  assert.equal(g.powers.shield, 0);
  g.drops = [{ type: "bomb", x: 400, y: PADDLE_Y - 10 }];
  g.balls[0].y = 700;
  g.update(1 / 120);
  assert.equal(g.lives, 2);
  assert.equal(g.stats.bombs, 1);
});
test("multiball caps at three and a remaining ball prevents life loss", () => {
  const g = playing();
  g.catchDrop({ type: "multi" });
  assert.equal(g.balls.length, 3);
  g.catchDrop({ type: "multi" });
  assert.equal(g.balls.length, 3);
  assert.equal(g.score, 500);
  g.balls[0].y = 700;
  g.update(1 / 120);
  assert.equal(g.lives, 3);
  assert.equal(g.balls.length, 2);
});
test("powers refresh, expire, and extra life at cap converts to score", () => {
  const g = playing();
  g.catchDrop({ type: "wide" });
  g.update(0.5);
  assert.equal(g.paddle.w, 240);
  g.catchDrop({ type: "wide" });
  assert.equal(g.powers.wide, 12);
  g.powers.wide = 0.001;
  g.update(0.01);
  g.update(0.01);
  assert.equal(g.paddle.w, 160);
  g.lives = 5;
  g.catchDrop({ type: "life" });
  assert.equal(g.lives, 5);
  assert.equal(g.score, 1000);
});
test("last brick wins over simultaneous bomb and ball loss; tenth clear reaches victory", () => {
  const g = playing();
  g.bricks.forEach((b) => (b.hp = 0));
  g.balls[0].y = 700;
  g.drops = [{ type: "bomb", x: 400, y: PADDLE_Y - 10 }];
  g.update(1 / 120);
  assert.equal(g.state, "clear");
  assert.equal(g.lives, 3);
  assert.equal(g.score, 4500);
  g.level = 10;
  g.nextLevel();
  g.launch();
  g.bricks.forEach((b) => {
    if (b.type !== "steel") b.hp = 0;
  });
  g.update(1 / 120);
  assert.equal(g.state, "victory");
});
test("paused update freezes simulation and timers", () => {
  const g = playing();
  g.powers.wide = 12;
  g.state = "paused";
  const before = JSON.stringify(g);
  g.update(1);
  assert.equal(JSON.stringify(g), before);
});
test("fast ball cannot tunnel through brick; paddle edges return upwards", () => {
  const g = playing();
  g.level = 10;
  g.bricks = [
    {
      x: 200,
      y: 100,
      w: 61,
      h: 23,
      hp: 2,
      maxHp: 2,
      type: "armored",
      r: 0,
      c: 0,
    },
  ];
  g.balls = [{ x: 225, y: 150, r: 7, vx: 0, vy: -585, trail: [] }];
  g.update(0.1);
  assert.equal(g.bricks[0].hp, 1);
  assert(g.balls[0].vy > 0);
  g.balls = [{ x: 450, y: PADDLE_Y - 10, r: 7, vx: 0, vy: 585, trail: [] }];
  g.update(0.02);
  assert(g.balls[0].vy < 0);
  assert(g.balls[0].vx > 0);
});
test("long seeded auto-paddle run remains finite and bounded", () => {
  const g = new Game({ random: seeded(40) });
  g.start();
  for (let i = 0; i < 30000; i++) {
    if (g.state === "ready") g.launch();
    if (g.state === "clear") {
      g.level++;
      g.nextLevel();
    }
    if (["over", "victory"].includes(g.state)) break;
    const b = g.balls.find((b) => b.vy > 0) || g.balls[0];
    if (b) g.move(b.x);
    g.update(1 / 120);
    for (const b of g.balls) {
      assert(Number.isFinite(b.x) && Number.isFinite(b.y));
      assert(Math.abs(b.vx) < 1000 && Math.abs(b.vy) < 1000);
    }
    assert(g.balls.length <= 3);
  }
  assert(g.score > 0);
});

test("seeded random walls vary, repeat reliably, and keep safe geometry across 1,000 layouts", () => {
  const layouts = new Set();
  const shapes = new Set();
  for (let seed = 1; seed <= 1000; seed++) {
    const n = 1 + (seed % 10),
      bricks = makeLevel(n, seeded(seed));
    assert.deepEqual(bricks, makeLevel(n, seeded(seed)));
    shapes.add(bricks.shape);
    layouts.add(JSON.stringify(bricks));
    assert(bricks.filter((b) => b.type !== "steel").length >= 16);
    assert(
      bricks.every(
        (b) =>
          b.w === 86 &&
          b.h === 32 &&
          b.x >= 0 &&
          b.x + b.w <= 800 &&
          b.y + b.h <= PADDLE_Y - 260,
      ),
    );
    // Steel barriers are isolated: no unbreakable rectangle can trap a target.
    const steel = bricks.filter((b) => b.type === "steel");
    assert(steel.length <= 2);
    assert(steel.every((b) => b.r === 1));
  }
  assert.equal(shapes.size, 6);
  assert(layouts.size > 100);
});

test("failures accelerate balls, slow pickups reduce speed without stacking, and next level repairs speed", () => {
  const g = playing(),
    baseline = g.speed();
  g.lose("miss");
  assert.equal(g.speed(), baseline * 1.12);
  g.launch();
  g.lose("bomb");
  assert.equal(g.speed(), baseline * 1.24);
  g.launch();
  g.catchDrop({ type: "slow" });
  assert.equal(g.speed(), baseline * 1.24 * 0.65);
  g.catchDrop({ type: "slow" });
  assert.equal(g.speed(), baseline * 1.24 * 0.65);
  g.powers.slow = 0.001;
  g.update(0.01);
  assert.equal(g.speed(), baseline * 1.24);
  g.nextLevel();
  assert.equal(g.speed(), baseline);
});

test("paddle stroke preserves slow aiming and scales lateral influence in both directions", () => {
  assert.equal(paddleBounce(0.4, 0), paddleBounce(0.4, 60));
  assert(paddleBounce(0.4, 400) > paddleBounce(0.4, 0));
  assert(paddleBounce(0.4, 1000) > paddleBounce(0.4, 400));
  assert(paddleBounce(-0.4, -1000) < paddleBounce(-0.4, -400));
  assert(paddleBounce(-0.2, 1200) > 0);
  for (const v of [-1200, 0, 1200])
    for (const offset of [-1.2, 0, 1.2]) {
      const a = paddleBounce(offset, v);
      assert(Math.abs(a) <= 1.13);
      assert(Math.cos(a) > 0.4);
    }
});
test("actual paddle movement transfers momentum on contact, stops at walls, and keeps ball speed", () => {
  for (const direction of [-1, 1]) {
    const g = playing();
    g.move(400 + direction * 200);
    g.balls = [
      { x: 400, y: PADDLE_Y - 11, r: 10, vx: 0, vy: g.speed(), trail: [] },
    ];
    g.update(1 / 120);
    assert(Math.sign(g.balls[0].vx) === direction);
    assert(g.balls[0].vy < 0);
    assert(
      Math.abs(Math.hypot(g.balls[0].vx, g.balls[0].vy) - g.speed()) < 0.01,
    );
    g.move(direction > 0 ? 10000 : -10000);
    for (let i = 0; i < 100; i++) g.update(1 / 120);
    assert.equal(g.paddle.vx, 0);
    assert(g.paddle.x >= g.paddle.w / 2 && g.paddle.x <= 800 - g.paddle.w / 2);
  }
});
test("vest blocks exactly two hazard hits; shield is consumed first and armor does not save a missed ball", () => {
  const g = playing();
  g.catchDrop({ type: "vest" });
  assert.equal(g.vestCharges, 2);
  assert.equal(g.catchDrop({ type: "rocket" }), false);
  assert.equal(g.vestCharges, 1);
  g.catchDrop({ type: "shield" });
  assert.equal(g.catchDrop({ type: "worm" }), false);
  assert.equal(g.vestCharges, 1);
  assert.equal(g.catchDrop({ type: "worm" }), false);
  assert.equal(g.vestCharges, 0);
  assert.equal(g.catchDrop({ type: "bomb" }), true);
  g.catchDrop({ type: "vest" });
  g.balls[0].y = 700;
  g.update(1 / 120);
  assert.equal(g.lives, 2);
  assert.equal(g.vestCharges, 0);
});
test("vest collected with simultaneous hazards protects in the same step and failures cost at most one life", () => {
  const g = playing();
  g.drops = ["rocket", "vest", "bomb"].map((type) => ({
    type,
    x: 400,
    y: PADDLE_Y - 10,
  }));
  g.update(1 / 120);
  assert.equal(g.lives, 3);
  assert.equal(g.vestCharges, 0);
  g.drops = ["bomb", "rocket", "worm"].map((type) => ({
    type,
    x: 400,
    y: PADDLE_Y - 10,
  }));
  g.update(1 / 120);
  assert.equal(g.lives, 2);
});
test("rocket descends fastest, worm weaves, hazards freeze on pause, and full hazard slots suppress spawns", () => {
  const g = playing();
  g.drops = ["bomb", "rocket", "worm"].map((type) => ({
    type,
    x: 100,
    y: 100,
  }));
  g.update(0.1);
  assert(g.drops[1].y > g.drops[0].y);
  assert(g.drops[0].y > g.drops[2].y);
  assert.notEqual(g.drops[2].x, 100);
  const before = JSON.stringify(g.drops);
  g.state = "paused";
  g.update(2);
  assert.equal(JSON.stringify(g.drops), before);
  for (const roll of [0.95, 0.97, 0.99])
    assert.equal(dropType(roll, true), null);
  assert.deepEqual([...HAZARDS], ["bomb", "rocket", "worm"]);
});

test("sticky ball follows paddle until release; releases upward with no immediate recatch", () => {
  const g = playing();
  g.catchDrop({ type: "sticky" });
  g.balls = [
    { x: 400, y: PADDLE_Y - 11, r: 10, vx: 0, vy: g.speed(), trail: [] },
  ];
  g.update(1 / 120);
  assert.equal(g.balls[0].stuck, true);
  assert.equal(g.stickyCharges, 2);
  g.move(600);
  for (let i = 0; i < 30; i++) g.update(1 / 120);
  assert.equal(g.balls[0].x, g.paddle.x);
  assert.equal(g.balls[0].vy, 0);
  g.action();
  assert.equal(g.balls[0].stuck, false);
  assert(g.balls[0].vy < 0);
  g.update(1 / 120);
  assert.equal(g.balls[0].stuck, false);
  assert.equal(g.stickyCharges, 2);
});
test("all held multiballs release together and remain valid when wide paddle expires", () => {
  const g = playing();
  g.catchDrop({ type: "multi" });
  g.catchDrop({ type: "wide" });
  g.update(0.01);
  for (const [i, b] of g.balls.entries()) {
    b.stuck = true;
    b.offset = (i - 1) * 110;
    b.vx = 0;
    b.vy = 0;
  }
  g.powers.wide = 0;
  g.update(0.01);
  for (const b of g.balls)
    assert(Math.abs(b.x - g.paddle.x) <= g.paddle.w / 2 - b.r);
  g.action();
  assert(g.balls.every((b) => !b.stuck && b.vy < 0));
  assert.equal(g.lives, 3);
});
test("bazooka pickup stocks ammo, caps storage, obeys cooldown, and fires with release", () => {
  const g = playing();
  for (let i = 0; i < 4; i++) g.catchDrop({ type: "bazooka" });
  assert.equal(g.ammo, 15);
  g.balls[0].stuck = true;
  g.balls[0].offset = 0;
  g.action();
  assert.equal(g.ammo, 14);
  assert.equal(g.shots.length, 1);
  assert.equal(g.balls[0].stuck, false);
  assert.equal(g.fire(), false);
  g.update(0.26);
  assert.equal(g.fire(), true);
  assert.equal(g.ammo, 13);
  g.state = "paused";
  const before = JSON.stringify(g);
  g.update(2);
  assert.equal(JSON.stringify(g), before);
  assert.equal(g.fire(), false);
});
test("bazooka intercepts bombs rockets and worms for points without player damage", () => {
  for (const type of HAZARDS) {
    const g = playing();
    g.catchDrop({ type: "bazooka" });
    g.fire();
    g.drops = [{ type, x: 400, y: 500 }];
    g.updateShots(0.15);
    assert.equal(g.drops.length, 0);
    assert.equal(g.shots.length, 0);
    assert.equal(g.score, 100);
    assert.equal(g.lives, 3);
  }
});
test("bazooka damages armor, detonates explosive chains, and steel stops shots", () => {
  for (const [type, hp] of [
    ["armored", 2],
    ["steel", Infinity],
  ]) {
    const g = playing();
    g.bricks = [
      { x: 380, y: 300, w: 86, h: 32, type, hp, maxHp: hp, r: 0, c: 0 },
    ];
    g.catchDrop({ type: "bazooka" });
    g.fire();
    g.updateShots(0.5);
    assert.equal(g.bricks[0].hp, type === "steel" ? Infinity : 1);
    assert.equal(g.shots.length, 0);
    assert.equal(g.score, 0);
  }
  const g = playing();
  g.bricks = [
    { x: 380, y: 300, w: 86, h: 32, type: "explosive", hp: 1, r: 0, c: 0 },
    { x: 474, y: 300, w: 86, h: 32, type: "standard", hp: 1, r: 0, c: 1 },
  ];
  g.catchDrop({ type: "bazooka" });
  g.fire();
  g.updateShots(0.5);
  assert(g.bricks.every((b) => b.hp === 0));
  assert.equal(g.score, 250);
});
test("weapons reset on life loss and level clear; last brick shot safely wins over hazards", () => {
  const g = playing();
  g.catchDrop({ type: "bazooka" });
  g.catchDrop({ type: "sticky" });
  g.fire();
  g.lose("miss");
  assert.equal(g.ammo, 0);
  assert.equal(g.stickyCharges, 0);
  assert.equal(g.shots.length, 0);
  g.launch();
  g.bricks = [
    {
      x: 380,
      y: PADDLE_Y - 40,
      w: 86,
      h: 10,
      type: "standard",
      hp: 1,
      r: 0,
      c: 0,
    },
  ];
  g.catchDrop({ type: "bazooka" });
  g.fire();
  g.drops = [{ type: "bomb", x: 400, y: PADDLE_Y - 10 }];
  g.update(0.01);
  assert.equal(g.state, "clear");
  assert.equal(g.lives, 2);
  assert.equal(g.ammo, 0);
  assert.equal(g.shots.length, 0);
});
