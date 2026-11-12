import { WEAPON_RULES, shotBounds, shotSpawnY } from "./duel-weapons.js";
import {
  DROP_RULES,
  HAZARDS,
  duelDropType,
  dropHalfExtents,
  moveDuelDrop,
  dropTouchesPaddle,
} from "./duel-drops.js";
import { makeDuelWall, canSpawnWall } from "./duel-walls.js";
import { sweepCircleRect, sweepAabb } from "./duel-collision.js";
import { DUEL_RULES as R, viewInputToWorldX } from "./duel-rules.js";
import { seeded, paddleBounce } from "./game-helpers.js";
import { toPublicDuelState } from "./duel-protocol.js";

const DT = 1 / R.simulationHz;
const EPS = 1e-8;
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const timerFields = [
  "comboRemainingMs",
  "fireCooldownMs",
  "wideRemainingMs",
  "slowRemainingMs",
  "shieldRemainingMs",
  "invulnerabilityRemainingMs",
];
function player(slot) {
  return {
    slot,
    x: R.initialCenterX,
    targetX: R.initialCenterX,
    vx: 0,
    width: R.initialPaddleWidth,
    damage: 0,
    points: 0,
    comboCount: 0,
    shieldCharges: 0,
    vestCharges: 0,
    stickyCharges: 0,
    ammo: 0,
    ...Object.fromEntries(timerFields.map((key) => [key, 0])),
    connected: true,
    lastAckInputSeq: 0,
  };
}

// Sweep an approaching circle against the front face and rounded front corners.
// Relative x removes the paddle's linear motion over this microstep.
function paddleContact(x, y, dx, dy, halfWidth, radius, face) {
  if (dy <= 0 || y > face + EPS) return null;
  let first = Infinity;
  const t = (face - radius - y) / dy;
  if (t >= -EPS && t <= 1 + EPS && Math.abs(x + dx * t) <= halfWidth)
    first = clamp(t, 0, 1);
  for (const corner of [-halfWidth, halfWidth]) {
    const ox = x - corner,
      oy = y - face;
    const a = dx * dx + dy * dy,
      b = 2 * (ox * dx + oy * dy);
    const c = ox * ox + oy * oy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0 || a === 0) continue;
    const hit = (-b - Math.sqrt(discriminant)) / (2 * a);
    const hx = x + dx * hit,
      hy = y + dy * hit;
    if (
      hit >= -EPS &&
      hit <= 1 + EPS &&
      hy <= face + EPS &&
      (corner < 0 ? hx <= corner : hx >= corner)
    )
      first = Math.min(first, clamp(hit, 0, 1));
  }
  return Number.isFinite(first) ? first : null;
}

