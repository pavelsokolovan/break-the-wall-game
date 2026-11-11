import { pixelRect } from "./pixel-drawing.js";

/** direction 1 faces upward; -1 rotates artwork through 180 degrees. */
export function drawPaddleGear(
  ctx,
  p,
  { ammo = 0, stickyCharges = 0, direction = 1 } = {},
) {
  const rect = (x, y, w, h, color) =>
    pixelRect(
      ctx,
      direction === 1 ? x : 2 * p.x - x - w,
      direction === 1 ? y : 2 * (p.y + p.h / 2) - y - h,
      w,
      h,
      color,
    );
  if (ammo > 0) {
    rect(p.x - 8, p.y - 21, 16, 22, "#ffb570");
    rect(p.x - 11, p.y - 24, 22, 7, "#e1e5db");
    rect(p.x - 5, p.y - 21, 10, 5, "#32304b");
  }
  if (stickyCharges > 0) rect(p.x - p.w / 2 + 10, p.y, p.w - 20, 3, "#b38aff");
}
export function drawShot(ctx, shot, direction = 1) {
  const rect = (x, y, w, h, color) =>
    pixelRect(
      ctx,
      direction === 1 ? x : 2 * shot.x - x - w,
      direction === 1 ? y : 2 * shot.y - y - h,
      w,
      h,
      color,
    );
  rect(shot.x - 4, shot.y - 10, 8, 17, "#ffe7ad");
  rect(shot.x - 3, shot.y + 7, 6, 10, "#ff7695");
}
