import { normalizeRoomCode } from "../shared/duel-rules.js";

export const DUEL_HISTORY_KEY = "brickfall-blitz:duel:v1";
const validNumber = (n) => Number.isFinite(n) && n >= 0;
function cleanRecord(r) {
  if (
    !r ||
    typeof r.matchId !== "string" ||
    !r.matchId.length ||
    r.matchId.length > 128 ||
    typeof r.date !== "string" ||
    r.date.length > 40 ||
    !Number.isFinite(Date.parse(r.date)) ||
    !["win", "loss", "draw"].includes(r.outcome) ||
    !["five_goals", "forfeit", "time_limit"].includes(r.reason) ||
    ![
      r.goalsFor,
      r.goalsAgainst,
      r.pointsFor,
      r.pointsAgainst,
      r.durationMs,
      r.waveCount,
    ].every(validNumber) ||
    ![
      r.goalsFor,
      r.goalsAgainst,
      r.pointsFor,
      r.pointsAgainst,
      r.waveCount,
    ].every(Number.isSafeInteger) ||
    r.waveCount < 1
  )
    return null;
  const {
    matchId,
    date,
    outcome,
    reason,
    goalsFor,
    goalsAgainst,
    pointsFor,
    pointsAgainst,
    durationMs,
    waveCount,
  } = r;
  return {
    matchId,
    date,
    outcome,
    reason,
    goalsFor,
    goalsAgainst,
    pointsFor,
    pointsAgainst,
    durationMs,
    waveCount,
  };
}
export class DuelHistory {
  constructor(storage, now = () => new Date().toISOString()) {
    this.storage = storage;
    this.now = now;
    this.memory = [];
    this.seen = new Set();
    this.read();
  }
  read() {
    let records = [];
    try {
      const data = JSON.parse(this.storage?.getItem(DUEL_HISTORY_KEY) || "[]");
      if (Array.isArray(data))
        records = data.slice(0, 100).map(cleanRecord).filter(Boolean);
    } catch {
      /* In-memory history survives unavailable or corrupted storage. */
    }
    const unique = new Map();
    for (const r of [...this.memory, ...records])
      if (!unique.has(r.matchId)) unique.set(r.matchId, r);
    this.memory = [...unique.values()]
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 20);
    for (const r of this.memory) this.seen.add(r.matchId);
    // The bounded history is also the deduplication horizon.
    if (this.seen.size > 100)
      this.seen = new Set(this.memory.map((r) => r.matchId));
    return this.memory.map((r) => ({ ...r }));
  }
  save(result, slot) {
    if (![0, 1].includes(slot)) return false;
    this.read();
    if (this.seen.has(result.matchId)) return false;
    const r = cleanRecord({
      matchId: result.matchId,
      date: this.now(),
      outcome:
        result.winner === null
          ? "draw"
          : result.winner === slot
            ? "win"
            : "loss",
      reason: result.reason,
      goalsFor: result.goals[slot],
      goalsAgainst: result.goals[1 - slot],
      pointsFor: result.points[slot],
      pointsAgainst: result.points[1 - slot],
      durationMs: result.durationMs,
      waveCount: result.waveCount,
    });
    if (!r) return false;
    this.memory.unshift(r);
    this.memory = this.memory.slice(0, 20);
    this.seen.add(r.matchId);
    try {
      this.storage?.setItem(DUEL_HISTORY_KEY, JSON.stringify(this.memory));
    } catch {
      /* Optional storage. */
    }
    return true;
  }
}
export function invitationCode(location) {
  try {
    return normalizeRoomCode(new URL(location.href).searchParams.get("duel"));
  } catch {
    return null;
  }
}
export function invitationUrl(location, code) {
  const normalized = normalizeRoomCode(code);
  if (!normalized) throw new Error("Invalid room code.");
  const url = new URL(location.href);
  url.searchParams.set("duel", normalized);
  return url.href;
}
export async function shareInvitation(navigator, link) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "Brickfall Blitz — Online Duel",
        url: link,
      });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    return "copied";
  } catch {
    return "manual";
  }
}
