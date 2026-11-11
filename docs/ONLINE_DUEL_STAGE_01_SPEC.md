# Stage 1 specification: shared foundations and contracts

Source: [ONLINE_DUEL_SPEC.md](ONLINE_DUEL_SPEC.md).
Roadmap: [ONLINE_DUEL_ROADMAP.md](ONLINE_DUEL_ROADMAP.md).
Status: implemented; see verification commands below.

## Permanent two-mode requirement

Keep **Solo (single player)** and **Online Duel (two online players)** as separate mode
choices. This stage adds to Online Duel without replacing Solo or changing its campaign,
controls, bonuses or `brickfall-blitz:v1` saves. Solo must run without a multiplayer backend.
Follow the [master two-mode requirement](ONLINE_DUEL_SPEC.md#permanent-two-mode-requirement)
and this stage's [mode-specific acceptance](ONLINE_DUEL_ROADMAP.md#two-mode-acceptance-in-every-stage).
Run Solo regressions alongside the stage's duel checks; networking failures must not block Solo.

## 1. Objective and boundaries

Create shared browser/Node contracts for the duel simulation, server, and frontend.
Deliver constants, pure transforms, protocol v1 structural validation, explicit public
snapshot serialization, a documented Stage 2 simulation interface, and contract tests.
Keep Solo's Game API, behavior, and storage unchanged.

No physics, rooms, sockets, multiplayer UI, hosting, or placeholder playable mode in
this stage. Phase/authentication checks, sequence deduplication, byte/rate limits, and
request-id idempotency remain server-stage responsibilities.

## 2. Modules and rules

`shared/duel-rules.js` exports frozen DUEL_RULES, PROTOCOL_VERSION=1,
WEBSOCKET_PATH=/ws, ROOM_CODE_ALPHABET=ABCDEFGHJKLMNPQRSTUVWXYZ23456789,
and ROOM_CODE_LENGTH=6. No runtime dependency, browser global, I/O, or environment
access is allowed. JavaScript ES modules and JSDoc are retained; no TypeScript migration.

| Constant                                                                        | Value                 |
| ------------------------------------------------------------------------------- | --------------------- |
| width / height                                                                  | 800 / 1000            |
| paddleTopY / paddleHeight / initialCenterX                                      | [918,64] / 18 / 400   |
| initialPaddleWidth / damageWidthDecrement / minimumPaddleWidth                  | 160 / 20 / 100        |
| keyboardSpeed / maximumPaddleSpeed                                              | 720 / 1200 px/s       |
| ballRadius / maximumBalls / maximumReboundAngle                                 | 10 / 3 / 1.13 radians |
| simulationHz / snapshotHz / maximumInputHz                                      | 60 / 20 / 30          |
| initialCountdownMs / reconnectCountdownMs / serveCountdownMs                    | 3000 / 3000 / 2000    |
| winningGoals / activeDurationLimitMs                                            | 5 / 900000            |
| brickWidth / brickHeight / brickHorizontalGap / brickVerticalGap / brickColumns | 86 / 32 / 8 / 8 / 8   |

All positions are pixels, velocities pixels/second, durations milliseconds. Convert
milliseconds to seconds for physics integration. Nested constant arrays are frozen.

### Coordinate API

- worldToViewPoint(slot, {x,y}); viewToWorldPoint(slot, {x,y}).
- worldToViewRect(slot, {x,y,w,h}).
- worldToViewVelocity(slot, {vx,vy}).
- viewInputToWorldX(slot, normalizedX).
- normalizeRoomCode(value).

Slot 0 is identity; slot 1 rotates 180 degrees. Points become (800-x,1000-y),
rectangles (800-x-w,1000-y-h), velocity (-vx,-vy), input x becomes 800*(1-x).
Transforms return fresh objects; require slot 0/1 and finite numeric arguments,
throwing on programmer errors. Input is strictly [0,1], without coercion.
Codes trim/uppercase then require six allowed characters, otherwise return null.

## 3. Protocol and snapshot contracts

`shared/duel-protocol.js` supplies:

- parseClientMessage(text): parse JSON text, validate and project recognized fields.
- validateServerMessage(value): validate and project a parsed server message.
- toPublicDuelState(internalState): detach and allowlist public state; programmer errors throw.
- ERROR_CODES: frozen protocol error names from the parent specification.

Network validators return {ok:true,value} or {ok:false,code,message}; malformed data
never throws. Explicit unsupported versions return VERSION_MISMATCH; other structural
failures return BAD_MESSAGE. Unknown properties are discarded recursively. Numeric
strings are rejected. All transmitted numbers are finite; integer fields must be safe
integers. Request IDs are nonempty strings up to 64 characters, tokens up to 256,
match/player IDs up to 128, errors up to 256. Room codes normalize on input.

### Client messages (all also carry v:1 and type)

| Type                | Required fields                                                        |
| ------------------- | ---------------------------------------------------------------------- |
| create              | requestId                                                              |
| join                | requestId, code                                                        |
| resume              | requestId, code, token                                                 |
| ready / rematch     | ready:boolean                                                          |
| input               | seq:positive integer, x:number in [0,1], action:none/release_fire/fire |
| pause               | requested:boolean                                                      |
| resume_play / leave | none                                                                   |
| ping                | id:nonnegative integer, clientTime:nonnegative number                  |

### Server messages (all also carry v:1 and type)

| Type     | Fields                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| welcome  | requestId, code, playerId, slot, token, matchId:string or null, nextInputSeq:positive integer                   |
| room     | code, phase, players:[{slot,connected,ready},{slot,connected,ready}] ordered by slot                            |
| snapshot | matchId, tick:nonnegative integer, serverTime, phase, state                                                     |
| events   | matchId, items:[event]                                                                                          |
| result   | matchId, winner:slot or null, reason, goals:[int,int], points:[int,int], durationMs, waveCount:positive integer |
| error    | code, optional requestId, message                                                                               |
| pong     | id, clientTime, serverTime                                                                                      |

Snapshot phases: countdown, playing, goal_countdown, paused, reconnecting, finished.
Room messages also allow lobby. Terminal reasons: five_goals, forfeit, time_limit;
interrupted/abandoned matches do not produce competitive results. Goal and point arrays
contain nonnegative integers indexed by slot. Durations/time values are nonnegative.

### Public state

Required state fields:

- wave:positive integer; goals:[int,int]; servingSlot:0/1.
- countdownRemainingMs, activeDurationMs: nonnegative numbers.
- pause:null or {reason,deadlineServerTime,resumePhase}.
- players: exactly two player records ordered by slot.
- balls, bricks, drops, shots: arrays, empty when no entities exist.

Pause reasons: manual, background, reconnect, server_busy. resumePhase is countdown,
playing, or goal_countdown. serverTime and deadlines share the server monotonic
millisecond clock, which continues during frozen simulation.

Player fields: slot, x, targetX, vx, width, damage, points, comboCount,
comboRemainingMs, shieldCharges, vestCharges, stickyCharges, ammo, fireCooldownMs,
wideRemainingMs, slowRemainingMs, shieldRemainingMs, invulnerabilityRemainingMs,
connected, lastAckInputSeq. x/targetX are canonical paddle centers; derive y/height from
constants. Width is 100..240; damage 0..3; shield 0..1; vest 0..2; sticky 0..3;
ammo 0..15. Counters are nonnegative safe integers; timers nonnegative numbers.
Initial lastAckInputSeq is 0; welcome supplies expected next sequence across resume.

Entity fields:

| Entity | Required fields                                              |
| ------ | ------------------------------------------------------------ |
| Ball   | id,x,y,vx,vy,r,owner,held,heldOffsetX,autoReleaseRemainingMs |
| Brick  | id,x,y,w,h,type,hp,maxHp                                     |
| Drop   | id,type,owner,x,y,baseX,motionPhase                          |
| Shot   | id,owner,x,y                                                 |

Owners/slots are 0 or 1. Entity IDs are positive safe integers, unique across all entity
arrays per match, never reused. Maximum three balls. Radius/dimensions are positive.
Brick types: standard, armored, reinforced, explosive, steel. Steel hp/maxHp are null
on the wire; the projector converts internal steel durability to null. Other hp/maxHp
are positive integers with hp <= maxHp. Drop types: sticky, bazooka, gem, wide, slow,
shield, multi, repair, vest, bomb, rocket, worm. The `multi` spelling preserves the
existing game's item naming; duel `repair` replaces solo `life`.

Projection explicitly selects every field. Do not transmit RNG state, resume tokens,
raw sockets, or internal manager objects. Returned nested arrays/objects are detached.

### Events

Every event has a positive id, nonnegative tick, and type. IDs increase within a match;
each batch is strictly ordered. Clients deduplicate by (matchId,id), results by matchId.
Stage 2 payloads: serve {servingSlot}, paddle_hit {slot,ballId}, goal {scorer,goals},
rally_replay {servingSlot}, match_finished {winner,reason}. Later content event types
must be added alongside their stages, not accepted as unchecked payloads now.

## 4. Stage 2 simulation interface (not implemented in Stage 1)

```js
new DuelGame({ seed, matchId });
game.start();
game.applyInput(slot, { seq, x, action });
game.step();
game.getState();
game.drainEvents();
```

Seed is uint32, matchId externally supplied. step advances exactly 1/60 second.
applyInput receives validated player-view input, returns boolean acceptance, updates
acknowledgement for accepted input, and ignores stale sequences. getState returns a
detached public simulation state; drainEvents returns pending ordered events once.
No ambient randomness, clocks, or I/O in simulation. Room manager owns sockets,
connection status, wall-clock deadlines, and scheduling, merging these into snapshots.
No stub class or empty shared/duel-game.js is required at this stage.

## 5. Verification and acceptance

`tests/duel-contracts.test.js` covers transforms/round trips, rectangle sizes and velocity,
input endpoints/midpoint, bad slots/numbers/ranges, room-code normalization, all client
and server types, malformed JSON/version/action/sequence, unknown-field projection,
complete/empty snapshots, pause state, steel serialization, detached references, private
field exclusion, duplicate IDs, sparse arrays, and invalid nested state/events.
Node imports require no browser globals. A Vite browser bundle of both shared modules
must also succeed without writing build output. Existing check/test scripts include
new modules/tests; format includes shared source. No deployment workflow change needed
because CI already runs these scripts.

Run npm run check, npm test, and npm run build -- --base=/break-the-wall-game/.
Complete only when contract tests, Solo regressions, syntax checks, browser module
bundling, and production build pass. No visual/device behavior changes in this stage.

### Verification record — 2026-11-11

- `npm run check`: passed.
- `npm test`: 36 passed (27 existing Solo tests and 9 contract tests).
- Shared modules bundled for browser use through Vite with `write:false`: passed.
- `npm run build -- --base=/break-the-wall-game/`: passed.
- `git diff --check`: passed.

No multiplayer gameplay, live-server, visual, or physical-phone validation was performed;
those behaviors are outside this stage. Changes are local; nothing was deployed.
