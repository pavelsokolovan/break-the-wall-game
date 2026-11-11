import { pixelRect } from "./pixel-drawing.js";

const icons = {
  gem: "◆",
  wide: "↔",
  slow: "S",
  shield: "◇",
  multi: "···",
  life: "♥",
  repair: "+",
  bomb: "✹",
  vest: "V",
  sticky: "U",
  bazooka: "B",
};

/** Shared Solo artwork; direction rotates hazard geometry toward its destination. */
export function drawDrop(
  ctx,
  d,
  { time = 0, direction = 1, motion = true } = {},
) {
  const t = motion ? time : 0;
  const rect = (x, y, w, h, color) =>
    pixelRect(
      ctx,
      direction === 1 ? x : 2 * d.x - x - w,
      direction === 1 ? y : 2 * d.y - y - h,
      w,
      h,
      color,
    );
  const label = (text, x, y, color, size = 12) => {
    ctx.font = `${size * 1.35}px "VT323", monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(text, Math.round(x), Math.round(y));
  };

  const color =
    d.type === "bomb"
      ? "#ff7695"
      : ["life", "repair"].includes(d.type)
        ? "#d3fa65"
        : d.type === "gem"
          ? "#c49aff"
          : d.type === "vest"
            ? "#ffb570"
            : "#66dfd1";
  if (d.type === "rocket") {
    rect(d.x - 7, d.y - 15, 14, 28, "#ff7695");
    rect(d.x - 4, d.y + 13, 8, 5, "#d7f2ff");
    rect(d.x - 13, d.y - 10, 6, 12, "#b38aff");
    rect(d.x + 7, d.y - 10, 6, 12, "#b38aff");
    rect(d.x - 4, d.y - 23, 8, 8, Math.sin(t * 30) > 0 ? "#ffb570" : "#fff0ae");
  } else if (d.type === "worm") {
    for (let k = 0; k < 5; k++)
      rect(
        d.x - 24 + k * 10,
        d.y + Math.sin(t * 10 + k) * 4 - 5,
        10,
        10,
        k === 4 ? "#ffb570" : "#ff7695",
      );
    rect(d.x + 19, d.y + Math.sin(t * 10 + 4) * 4 - 3, 3, 3, "#191827");
  } else if (d.type === "bomb") {
    rect(d.x - 9, d.y - 9, 18, 18, "#ff7695");
    rect(d.x - 5, d.y - 13, 10, 4, "#ffb570");
    rect(d.x + 3, d.y - 18, 3, 5, Math.sin(t * 20) > 0 ? "#fff0ae" : "#ff7695");
    label("×", d.x, d.y + 6, "#391b32", 20);
  } else {
    rect(d.x - 12, d.y - 12, 24, 24, color);
    rect(d.x - 10, d.y - 10, 20, 20, "#17162b");
    if (d.type === "vest") {
      rect(d.x - 8, d.y - 8, 5, 7, color);
      rect(d.x + 3, d.y - 8, 5, 7, color);
      rect(d.x - 8, d.y - 1, 16, 11, color);
      rect(d.x - 1, d.y - 1, 2, 11, "#573b36");
      rect(d.x - 6, d.y + 3, 4, 4, "#be6b35");
      rect(d.x + 2, d.y + 3, 4, 4, "#be6b35");
    } else if (d.type === "bazooka") {
      rect(d.x - 7, d.y - 8, 14, 7, "#ffb570");
      rect(d.x - 3, d.y - 1, 6, 10, "#ffb570");
    } else if (d.type === "sticky") {
      rect(d.x - 8, d.y - 8, 5, 16, "#b38aff");
      rect(d.x + 3, d.y - 8, 5, 16, "#b38aff");
      rect(d.x - 8, d.y + 4, 16, 5, "#b38aff");
    } else if (d.type === "multi") {
      for (const [dx, dy] of [
        [-6, 4],
        [6, 4],
        [0, -5],
      ])
        rect(d.x + dx - 3, d.y + dy - 3, 6, 6, color);
    } else label(icons[d.type], d.x, d.y + 6, color, 19);
  }
}
