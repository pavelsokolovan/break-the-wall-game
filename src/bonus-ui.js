export function bonusEntries(player) {
  const entries = [];
  for (const [key, name, total] of [
    ["wideRemainingMs", "WIDE", 12000],
    ["slowRemainingMs", "SLOW", 10000],
    ["shieldRemainingMs", "SHIELD", 15000],
  ]) {
    if (
      player[key] > 0 &&
      (key !== "shieldRemainingMs" || player.shieldCharges > 0)
    )
      entries.push({
        key,
        label: `${name}${name === "SHIELD" ? " ×" + player.shieldCharges : ""} ${Math.ceil(player[key] / 1000)}s`,
        ratio: Math.min(1, player[key] / total),
      });
  }
  for (const [key, name] of [
    ["vestCharges", "VEST"],
    ["stickyCharges", "STICKY"],
    ["ammo", "AMMO"],
  ])
    if (player[key] > 0)
      entries.push({ key, label: `${name} ×${player[key]}` });
  return entries;
}
export function renderBonuses(bar, player) {
  const doc = bar.ownerDocument;
  const entries = bonusEntries(player);
  const activeKeys = new Set(entries.map((e) => e.key));
  for (const node of [...bar.children])
    if (!activeKeys.has(node.dataset.bonus)) node.remove();
  for (const entry of entries) {
    let node = [...bar.children].find((n) => n.dataset.bonus === entry.key);
    if (!node) {
      node = doc.createElement("div");
      node.className = "duel-bonus";
      node.dataset.bonus = entry.key;
      node.append(doc.createElement("span"));
      if (entry.ratio !== undefined) {
        const strip = doc.createElement("i");
        strip.className = "duel-bonus-time";
        strip.setAttribute("aria-hidden", "true");
        node.append(strip);
      }
      bar.append(node);
    }
    node.firstElementChild.textContent = entry.label;
    if (entry.ratio !== undefined)
      node.lastElementChild.style.width = `${entry.ratio * 100}%`;
  }
  bar.hidden = !entries.length;
}
