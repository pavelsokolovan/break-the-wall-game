const EPS = 1e-8;
/** Earliest swept circle contact with rectangle faces and actual rounded corners.
 * t is normalized travel in [0,1]; only approaching contacts are returned.
 */
export function sweepCircleRect(ball, dx, dy, rect) {
  let best = null;
  const accept = (t, nx, ny) => {
    if (t < -EPS || t > 1 + EPS || dx * nx + dy * ny >= -EPS) return;
    if (!best || t < best.t - EPS)
      best = { t: Math.max(0, Math.min(1, t)), nx, ny };
  };
  if (dx)
    for (const [face, nx] of [
      [rect.x, -1],
      [rect.x + rect.w, 1],
    ]) {
      const t = (face + nx * ball.r - ball.x) / dx,
        y = ball.y + dy * t;
      if (y >= rect.y && y <= rect.y + rect.h) accept(t, nx, 0);
    }
  if (dy)
    for (const [face, ny] of [
      [rect.y, -1],
      [rect.y + rect.h, 1],
    ]) {
      const t = (face + ny * ball.r - ball.y) / dy,
        x = ball.x + dx * t;
      if (x >= rect.x && x <= rect.x + rect.w) accept(t, 0, ny);
    }
  const a = dx * dx + dy * dy;
  if (a === 0) return best;
  for (const [x, sx] of [
    [rect.x, -1],
    [rect.x + rect.w, 1],
  ])
    for (const [y, sy] of [
      [rect.y, -1],
      [rect.y + rect.h, 1],
    ]) {
      const ox = ball.x - x,
        oy = ball.y - y,
        b = 2 * (ox * dx + oy * dy),
        c = ox * ox + oy * oy - ball.r * ball.r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * a),
        nx = (ox + dx * t) / ball.r,
        ny = (oy + dy * t) / ball.r;
      if (nx * sx >= -EPS && ny * sy >= -EPS) accept(t, nx, ny);
    }
  return best;
}

/** Swept axis-aligned boxes. Initial overlap is an immediate contact. */
export function sweepAabb(box, dx, dy, target) {
  let enter = 0,
    leave = 1;
  for (const [origin, delta, low, high] of [
    [box.x, dx, target.x - box.w, target.x + target.w],
    [box.y, dy, target.y - box.h, target.y + target.h],
  ]) {
    if (Math.abs(delta) < EPS) {
      if (origin < low || origin > high) return null;
      continue;
    }
    const a = (low - origin) / delta,
      b = (high - origin) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return null;
  }
  return enter;
}
