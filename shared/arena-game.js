import { seeded } from "./game-helpers.js";
export const ARENA_SIZE = 800;
export const ARENA_FORMATIONS = ["diamond", "ring", "cross", "star", "islands"];
const formations = [
  (x, y) => Math.abs(x) + Math.abs(y) <= 3,
  (x, y) => x * x + y * y >= 5 && x * x + y * y <= 10,
  (x, y) => Math.abs(x) <= 1 || Math.abs(y) <= 1,
  (x, y) =>
    Math.abs(x) === Math.abs(y) || (Math.abs(x) <= 1 && Math.abs(y) <= 1),
  (x, y) => Math.abs(x) >= 2 && Math.abs(y) >= 2,
];
export const ARENA_COLORS = ["#d3fa65", "#66dfd1", "#ff6090", "#b895ff"];
export const ARENA_SIDES = ["BOTTOM", "RIGHT", "TOP", "LEFT"];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const geometry = (slot, t) =>
  [
    { x: t, y: 760, nx: 0, ny: -1, tx: 1, ty: 0 },
    { x: 760, y: t, nx: -1, ny: 0, tx: 0, ty: 1 },
    { x: t, y: 40, nx: 0, ny: 1, tx: 1, ty: 0 },
    { x: 40, y: t, nx: 1, ny: 0, tx: 0, ty: 1 },
  ][slot];
