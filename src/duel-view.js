import { drawPaddleGear, drawShot } from "./weapon-drawing.js";
import { drawDrop } from "./drop-drawing.js";
import { drawBrick } from "./brick-drawing.js";
import { COLORS } from "../shared/levels.js";
import {
  DUEL_RULES as R,
  worldToViewPoint,
  worldToViewRect,
} from "../shared/duel-rules.js";
import { pixelRect } from "./pixel-drawing.js";

export function drawDuel(canvas, snapshot, slot, { motion = true } = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  pixelRect(ctx, 0, 0, R.width, R.height, "#0e0f20");
  for (let y = 20; y < R.height; y += 40)
    pixelRect(ctx, 399, y, 2, 16, "#292939");
  for (const b of snapshot.state.bricks) {
    const row = Math.round(
      (b.y -
        (R.height -
          (Math.min(4 + Math.floor(snapshot.state.wave / 3), 6) * 40 - 8)) /
          2) /
        40,
    );
    const rect = worldToViewRect(slot, b);
    drawBrick(ctx, {
      ...b,
      ...rect,
      color:
        COLORS[
          Math.min(
            row,
            Math.min(4 + Math.floor(snapshot.state.wave / 3), 6) - 1 - row,
          ) % COLORS.length
        ],
    });
  }
  for (const d of snapshot.state.drops) {
    drawDrop(
      ctx,
      { ...d, ...worldToViewPoint(slot, d) },
      {
        time: snapshot.tick / R.simulationHz,
        direction: d.owner === slot ? 1 : -1,
        motion,
      },
    );
  }
  for (const p of snapshot.state.players) {
    const rect = worldToViewRect(slot, {
      x: p.x - p.width / 2,
      y: R.paddleTopY[p.slot],
      w: p.width,
      h: R.paddleHeight,
    });
    const color = p.slot === slot ? "#d3fa65" : "#ff7695";
    pixelRect(ctx, rect.x, rect.y, rect.w, rect.h, color);
    pixelRect(ctx, rect.x + 4, rect.y + 3, rect.w - 8, 3, "#ffffff88");
    drawPaddleGear(
      ctx,
      { x: rect.x + rect.w / 2, y: rect.y, w: rect.w, h: rect.h },
      {
        ammo: p.ammo,
        stickyCharges: p.stickyCharges,
        direction: p.slot === slot ? 1 : -1,
      },
    );
    for (let i = 0; i < p.vestCharges; i++)
      pixelRect(
        ctx,
        rect.x + rect.w / 2 - 14 + i * 18,
        rect.y + 5,
        12,
        9,
        "#be6b35",
      );
    if (p.shieldCharges || p.invulnerabilityRemainingMs > 0) {
      ctx.strokeStyle =
        p.invulnerabilityRemainingMs > 0 ? "#fff0ae" : "#66dfd1";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x - 4, rect.y - 4, rect.w + 8, rect.h + 8);
    }
    const labels = [];
    if (p.stickyCharges) labels.push(`STICK ${p.stickyCharges}`);
    if (p.ammo) labels.push(`AMMO ${p.ammo}`);
    const held = snapshot.state.balls.filter(
      (b) => b.held && b.owner === p.slot,
    );
    if (held.length)
      labels.push(
        `HELD ${held.length} ${Math.ceil(Math.min(...held.map((b) => b.autoReleaseRemainingMs)) / 1000)}s`,
      );
    if (p.wideRemainingMs > 0)
      labels.push(`WIDE ${Math.ceil(p.wideRemainingMs / 1000)}s`);
    if (p.slowRemainingMs > 0)
      labels.push(`SLOW ${Math.ceil(p.slowRemainingMs / 1000)}s`);
    if (p.shieldCharges)
      labels.push(`SHIELD ${Math.ceil(p.shieldRemainingMs / 1000)}s`);
    if (p.vestCharges) labels.push(`VEST ${p.vestCharges}`);
    ctx.font = '18px "VT323", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(labels.join(" · "), 400, p.slot === slot ? 972 : 45);
  }
  for (const shot of snapshot.state.shots)
    drawShot(
      ctx,
      { ...shot, ...worldToViewPoint(slot, shot) },
      shot.owner === slot ? 1 : -1,
    );
  for (const b of snapshot.state.balls) {
    const p = worldToViewPoint(slot, b);
    const color = b.owner === slot ? "#d3fa65" : "#ff6090";
    pixelRect(ctx, p.x - 6, p.y - b.r, 12, b.r * 2, color);
    pixelRect(ctx, p.x - b.r, p.y - 6, b.r * 2, 12, color);
  }
  if (["countdown", "goal_countdown"].includes(snapshot.phase)) {
    ctx.font = '48px "VT323", monospace';
    ctx.fillStyle = "#d3fa65";
    ctx.textAlign = "center";
    ctx.fillText(
      String(Math.ceil(snapshot.state.countdownRemainingMs / 1000)),
      400,
      500,
    );
    ctx.font = '24px "VT323", monospace';
    ctx.fillText("AUTO SERVE", 400, 540);
  }
}
