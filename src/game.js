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
export function makeLevel(n) {
  const bricks = [],
    rows = Math.min(4 + Math.floor(n / 2), 7);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < 11; c++) {
      if (n > 1 && (c + r * 2 + n) % 9 === 0) continue;
      let type =
        n >= 3 && (c + r * 3) % 13 === 5
          ? "explosive"
          : n >= 5 && (r + c) % 5 === 0
            ? "reinforced"
            : n >= 2 && (r + c) % 3 === 0
              ? "armored"
              : "standard";
      // Sparse single steel barriers leave every brick exposed from below or a side.
      if (n >= 4 && r === 2 && (c === 3 || c === 7)) type = "steel";
      const hp =
        type === "steel"
          ? Infinity
          : type === "reinforced"
            ? 3
            : type === "armored"
              ? 2
              : 1;
      bricks.push({
        id: r * 11 + c,
        r,
        c,
        x: 32 + c * 67,
        y: 76 + r * 31,
        w: 61,
        h: 23,
        type,
        hp,
        maxHp: hp,
        color: COLORS[r % COLORS.length],
      });
    }
  return bricks;
}
export function circleRect(ball, rect) {
  const x = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
  const y = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
  return (ball.x - x) ** 2 + (ball.y - y) ** 2 <= ball.r ** 2;
}
export function dropType(roll, bombExists) {
  if (roll < 0.72) return null;
  if (roll < 0.82) return "gem";
  if (roll < 0.87) return "wide";
  if (roll < 0.91) return "slow";
  if (roll < 0.94) return "shield";
  if (roll < 0.96) return "multi";
  if (roll < 0.97) return "life";
  return bombExists ? null : "bomb";
}
export class Game {
  constructor({ random = Math.random, event = () => {} } = {}) {
    this.random = random;
    this.event = event;
    this.state = "title";
    this.balls = [];
    this.drops = [];
    this.bricks = makeLevel(1);
    this.level = 1;
    this.score = 0;
    this.lives = 3;
    this.paddle = { x: W / 2, w: 120 };
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
    this.bricks = makeLevel(this.level);
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
    this.balls = [{ x: W / 2, y: PADDLE_Y - 9, r: 7, vx: 0, vy: 0, trail: [] }];
    this.state = "ready";
  }
  baseWidth() {
    return Math.max(72, 120 - this.damage * 16);
  }
  speed() {
    return (
      (360 + 25 * (this.level - 1)) *
      (1 + Math.min((this.returns / 10) | 0, 6) * 0.03) *
      (this.powers.slow > 0 ? 0.75 : 1)
    );
  }
  move(x) {
    this.paddle.x = Math.max(
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
      this.drops.some((d) => d.type === "bomb"),
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
            r: 7,
            vx: Math.sin(a) * s,
            vy: -Math.cos(a) * s,
            trail: [],
          });
        }
        break;
      }
      case "bomb":
        if (this.powers.shield > 0) {
          this.powers.shield = 0;
          this.event("shield");
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
    if (reason === "bomb") this.stats.bombs++;
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
    this.move(this.paddle.x);
    if (this.state === "ready") {
      this.balls[0].x = this.paddle.x;
      this.balls[0].y = PADDLE_Y - 9;
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
          h: 12,
        };
        if (b.vy > 0 && py <= PADDLE_Y && circleRect(b, p)) {
          let a = ((b.x - this.paddle.x) / (this.paddle.w / 2)) * 1.13;
          if (Math.abs(a) < 0.26) a = 0.26 * (a < 0 ? -1 : 1);
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
      d.y += 150 * dt;
      if (
        d.y + 11 >= PADDLE_Y &&
        d.y - 11 <= PADDLE_Y + 12 &&
        Math.abs(d.x - this.paddle.x) < this.paddle.w / 2 + 11
      )
        caught.push(d);
    }
    caught.sort(
      (a, b) =>
        (a.type === "shield" ? -2 : a.type === "bomb" ? 2 : 0) -
        (b.type === "shield" ? -2 : b.type === "bomb" ? 2 : 0),
    );
    let bomb = false;
    for (const d of caught) bomb = this.catchDrop(d) || bomb;
    this.drops = this.drops.filter((d) => !caught.includes(d) && d.y < H + 30);
    if (bomb || !this.balls.length) this.lose(bomb ? "bomb" : "miss");
  }
}
