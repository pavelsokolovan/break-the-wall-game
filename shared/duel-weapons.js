import { DUEL_RULES as R } from "./duel-rules.js";

export const WEAPON_RULES = Object.freeze({
  stickyCatches: 3,
  heldMs: 3000,
  ammoPerPickup: 5,
  maximumAmmo: 15,
  shotSpeed: 720,
  cooldownMs: 250,
  splitAngle: 0.45,
});
export function shotBounds(shot) {
  return {
    x: shot.x - 4,
    y: shot.y - (shot.owner === 0 ? 10 : 17),
    w: 8,
    h: 27,
  };
}
export function shotSpawnY(slot) {
  return slot === 0
    ? R.paddleTopY[0] - 24
    : R.paddleTopY[1] + R.paddleHeight + 24;
}
