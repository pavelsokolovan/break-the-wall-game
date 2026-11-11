import { HAZARDS, dropType } from "../shared/drops.js";
export { HAZARDS, dropType } from "../shared/drops.js";
import { makeLevel } from "../shared/levels.js";
export { COLORS, WALL_SHAPES, makeLevel } from "../shared/levels.js";
import { paddleBounce } from "../shared/game-helpers.js";
export { seeded, paddleBounce } from "../shared/game-helpers.js";

export const W = 800,
  H = 640,
  PADDLE_Y = 586;
export const THEMES = [
  "FIRST CONTACT",
  "SPLIT WALL",
  "CHAIN REACTION",
  "STEEL GATES",
  "FORTRESS",
  "CROSSFIRE",
  "THE VAULT",
  "LABYRINTH",
  "REACTOR",
  "FINAL BREACH",
];
export function circleRect(ball, rect) {
  const x = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
  const y = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
  return (ball.x - x) ** 2 + (ball.y - y) ** 2 <= ball.r ** 2;
}
export class Game {
  constructor({ random = Math.random, event = () => {} } = {}) {
    this.random = random;
    this.event = event;
    this.state = "title";
    this.balls = [];
    this.drops = [];
    this.bricks = makeLevel(1, this.random);
    this.level = 1;
    this.score = 0;
    this.lives = 3;
    this.paddle = { x: W / 2, w: 160, target: W / 2, vx: 0 };
    this.vestCharges = 0;
    this.stickyCharges = 0;
    this.ammo = 0;
    this.shots = [];
    this.shotCooldown = 0;
    this.powers = {};
    this.damage = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.elapsed = 0;
  }
  start() {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.elapsed = 0;
    this.stats = { bricks: 0, gems: 0, bombs: 0 };
    this.nextLevel();
  }
  nextLevel() {
    this.bricks = makeLevel(this.level, this.random);
    this.damage = 0;
    this.levelLosses = 0;
    this.returns = 0;
    this.reset();
    this.event("level", { level: this.level });
  }
  reset() {
    this.powers = {};
    this.combo = 0;
    this.comboTimer = 0;
    this.noHit = 0;
    this.drops = [];
    this.returns = 0;
    this.paddle.w = this.baseWidth();
    this.paddle.x = W / 2;
    this.paddle.target = W / 2;
    this.paddle.vx = 0;
    this.vestCharges = 0;
    this.stickyCharges = 0;
    this.ammo = 0;
    this.shots = [];
    this.shotCooldown = 0;
    this.balls = [
      { x: W / 2, y: PADDLE_Y - 12, r: 10, vx: 0, vy: 0, trail: [] },
    ];
    this.state = "ready";
  }
  baseWidth() {
    return Math.max(100, 160 - this.damage * 20);
  }
  speed() {
    return (
      (360 + 25 * (this.level - 1)) *
      (1 + Math.min((this.returns / 10) | 0, 6) * 0.03) *
      (1 + this.damage * 0.12) *
      (this.powers.slow > 0 ? 0.65 : 1)
    );
  }
  move(x) {
    this.paddle.target = Math.max(
      this.paddle.w / 2 + 4,
      Math.min(W - this.paddle.w / 2 - 4, x),
    );
  }
  launch() {
    if (this.state !== "ready") return;
    this.state = "playing";
    const a = 0.26 * (this.level % 2 ? 1 : -1),
      s = this.speed();
    this.balls[0].vx = Math.sin(a) * s;
    this.balls[0].vy = -Math.cos(a) * s;
    this.event("launch");
  }
  releaseHeld() {
    for (const b of this.balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const angle = paddleBounce(
        (b.offset || 0) / (this.paddle.w / 2),
        this.paddle.vx,
      );
      b.vx = Math.sin(angle) * this.speed();
      b.vy = -Math.cos(angle) * this.speed();
      b.trail = [];
      this.event("launch");
    }
  }
  fire() {
    if (this.state !== "playing" || this.ammo <= 0 || this.shotCooldown > 0)
      return false;
    this.ammo--;
    this.shotCooldown = 0.25;
    this.shots.push({ x: this.paddle.x, y: PADDLE_Y - 24, r: 5 });
    this.event("fire", { x: this.paddle.x, y: PADDLE_Y - 24 });
    return true;
  }
  action() {
    if (this.state === "ready") this.launch();
    if (this.state !== "playing") return;
    this.releaseHeld();
    this.fire();
  }
  updateShots(dt) {
    const steps = Math.max(1, Math.ceil((720 * dt) / 4));
    for (const shot of this.shots) {
      for (let i = 0; i < steps && !shot.dead; i++) {
        shot.y -= (720 * dt) / steps;
        const hazard = this.drops.find(
          (d) =>
            HAZARDS.has(d.type) &&
            circleRect(shot, {
              x: d.x - (d.type === "worm" ? 24 : 11),
              y: d.y - (d.type === "rocket" ? 18 : 11),
              w: d.type === "worm" ? 48 : 22,
              h: d.type === "rocket" ? 36 : 22,
            }),
        );
        if (hazard) {
          this.drops = this.drops.filter((d) => d !== hazard);
          this.score += 100;
          shot.dead = true;
          this.event("intercept", { x: hazard.x, y: hazard.y });
          break;
        }
        const brick = this.bricks.find((b) => b.hp > 0 && circleRect(shot, b));
        if (brick) {
          this.hitBrick(brick);
          shot.dead = true;
          break;
        }
        if (shot.y < -20) shot.dead = true;
      }
    }
    this.shots = this.shots.filter((s) => !s.dead);
  }
  hitBrick(brick) {
    if (brick.hp <= 0 || brick.type === "steel") return;
    brick.hp--;
    this.noHit = 0;
    if (brick.hp > 0) {
      this.event("hit", brick);
      return;
    }
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 2;
    const mult = Math.min(4, 1 + Math.floor(this.combo / 5));
    const points =
      { standard: 100, armored: 250, reinforced: 450, explosive: 150 }[
        brick.type
      ] * mult;
    this.score += points;
    this.stats.bricks++;
    this.event("brick", { ...brick, points, combo: this.combo, mult });
    const type = dropType(
      this.random(),
      this.drops.filter((d) => HAZARDS.has(d.type)).length >= 3,
    );
    if (type)
      this.drops.push({
        x: brick.x + brick.w / 2,
        y: brick.y + brick.h / 2,
        type,
        w: 22,
        h: 22,
      });
    if (brick.type === "explosive") {
      this.event("explosion", brick);
      for (const near of this.bricks)
        if (
          near.hp > 0 &&
          Math.abs(near.r - brick.r) <= 1 &&
          Math.abs(near.c - brick.c) <= 1
        )
          this.hitBrick(near);
    }
  }
  catchDrop(d) {
    switch (d.type) {
      case "sticky":
        this.stickyCharges = 3;
        break;
      case "bazooka":
        this.ammo = Math.min(15, this.ammo + 5);
        break;
      case "gem":
        this.score += 500;
        this.stats.gems++;
        break;
      case "wide":
        this.powers.wide = 12;
        break;
      case "slow":
        this.powers.slow = 10;
        break;
      case "vest":
        this.vestCharges = 2;
        break;
      case "shield":
        this.powers.shield = 15;
        break;
      case "life":
        if (this.lives < 5) this.lives++;
        else this.score += 1000;
        break;
      case "multi": {
        if (this.balls.length >= 3) {
          this.score += 500;
          break;
        }
        const ball = this.balls[0];
        if (!ball) break;
        for (const a of [-0.65, 0.65]) {
          if (this.balls.length >= 3) break;
          const s = this.speed();
          this.balls.push({
            x: ball.x,
            y: ball.y,
            r: 10,
            vx: Math.sin(a) * s,
            vy: -Math.cos(a) * s,
            trail: [],
          });
        }
        break;
      }
      case "rocket":
      case "worm":
      case "bomb":
        if (this.powers.shield > 0) {
          this.powers.shield = 0;
          this.event("shield");
          return false;
        }
        if (this.vestCharges > 0) {
          this.vestCharges--;
          this.event("vest-block", { charges: this.vestCharges });
          return false;
        }
        return true;
    }
    this.event("pickup", d);
    return false;
  }
  lose(reason) {
    if (!["playing", "ready"].includes(this.state)) return;
    this.lives--;
    this.damage = Math.min(3, this.damage + 1);
    this.levelLosses++;
    if (HAZARDS.has(reason)) {
      const key = reason === "bomb" ? "bombs" : reason + "s";
      this.stats[key] = (this.stats[key] || 0) + 1;
    }
    this.event("damage", { reason });
    if (this.lives <= 0) {
      this.state = "over";
      this.event("end", { win: false });
    } else this.reset();
  }
  update(dt, direction = 0) {
    if (!["ready", "playing"].includes(this.state)) return;
    if (direction) this.move(this.paddle.x + direction * 720 * dt);
    this.paddle.w = this.baseWidth() * (this.powers.wide > 0 ? 1.5 : 1);
    this.move(this.paddle.target);
    const oldX = this.paddle.x;
    const travel = Math.max(
      -1200 * dt,
      Math.min(1200 * dt, this.paddle.target - oldX),
    );
    this.paddle.x += travel;
    const velocity = dt > 0 ? travel / dt : 0;
    this.paddle.vx = velocity;
    if (this.state === "ready") {
      this.balls[0].x = this.paddle.x;
      this.balls[0].y = PADDLE_Y - 12;
      return;
    }
    this.elapsed += dt;
    this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (!this.comboTimer) this.combo = 0;
    this.noHit += dt;
    for (const key of Object.keys(this.powers))
      this.powers[key] = Math.max(0, this.powers[key] - dt);
    // Microsteps bound maximum travel to four pixels, preventing brick tunneling.
    const steps = Math.max(1, Math.ceil((this.speed() * dt) / 4)),
      sub = dt / steps;
    for (let j = 0; j < steps; j++)
      for (const b of this.balls) {
        if (b.stuck) {
          b.offset = Math.max(
            -this.paddle.w / 2 + b.r,
            Math.min(this.paddle.w / 2 - b.r, b.offset || 0),
          );
          b.x = this.paddle.x + b.offset;
          b.y = PADDLE_Y - b.r - 1;
          b.trail = [];
          continue;
        }
        const norm = Math.hypot(b.vx, b.vy) || 1,
          speed = this.speed();
        b.vx = (b.vx / norm) * speed;
        b.vy = (b.vy / norm) * speed;
        const px = b.x,
          py = b.y;
        b.x += b.vx * sub;
        b.y += b.vy * sub;
        if (b.x < b.r || b.x > W - b.r) {
          b.x = Math.max(b.r, Math.min(W - b.r, b.x));
          b.vx *= -1;
          this.event("wall");
          if (this.noHit > 12) {
            b.vy = -Math.abs(speed * 0.7);
            b.vx = Math.sign(b.vx) * speed * Math.sqrt(0.51);
            this.noHit = 0;
          }
        }
        if (b.y < b.r) {
          b.y = b.r;
          b.vy = Math.abs(b.vy);
          this.event("wall");
        }
        const p = {
          x: this.paddle.x - this.paddle.w / 2,
          y: PADDLE_Y,
          w: this.paddle.w,
          h: 18,
        };
        if (b.vy > 0 && py <= PADDLE_Y && circleRect(b, p)) {
          const a = paddleBounce(
            (b.x - this.paddle.x) / (this.paddle.w / 2),
            this.paddle.vx,
          );
          b.vx = Math.sin(a) * speed;
          b.vy = -Math.cos(a) * speed;
          b.y = PADDLE_Y - b.r - 1;
          this.returns++;
          this.event("paddle", { x: b.x, y: b.y });
          if (this.stickyCharges > 0) {
            this.stickyCharges--;
            b.stuck = true;
            b.offset = b.x - this.paddle.x;
            b.vx = 0;
            b.vy = 0;
            b.trail = [];
            this.event("stick");
            continue;
          }
        }
        for (const brick of this.bricks) {
          if (brick.hp <= 0 || !circleRect(b, brick)) continue;
          if (py + b.r <= brick.y || py - b.r >= brick.y + brick.h) {
            b.vy *= -1;
            b.y = py;
          } else {
            b.vx *= -1;
            b.x = px;
          }
          this.hitBrick(brick);
          break;
        }
      }
    this.updateShots(dt);
    if (!this.bricks.some((b) => b.hp > 0 && b.type !== "steel")) {
      const bonus =
        1000 * this.level +
        500 * this.lives +
        (this.levelLosses === 0 ? 2000 : 0);
      this.score += bonus;
      this.drops = [];
      this.powers = {};
      this.vestCharges = 0;
      this.stickyCharges = 0;
      this.ammo = 0;
      this.shots = [];
      this.shotCooldown = 0;
      if (this.level === 10) {
        this.state = "victory";
        this.event("end", { win: true, bonus });
      } else {
        this.state = "clear";
        this.event("clear", { bonus });
      }
      return;
    }
    for (const b of this.balls) {
      b.trail.unshift({ x: b.x, y: b.y });
      if (b.trail.length > 9) b.trail.pop();
    }
    this.balls = this.balls.filter((b) => b.y < H + 20);
    const caught = [];
    for (const d of this.drops) {
      d.age = (d.age || 0) + dt;
      d.baseX ??= d.x;
      d.y += (d.type === "rocket" ? 260 : d.type === "worm" ? 110 : 150) * dt;
      if (d.type === "worm")
        d.x = Math.max(
          24,
          Math.min(W - 24, d.baseX + Math.sin(d.age * 6) * 55),
        );
      const halfW = d.type === "worm" ? 24 : 11,
        halfH = d.type === "rocket" ? 18 : 11;
      if (
        d.y + halfH >= PADDLE_Y &&
        d.y - halfH <= PADDLE_Y + 18 &&
        Math.abs(d.x - this.paddle.x) < this.paddle.w / 2 + halfW
      )
        caught.push(d);
    }
    const priority = (d) =>
      ["shield", "vest"].includes(d.type) ? -1 : HAZARDS.has(d.type) ? 1 : 0;
    caught.sort((a, b) => priority(a) - priority(b));
    let hazard = null;
    for (const d of caught) if (this.catchDrop(d)) hazard ||= d.type;
    this.drops = this.drops.filter((d) => !caught.includes(d) && d.y < H + 30);
    if (hazard || !this.balls.length) this.lose(hazard || "miss");
  }
}