/** Pure authoritative simulation. Only trusted server/test code may mutate state. */
export class DuelGame {
  constructor({ seed, matchId } = {}) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new TypeError("seed must be uint32");
    if (typeof matchId !== "string" || !matchId.length || matchId.length > 128)
      throw new TypeError("Invalid matchId");
    this.matchId = matchId;
    this.random = seeded(seed);
    this.phase = "lobby";
    this.tick = 0;
    this.state = {
      wave: 1,
      goals: [0, 0],
      servingSlot: 0,
      countdownRemainingMs: 0,
      activeDurationMs: 0,
      pause: null,
      players: [player(0), player(1)],
      balls: [],
      bricks: [],
      drops: [],
      shots: [],
    };
    this.nextEntityId = 1;
    this.nextEventId = 1;
    this.events = [];
    this.serveSign = 1;
    this.activeTicks = 0;
    this.countdownTicks = 0;
    this.result = null;
    this.pendingWall = null;
    this.comboUntil = [0, 0];
    this.pendingActions = [
      { release: false, fire: false },
      { release: false, fire: false },
    ];
  }
  start() {
    if (this.phase !== "lobby") return false;
    this.state.servingSlot = this.random() < 0.5 ? 0 : 1;
    this.state.bricks = makeDuelWall(1, this.random, () => this.nextEntityId++);
    this.emit("wave_started", { wave: 1 });
    this.beginCountdown("countdown", R.initialCountdownMs);
    return true;
  }
  /** @param {0|1} slot @param {import('./duel-protocol.js').DuelInput} input */
  applyInput(slot, input) {
    if (this.phase !== "playing" || (slot !== 0 && slot !== 1) || !input)
      return false;
    const { seq, x, action } = input,
      p = this.state.players[slot];
    if (
      !Number.isSafeInteger(seq) ||
      seq <= p.lastAckInputSeq ||
      !Number.isFinite(x) ||
      x < 0 ||
      x > 1 ||
      !["none", "release_fire", "fire"].includes(action)
    )
      return false;
    p.targetX = viewInputToWorldX(slot, x);
    p.lastAckInputSeq = seq;
    if (action === "release_fire") this.pendingActions[slot].release = true;
    if (action !== "none") this.pendingActions[slot].fire = true;
    return true;
  }
  clearMovement() {
    this.pendingActions = [
      { release: false, fire: false },
      { release: false, fire: false },
    ];
    for (const p of this.state.players) {
      p.targetX = p.x;
      p.vx = 0;
    }
  }
  setPaused(paused) {
    if (typeof paused !== "boolean") return false;
    if (
      paused &&
      ["playing", "countdown", "goal_countdown"].includes(this.phase)
    ) {
      this.resumePhase = this.phase;
      this.phase = "paused";
      this.clearMovement();
      return true;
    }
    if (!paused && this.phase === "paused") {
      this.phase = this.resumePhase;
      this.clearMovement();
      return true;
    }
    return false;
  }
  getState() {
    return toPublicDuelState(this.state);
  }
  getResult() {
    return this.result ? structuredClone(this.result) : null;
  }
  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }
  emit(type, fields) {
    this.events.push({
      id: this.nextEventId++,
      tick: this.tick,
      type,
      ...fields,
    });
  }
  beginCountdown(phase, durationMs) {
    this.phase = phase;
    this.countdownTicks = Math.round((durationMs * R.simulationHz) / 1000);
    this.state.countdownRemainingMs =
      (this.countdownTicks * 1000) / R.simulationHz;
    this.clearMovement();
  }
  ballSpeed(owner) {
    const p = this.state.players[owner];
    return (
      Math.min(360 + 25 * (this.state.wave - 1), 585) *
      (1 + 0.12 * p.damage) *
      (p.slowRemainingMs > 0 ? 0.65 : 1)
    );
  }
  serve() {
    const slot = this.state.servingSlot,
      p = this.state.players[slot],
      speed = this.ballSpeed(slot);
    const direction = slot === 0 ? 1 : -1,
      angle = (this.serveSign * Math.PI) / 12;
    this.state.balls.push({
      id: this.nextEntityId++,
      x: p.x,
      y:
        slot === 0
          ? R.paddleTopY[0] - R.ballRadius - 1
          : R.paddleTopY[1] + R.paddleHeight + R.ballRadius + 1,
      vx: direction * Math.sin(angle) * speed,
      vy: -direction * Math.cos(angle) * speed,
      r: R.ballRadius,
      owner: slot,
      held: false,
      heldOffsetX: 0,
      autoReleaseRemainingMs: 0,
    });
    this.serveSign *= -1;
    this.phase = "playing";
    this.emit("serve", { servingSlot: slot });
  }
  resetRally() {
    this.comboUntil = [0, 0];
    this.pendingActions = [
      { release: false, fire: false },
      { release: false, fire: false },
    ];
    this.state.balls = [];
    this.state.drops = [];
    this.state.shots = [];
    for (const p of this.state.players) {
      for (const key of timerFields) p[key] = 0;
      p.comboCount = 0;
      p.shieldCharges = 0;
      p.vestCharges = 0;
      p.stickyCharges = 0;
      p.ammo = 0;
      p.width = Math.max(
        R.minimumPaddleWidth,
        R.initialPaddleWidth - p.damage * R.damageWidthDecrement,
      );
      p.x = clamp(p.x, p.width / 2, R.width - p.width / 2);
    }
    this.clearMovement();
  }
  resolveGoals(exits) {
    if (!exits.size) return;
    this.resetRally();
    if (exits.size === 2) {
      this.emit("rally_replay", { servingSlot: this.state.servingSlot });
      this.beginCountdown("goal_countdown", R.serveCountdownMs);
      return;
    }
    const scorer = [...exits][0],
      conceding = 1 - scorer,
      p = this.state.players[conceding];
    this.state.goals[scorer]++;
    p.damage = Math.min(3, p.damage + 1);
    p.width = R.initialPaddleWidth - p.damage * R.damageWidthDecrement;
    this.state.servingSlot = conceding;
    this.emit("goal", { scorer, goals: [...this.state.goals] });
    if (this.state.goals[scorer] >= R.winningGoals) {
      this.finish(scorer, "five_goals");
    } else this.beginCountdown("goal_countdown", R.serveCountdownMs);
  }
  /** Trusted room-layer terminal hook; no client can choose the winner. */
  finish(winner, reason) {
    if (
      !["playing", "countdown", "goal_countdown", "paused"].includes(
        this.phase,
      ) ||
      ![0, 1, null].includes(winner) ||
      !["five_goals", "forfeit", "time_limit"].includes(reason)
    )
      return false;
    this.resetRally();
    this.phase = "finished";
    this.pendingWall = null;
    this.state.countdownRemainingMs = 0;
    this.result = {
      v: 1,
      type: "result",
      matchId: this.matchId,
      winner,
      reason,
      goals: [...this.state.goals],
      points: this.state.players.map((p) => p.points),
      durationMs: this.state.activeDurationMs,
      waveCount: this.state.wave,
    };
    this.emit("match_finished", { winner, reason });
    return true;
  }
  followHeldBalls() {
    for (const b of this.state.balls)
      if (b.held) {
        const p = this.state.players[b.owner];
        b.heldOffsetX = clamp(
          b.heldOffsetX,
          -p.width / 2 + b.r,
          p.width / 2 - b.r,
        );
        b.x = p.x + b.heldOffsetX;
        b.y =
          b.owner === 0
            ? R.paddleTopY[0] - b.r - 1
            : R.paddleTopY[1] + R.paddleHeight + b.r + 1;
        b.vx = 0;
        b.vy = 0;
      }
  }
  releaseHeld(slot, automatic = false, ballId = null) {
    if (this.phase !== "playing" || ![0, 1].includes(slot)) return false;
    this.followHeldBalls();
    const p = this.state.players[slot],
      sign = slot === 0 ? 1 : -1;
    let released = false;
    for (const b of [...this.state.balls].sort((a, b) => a.id - b.id))
      if (b.held && b.owner === slot && (ballId === null || b.id === ballId)) {
        const angle = paddleBounce(
            (sign * b.heldOffsetX) / (p.width / 2),
            sign * p.vx,
          ),
          speed = this.ballSpeed(slot);
        b.held = false;
        b.autoReleaseRemainingMs = 0;
        b.owner = slot;
        b.vx = sign * Math.sin(angle) * speed;
        b.vy = -sign * Math.cos(angle) * speed;
        this.emit("ball_released", { ballId: b.id, owner: slot, automatic });
        released = true;
      }
    return released;
  }
  fire(slot) {
    if (this.phase !== "playing" || ![0, 1].includes(slot)) return false;
    const p = this.state.players[slot];
    if (p.ammo <= 0 || p.fireCooldownMs > 0) return false;
    p.ammo--;
    p.fireCooldownMs = WEAPON_RULES.cooldownMs;
    const shot = {
      id: this.nextEntityId++,
      owner: slot,
      x: p.x,
      y: shotSpawnY(slot),
    };
    this.state.shots.push(shot);
    this.emit("shot_fired", {
      shotId: shot.id,
      owner: slot,
      x: shot.x,
      y: shot.y,
    });
    return true;
  }
  processActions() {
    this.followHeldBalls();
    const pending = this.pendingActions;
    this.pendingActions = [
      { release: false, fire: false },
      { release: false, fire: false },
    ];
    for (const slot of [0, 1]) {
      if (pending[slot].release) this.releaseHeld(slot);
      if (pending[slot].fire) this.fire(slot);
    }
    for (const b of [...this.state.balls].sort((a, b) => a.id - b.id))
      if (b.held) {
        b.autoReleaseRemainingMs = Math.max(
          0,
          b.autoReleaseRemainingMs - DT * 1000,
        );
        if (b.autoReleaseRemainingMs < 1e-7)
          this.releaseHeld(b.owner, true, b.id);
      }
  }
  splitBalls(owner) {
    const source = [...this.state.balls].sort((a, b) => a.id - b.id);
    const base = source.find((b) => b.owner === owner) || source[0];
    const count = Math.min(2, R.maximumBalls - source.length);
    if (!base || count <= 0) return 500;
    const sign = owner === 0 ? 1 : -1,
      speed = this.ballSpeed(owner);
    for (const angle of [
      -WEAPON_RULES.splitAngle,
      WEAPON_RULES.splitAngle,
    ].slice(0, count)) {
      const b = {
        id: this.nextEntityId++,
        x: base.x,
        y: base.y,
        vx: sign * Math.sin(angle) * speed,
        vy: -sign * Math.cos(angle) * speed,
        r: R.ballRadius,
        owner,
        held: false,
        heldOffsetX: 0,
        autoReleaseRemainingMs: 0,
      };
      this.state.balls.push(b);
      this.emit("ball_split", { ballId: b.id, sourceBallId: base.id, owner });
    }
    return 0;
  }

  updatePaddleWidth(p) {
    p.width =
      Math.max(
        R.minimumPaddleWidth,
        R.initialPaddleWidth - p.damage * R.damageWidthDecrement,
      ) * (p.wideRemainingMs > 0 ? 1.5 : 1);
    const before = p.x;
    p.x = clamp(p.x, p.width / 2, R.width - p.width / 2);
    p.targetX = clamp(p.targetX, p.width / 2, R.width - p.width / 2);
    if (p.x !== before) p.vx = 0;
  }
  updatePowerTimers() {
    for (const p of this.state.players) {
      for (const key of timerFields)
        if (key !== "comboRemainingMs") {
          const remaining = Math.max(0, p[key] - DT * 1000);
          p[key] = remaining < 1e-7 ? 0 : remaining;
        }
      if (!p.shieldRemainingMs) p.shieldCharges = 0;
      this.updatePaddleWidth(p);
    }
  }
  spawnBrickDrop(brick, owner) {
    const full =
      this.state.drops.filter((d) => d.owner === owner && HAZARDS.has(d.type))
        .length >= DROP_RULES.hazardsPerOwner;
    const type = duelDropType(this.random(), full);
    if (!type) return;
    const drop = {
      id: this.nextEntityId++,
      type,
      owner,
      x: brick.x + brick.w / 2,
      y: brick.y + brick.h / 2,
      baseX: brick.x + brick.w / 2,
      motionPhase: 0,
    };
    this.state.drops.push(drop);
    this.emit("drop_spawned", {
      dropId: drop.id,
      owner,
      dropType: type,
      x: drop.x,
      y: drop.y,
    });
  }
  collectReward(drop) {
    const p = this.state.players[drop.owner];
    let points = 0;
    switch (drop.type) {
      case "sticky":
        p.stickyCharges = WEAPON_RULES.stickyCatches;
        break;
      case "bazooka":
        p.ammo = Math.min(
          WEAPON_RULES.maximumAmmo,
          p.ammo + WEAPON_RULES.ammoPerPickup,
        );
        break;
      case "multi":
        points = this.splitBalls(drop.owner);
        break;
      case "gem":
        points = 500;
        break;
      case "wide":
        p.wideRemainingMs = DROP_RULES.wideMs;
        break;
      case "slow":
        p.slowRemainingMs = DROP_RULES.slowMs;
        break;
      case "shield":
        p.shieldCharges = 1;
        p.shieldRemainingMs = DROP_RULES.shieldMs;
        break;
      case "vest":
        p.vestCharges = 2;
        break;
      case "repair":
        if (p.damage) p.damage--;
        else points = 1000;
        break;
      default:
        return;
    }
    p.points += points;
    this.updatePaddleWidth(p);
    this.emit("pickup", {
      dropId: drop.id,
      owner: drop.owner,
      dropType: drop.type,
      points,
    });
  }
  applyHazard(drop) {
    const p = this.state.players[drop.owner];
    let defense;
    if (p.invulnerabilityRemainingMs > 0) defense = "invulnerability";
    else if (p.shieldCharges > 0) {
      defense = "shield";
      p.shieldCharges = 0;
      p.shieldRemainingMs = 0;
    } else if (p.vestCharges > 0) {
      defense = "vest";
      p.vestCharges--;
    }
    if (defense)
      this.emit("hazard_blocked", {
        dropId: drop.id,
        owner: drop.owner,
        defense,
      });
    else {
      p.damage = Math.min(3, p.damage + 1);
      p.invulnerabilityRemainingMs = DROP_RULES.invulnerabilityMs;
      this.updatePaddleWidth(p);
      this.emit("hazard_damage", {
        dropId: drop.id,
        owner: drop.owner,
        damage: p.damage,
      });
    }
  }
  advanceDrops(starts, rallyReset) {
    const paths = new Map(),
      caught = new Set();
    for (const d of this.state.drops) {
      paths.set(d.id, { x: d.x, y: d.y });
      moveDuelDrop(d, DT);
    }
    const touches = (d) =>
      dropTouchesPaddle(
        d,
        paths.get(d.id),
        this.state.players[d.owner],
        starts[d.owner],
      );
    const armor = (type) => (["shield", "vest"].includes(type) ? 0 : 1);
    const rewards = this.state.drops
      .filter((d) => !HAZARDS.has(d.type) && touches(d))
      .sort((a, b) => armor(a.type) - armor(b.type) || a.id - b.id);
    for (const d of rewards) {
      this.collectReward(d);
      caught.add(d.id);
    }
    for (const d of [...this.state.drops].sort((a, b) => a.id - b.id))
      if (HAZARDS.has(d.type) && touches(d)) {
        caught.add(d.id);
        if (!rallyReset) this.applyHazard(d);
      }
    this.state.drops = this.state.drops.filter(
      (d) =>
        !caught.has(d.id) &&
        (d.owner === 0
          ? d.y - dropHalfExtents(d.type).y <= R.height
          : d.y + dropHalfExtents(d.type).y >= 0),
    );
  }

  updateCombos() {
    for (const p of this.state.players) {
      p.comboRemainingMs =
        (Math.max(0, this.comboUntil[p.slot] - this.activeTicks) * 1000) /
        R.simulationHz;
      if (!p.comboRemainingMs) p.comboCount = 0;
    }
  }
  /** Trusted simulation damage entry point; owner propagates through explosive chains. */
  hitBrick(brickId, owner) {
    if (this.phase !== "playing" || ![0, 1].includes(owner)) return false;
    const first = this.state.bricks.find((b) => b.id === brickId);
    if (!first) return false;
    const queue = [first];
    for (let i = 0; i < queue.length; i++) {
      const b = queue[i];
      if (b.type === "steel") {
        this.emit("brick_hit", { brickId: b.id, owner, hp: null });
        continue;
      }
      if (b.hp <= 0) continue;
      b.hp--;
      if (b.hp > 0) {
        this.emit("brick_hit", { brickId: b.id, owner, hp: b.hp });
        continue;
      }
      const p = this.state.players[owner];
      p.comboCount =
        this.comboUntil[owner] > this.activeTicks ? p.comboCount + 1 : 1;
      this.comboUntil[owner] = this.activeTicks + 120;
      p.comboRemainingMs = 2000;
      const multiplier = Math.min(4, 1 + Math.floor(p.comboCount / 5));
      const points =
        { standard: 100, armored: 250, reinforced: 450, explosive: 150 }[
          b.type
        ] * multiplier;
      p.points += points;
      this.emit("brick_destroyed", {
        brickId: b.id,
        owner,
        points,
        x: b.x + b.w / 2,
        y: b.y + b.h / 2,
        brickType: b.type,
      });
      this.spawnBrickDrop(b, owner);
      if (b.type === "explosive") {
        this.emit("explosion", {
          brickId: b.id,
          owner,
          x: b.x + b.w / 2,
          y: b.y + b.h / 2,
        });
        queue.push(
          ...this.state.bricks
            .filter(
              (near) =>
                near.type !== "steel" &&
                near.hp > 0 &&
                Math.abs(near.r - b.r) <= 1 &&
                Math.abs(near.c - b.c) <= 1,
            )
            .sort((a, b) => a.r - b.r || a.c - b.c || a.id - b.id),
        );
      }
    }
    this.state.bricks = this.state.bricks.filter(
      (b) => b.type === "steel" || b.hp > 0,
    );
    return true;
  }
  updateWave() {
    if (!this.pendingWall) {
      if (this.state.bricks.some((b) => b.type !== "steel")) return;
      this.state.bricks = [];
      this.pendingWall = {
        bricks: makeDuelWall(
          this.state.wave + 1,
          this.random,
          () => this.nextEntityId++,
        ),
        ticks: 120,
      };
      this.emit("wave_cleared", { wave: this.state.wave });
      return;
    }
    this.pendingWall.ticks = Math.max(0, this.pendingWall.ticks - 1);
    if (
      this.pendingWall.ticks ||
      !canSpawnWall(this.pendingWall.bricks, this.state)
    )
      return;
    this.state.bricks = this.pendingWall.bricks;
    this.pendingWall = null;
    this.state.wave++;
    for (const p of this.state.players) {
      p.damage = 0;
      p.width = R.initialPaddleWidth * (p.wideRemainingMs > 0 ? 1.5 : 1);
      p.x = clamp(p.x, p.width / 2, R.width - p.width / 2);
      p.targetX = clamp(p.targetX, p.width / 2, R.width - p.width / 2);
      p.vx = 0;
    }
    this.emit("wave_started", { wave: this.state.wave });
  }
  advanceBalls(starts) {
    const travel = Math.max(
      R.maximumPaddleSpeed,
      WEAPON_RULES.shotSpeed,
      ...this.state.balls.map((b) => Math.hypot(b.vx, b.vy)),
    );
    const steps = Math.max(1, Math.ceil((travel * DT) / 4)),
      sub = DT / steps;
    const exits = new Set(),
      gone = new Set(),
      damaged = new Set(),
      consumedShots = new Set();
    const collectExits = () => {
      for (const b of this.state.balls) {
        if (b.held) continue;
        if (b.y - b.r > R.height) {
          exits.add(1);
          gone.add(b.id);
        }
        if (b.y + b.r < 0) {
          exits.add(0);
          gone.add(b.id);
        }
      }
    };
    collectExits();
    for (let j = 0; j < steps; j++) {
      let remaining = sub,
        elapsed = 0;
      // Flying balls and shots advance together to the earliest contact, independent of array order.
      for (
        let iteration = 0;
        remaining > 1e-10 && iteration < 48;
        iteration++
      ) {
        let best = null;
        const consider = (candidate) => {
          if (candidate.t < -EPS || candidate.t > 1 + EPS) return;
          candidate.t = clamp(candidate.t, 0, 1);
          if (
            !best ||
            candidate.t < best.t - EPS ||
            (Math.abs(candidate.t - best.t) <= EPS &&
              (candidate.ball.id < best.ball.id ||
                (candidate.ball.id === best.ball.id &&
                  candidate.targetId < best.targetId)))
          )
            best = candidate;
        };
        for (const b of this.state.balls) {
          if (gone.has(b.id) || b.held) continue;
          const dx = b.vx * remaining,
            dy = b.vy * remaining;
          if (dx < 0)
            consider({
              ball: b,
              targetId: -2,
              kind: "wall",
              t: (b.r - b.x) / dx,
              nx: 1,
              ny: 0,
            });
          if (dx > 0)
            consider({
              ball: b,
              targetId: -1,
              kind: "wall",
              t: (R.width - b.r - b.x) / dx,
              nx: -1,
              ny: 0,
            });
          const slot = b.vy > 0 ? 0 : 1,
            sign = slot === 0 ? 1 : -1,
            p = this.state.players[slot];
          const pStart =
            starts[slot] + ((p.x - starts[slot]) * (j * sub + elapsed)) / DT;
          const t = paddleContact(
            sign * (b.x - pStart),
            slot === 0 ? b.y : R.height - b.y,
            sign * (dx - p.vx * remaining),
            sign * dy,
            p.width / 2,
            b.r,
            R.paddleTopY[0],
          );
          if (t !== null)
            consider({ ball: b, targetId: -4 + slot, kind: "paddle", t, slot });
          for (const brick of this.state.bricks) {
            const contact = sweepCircleRect(b, dx, dy, brick);
            if (contact)
              consider({
                ball: b,
                targetId: brick.id,
                kind: "brick",
                brick,
                ...contact,
              });
          }
        }
        for (const shot of this.state.shots) {
          if (consumedShots.has(shot.id)) continue;
          const dy =
            (shot.owner === 0 ? -1 : 1) * WEAPON_RULES.shotSpeed * remaining;
          const bounds = shotBounds(shot);
          for (const brick of this.state.bricks) {
            const t = sweepAabb(bounds, 0, dy, brick);
            if (t !== null)
              consider({
                ball: shot,
                targetId: brick.id,
                kind: "shot_brick",
                brick,
                t,
              });
          }
          for (const drop of this.state.drops)
            if (HAZARDS.has(drop.type)) {
              const half = dropHalfExtents(drop.type);
              const t = sweepAabb(bounds, 0, dy, {
                x: drop.x - half.x,
                y: drop.y - half.y,
                w: half.x * 2,
                h: half.y * 2,
              });
              if (t !== null)
                consider({
                  ball: shot,
                  targetId: drop.id,
                  kind: "shot_hazard",
                  drop,
                  t,
                });
            }
        }
        const duration = remaining * (best ? best.t : 1);
        for (const b of this.state.balls)
          if (!gone.has(b.id) && !b.held) {
            b.x += b.vx * duration;
            b.y += b.vy * duration;
          }
        for (const shot of this.state.shots)
          if (!consumedShots.has(shot.id))
            shot.y +=
              (shot.owner === 0 ? -1 : 1) * WEAPON_RULES.shotSpeed * duration;
        elapsed += duration;
        remaining = Math.max(0, remaining - duration);
        collectExits();
        if (!best) break;
        const b = best.ball;
        if (best.kind === "shot_hazard") {
          consumedShots.add(b.id);
          this.state.drops = this.state.drops.filter(
            (d) => d.id !== best.drop.id,
          );
          this.state.players[b.owner].points += 100;
          this.emit("hazard_intercepted", {
            shotId: b.id,
            dropId: best.drop.id,
            owner: b.owner,
            points: 100,
            x: best.drop.x,
            y: best.drop.y,
          });
        } else if (best.kind === "shot_brick") {
          consumedShots.add(b.id);
          this.emit("shot_hit", {
            shotId: b.id,
            owner: b.owner,
            brickId: best.brick.id,
          });
          this.hitBrick(best.brick.id, b.owner);
        } else if (best.kind === "paddle") {
          const p = this.state.players[best.slot],
            sign = best.slot === 0 ? 1 : -1;
          const contactP =
            starts[best.slot] +
            ((p.x - starts[best.slot]) * (j * sub + elapsed)) / DT;
          const angle = paddleBounce(
              (sign * (b.x - contactP)) / (p.width / 2),
              sign * p.vx,
            ),
            speed = this.ballSpeed(best.slot);
          b.owner = best.slot;
          b.vx = sign * Math.sin(angle) * speed;
          b.vy = -sign * Math.cos(angle) * speed;
          b.y =
            best.slot === 0
              ? R.paddleTopY[0] - b.r - EPS
              : R.paddleTopY[1] + R.paddleHeight + b.r + EPS;
          this.emit("paddle_hit", { slot: best.slot, ballId: b.id });
          if (p.stickyCharges > 0) {
            p.stickyCharges--;
            b.held = true;
            b.heldOffsetX = clamp(
              b.x - contactP,
              -p.width / 2 + b.r,
              p.width / 2 - b.r,
            );
            b.autoReleaseRemainingMs = WEAPON_RULES.heldMs;
            b.vx = 0;
            b.vy = 0;
            this.emit("ball_held", { ballId: b.id, owner: best.slot });
          }
        } else {
          const dot = b.vx * best.nx + b.vy * best.ny;
          b.vx -= 2 * dot * best.nx;
          b.vy -= 2 * dot * best.ny;
          b.x += best.nx * EPS;
          b.y += best.ny * EPS;
          if (best.kind === "brick") {
            const key = `${b.id}:${best.brick.id}`;
            if (!damaged.has(key)) {
              damaged.add(key);
              this.hitBrick(best.brick.id, b.owner);
            }
          }
        }
      }
      collectExits();
    }
    this.state.shots = this.state.shots.filter(
      (s) =>
        !consumedShots.has(s.id) &&
        (s.owner === 0
          ? shotBounds(s).y + shotBounds(s).h >= 0
          : shotBounds(s).y <= R.height),
    );
    this.followHeldBalls();
    return exits;
  }

  step() {
    if (!["playing", "countdown", "goal_countdown"].includes(this.phase))
      return;
    this.tick++;
    if (this.phase !== "playing") {
      this.countdownTicks--;
      this.state.countdownRemainingMs =
        (this.countdownTicks * 1000) / R.simulationHz;
      if (this.countdownTicks === 0) this.serve();
      return;
    }
    this.state.activeDurationMs = (++this.activeTicks * 1000) / R.simulationHz;
    if (this.state.activeDurationMs >= R.activeDurationLimitMs) {
      const [a, b] = this.state.goals;
      this.finish(a === b ? null : a > b ? 0 : 1, "time_limit");
      return;
    }
    this.updatePowerTimers();
    this.updateCombos();
    const starts = this.state.players.map((p) => p.x);
    for (const p of this.state.players) {
      const target = clamp(p.targetX, p.width / 2, R.width - p.width / 2);
      p.x += clamp(
        target - p.x,
        -R.maximumPaddleSpeed * DT,
        R.maximumPaddleSpeed * DT,
      );
      p.vx = (p.x - starts[p.slot]) / DT;
    }
    this.processActions();
    const exits = this.advanceBalls(starts);
    this.advanceDrops(starts, exits.size > 0);
    this.resolveGoals(exits);
    if (!exits.size) this.updateWave();
    this.followHeldBalls();
  }
}
