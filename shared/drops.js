/** Original Solo probabilities, preserved for both modes. */
export const HAZARDS = new Set(["bomb", "rocket", "worm"]);
export function dropType(roll, hazardsFull) {
  if (roll < 0.56) return null;
  if (roll < 0.59) return "sticky";
  if (roll < 0.62) return "bazooka";
  if (roll < 0.72) return "gem";
  if (roll < 0.77) return "wide";
  if (roll < 0.83) return "slow";
  if (roll < 0.86) return "shield";
  if (roll < 0.9) return "multi";
  if (roll < 0.91) return "life";
  if (roll < 0.94) return "vest";
  if (hazardsFull) return null;
  if (roll < 0.96) return "bomb";
  if (roll < 0.98) return "rocket";
  return "worm";
}
