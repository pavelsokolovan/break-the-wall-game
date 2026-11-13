/** Pure duel geometry. Positions are pixels, velocities px/s, durations ms. */
export const DUEL_RULES = Object.freeze({
  width: 800,
  height: 1000,
  paddleTopY: Object.freeze([918, 64]),
  paddleHeight: 18,
  paddleCollisionPadding: 5,
  initialCenterX: 400,
  initialPaddleWidth: 160,
  damageWidthDecrement: 20,
  minimumPaddleWidth: 100,
  keyboardSpeed: 720,
  maximumPaddleSpeed: 1800,
  ballRadius: 10,
  maximumBalls: 3,
  maximumReboundAngle: 1.13,
  simulationHz: 60,
  snapshotHz: 30,
  maximumInputHz: 60,
  initialCountdownMs: 3000,
  reconnectCountdownMs: 3000,
  serveCountdownMs: 2000,
  winningGoals: 5,
  activeDurationLimitMs: 900000,
  brickWidth: 86,
  brickHeight: 32,
  brickHorizontalGap: 8,
  brickVerticalGap: 8,
  brickColumns: 8,
});
export const PROTOCOL_VERSION = 1;
export const SESSION_FEATURE = "duel-paired-v1";
export const WEBSOCKET_PATH = "/ws";
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

function validate(slot, ...numbers) {
  if (slot !== 0 && slot !== 1) throw new RangeError("Invalid player slot");
  if (!numbers.every(Number.isFinite))
    throw new TypeError("Coordinates must be finite numbers");
}
/** @param {0|1} slot @param {{x:number,y:number}} point */
export function worldToViewPoint(slot, { x, y }) {
  validate(slot, x, y);
  return slot === 0 ? { x, y } : { x: 800 - x, y: 1000 - y };
}
export const viewToWorldPoint = worldToViewPoint;
export function worldToViewRect(slot, { x, y, w, h }) {
  validate(slot, x, y, w, h);
  return slot === 0
    ? { x, y, w, h }
    : { x: 800 - x - w, y: 1000 - y - h, w, h };
}
export function worldToViewVelocity(slot, { vx, vy }) {
  validate(slot, vx, vy);
  return slot === 0 ? { vx, vy } : { vx: -vx, vy: -vy };
}
export function viewInputToWorldX(slot, normalizedX) {
  validate(slot, normalizedX);
  if (normalizedX < 0 || normalizedX > 1)
    throw new RangeError("Input outside [0,1]");
  return 800 * (slot === 0 ? normalizedX : 1 - normalizedX);
}
export function normalizeRoomCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return code.length === ROOM_CODE_LENGTH &&
    [...code].every((c) => ROOM_CODE_ALPHABET.includes(c))
    ? code
    : null;
}
