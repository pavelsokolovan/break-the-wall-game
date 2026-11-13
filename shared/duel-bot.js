import { DUEL_RULES as R } from "./duel-rules.js";
import { seeded } from "./game-helpers.js";

/** Fallible player: reacts to current visible balls, never changes physics or scores. */
export class DuelBot {
  constructor(slot, seed = 1) {
    this.slot = slot;
    this.random = seeded(seed);
    this.seq = 0;
    this.nextDecision = 0;
    this.tracking = null;
    this.error = 0;
  }
  update(game) {
    if (game.phase !== "playing") return;
    const now = game.state.activeDurationMs;
    if (now < this.nextDecision) return;
    this.nextDecision = now + 140 + this.random() * 160;
    const p = game.state.players[this.slot];
    const incoming = game.state.balls
      .filter((b) => !b.held && (this.slot === 0 ? b.vy > 0 : b.vy < 0))
      .sort(
        (a, b) =>
          Math.abs((R.paddleTopY[this.slot] - a.y) / a.vy) -
          Math.abs((R.paddleTopY[this.slot] - b.y) / b.vy),
      );
    const ball = incoming[0];
    if ((ball?.id ?? null) !== this.tracking) {
      this.tracking = ball?.id ?? null;
      const miss = this.random() < 0.22;
      this.error =
        (this.random() < 0.5 ? -1 : 1) *
        (miss ? 180 + this.random() * 100 : this.random() * 45);
    }
    let x = ball ? ball.x + this.error : 400;
    // Like keyboard movement, each decision has limited travel rather than teleporting.
    x = Math.max(
      p.x - R.keyboardSpeed * 0.25,
      Math.min(p.x + R.keyboardSpeed * 0.25, x),
    );
    x = Math.max(p.width / 2, Math.min(R.width - p.width / 2, x));
    const held = game.state.balls.some((b) => b.held && b.owner === this.slot);
    game.applyInput(this.slot, {
      seq: ++this.seq,
      x: this.slot === 0 ? x / R.width : 1 - x / R.width,
      action: held
        ? "release_fire"
        : p.ammo > 0 && this.random() < 0.35
          ? "fire"
          : "none",
    });
  }
}
