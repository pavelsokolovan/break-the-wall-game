/** Deterministic RNG and paddle aiming shared by Solo and Duel. No I/O. */
export function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paddleBounce(offset, velocity) {
  let angle = Math.max(-1.13, Math.min(1.13, offset * 1.13));
  if (Math.abs(angle) < 0.26) angle = 0.26 * (angle < 0 ? -1 : 1);
  // Slow strokes keep contact-position aiming; fast strokes transfer lateral momentum.
  const stroke =
    (Math.sign(velocity) * Math.max(0, Math.abs(velocity) - 80)) / 1120;
  angle = Math.max(-1.13, Math.min(1.13, angle + stroke * 0.9));
  if (Math.abs(angle) < 0.12) angle = 0.12 * (angle < 0 ? -1 : 1);
  return angle;
}
