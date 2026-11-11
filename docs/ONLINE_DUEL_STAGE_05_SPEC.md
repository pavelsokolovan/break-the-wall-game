# Stage 5 specification: drops, hazards and defensive powers

Status: implemented locally; not deployed.

Depends on Stages 1–4. Source: [ONLINE_DUEL_SPEC.md](ONLINE_DUEL_SPEC.md), sections 4–5.

## Permanent two-mode requirement

Keep **Solo (single player)** and **Online Duel (two online players)** as separate mode
choices. This stage adds to Online Duel without replacing Solo or changing its campaign,
controls, bonuses or `brickfall-blitz:v1` saves. Solo must run without a multiplayer backend.
Follow the [master two-mode requirement](ONLINE_DUEL_SPEC.md#permanent-two-mode-requirement)
and this stage's [mode-specific acceptance](ONLINE_DUEL_ROADMAP.md#two-mode-acceptance-in-every-stage).
Run Solo regressions alongside the stage's duel checks; networking failures must not block Solo.

## Deliverable and defaults

Add owner-directed rewards, timed wide/slow/shield powers, vest, Repair, bomb/rocket/worm
hazards, per-owner hazard caps, damage and invulnerability. Preserve Solo rules, its API
and saves. No new lives counter in duels. Sticky catches, bazooka and multiball remain
Stage 6: their original 3%/3%/4% ranges produce no drop in Stage 5, without redistributing
those odds or showing inert pickups. Stage 6 will enable these reserved outcomes.
No networking lifecycle, hosting or deployment changes.

## Shared rules and ownership

Extract Solo's unchanged HAZARDS and dropType into shared/drops.js; import/re-export
from src/game.js. Add pure shared/duel-drops.js for the duel roll adapter, sizes/motion,
and swept drop/paddle contact. Use one seeded random roll on every destroyed breakable
brick, including explosion chains. No rolls on nonlethal/steel hits; no extra roll when
a hazard outcome is suppressed. Apply full parent thresholds: none 56%, reserved sticky
3%, reserved bazooka 3%, gem 10%, wide 5%, slow 6%, shield 3%, reserved multi 4%, Repair
1%, vest 3%, bomb/rocket/worm 2% each. Reject invalid programmer roll arguments.

A drop receives a globally unique entity ID, type, owner, canonical brick-center x/y,
baseX, and motionPhase=0. Owner comes from credited destruction, carried through blasts.
Cap live hazards at three per owner; the other owner has an independent cap. Evaluate
at spawn time in deterministic damage order. Suppressed outcomes are no drop.

All ordinary rewards and bombs move at 150px/s toward owner; rockets 260, worms 110.
Worm phase advances 6 radians/s; x=baseX+sin(phase)*55 in owner view, clamped to field.
Mirror its horizontal weave as well as vertical direction for slot 1. Reuse Solo sizes:
worm half-width 24, rocket half-height 18, otherwise half-extents 11. Drop motion passes
through balls/bricks/opponent. Missed drops fully crossing their destination end disappear
without score/damage. Pause/countdown freezes all motion and phase.

## Tick ordering and catches

On a playing tick: advance power timers, move paddles, resolve balls/brick damage,
move drops, process beneficial catches, suppress hazards if a rally reset is pending,
otherwise process hazard contacts, resolve aggregated goals, schedule wall replacement.
Drops created during ball processing move for this tick's normal drop step.

Use swept rectangle contact against only the owner's actual paddle travel, including
rocket speed and worm lateral motion. Candidate beneficial catches are determined from
pre-pickup paddle geometry, sorted armor first (shield/vest) then other rewards by drop ID.
Apply them all before checking hazards against final pickup-adjusted width. Do not let
array order determine armor protection. Opponent overlap never consumes a reward,
armor, or damage. Remove all caught drops; remaining drops expire only beyond their end.

A goal/opposite-exit replay suppresses all hazard effects on that tick; it still retains
already caught gem/Repair-conversion points. Resolve beneficial Repair before goal damage.
Normal rally reset clears all drops, powers, charges and invulnerability as before.
Goal boundaries bypass armor. Hazard hits never award goals, reset balls, clear combos,
or remove other active powers. Wave spawn guard uses actual type-specific drop extents;
spawn repairs accumulated damage but preserves still-active powers and drops.

## Effects and timing

- Gem: +500 points, no combo multiplier or refresh.
- Wide: current damaged base width x1.5 for 12,000ms; repeat refreshes, never stacks.
- Slow: refresh 10,000ms for owner only. Preserve the agreed serve/return/split speed
  rule: current flight velocity is unchanged. Returns while slow is active use 65%
  owner speed; expired slow affects the next return, never flips an opponent's modifier.
- Shield: one charge for 15,000ms; refresh both duration and single charge. Expiry clears
  charge. A blocked hazard consumes shield and its timer before vest is considered.
- Vest: refill to two charges; no time expiry; consumes after shield.
- Repair: reduce one damage increment; if already undamaged, +1,000 points instead.
  Preserve current wide multiplier when recomputing width; no speed change in flight.
- Damaging hazard: one increment (cap 3; base width minimum 100), plus 1,000ms
  invulnerability. Still grant invulnerability at cap. At most one damaging hit/player/tick.
  During invulnerability remove contacting hazards without consuming armor. Otherwise
  shield, then vest, then damage. Independent simultaneous damage is allowed for both owners.

Timers use server simulation milliseconds with epsilon-to-zero at exact tick expiry.
They decrement once at start of playing tick; pause/countdown/finished do not advance.
A pickup at tick end starts with its full duration. Width changes clamp position/target
inside the field; geometry correction must not become paddle-stroke velocity. Width is
recomputed after expiry, damage, Repair and pickups. Unused vest persists until consumed
or rally reset. Wave repair honors any remaining wide duration.

## Protocol and interface

Keep snapshot shape/protocol v1. Add validated cosmetic events:

- drop_spawned: {dropId,owner,dropType,x,y}.
- pickup: {dropId,owner,dropType,points}.
- hazard_blocked: {dropId,owner,defense:shield/vest/invulnerability}.
- hazard_damage: {dropId,owner,damage}.

Never send RNG, raw objects or extra internal fields. Snapshots fully reconstruct drops,
charges and remaining timers. Keep new frontend/server in sync locally; production
version rollout remains Stage 9. Add type aliases for reused drop types where useful.

Extract Solo's drop artwork into src/drop-drawing.js without changing Solo appearance.
Duel draws transformed drop positions and owner-relative hazard orientation, with the
same readable distinct shapes. Repair uses a plus/repair icon instead of the Solo heart.
Use authoritative snapshot phase/tick for duel animation, not a second physics engine.
Show shield/vest/invulnerability markers on paddles and short power labels inside canvas
for each player. Keep goals/points HUD compact. Deduplicate pickup/protection/damage sounds
through existing authoritative event IDs. Update preview copy and README with active
bonuses and reserved Stage 6 outcomes. No duel history changes.

## Acceptance

Test roll boundaries and exact counts across all percentile buckets, reserved ranges,
invalid rolls, one roll per destroyed brick, blast ownership, and independent three-hazard
caps. Verify both-end movement and mirrored weaving, missed-drop cleanup and bounded IDs.
Test gem/Repair points without combo changes, damaged wide and refresh/expiry, owner slow
return/expiry, shield refresh/expiry/priority, vest refill/persistence, invulnerability and
one-damage-per-player/tick, cap behavior and no rally reset. Test simultaneous armor/hazards,
wrong-owner contact, fast moving-paddle catches, wide-adjusted hazard coverage, goal/hazard
and goal/Repair conflicts, frozen timers/motion in pause/countdown, and wave preservation.
Validate snapshots/events, seeded replay and existing Solo/core/wall regressions. Real
WebSocket tests verify drop/power/damage delivery; UI tests cover both views, markers and
event deduplication. Run Chromium with natural gameplay plus explicitly identified server
scenario fixtures for pickup/armor/hazard rendering, portrait/landscape and return to Solo.
Record real coverage; no phone/deployment claims.

## Verification record — 2026-11-11

- `npm run check`, `git diff --check` and Pages base-path production build: passed.
- `npm test`: 104 passed (27 Solo, 9 contracts, 16 core duel, 13 real WebSocket/server,
  10 UI/client, 13 walls/waves, 16 drop/power/hazard tests).
- Roll-range counts tested over 10,000 midpoint samples; reserved outcomes and all
  enabled probabilities matched exactly. One-roll semantics, blast ownership and
  independent three-hazard caps passed.
- Both-end movement/weaving, swept paddle catches, wrong-owner overlaps, armor-first
  processing, timer boundaries, pause/countdown freeze, Repair/goal conflicts,
  invulnerability and seeded drop replay passed. Existing wave tests now use running
  power timers and verify preservation of still-active powers at spawn.
- Real WebSocket clients received matching drops, pickup points, shield absorption,
  hazard damage/invulnerability and room state. Full first-to-five regression passed.
- `npm run test:browser`: natural two-page create/join/ready/move/wall scoring/goal play
  passed. Explicit trusted server fixtures then verified a gem pickup, visible shield,
  shield absorption, rocket/worm damage limited to one increment, invulnerability,
  vest/wide/slow indicators and drop drawing. Fixture setup is confined to the optional
  test script; no server endpoint grants these powers. Forfeit result and return to Solo
  passed with no runtime exceptions.
- Portrait 390x844 and landscape 844x390 screenshots were inspected; field and controls
  fit. Artifacts: `/tmp/brickfall-stage5-portrait.png` and
  `/tmp/brickfall-stage5-landscape.png`.

No physical-phone, real-network latency, reconnect/rematch or hosting checks were claimed.
No deployment or paid resource provisioning occurred. Stage 6 enables the remaining
three pickup kinds and their interactions.
