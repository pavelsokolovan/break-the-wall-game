import { shotBounds } from "./duel-weapons.js";
import { dropHalfExtents } from "./duel-drops.js";
import { makeLevel, COLORS } from "./levels.js";
import { DUEL_RULES as R } from "./duel-rules.js";

/** Mirror occupancy and materials from an original silhouette without changing Solo. */
export function makeDuelWall(wave, random, allocateId) {
  if (typeof random !== "function" || typeof allocateId !== "function")
    throw new TypeError("Explicit random generator and ID allocator required");
  if (!Number.isSafeInteger(wave) || wave < 1)
    throw new TypeError("Invalid wave");
  const rows = Math.min(4 + Math.floor(wave / 3), 6);
  const original = makeLevel(wave, random),
    cells = new Map(original.map((b) => [b.r * 8 + b.c, b]));
  const pairs = [];
  for (let i = 0; i < (rows * 8) / 2; i++) {
    const other = rows * 8 - 1 - i,
      source = cells.get(i) || cells.get(other);
    if (source)
      pairs.push({
        indexes: [i, other],
        type: source.type,
        color: source.color,
      });
  }
  const steel = [];
  for (const pair of pairs)
    if (pair.type === "steel") {
      const positions = pair.indexes.map((i) => ({
        r: Math.floor(i / 8),
        c: i % 8,
      }));
      const touches = (a, b) =>
        Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1;
      if (
        touches(...positions) ||
        positions.some((p) => steel.some((s) => touches(p, s)))
      )
        pair.type = "armored";
      else steel.push(...positions);
    }
  const result = pairs
    .flatMap((pair) =>
      pair.indexes.map((i) => {
        const r = Math.floor(i / 8),
          c = i % 8;
        const hp =
          pair.type === "steel"
            ? null
            : pair.type === "reinforced"
              ? 3
              : pair.type === "armored"
                ? 2
                : 1;
        return {
          r,
          c,
          x: 28 + c * 94,
          y: (R.height - (rows * 40 - 8)) / 2 + r * 40,
          w: 86,
          h: 32,
          type: pair.type,
          hp,
          maxHp: hp,
          color: COLORS[Math.min(r, rows - 1 - r) % COLORS.length],
        };
      }),
    )
    .sort((a, b) => a.r - b.r || a.c - b.c);
  return result.map((b) => ({ ...b, id: allocateId() }));
}
export function wallBounds(wall) {
  const x = Math.min(...wall.map((b) => b.x)),
    y = Math.min(...wall.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...wall.map((b) => b.x + b.w)) - x,
    h: Math.max(...wall.map((b) => b.y + b.h)) - y,
  };
}
const overlaps = (a, b) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export function canSpawnWall(wall, state) {
  const bounds = wallBounds(wall);
  if (
    state.balls.some((b) => {
      const x = Math.max(bounds.x, Math.min(bounds.x + bounds.w, b.x)),
        y = Math.max(bounds.y, Math.min(bounds.y + bounds.h, b.y));
      return (b.x - x) ** 2 + (b.y - y) ** 2 <= b.r ** 2;
    })
  )
    return false;
  if (
    state.drops.some((d) => {
      const half = dropHalfExtents(d.type);
      return overlaps(bounds, {
        x: d.x - half.x,
        y: d.y - half.y,
        w: half.x * 2,
        h: half.y * 2,
      });
    })
  )
    return false;
  return !state.shots.some((s) => overlaps(bounds, shotBounds(s)));
}
