const EPS = 1e-8;
export const freeBall = (b) => !b.held && !b.stuck;

/** Swept circle/circle time of impact, normalized to the supplied duration. */
export function sweepBalls(a, b, duration) {
  const x = b.x - a.x,
    y = b.y - a.y,
    radius = a.r + b.r;
  const dx = (b.vx - a.vx) * duration,
    dy = (b.vy - a.vy) * duration;
  const approach = x * dx + y * dy;
  if (approach >= -EPS) return null;
  const gap = x * x + y * y - radius * radius;
  if (gap <= EPS) return 0;
  const speed = dx * dx + dy * dy;
  const disc = approach * approach - speed * gap;
  if (!speed || disc < 0) return null;
  const t = gap / (-approach + Math.sqrt(disc));
  return t >= -EPS && t <= 1 + EPS ? Math.max(0, Math.min(1, t)) : null;
}

/** Equal-mass elastic impact: exchange normal components, preserve tangent motion. */
export function resolveBallPair(a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    distance = Math.hypot(dx, dy);
  // For coincident spawn positions, choose a deterministic separating normal.
  const relative = Math.hypot(a.vx - b.vx, a.vy - b.vy);
  const nx =
    distance > EPS
      ? dx / distance
      : relative > EPS
        ? (a.vx - b.vx) / relative
        : 1;
  const ny =
    distance > EPS
      ? dy / distance
      : relative > EPS
        ? (a.vy - b.vy) / relative
        : 0;
  const overlap = a.r + b.r - distance;
  if (overlap >= -EPS) {
    const shift = Math.max(0, overlap) / 2 + EPS;
    a.x -= nx * shift;
    a.y -= ny * shift;
    b.x += nx * shift;
    b.y += ny * shift;
  }
  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (closing <= EPS) return false;
  a.vx -= closing * nx;
  a.vy -= closing * ny;
  b.vx += closing * nx;
  b.vy += closing * ny;
  return true;
}

/** Continuous pair impacts between scene microsteps; held balls are excluded. */
export function advanceBallPairs(balls, duration) {
  const moving = balls
    .filter(freeBall)
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  for (let i = 0; i < moving.length; i++)
    for (let j = i + 1; j < moving.length; j++) {
      const a = moving[i],
        b = moving[j];
      if (Math.hypot(b.x - a.x, b.y - a.y) < a.r + b.r) resolveBallPair(a, b);
    }
  let remaining = duration;
  const advance = (dt) => {
    for (const b of moving) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
  };
  for (
    let n = 0;
    remaining > 1e-12 && n < Math.max(32, moving.length * moving.length * 4);
    n++
  ) {
    let hit = null;
    for (let i = 0; i < moving.length; i++)
      for (let j = i + 1; j < moving.length; j++) {
        const t = sweepBalls(moving[i], moving[j], remaining);
        if (t !== null && (!hit || t < hit.t - EPS))
          hit = { a: moving[i], b: moving[j], t };
      }
    if (!hit) {
      advance(remaining);
      remaining = 0;
      break;
    }
    advance(remaining * hit.t);
    remaining *= 1 - hit.t;
    resolveBallPair(hit.a, hit.b);
  }
  // Bound pathological simultaneous contacts without dropping simulation time.
  if (remaining > 0) advance(remaining);
}
