export const W = 800,
  H = 640,
  PADDLE_Y = 586;
export const COLORS = ["#c49aff", "#ff7695", "#ffb570", "#d3fa65", "#66dfd1"];
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
export function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const WALL_SHAPES = [
  "DIAMOND",
  "SPACE INVADER",
  "CHEVRON",
  "TWIN TOWERS",
  "WAVE",
  "PORTAL",
];
export function makeLevel(n, random = Math.random) {
  const bricks = [],
    rows = Math.min(4 + Math.floor(n / 3), 6);
  const shape = Math.floor(random() * WALL_SHAPES.length);
  const phase = Math.floor(random() * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 8; c++) {
      const d = Math.abs(c - 3.5),
        mid = (rows - 1) / 2;
      const masks = [
        d <= 3.8 - Math.abs(r - mid),
        r === 0
          ? d > 0.5 && d < 3.5
          : r === rows - 1
            ? c % 3 !== 1
            : r === 1
              ? d < 2.6
              : true,
        Math.abs(r - d * 0.65) < 1.7,
        d >= 1 || r === 0 || r === rows - 1,
        r >= Math.floor((Math.sin((c + phase) * 0.9) + 1) * 0.9),
        r === 0 || r === rows - 1 || d > 1.5,
      ];
      if (!masks[shape]) continue;
      let type =
        n >= 3 && random() < 0.16
          ? "explosive"
          : n >= 5 && (r + c + phase) % 5 === 0
            ? "reinforced"
            : n >= 2 && (r + c + phase) % 3 === 0
              ? "armored"
              : "standard";
      // Isolated steel cells cannot enclose targets or seal a passage.
      if (n >= 4 && r === 1 && (c === 2 || c === 5)) type = "steel";
      const hp =
        type === "steel"
          ? Infinity
          : type === "reinforced"
            ? 3
            : type === "armored"
              ? 2
              : 1;
      bricks.push({
        id: r * 8 + c,
        r,
        c,
        x: 28 + c * 94,
        y: 66 + r * 40,
        w: 86,
        h: 32,
        type,
        hp,
        maxHp: hp,
        color: COLORS[(r + phase) % COLORS.length],
      });
    }
  }
  bricks.shape = WALL_SHAPES[shape];
  return bricks;
}
export function circleRect(ball, rect) {
  const x = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
  const y = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
  return (ball.x - x) ** 2 + (ball.y - y) ** 2 <= ball.r ** 2;
}
export const HAZARDS = new Set(["bomb", "rocket", "worm"]);
export function paddleBounce(offset, velocity) {
  let angle = Math.max(-1.13, Math.min(1.13, offset * 1.13));
  if (Math.abs(angle) < 0.26) angle = 0.26 * (angle < 0 ? -1 : 1);
  // Slow strokes keep contact-position aiming; fast strokes transfer lateral momentum.
  const stroke =
    (Math.sign(velocity) * Math.max(0, Math.abs(velocity) - 80)) / 1120;
  angle = Math.max(-1.13, Math.min(1.13, angle + stroke * 0.9));
  if (Math.abs(angle) < 0.12) angle = 0.12 * (angle < 0 ? -1 : 1);
  return angle;
}
export function dropType(roll, hazardsFull) {
  if (roll < 0.62) return null;
  if (roll < 0.72) return "gem";
  if (roll < 0.77) return "wide";
  if (roll < 0.83) return "slow";
  if (roll < 0.86) return "shield";
  if (roll < 0.9) return "multi";
  if (roll < 0.91) return "life";
  if (roll < 0.94) return "vest";
  if (hazardsFull) return null;
  if (roll < 0.96) return "bomb";
  if (roll < 0.98) return "rocket";
  return "worm";
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
    if (!this.bricks.some((b) => b.hp > 0 && b.type !== "steel")) {
      const bonus =
        1000 * this.level +
        500 * this.lives +
        (this.levelLosses === 0 ? 2000 : 0);
      this.score += bonus;
      this.drops = [];
      this.powers = {};
      this.vestCharges = 0;
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
