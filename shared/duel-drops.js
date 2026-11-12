import { HAZARDS, dropType } from "./drops.js";
import { DUEL_RULES as R } from "./duel-rules.js";

export const DROP_RULES = Object.freeze({
  speed: 150,
  rocketSpeed: 260,
  wormSpeed: 110,
  wormAmplitude: 55,
  wormPhaseSpeed: 6,
  hazardsPerOwner: 3,
  wideMs: 12000,
  slowMs: 10000,
  shieldMs: 15000,
  invulnerabilityMs: 1000,
});
/** Full duel table, with Repair replacing Solo extra life. */
export function duelDropType(roll, hazardsFull = false) {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1)
    throw new TypeError("Roll must be in [0,1)");
  const type = dropType(roll, hazardsFull);
  return type === "life" ? "repair" : type === "multi" ? "gem" : type;
}
export function dropHalfExtents(type) {
  return { x: type === "worm" ? 24 : 11, y: type === "rocket" ? 18 : 11 };
}
export function moveDuelDrop(drop, dt) {
  const direction = drop.owner === 0 ? 1 : -1;
  drop.motionPhase += DROP_RULES.wormPhaseSpeed * dt;
  drop.y +=
    direction *
    (drop.type === "rocket"
      ? DROP_RULES.rocketSpeed
      : drop.type === "worm"
        ? DROP_RULES.wormSpeed
        : DROP_RULES.speed) *
    dt;
  if (drop.type === "worm") {
    const half = dropHalfExtents(drop.type).x;
    drop.x = Math.max(
      half,
      Math.min(
        R.width - half,
        drop.baseX +
          direction * Math.sin(drop.motionPhase) * DROP_RULES.wormAmplitude,
      ),
    );
  }
}
/** Swept axis-aligned reward rectangle against the owner's moving paddle. */
export function dropTouchesPaddle(drop, from, paddle, startX) {
  const half = dropHalfExtents(drop.type);
  const origin = { x: from.x - startX, y: from.y };
  const delta = {
    x: drop.x - from.x - (paddle.x - startX),
    y: drop.y - from.y,
  };
  const low = {
    x: -paddle.width / 2 - half.x,
    y: R.paddleTopY[paddle.slot] - half.y,
  };
  const high = {
    x: paddle.width / 2 + half.x,
    y: R.paddleTopY[paddle.slot] + R.paddleHeight + half.y,
  };
  let enter = 0,
    leave = 1;
  for (const axis of ["x", "y"]) {
    if (Math.abs(delta[axis]) < 1e-12) {
      if (origin[axis] < low[axis] || origin[axis] > high[axis]) return false;
      continue;
    }
    const a = (low[axis] - origin[axis]) / delta[axis],
      b = (high[axis] - origin[axis]) / delta[axis];
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  return true;
}
export { HAZARDS };
