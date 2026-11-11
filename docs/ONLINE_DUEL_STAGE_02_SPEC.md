# Stage 2 specification: pure competitive simulation

Source: [ONLINE_DUEL_SPEC.md](ONLINE_DUEL_SPEC.md), sections 4, 6–8, 13–14.
Depends on [Stage 1](ONLINE_DUEL_STAGE_01_SPEC.md).
Status: implemented; verification recorded below.

## Permanent two-mode requirement

Keep **Solo (single player)** and **Online Duel (two online players)** as separate mode
choices. This stage adds to Online Duel without replacing Solo or changing its campaign,
controls, bonuses or `brickfall-blitz:v1` saves. Solo must run without a multiplayer backend.
Follow the [master two-mode requirement](ONLINE_DUEL_SPEC.md#permanent-two-mode-requirement)
and this stage's [mode-specific acceptance](ONLINE_DUEL_ROADMAP.md#two-mode-acceptance-in-every-stage).
Run Solo regressions alongside the stage's duel checks; networking failures must not block Solo.

## Goal and boundaries

Implement `shared/duel-game.js` as a deterministic, DOM-free 60 Hz simulation of an
empty-field duel. Two paddles return one served ball, misses award goals, and the first
player to five wins. Keep Solo working and preserve Stage 1 wire contracts.
No bricks, wave progression, pickups, hazard damage, weapons, networking, UI, room
lifecycle, rematch, or deployment. Simultaneous-exit tests may inject up to three balls
to establish the aggregation rule before multiball is implemented in Stage 6.

## API and state

- `new DuelGame({seed,matchId})`: require uint32 seed and nonempty matchId <=128 chars;
  invalid programmer configuration throws. Initializes `phase='lobby'`, tick=0,
  wave=1, zero goals/points/damage, both players centered, and empty entity arrays.
- `start()`: succeeds once, returning boolean; chooses server with seeded fair coin
  and enters 180-tick initial countdown. Repeated calls never reset a live/finished game.
- `applyInput(slot,{seq,x,action})`: boolean, finite normalized view x, safe positive
  sequence greater than last acknowledgement, recognized action. Only playing accepts
  inputs. Acknowledgement advances immediately for accepted input; latest target wins.
  Fire/release actions have no effect without weapons/held balls in this stage.
- `step()`: advances exactly one tick in countdown/goal_countdown/playing; lobby,
  paused, finished calls are no-ops. No caller-supplied delta. Expose `phase` and `tick`
  separately from `getState()` for the existing snapshot envelope.
- `getState()`: detached Stage 1 public state; fields for future mechanics start at
  zero/empty. Connection status defaults true; the room layer will overlay live status.
- `drainEvents()`: returns pending events once, ordered by increasing per-match IDs.
- `setPaused(boolean)`: minimal scheduler hook, not manual-pause policy. Preserve prior
  running/countdown phase, freeze all ticks/timers, clear targets/velocity on pause and
  resume. No wall-clock deadlines here; room layer will manage those in Stage 7/8.
- `getResult()`: null until terminal; thereafter returns a detached protocol-v1 result.

Internal state is available as `state` for trusted simulation code and deterministic
scenario tests, not exposed to network inputs. Server must never accept client state.
Use match-scoped monotonically increasing entity/event IDs; never reuse IDs after goals.

## Movement, collisions, and speed

World/paddle geometry and limits come from DUEL_RULES. Map inputs with the shared helper.
Paddles approach clamped target by at most 1200/60 pixels per tick; measured velocity
is actual travel/dt. The future keyboard client advances its target at 720 px/s.
Interpolate paddle travel across collision microsteps; use paddle position at contact,
not its final tick position. Ball microsteps travel at most four pixels; also subdivide
for paddle motion. Only approaching balls can hit a paddle's inward face/corners;
never catch a ball already behind it. Side walls reflect; vertical boundaries are exits.

Extract Solo's seeded RNG and unchanged paddleBounce into `shared/game-helpers.js`,
re-export both from Solo's existing module to preserve its API. For slot 1, rotate
position and velocity into owner view, aim there, then rotate back. Preserve speed,
assign owner on return, enforce inward rebound and 1.13-radian maximum aiming angle.
No paddle-return acceleration. Return/serve speed is
`min(360+25*(wave-1),585) * (1+0.12*damage[owner])`, with 0.65 slow multiplier if active.
No powers are granted or expired in this stage; later mechanics own their lifecycle.

## Serves, goals, and terminal behavior

Countdowns use integer tick budgets (180 initial, 120 subsequent) to avoid floating
rounding drift. Inputs cannot move paddles or stockpile actions during countdown.
Automatic serve appears at countdown completion; movement starts next tick. Spawn
centered just inside server's paddle, radius 10, at 15 degrees from inward vertical.
Start horizontal sign positive in server view, alternate every serve, transform to world.

Collect exits across the complete tick: bottom `y-r>1000` scores for slot 1; top
`y+r<0` scores for slot 0. Several exits at one end yield one goal; both ends yield
no goal/damage and replay with same server. Emit rally_replay for that case. Each
replay uses the ordinary two-second serve countdown and alternates serve direction.
A single conceding player gains one damage increment capped at 3 (width 160/140/120/100)
and serves next. Goal damage persists; points and wall damage will persist in later stages.

Every rally reset clears balls/drops/shots, armor/ammo/sticky, timers, and combo counters;
retain paddle position, accumulated damage, points, and wall arrays. Clamp paddle position
after restoring damage-based width. Clear movement targets and velocity. Incremented
entity IDs survive resets. Count activeDurationMs from playing ticks only, not countdown
or pause. Stage 8 will enforce the 15-minute cap.

At five goals: clear rally entities/powers, enter finished, emit goal then exactly one
match_finished, and retain an immutable result with winner, reason=five_goals, goals,
points, active duration, and waveCount. No further input/ticks/scoring. Use Stage 1 event
payloads; no new wire schema needed. Goal/brick-clear precedence is deferred to Stage 4
because this stage has no brick transition.

## Acceptance and validation

Tests must cover exact countdown duration/automatic serves, both first-server choices,
alternating serves, view input/sequence rules, actual clamped velocity, contact-time
moving paddles, slow/static/fast rebounds for both ends, side-wall reflection, maximum
speed tunneling safety, no back-side catches, same-end/opposite exits independent of
entity order, damage cap/speed, rally cleanup, first-to-five single terminal result,
pause freeze/no stored input, detached state/events/results, seeded replay, and long
finite/bounded simulation. Validate real state/events/results with Stage 1 validators.
Add simulation to browser bundle smoke test and new modules/tests to npm check/test.
Run all Solo/contract/simulation tests and Pages build. No server/device test claims.

### Verification record — 2026-11-11

- `npm run check`: passed.
- `npm test`: 52 passed (27 Solo, 9 shared-contract, 16 duel-simulation tests).
- Vite browser bundle includes `DuelGame` with `write:false`: passed.
- `npm run build -- --base=/break-the-wall-game/`: passed.
- `git diff --check`: passed.

Scenario coverage includes contact-time moving paddles and rounded corners, both
viewpoints/aiming directions, maximum legal speed, owner-dependent slow/damage speed,
exits occurring at different microsteps in one tick, deterministic replay and a
12,000-tick automatic-paddle run. No browser UI, live-server, physical-device testing,
or deployment was performed. Those features remain in later stages.
