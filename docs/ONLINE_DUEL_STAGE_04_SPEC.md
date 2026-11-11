# Stage 4 specification: symmetric walls and competitive scoring

Status: implemented locally; not deployed.

Depends on Stages 1–3. Source: [ONLINE_DUEL_SPEC.md](ONLINE_DUEL_SPEC.md), sections 4–5.

## Permanent two-mode requirement

Keep **Solo (single player)** and **Online Duel (two online players)** as separate mode
choices. This stage adds to Online Duel without replacing Solo or changing its campaign,
controls, bonuses or `brickfall-blitz:v1` saves. Solo must run without a multiplayer backend.
Follow the [master two-mode requirement](ONLINE_DUEL_SPEC.md#permanent-two-mode-requirement)
and this stage's [mode-specific acceptance](ONLINE_DUEL_ROADMAP.md#two-mode-acceptance-in-every-stage).
Run Solo regressions alongside the stage's duel checks; networking failures must not block Solo.

## Deliverable and boundaries

Add server-seeded symmetric central walls, ball/brick collisions, durability, steel,
explosive chains, individual brick points/combos, and safe endless wave advancement.
Goals still decide the first-to-five winner. No drops, hazards, weapons, rematch,
reconnect, hosting, or changes to Solo rules/storage in this stage.

## Wall generation and shared code

Extract Solo's unchanged COLORS, WALL_SHAPES and makeLevel into shared/levels.js,
import/re-export from src/game.js to preserve the Solo API and exact RNG behavior.
Add shared/duel-walls.js with makeDuelWall(wave,random,allocateId), wallBounds(wall),
and canSpawnWall(wall,state). Browser/Node pure imports only. All waves use the six
existing silhouettes, eight columns, 86x32 bricks, 8px gaps, centered at (400,500).
Rows follow Solo: min(4+floor(wave/3),6). For each 180-degree cell pair, occupy both
if either source cell is occupied; copy the canonical half's material (or its present
partner's material). This ensures every wave is symmetric in occupancy and durability.
Wave 1 is standard-only; armor unlocks at 2, explosive at 3, steel at 4, reinforced at 5.
Use the existing generator's steel candidates as mirrored pairs. Accept a steel pair
only if neither member touches any other steel cell (including diagonals); reject
whole pairs to armored material otherwise. Isolated central steel cannot form a sealed
wall or enclosure, leaving paths around it with ball-diameter clearance.
Allocate positive globally unique match entity IDs in row/column order. Retain r/c
internally for blast adjacency; do not add private fields to wire snapshots. Steel hp
is null; never serialize Infinity. Seed/RNG state stays private. Do not reroll layouts
while waiting for a safe spawn.

## Physics, attribution and scoring

Start generates wave 1 before countdown. Ball owner is lastTouch from serve/return.
Use continuous swept-circle collision with rectangle faces and rounded corners inside
adaptive microsteps <=4px ball/paddle travel. Within each microstep, resolve contacts
across balls in chronological order; equal times use ball ID then target ID. Recompute
after damage/chains so no destroyed target is hit twice from stale collision candidates.
Reflect using contact normal, preserve speed, separate by epsilon, and require approaching
motion; resting/separating contacts cannot repeatedly damage a brick. A given ball
can damage a given brick at most once per tick; subsequent contacts still reflect. Bound collision
iterations and freeze remaining microstep travel if exhausted rather than tunneling.
Keep current paddle-stroke physics; use contact-time position of moving paddles.

Trusted simulation method hitBrick(brickId,owner) is shared by balls and future shots.
Steel reflects without damage/points. Normal hits remove one hp; nonlethal hits score
zero. Destruction values: standard 100, armored 250, reinforced 450, explosive 150.
Independent player combos last 120 active ticks; counts 1–4 multiply x1, 5–9 x2,
10–14 x3, 15+ x4. At the exact expiry tick, a new destruction starts a fresh combo.
Refresh on destruction only. Countdown/pause freezes combo time; goal reset clears it.
Ball wall/brick contacts never change owner. Do not grant Solo clear/perfect/life bonuses.

Explosion resolution uses a queue. An explosive destroys once and deals one hp to each
live adjacent grid cell (including diagonals), sorted by row/column/ID. Carry the initiating
owner through all queued hits; steel neither takes damage nor propagates a blast. Multiple
explosions may hit armored neighbors independently; already dead cells do nothing.
Remove destroyed bricks from live state after resolution. Future drop rolls will be added
at this same destruction point in Stage 5; no drop RNG is consumed yet.

## Wave replacement and goal precedence

After all tick exits are aggregated, resolve a goal or opposite-exit replay first.
Skip wave scheduling entirely on a rally-reset tick, preserving scored points and wall
damage. A terminal match never spawns another wall. Otherwise, when no breakable brick
remains, remove leftover steel, emit wave_cleared, generate/cache wave+1 once, and wait
120 subsequent playing ticks. Pending replacement and remaining delay survive goals;
countdown/paused ticks do not advance it. After a last-brick/goal tie with no previously
pending wall, scheduling begins on the next playing tick after serve.

At zero delay, check the entire proposed wall bounding band (not just occupied cells).
Any ball-circle overlap, 22x22 drop box overlap, or shot box (x±4,y-10..y+17) overlap,
including boundary contact, postpones spawn without RNG/ID changes. These conservative
bounds reserve space for later stages. Only after an unoccupied tick replace the wall,
increment wave and repair both paddles' accumulated damage. Preserve goals, points,
combos, live balls, ownership, powers, ammo and shots. Restore base width 160, or 240
while wide is active; clamp paddle/target inside field without adding stroke velocity.
Existing ball speed stays unchanged until its next serve/return, when new wave base
speed and owner damage/slow apply. No Solo campaign win or lives in duel.

## Protocol and rendering

Retain protocol v1 and existing snapshot shape; add validated event payloads:

- brick_hit: {brickId,owner,hp} (hp:null for steel).
- brick_destroyed: {brickId,owner,points,x,y,brickType}.
- explosion: {brickId,owner,x,y}.
- wave_cleared / wave_started: {wave}.

Events are cosmetic; snapshots fully reconstruct walls/points. Older clients reject
unknown events cleanly, so do not deploy this change against an older client. Same-version
local frontend/server are tested together; production compatibility rollout is Stage 9.
Extract Solo brick drawing into src/brick-drawing.js and reuse unchanged visuals with
rotated rectangle coordinates for slot 1, positive durability on live bricks, and null
steel durability supported. Derive ordinary brick color from the mirrored canonical row pair (never view
row) so players see matching materials/colors. Render destruction/hit/explosion sounds
from deduplicated authoritative events. HUD retains goals and personal points; append
wave number to points. Update the preview text to describe waves, leaving bonuses for later.

## Acceptance

Test hundreds of seeded walls across waves 1–12 for symmetry, material progression,
steel isolation and passable routes, geometry/IDs, variety and reproducibility. Test all
brick durability values, steel reflection, high-speed face/corner contacts, no duplicate
hits, owner transfer on paddle return, independent combo thresholds/expiry, deterministic
explosive queues, multi-ball contact chronology and ID tie-breaking. Test natural last
brick clearance, 120-tick delay, all blocker types/boundaries, no rerolls, paused/countdown
freeze, repair/power preservation, stable ball speed, goal/clear ties and terminal priority.
Validate snapshots/events/results, retaining Solo API/regressions and real WebSocket
room tests. Add real-socket wall/score checks and mirrored rendering/UI/audio coverage.
Run the Chromium two-page smoke test with live walls/brick scores, portrait/landscape,
and return to Solo. Record actual coverage; no phone, hosting, or latency claims.

## Verification record — 2026-11-11

- `npm run check`, `git diff --check`, and Pages base-path production build: passed.
- `npm test`: 86 passed (27 Solo, 9 contracts, 16 core duel, 12 real WebSocket/server,
  9 UI/client, 13 wall/scoring/wave tests).
- Generated 1,200 seeded layouts across waves 1–12: reproducible symmetry, material
  unlocks/durability, unique IDs, centered geometry, isolated steel, and reachable
  nonsteel grid cells with ball-width exterior routes verified.
- Verified maximum-speed face/corner reflection, independent combos, explosion ownership,
  chronological simultaneous contacts, no stale destroyed-target hits, goal/clear priority,
  cached spawn delay/blockers, pause/countdown freeze and paddle repair/power preservation.
- Two real WebSocket clients received identical wall snapshots and naturally earned
  brick points/events, and completed a first-to-five match through the real simulation.
- `npm run test:browser`: two Chromium pages verified matching rotated wall material
  pixels, paddle movement, natural brick points and goals, a forfeit result and return
  to Solo; no runtime exceptions. Portrait 390x844 and landscape 844x390 screenshots
  were inspected and controls fit. Artifacts: `/tmp/brickfall-stage4-portrait.png` and
  `/tmp/brickfall-stage4-landscape.png`.

Physical-phone/internet latency, pickups/hazards, reconnect/rematch, hosting and deployment
remain for their later stages. No service was provisioned or deployed.
