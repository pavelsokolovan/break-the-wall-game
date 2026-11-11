import { pixelRect } from "./pixel-drawing.js";

export function drawBrick(ctx, b) {
  const rect = (...args) => pixelRect(ctx, ...args);
  if (b.type !== "steel" && b.hp <= 0) return;
  const { x, y, w, h, type } = b;
  const color =
    type === "steel"
      ? "#8798b5"
      : type === "explosive"
        ? "#ff9c42"
        : type === "reinforced"
          ? "#b38aff"
          : b.color;
  rect(x + 4, y + 4, w, h, "#0009");
  rect(x, y, w, h, "#171827");
  rect(x + 3, y + 3, w - 6, h - 6, color);
  rect(x + 6, y + 3, w - 12, 4, "#ffffff66");
  rect(x + 3, y + h - 7, w - 6, 4, "#0005");
  if (type === "steel") {
    // Riveted steel with diagonal hazard slots.
    for (let k = 14; k < w - 12; k += 12) {
      rect(x + k, y + 11, 5, 12, "#3c4b63");
      rect(x + k + 4, y + 7, 5, 8, "#3c4b63");
    }
    for (const dx of [6, w - 10])
      for (const dy of [6, h - 10]) rect(x + dx, y + dy, 4, 4, "#e3edff");
  } else if (type === "reinforced") {
    // Three nested armor plates, removed as durability falls.
    for (let k = 0; k < b.hp; k++) {
      const dx = x + 13 + k * 20;
      rect(dx, y + 9, 16, 15, "#533783");
      rect(dx + 3, y + 12, 10, 8, "#d8b5ff");
    }
  } else if (type === "armored") {
    // Bolted panel and horizontal plating seam.
    rect(x + 9, y + 15, w - 18, 3, "#28213c88");
    for (const dx of [8, w - 12]) rect(x + dx, y + 11, 4, 10, "#f4f0df");
    rect(x + w / 2 - 7, y + 10, 14, 12, "#28213c");
    rect(x + w / 2 - 3, y + 13, 6, 6, color);
  } else if (type === "explosive") {
    // Pixel dynamite bundle and a fuse, readable without color.
    for (let k = 0; k < 3; k++)
      rect(x + w / 2 - 13 + k * 9, y + 11, 7, 14, "#a22b3f");
    rect(x + w / 2 - 15, y + 17, 32, 4, "#ffe9a1");
    rect(x + w / 2 + 5, y + 7, 4, 5, "#fff6c7");
  } else {
    // Classic staggered masonry seam.
    rect(x + 5, y + 16, w - 10, 2, "#0003");
    rect(x + w / 2, y + 7, 2, 9, "#0003");
  }
  if (b.hp < b.maxHp) {
    rect(x + w - 27, y + 3, 4, 10, "#191628");
    rect(x + w - 31, y + 11, 8, 4, "#191628");
    rect(x + w - 31, y + 14, 4, 12, "#191628");
  }
}
