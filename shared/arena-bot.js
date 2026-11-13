import { seeded } from "./game-helpers.js";
import { arenaPaddle } from "./arena-game.js";

/** Reacts to visible incoming balls using ordinary input; deliberately fallible. */
export class ArenaBot {
  constructor(slot, seed = 1) {
    this.slot = slot;
    this.random = seeded(seed);
    this.nextDecision = 0;
    this.tracking = null;
    this.error = 0;
    this.seq = 0;
  }
  update(game) {
    const player = game.players[this.slot];
    if (
      game.phase !== "playing" ||
      !player?.lives ||
      game.activeTicks < this.nextDecision
    )
      return;
    this.nextDecision = game.activeTicks + 9 + Math.floor(this.random() * 10);
    const pose = arenaPaddle(this.slot, player.t);
    const incoming = game.balls.filter(
      (ball) =>
        ball.vx * pose.nx + ball.vy * pose.ny < 0 &&
        (ball.x - pose.x) * pose.nx + (ball.y - pose.y) * pose.ny >= 0,
    );
    incoming.sort((a, b) => {
      const time = (ball) =>
        ((ball.x - pose.x) * pose.nx + (ball.y - pose.y) * pose.ny) /
        -(ball.vx * pose.nx + ball.vy * pose.ny);
      return time(a) - time(b);
    });
    const ball = incoming[0];
    if ((ball?.id ?? null) !== this.tracking) {
      this.tracking = ball?.id ?? null;
      this.error =
        (this.random() < 0.5 ? -1 : 1) *
        (this.random() < 0.22 ? 160 + this.random() * 100 : this.random() * 35);
    }
    const desired = ball
      ? (this.slot % 2 === 0 ? ball.x : ball.y) + this.error
      : 400;
    const target = Math.max(
      75,
      Math.min(
        725,
        Math.max(player.t - 100, Math.min(player.t + 100, desired)),
      ),
    );
    game.input(this.slot, { seq: ++this.seq, x: target / 800 });
  }
}
