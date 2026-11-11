/** Original Solo layouts; shared without changing Solo geometry or random draws. */
export const COLORS = ["#c49aff", "#ff7695", "#ffb570", "#d3fa65", "#66dfd1"];
export const WALL_SHAPES = [
  "DIAMOND",
  "SPACE INVADER",
  "CHEVRON",
  "TWIN TOWERS",
  "WAVE",
  "PORTAL",
];
export function makeLevel(n, random = Math.random) {
  const bricks = [],
    rows = Math.min(4 + Math.floor(n / 3), 6);
  const shape = Math.floor(random() * WALL_SHAPES.length);
  const phase = Math.floor(random() * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 8; c++) {
      const d = Math.abs(c - 3.5),
        mid = (rows - 1) / 2;
      const masks = [
        d <= 3.8 - Math.abs(r - mid),
        r === 0
          ? d > 0.5 && d < 3.5
          : r === rows - 1
            ? c % 3 !== 1
            : r === 1
              ? d < 2.6
              : true,
        Math.abs(r - d * 0.65) < 1.7,
        d >= 1 || r === 0 || r === rows - 1,
        r >= Math.floor((Math.sin((c + phase) * 0.9) + 1) * 0.9),
        r === 0 || r === rows - 1 || d > 1.5,
      ];
      if (!masks[shape]) continue;
      let type =
        n >= 3 && random() < 0.16
          ? "explosive"
          : n >= 5 && (r + c + phase) % 5 === 0
            ? "reinforced"
            : n >= 2 && (r + c + phase) % 3 === 0
              ? "armored"
              : "standard";
      // Isolated steel cells cannot enclose targets or seal a passage.
      if (n >= 4 && r === 1 && (c === 2 || c === 5)) type = "steel";
      const hp =
        type === "steel"
          ? Infinity
          : type === "reinforced"
            ? 3
            : type === "armored"
              ? 2
              : 1;
      bricks.push({
        id: r * 8 + c,
        r,
        c,
        x: 28 + c * 94,
        y: 66 + r * 40,
        w: 86,
        h: 32,
        type,
        hp,
        maxHp: hp,
        color: COLORS[(r + phase) % COLORS.length],
      });
    }
  }
  bricks.shape = WALL_SHAPES[shape];
  return bricks;
}
