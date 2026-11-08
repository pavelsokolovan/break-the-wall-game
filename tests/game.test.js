import test from "node:test";
import assert from "node:assert/strict";
import { Game, makeLevel, dropType, seeded, PADDLE_Y } from "../src/game.js";
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
    [0.1, 0.72, 0.82, 0.87, 0.91, 0.94, 0.96, 0.97].map((n) =>
      dropType(n, false),
    ),
    [null, "gem", "wide", "slow", "shield", "multi", "life", "bomb"],
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
  assert.equal(g.paddle.w, 104);
  assert.deepEqual(g.powers, {});
  assert.equal(g.bricks[0].hp, 0);
  g.level++;
  g.nextLevel();
  assert.equal(g.paddle.w, 120);
});
test("paddle never shrinks below 72 pixels", () => {
  const g = playing();
  g.lives = 20;
  for (let i = 0; i < 10; i++) {
    g.launch();
    g.lose("bomb");
  }
  assert.equal(g.baseWidth(), 72);
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
  assert.equal(g.paddle.w, 180);
  g.catchDrop({ type: "wide" });
  assert.equal(g.powers.wide, 12);
  g.powers.wide = 0.001;
  g.update(0.01);
  g.update(0.01);
  assert.equal(g.paddle.w, 120);
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
