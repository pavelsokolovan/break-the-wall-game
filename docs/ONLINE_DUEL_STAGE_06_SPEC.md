# Stage 6 specification: multiball, sticky paddle and bazooka

Status: implemented locally; not deployed.

Depends on Stages 1–5. Source: [ONLINE_DUEL_SPEC.md](ONLINE_DUEL_SPEC.md), sections 5, 7–8.

## Permanent two-mode requirement

Keep **Solo (single player)** and **Online Duel (two online players)** as separate mode
choices. This stage adds to Online Duel without replacing Solo or changing its campaign,
controls, bonuses or `brickfall-blitz:v1` saves. Solo must run without a multiplayer backend.
Follow the [master two-mode requirement](ONLINE_DUEL_SPEC.md#permanent-two-mode-requirement)
and this stage's [mode-specific acceptance](ONLINE_DUEL_ROADMAP.md#two-mode-acceptance-in-every-stage).
Run Solo regressions alongside the stage's duel checks; networking failures must not block Solo.

## Deliverable and boundaries

Activate the reserved sticky 3%, bazooka 3%, and multiball 4% rolls, restoring the full
56% no-drop table. Implement held-ball catches/releases, anti-stall timeout, three-ball
cap, stored ammunition, fire actions, shots and hazard interception for both ends.
Keep Solo and its saves unchanged. Networking lifecycle, prediction/interpolation,
reconnect, pause policy, rematch/history and hosting remain later stages. This completes
gameplay milestone B locally; it does not make the service production-ready or deploy it.

## Sticky and manual actions

- Sticky refills three catches, never stacks. Each paddle return with a charge consumes
  one and attaches that ball at its contact offset, assigns the paddle owner, stops
  velocity and sets a full 3000ms auto-release timer. Stable collision ordering chooses
  catches when several balls arrive together and charges are insufficient.
- heldOffsetX is canonical offset from paddle center; clamp to width/2-radius. Held balls
  follow the current paddle on both ends, including power expiry, damage, Repair and wave
  repair. Use y=918-radius-1 for slot 0 and 82+radius+1 for slot 1. They count toward cap,
  do not collide while held, and cannot score goals. Do not create new ball entities on catch.
- Tap/Space/action button releases all owner's held balls, even after final catch charge.
  Use current measured paddle velocity and owner-view offset with unchanged paddleBounce,
  current owner damage/slow/wave speed. All releases point inward and do not re-catch.
  Fire-only F never releases. Manual release/fire is processed once at the next fixed
  tick after paddle movement; latest movement updates cannot overwrite queued actions.
- Each existing held ball decrements its timer once per playing tick. At zero, release
  that ball automatically using the same aiming rules, without firing. Fresh catches
  start at full 3000ms; pause/countdown freezes the timer. Clear queued actions on pause,
  countdown, goal/replay or terminal state; never stockpile inputs while inactive.
- Sequenced input still acknowledges valid movement when a fire request cannot execute;
  ammo/cooldown rejection suppresses the fire action without consuming ammunition.
  Duplicate/out-of-order input never repeats an action. Coalesce bursts to at most one
  release-all and one fire attempt per seat/tick.

## Multiball

Select owner's lowest-ID ball, held or flying, otherwise globally lowest-ID ball. Create
up to two flying balls at its current position, leaving original state/owner unchanged.
New balls belong to pickup owner and travel toward opponent at +/-0.45 radians from
inward vertical, with current owner/wave/damage/slow speed. If only one slot remains,
create the negative-angle ball. This works from an opponent-owned or held source.
Global cap is three including held balls; at cap grant +500 without combo refresh.
An impossible empty-source playing fixture also converts to +500 rather than creating
an undefined ball. Simultaneous pickups resolve by stable drop ID (within existing armor
priority), so the first split fills available slots and later pickups convert at cap.
Normal aggregated exits still end the whole rally even when another ball is held.

## Bazooka and authoritative projectiles

Bazooka adds five shots, capacity 15. Ammo/250ms cooldown are authoritative. Fire shoots
one projectile toward opponent at 720px/s if playing, ammo>0, cooldown=0; consume exactly
one shot and start cooldown. Action releases held balls and attempts one shot; fire-only
attempts one shot. A pickup at tick end cannot retroactively authorize an earlier fire.
Cannon anchor is (paddle.x,894) bottom or (paddle.x,106) top, updated after paddle travel.
Use an 8x27 projectile box (relative y -10..+17 for slot 0, mirrored for slot 1). Shots
fully exiting the opposite world boundary disappear with no goal/points. No homing,
reflection, damage to paddles/balls, prize destruction, or projectile-vs-projectile hits.

Extend the shared contact timeline to flying balls and shots together, preserving <=4px
microsteps. Sweep shots against brick rectangles and hazard boxes at their current
pre-drop-motion positions (drops advance after projectile phase, as in parent tick order).
Resolve earliest contact globally, tie by moving entity ID then target ID; recompute
candidates after every damage/chain/interception. Shots hit at most one target:

- Hazard of either owner: remove it immediately, award shooter +100 (no combo refresh),
  consume shot. It cannot damage a paddle later in this tick.
- Brick: one damage credited to shooter through existing durability/scoring/explosive
  queue; steel consumes shot without damage/points. Concurrent shot/ball hits cannot
  score a dead brick from stale contacts.

Use globally unique match IDs for all new balls/shots. Naturally bounded shots (4/s per
player with finite flight lifetime) and existing ammo cap must not grow queues. Add pure
shared/duel-weapons.js for constants and shot bounds; reusable swept-AABB helper in
shared/duel-collision.js. Wave guards use owner-correct projectile bounds. Rally resets
clear held/flying balls, shots, ammo, catches, cooldowns and queued actions; wave advance
preserves them and clamps held offsets to repaired geometry. Hazard damage does not reset.

## Protocol, graphics and controls

Keep existing snapshot shape/protocol v1, now using held/ammo/shot fields already defined.
Extend drop_spawned/pickup type enums for sticky/bazooka/multi. Add cosmetic events:
ball_held {ballId,owner}, ball_released {ballId,owner,automatic:boolean},
ball_split {ballId,sourceBallId,owner} per added ball, shot_fired {shotId,owner,x,y},
shot_hit {shotId,owner,brickId}, hazard_intercepted {shotId,dropId,owner,points:100,x,y}.
Snapshots remain sufficient; deduplicate effects by match/event ID. No client physics,
shots, catches or score confirmation before authoritative state. Local frontend/server
must be updated together; hosting/version rollout remains Stage 9.

Extract reusable Solo cannon/sticky-strip/shot artwork into src/weapon-drawing.js;
retain Solo appearance. Apply the same world rotation to shots and gear as other objects.
Draw held balls normally, add catches/ammo to compact canvas power labels, and show
mobile button as RELEASE, RELEASE / FIRE (ammo), FIRE (ammo), or AUTO SERVE when no action
is useful. Disable when inactive and when no release/fire is possible; do not block a
release during shot cooldown. Space/tap combines release/fire; F only fires; drag/cancel
never triggers actions. Coalesce release_fire over fire when both queue before a send.
Reuse existing sounds for release, shots and interception, with no duplicate sound from
replayed events. Update menu instructions/README to describe complete local bonuses.

## Acceptance

Verify full roll probabilities, refill/cap behavior, both-end catch/follow/offset clamps,
last-charge release, automatic 180-tick release with pause/countdown freeze, action
coalescing/sequence replay, manual current-stroke aiming, no immediate re-catch, and
cap including held balls. Verify source selection/fallback, new-owner direction/speed,
stable simultaneous split conversion and no cap overflow.
Test ammo, cooldown boundary, fire-only vs combined action, invalid phases, reset and
wave preservation, mirrored shots, bounds cleanup, high-speed armor/steel/explosion
hits and shooter credit. Test both-owner hazard interception, no hostile prize/ball/
paddle hits, same-tick interception versus hazard damage, chronological shot/ball ties
independent of array order, goal/reset/terminal priority and deterministic mixed replay.
Keep existing Solo/contract/core/wall/drop/server/UI checks and production base-path build.
Real WebSocket tests exercise actions through sockets; Chromium tests use identified
trusted server fixtures for sticky/bazooka/multi plus actual UI/keyboard actions, snapshots,
portrait/landscape and return to Solo. No phone/network/deployment claims.

## Verification record — 2026-11-11

- `npm run check`, `git diff --check` and Pages base-path production build: passed.
- `npm test`: 124 passed (27 Solo, 9 contracts, 16 core duel, 14 real WebSocket/server,
  12 UI/client, 13 wall/wave, 16 drop/power, 17 weapon/interaction tests).
- Full 10,000-sample drop probability test now includes sticky/bazooka/multi at their
  original ranges. Global cap, source ownership, simultaneous split conversion,
  180-tick automatic release, 15-tick cooldown, pause/action deduplication, both-end
  aiming/following, shot lifetime, armor/explosive damage and interception passed.
- Chronological shot/shot and ball/shot ties were checked in different array orders;
  dead targets cannot receive stale damage. Goal/terminal/wave and mixed deterministic
  replay regressions passed. Existing placeholder wall blockers were updated to use
  moving shots and valid held-ball attachment semantics.
- Real WebSocket clients obtained pickups, caught the last sticky charge, fired without
  releasing, released with a movement-only message queued afterward, split, and intercepted
  through sequenced network inputs. The interception fixture isolates its score from
  older live shots and balls, which may legitimately earn separate brick points.
- Chromium smoke test: natural two-page room/countdown/movement/wall/goal play passed.
  Explicit trusted server fixtures granted pickups, then actual F and Space key events
  verified fire-only versus release after final charge. Three distinct rendered ball
  sprites were observed after multiball. An actual mobile-action-button click triggered
  a +100 hazard interception. Mirrored shots/cannons/held balls, protection, forfeit
  result and return to Solo passed without runtime exceptions.
- Portrait 390x844 and landscape 844x390 screenshots were inspected; field and controls
  fit. Artifacts: `/tmp/brickfall-stage6-portrait.png` and
  `/tmp/brickfall-stage6-landscape.png`.

Milestone B gameplay is complete locally. Physical-phone/internet-network validation,
reconnect/prediction/interpolation, complete session lifecycle and hosting remain for
Stages 7–10. No service was provisioned or deployed.
