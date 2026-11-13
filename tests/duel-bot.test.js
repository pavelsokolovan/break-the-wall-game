import test from "node:test";
import assert from "node:assert/strict";
import { DuelBot } from "../shared/duel-bot.js";
import { DuelGame } from "../shared/duel-game.js";

test("bot uses bounded ordinary inputs, reaction intervals and never thinks while paused", () => {
  const bot = new DuelBot(1, 7),
    calls = [];
  const game = {
    phase: "playing",
    state: {
      activeDurationMs: 0,
      players: [{}, { x: 400, width: 160, ammo: 0 }],
      balls: [{ id: 1, x: 600, y: 400, vy: -360, held: false }],
    },
    applyInput: (slot, input) => calls.push({ slot, ...input }),
  };
  bot.update(game);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].slot, 1);
  assert(calls[0].x >= 0 && calls[0].x <= 1);
  assert(Math.abs(800 * (1 - calls[0].x) - 400) <= 180);
  game.state.activeDurationMs = 100;
  bot.update(game);
  assert.equal(calls.length, 1);
  game.phase = "paused";
  game.state.activeDurationMs = 1000;
  bot.update(game);
  assert.equal(calls.length, 1);
});
test("seeded bot matches are reproducible and bots concede real goals", () => {
  function run() {
    const game = new DuelGame({ seed: 8, matchId: "bot" });
    game.start();
    const bots = [new DuelBot(0, 4), new DuelBot(1, 17)];
    let hits = 0;
    for (let i = 0; i < 30000 && game.phase !== "finished"; i++) {
      bots.forEach((bot) => bot.update(game));
      game.step();
      hits += game.drainEvents().filter((e) => e.type === "paddle_hit").length;
    }
    return { state: game.getState(), result: game.getResult(), hits };
  }
  const a = run(),
    b = run();
  assert.deepEqual(a, b);
  assert(a.hits > 0);
  assert(a.state.goals[0] > 0);
  assert(a.state.goals[1] > 0);
  assert(a.result);
});
