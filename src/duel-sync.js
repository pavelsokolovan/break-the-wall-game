import { DUEL_RULES as R, viewInputToWorldX } from "../shared/duel-rules.js";

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const move = (x, target, ms, width) =>
  clamp(
    x +
      clamp(
        target - x,
        (-R.maximumPaddleSpeed * ms) / 1000,
        (R.maximumPaddleSpeed * ms) / 1000,
      ),
    width / 2,
    R.width - width / 2,
  );

/** Local monotonic time <-> server monotonic time; never controls server simulation. */
export class ServerClock {
  constructor() {
    this.reset();
  }
  reset() {
    this.offset = null;
    this.samples = [];
  }
  observe(serverTime, receivedAt) {
    if (this.offset === null) this.offset = serverTime - receivedAt;
  }
  sample(clientTime, serverTime, receivedAt) {
    const rtt = receivedAt - clientTime;
    if (
      ![clientTime, serverTime, receivedAt].every(Number.isFinite) ||
      rtt < 0 ||
      rtt > 10000
    )
      return false;
    this.samples.push({
      rtt,
      offset: serverTime - (clientTime + receivedAt) / 2,
    });
    if (this.samples.length > 8) this.samples.shift();
    this.offset = this.samples.reduce((a, b) =>
      a.rtt <= b.rtt ? a : b,
    ).offset;
    return true;
  }
  serverNow(localNow) {
    return localNow + (this.offset ?? 0);
  }
  localTime(serverTime) {
    return serverTime - (this.offset ?? 0);
  }
}

