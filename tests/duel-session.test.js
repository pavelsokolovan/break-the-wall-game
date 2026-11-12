import test from "node:test";
import assert from "node:assert/strict";
import {
  DuelHistory,
  DUEL_HISTORY_KEY,
  invitationCode,
  invitationUrl,
  shareInvitation,
} from "../src/duel-session.js";
const result = (id = "m") => ({
  matchId: id,
  winner: 0,
  reason: "five_goals",
  goals: [5, 2],
  points: [100, 200],
  durationMs: 12000,
  waveCount: 2,
});
const storage = () => {
  const map = new Map();
  return { map, getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
};

test("duel history saves authoritative outcomes once, bounds records and excludes secrets/Solo", () => {
  const s = storage();
  s.setItem("brickfall-blitz:v1", "keep");
  const h = new DuelHistory(s, () => "2026-11-12T00:00:00Z");
  assert(h.save({ ...result(), token: "private" }, 1));
  assert(!h.save(result(), 1));
  assert.equal(h.read()[0].outcome, "loss");
  for (let i = 0; i < 25; i++) h.save(result(`m${i}`), 0);
  assert.equal(h.read().length, 20);
  assert(!s.getItem(DUEL_HISTORY_KEY).includes("private"));
  assert.equal(s.getItem("brickfall-blitz:v1"), "keep");
  assert(!new DuelHistory(s).save(result("m24"), 0));
});
test("history tolerates corruption/storage failure and merges another tab before saving", () => {
  const s = storage();
  s.setItem(DUEL_HISTORY_KEY, "bad");
  const a = new DuelHistory(s),
    b = new DuelHistory(s);
  a.save(result("a"), 0);
  b.save(result("b"), 1);
  a.save(result("c"), 0);
  assert.equal(a.read().length, 3);
  s.setItem(
    DUEL_HISTORY_KEY,
    JSON.stringify([{ matchId: "bad", outcome: "win", date: "bad" }]),
  );
  assert.equal(new DuelHistory(s).read().length, 0);
  const unavailable = new DuelHistory({
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
  });
  assert(unavailable.save(result(), 0));
  assert(!unavailable.save(result(), 0));
  assert.equal(unavailable.read().length, 1);
});
test("invitations validate room only, retain frontend path/query and never add credentials", () => {
  const location = {
    href: "https://pavelsokolovan.github.io/break-the-wall-game/?theme=pixel#play",
  };
  const link = invitationUrl(location, "abc234");
  assert.equal(new URL(link).pathname, "/break-the-wall-game/");
  assert.equal(new URL(link).searchParams.get("theme"), "pixel");
  assert.equal(invitationCode({ href: link }), "ABC234");
  assert.equal(invitationCode({ href: location.href + "?duel=bad" }), null);
  assert.throws(() => invitationUrl(location, "token"));
});
test("share uses native share, respects cancellation, then clipboard or manual fallback", async () => {
  let shared;
  assert.equal(
    await shareInvitation(
      {
        share: async (data) => {
          shared = data;
        },
      },
      "https://example/?duel=ABC234",
    ),
    "shared",
  );
  assert.equal(Object.keys(shared).sort().join(","), "title,url");
  assert.equal(
    await shareInvitation(
      {
        share: async () => {
          throw Object.assign(Error(), { name: "AbortError" });
        },
      },
      "link",
    ),
    "cancelled",
  );
  let copied;
  assert.equal(
    await shareInvitation(
      {
        clipboard: {
          writeText: async (text) => {
            copied = text;
          },
        },
      },
      "link",
    ),
    "copied",
  );
  assert.equal(copied, "link");
  assert.equal(await shareInvitation({}, "link"), "manual");
});