export class ArenaGame {
  constructor(count, seed = 1) {
    if (![3, 4].includes(count))
      throw Error("Arena needs three or four players");
    this.count = count;
    this.random = seeded(seed);
    this.phase = "countdown";
    this.tick = 0;
    this.activeTicks = 0;
    this.nextId = 1;
    this.winner = null;
    this.countdown = 180;
    this.players = Array.from({ length: count }, (_, slot) => ({
      slot,
      t: 400,
      target: 400,
      lives: 5,
      points: 0,
      seq: 0,
    }));
    this.balls = [];
    this.bricks = [];
    this.wall();
  }
  wall() {
    const choice = Math.floor(this.random() * formations.length);
    this.formation = ARENA_FORMATIONS[choice];
    for (let row = -3; row <= 3; row++)
      for (let col = -3; col <= 3; col++) {
        if (!formations[choice](col, row)) continue;
        this.bricks.push({
          id: this.nextId++,
          x: 384 + col * 40,
          y: 384 + row * 40,
          w: 32,
          h: 32,
        });
      }
  }
  spawn(slot) {
    if (!this.players[slot]?.lives) return;
    const p = geometry(slot, this.players[slot].t),
      angle = (this.random() - 0.5) * 0.7,
      speed = 340;
    this.balls.push({
      id: this.nextId++,
      x: p.x + p.nx * 25,
      y: p.y + p.ny * 25,
      vx: (p.nx * Math.cos(angle) + p.tx * Math.sin(angle)) * speed,
      vy: (p.ny * Math.cos(angle) + p.ty * Math.sin(angle)) * speed,
      r: 9,
      owner: slot,
    });
  }
  input(slot, message) {
    const p = this.players[slot];
    if (
      this.phase !== "playing" ||
      !p?.lives ||
      !Number.isSafeInteger(message.seq) ||
      message.seq <= p.seq ||
      !Number.isFinite(message.x) ||
      message.x < 0 ||
      message.x > 1
    )
      return false;
    p.seq = message.seq;
    p.target = clamp(message.x * 800, 75, 725);
    return true;
  }
  finishIfNeeded() {
    const alive = this.players.filter((p) => p.lives > 0);
    if (alive.length <= 1) {
      this.phase = "finished";
      this.winner = alive[0]?.slot ?? null;
      this.balls = [];
    }
  }
  forfeit(slot) {
    if (this.phase === "finished") return;
    const p = this.players[slot];
    if (p) p.lives = 0;
    this.finishIfNeeded();
  }
  step() {
    if (this.phase === "finished") return;
    this.tick++;
    if (this.phase === "countdown") {
      if (--this.countdown === 0) {
        this.phase = "playing";
        this.players.forEach((p) => this.spawn(p.slot));
      }
      return;
    }
    this.activeTicks++;
    for (const p of this.players) if (p.lives) p.t = p.target;
    const survivors = [];
    for (const b of this.balls) {
      let gone = false;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) / 60 / 2));
      for (let n = 0; n < steps && !gone; n++) {
        b.x += b.vx / (60 * steps);
        b.y += b.vy / (60 * steps);
        for (let side = 0; side < 4; side++) {
          const player = this.players[side],
            g = geometry(side, player?.t ?? 400);
          const incoming = b.vx * g.nx + b.vy * g.ny < 0;
          const normal = (b.x - g.x) * g.nx + (b.y - g.y) * g.ny;
          const tangent = (b.x - g.x) * g.tx + (b.y - g.y) * g.ty;
          if (
            player?.lives &&
            incoming &&
            normal <= 8 + b.r &&
            normal >= -8 - b.r &&
            Math.abs(tangent) <= 60 + 5 + b.r
          ) {
            const angle = clamp(tangent / 60, -1, 1) * 1.05,
              speed = 340;
            b.vx = (g.nx * Math.cos(angle) + g.tx * Math.sin(angle)) * speed;
            b.vy = (g.ny * Math.cos(angle) + g.ty * Math.sin(angle)) * speed;
            b.x = g.x + g.tx * tangent + g.nx * (8 + b.r + 0.01);
            b.y = g.y + g.ty * tangent + g.ny * (8 + b.r + 0.01);
            b.owner = side;
          }
          const position =
            side === 0
              ? 800 - b.y
              : side === 1
                ? 800 - b.x
                : side === 2
                  ? b.y
                  : b.x;
          if (!player?.lives && position < b.r && incoming) {
            if (side === 0) {
              b.y = 800 - b.r;
              b.vy = -Math.abs(b.vy);
            }
            if (side === 1) {
              b.x = 800 - b.r;
              b.vx = -Math.abs(b.vx);
            }
            if (side === 2) {
              b.y = b.r;
              b.vy = Math.abs(b.vy);
            }
            if (side === 3) {
              b.x = b.r;
              b.vx = Math.abs(b.vx);
            }
          }
          if (player?.lives && position < -b.r) {
            player.lives--;
            gone = true;
            if (player.lives) this.spawnQueue.push(side);
            break;
          }
        }
        if (gone || this.phase === "finished") break;
        for (const brick of this.bricks) {
          if (
            brick.dead ||
            b.x + b.r < brick.x ||
            b.x - b.r > brick.x + 32 ||
            b.y + b.r < brick.y ||
            b.y - b.r > brick.y + 32
          )
            continue;
          const options = [
            {
              d: Math.abs(b.x + b.r - brick.x),
              x: brick.x - b.r - 0.01,
              vx: -Math.abs(b.vx),
            },
            {
              d: Math.abs(brick.x + 32 - (b.x - b.r)),
              x: brick.x + 32 + b.r + 0.01,
              vx: Math.abs(b.vx),
            },
            {
              d: Math.abs(b.y + b.r - brick.y),
              y: brick.y - b.r - 0.01,
              vy: -Math.abs(b.vy),
            },
            {
              d: Math.abs(brick.y + 32 - (b.y - b.r)),
              y: brick.y + 32 + b.r + 0.01,
              vy: Math.abs(b.vy),
            },
          ].sort((a, c) => a.d - c.d);
          const hit = options[0];
          if (hit.x !== undefined) {
            b.x = hit.x;
            b.vx = hit.vx;
          } else {
            b.y = hit.y;
            b.vy = hit.vy;
          }
          brick.dead = true;
          this.players[b.owner].points += 100;
          break;
        }
      }
      if (!gone && this.phase !== "finished") survivors.push(b);
    }
    this.finishIfNeeded();
    if (this.phase !== "finished") {
      this.balls = survivors;
      for (const slot of this.spawnQueue) this.spawn(slot);
    }
    this.spawnQueue = [];
    this.bricks = this.bricks.filter((b) => !b.dead);
    if (this.activeTicks >= 36000 && this.phase !== "finished") {
      const ranked = [...this.players]
        .filter((p) => p.lives)
        .sort((a, b) => b.lives - a.lives || b.points - a.points);
      this.winner =
        ranked.length &&
        (!ranked[1] ||
          ranked[0].lives !== ranked[1].lives ||
          ranked[0].points !== ranked[1].points)
          ? ranked[0].slot
          : null;
      this.phase = "finished";
      this.balls = [];
    }
  }
  spawnQueue = [];
  snapshot() {
    return structuredClone({
      phase: this.phase,
      tick: this.tick,
      countdown: this.countdown,
      formation: this.formation,
      winner: this.winner,
      players: this.players,
      balls: this.balls,
      bricks: this.bricks,
    });
  }
}
export { geometry as arenaPaddle };