export class DuelSync {
  constructor({
    clock = new ServerClock(),
    interpolationMs = 100,
    correctionMs = 80,
    authoritativeContact = false,
    predictLocal = true,
  } = {}) {
    this.predictLocal = predictLocal;
    this.authoritativeContact = authoritativeContact;
    this.interpolationMs = interpolationMs;
    this.correctionMs = correctionMs;
    this.clock = clock;
    this.reset();
  }
  reset() {
    this.snapshots = [];
    this.pending = [];
    this.local = null;
    this.desired = null;
    this.desiredAt = 0;
    this.lastFrameAt = null;
    this.cursor = -Infinity;
    this.barrier = null;
    this.slot = null;
    this.lastRendered = null;
  }
  setTarget(normalizedX, now) {
    if (!this.local || this.slot === null || !Number.isFinite(normalizedX))
      return;
    const x = viewInputToWorldX(this.slot, clamp(normalizedX, 0, 1));
    if (x !== this.desired) {
      this.desired = x;
      this.desiredAt = now;
    }
  }
  recordInput({ seq, x, at }) {
    if (this.slot === null) return;
    this.pending.push({ seq, target: viewInputToWorldX(this.slot, x), at });
    if (this.pending.length > 128) this.pending.shift();
  }
  push(snapshot, receivedAt, slot) {
    this.clock.observe(snapshot.serverTime, receivedAt);
    const key = [
      snapshot.matchId,
      snapshot.phase,

      // Individual goals no longer reset movement: the other ball stays live.
    ].join(":");
    const last = this.snapshots.at(-1);
    if (
      last &&
      snapshot.matchId === last.snapshot.matchId &&
      snapshot.serverTime < last.snapshot.serverTime
    )
      return false;
    const changed = this.barrier !== key || this.slot !== slot;
    if (changed) this.reset();
    this.barrier = key;
    this.slot = slot;
    this.snapshots.push({ snapshot: structuredClone(snapshot), receivedAt });
    if (this.snapshots.length > 30) this.snapshots.shift();
    const p = snapshot.state.players[slot];
    if (changed || !this.local || snapshot.phase !== "playing") {
      this.local = { x: p.x, offset: 0, width: p.width, target: p.targetX };
      this.pending = [];
      this.desired = null;
      this.lastFrameAt = receivedAt;
    } else {
      this.pending = this.pending.filter((i) => i.seq > p.lastAckInputSeq);
      let x = p.x,
        target = p.targetX,
        cursor = clamp(
          this.clock.localTime(snapshot.serverTime),
          receivedAt - 250,
          receivedAt,
        );
      for (const input of this.pending) {
        const end = clamp(input.at, cursor, receivedAt);
        x = move(x, target, end - cursor, p.width);
        target = input.target;
        cursor = end;
      }
      if (this.desired !== null) {
        const end = clamp(this.desiredAt, cursor, receivedAt);
        x = move(x, target, end - cursor, p.width);
        target = this.desired;
        cursor = end;
      }
      x = move(x, target, receivedAt - cursor, p.width);
      this.local = {
        x,
        offset: this.local.x + this.local.offset - x,
        width: p.width,
        target,
      };
    }
    return true;
  }
  frame(now, connected = true) {
    const latest = this.snapshots.at(-1);
    if (!latest) return null;
    const stale = now - latest.receivedAt > 250;
    if (!connected && this.lastRendered)
      return { snapshot: structuredClone(this.lastRendered), stale: true };
    let snapshot = structuredClone(latest.snapshot);
    this.cursor = Math.max(
      this.cursor,
      this.clock.serverNow(now) - this.interpolationMs,
    );
    let left = this.snapshots[0].snapshot,
      right = left;
    for (const item of this.snapshots) {
      if (item.snapshot.serverTime <= this.cursor) left = item.snapshot;
      if (item.snapshot.serverTime >= this.cursor) {
        right = item.snapshot;
        break;
      }
      right = item.snapshot;
    }
    const interval = right.serverTime - left.serverTime;
    const t =
      interval > 0
        ? clamp((this.cursor - left.serverTime) / interval, 0, 1)
        : 1;
    const blend = (a, b) => a + (b - a) * t;
    const interpolate = (items, earlier, later) => {
      const a = new Map(earlier.map((e) => [e.id ?? e.slot, e])),
        b = new Map(later.map((e) => [e.id ?? e.slot, e]));
      for (const item of items) {
        const start = a.get(item.id ?? item.slot),
          end = b.get(item.id ?? item.slot);
        if (
          !start ||
          !end ||
          start.held !== end.held ||
          start.owner !== end.owner ||
          (Number.isFinite(start.vy) &&
            (Math.sign(start.vy) !== Math.sign(end.vy) ||
              Math.sign(start.vx) !== Math.sign(end.vx)))
        )
          continue;
        item.x = blend(start.x, end.x);
        if (Number.isFinite(start.y) && Number.isFinite(end.y))
          item.y = blend(start.y, end.y);
      }
    };
    let interpolateFrame = true;
    if (!this.predictLocal) {
      const previousBalls = new Map(left.state.balls.map((b) => [b.id, b]));
      const discontinuity =
        left.state.balls.length !== right.state.balls.length ||
        right.state.balls.some((b) => {
          const old = previousBalls.get(b.id);
          return (
            !old ||
            old.held !== b.held ||
            old.owner !== b.owner ||
            Math.sign(old.vx) !== Math.sign(b.vx) ||
            Math.sign(old.vy) !== Math.sign(b.vy)
          );
        }) ||
        left.state.players.some(
          (p, i) => p.width !== right.state.players[i].width,
        );
      // At a bounce/respawn, hold the complete earlier frame until the later
      // frame's time. Never mix a post-bounce ball with a pre-bounce paddle.
      snapshot = structuredClone(
        this.cursor >= right.serverTime ? right : left,
      );
      interpolateFrame = !discontinuity;
    }
    if (snapshot.phase === "playing" && interpolateFrame) {
      for (const key of ["players", "balls", "drops", "shots"])
        interpolate(snapshot.state[key], left.state[key], right.state[key]);
    }
    const dt =
      this.lastFrameAt === null ? 0 : clamp(now - this.lastFrameAt, 0, 50);
    this.lastFrameAt = now;
    if (snapshot.phase === "playing" && connected && !stale && this.local) {
      const previousDisplay = this.local.x + this.local.offset;
      this.local.x = move(
        this.local.x,
        this.desired ?? this.local.target,
        dt,
        this.local.width,
      );
      this.local.offset *= Math.exp(-dt / this.correctionMs);
      const displayed = move(
        previousDisplay,
        this.desired ?? this.local.x + this.local.offset,
        dt,
        this.local.width,
      );
      this.local.offset = displayed - this.local.x;
      if (this.predictLocal) snapshot.state.players[this.slot].x = displayed;
    } else if (this.local && this.predictLocal) {
      // Stale/disconnected frames keep the last local display, never accumulate motion.
      snapshot.state.players[this.slot].x = clamp(
        this.local.x + this.local.offset,
        this.local.width / 2,
        R.width - this.local.width / 2,
      );
    }
    // Keep balls current near contact, but never snap the local paddle away
    // from a held finger target. Only the server decides collisions.
    if (
      this.predictLocal &&
      this.authoritativeContact &&
      snapshot.phase === "playing"
    ) {
      for (const slot of [0, 1]) {
        const nearby = latest.snapshot.state.balls.filter(
          (b) => !b.held && Math.abs(b.y - R.paddleTopY[slot]) < 110,
        );
        if (!nearby.length) continue;
        if (slot !== this.slot)
          snapshot.state.players[slot].x =
            latest.snapshot.state.players[slot].x;
        for (const ball of nearby) {
          const rendered = snapshot.state.balls.find((b) => b.id === ball.id);
          if (rendered) {
            rendered.x = ball.x;
            rendered.y = ball.y;
          }
        }
      }
    }
    for (const b of snapshot.state.balls)
      if (b.held) {
        const p = snapshot.state.players[b.owner];
        b.x = p.x + clamp(b.heldOffsetX, -p.width / 2 + b.r, p.width / 2 - b.r);
      }
    this.lastRendered = structuredClone(snapshot);
    return { snapshot, stale };
  }
}
