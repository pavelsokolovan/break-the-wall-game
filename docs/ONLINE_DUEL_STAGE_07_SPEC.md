# Stage 7 specification: connection recovery and smooth rendering

Status: implemented locally. Stage 8 is next; no hosted deployment.

## Permanent two-mode requirement

Keep Solo and Online Duel as separate modes. Solo must remain playable without a backend,
retain its campaign/controls/bonuses and brickfall-blitz:v1 saves, and never start recovery
sockets. Returning to Solo cancels online retries; an active Solo run stays paused until
explicit resume. This stage follows the master specification and all-stage mode checks.

## Scope and contracts

Replace immediate disconnect interruption with seat recovery; add clock sampling,
interpolated remote rendering and locally predicted paddle movement. Preserve full
Stage 1–6 gameplay. Manual pause policy, invitations, rematch, duel history and match
active-time cap remain Stage 8; hosting/cold wake-up Stage 9; phone/network release QA
Stage 10. No deployment or new paid services.

Protocol v1 additions are optional welcome.resumed:boolean, error.terminal:boolean,
room.serverTime:number and room.reconnectDeadlineServerTime:number|null. Existing
snapshot pause/countdown/connected/ack fields carry recovery state; no token or internal
socket state is added to public snapshots. Error terminal=true means interrupted/no
further recovery, not a match result. Only authoritative result messages decide outcomes.

## Server recovery and security

- Seats store player ID, 128-bit random bearer token, socket|null, ready and sequence
  acknowledgement. A dropped connection reserves its seat; joining cannot take it.
  Resume authenticates code+token, rotates token, returns welcome with same player/slot,
  matchId and nextInputSeq=lastAck+1, then room/full snapshot and any retained result.
  Unbind and close a replaced socket before accepting further seat input. Invalid/old
  tokens return generic AUTH_FAILED; absent rooms ROOM_NOT_FOUND, never a new match.
- Create/join request idempotency remains; resume is also idempotent within a connection.
  Replay never rotates again. Old tokens are invalid after rotation. Use timing-safe
  comparison. Never place tokens in URLs, logs, room messages or peer snapshots.
  Limit resume attempts separately to 20/minute/IP so same-Wi-Fi recovery is not blocked
  by the five create/join attempts limit; retain socket/message/cache/backpressure caps.
- First missing seat starts a shared 30-second monotonic wall-clock grace window, not
  simulation time. Mark disconnected immediately on close or after 25 seconds without
  WebSocket pong (ping every ten seconds). Freeze the pure game, queued actions, targets,
  ball/power/shot/held-ball/combo/wave/active-duration timers. Send connected status and
  reconnect deadline to remaining player. A second disconnect cannot extend the outage.
- If both return in time, keep the game frozen for a three-second synchronized recovery
  countdown. This is a room-layer overlay, not a new serve: preserve balls/walls/stats and
  the original playing/initial-countdown/goal-countdown phase and remaining sim timers.
  On completion restore that phase, clearing stale movement/actions. Inputs during any
  freeze/countdown are rejected. Further disconnect during recovery countdown reuses
  the same grace window; successful return to simulation ends that outage.
- At grace expiry, one connected seat wins by authoritative forfeit; both absent means
  abandon/delete with no result. Preserve finished rooms/results/tokens for five minutes;
  late resume can retrieve the forfeit result. In lobbies reserve disconnected seats for
  30 seconds, then free them without recording results; restored players must Ready again.
- Broadcast frozen snapshots at 20 Hz when there is recovery state, despite frozen tick.
  Envelope phase is reconnecting/paused/recovery countdown as appropriate; state.pause
  includes reason/deadline/resumePhase, and recovery countdownRemainingMs is wall-clock.
  Public connected flags reflect socket readiness, not mere seat existence.
- A scheduler gap >500ms freezes live rooms with server_busy, discards catch-up and
  waits for one continuous second of <=100ms scheduler gaps, then a three-second recovery
  countdown. Three stalls within 60 seconds interrupt with terminal error/no invented
  winner. Disconnect grace takes precedence and is never extended by stalls. Retain
  max five simulation ticks per scheduler turn, normal room expiry and shutdown cleanup.

## Client identity and retry lifecycle

- Store only the online seat record in sessionStorage under
  brickfall-blitz:duel:session:v1: backend URL, room code, token, player ID, slot and next
  input sequence. Validate stored shape/URL and bound values; storage failure falls back
  to in-memory recovery. Do not touch Solo storage. Only send a token to its saved backend.
- Initial page stays Solo and opens no socket. Explicit Online Duel entry may resume a
  saved seat; unexpected loss during an online session retries after 1,2,4,8,8... seconds,
  bounded by a 30-second client deadline. Each attempt has a connection/request timeout,
  never creates/joins a replacement room. Show reconnecting/resuming/countdown/interrupted
  status. A successful welcome rotates persisted token and preserves monotonically
  increasing client sequence (max of local next and server expected next).
- Missing/expired room, auth failure, incompatible/invalid server response and terminal
  error stop retries and clear saved identity, showing interrupted unless a real result
  already arrived. A dropped recovery attempt may retry the same seat. Finished results
  can be delivered again after resume; UI deduplicates by match ID as before.
- Intentional Leave/Solo selection cancels timers/pending promises and clears identity;
  no delayed welcome or stale socket callback can reactivate an old session. Confirm
  live leave even while disconnected; offline leave may forfeit when server grace expires.
  Late callbacks use generation guards. Recovery and pending histories stay bounded.

## Clock, interpolation and local movement

Add pure src/duel-sync.js utilities with injected time for tests. Share one server clock
estimate between connection and view. Seed from first snapshot; refine with verified
ping/pong midpoint samples, keeping the minimum RTT among eight recent samples. Bound
outstanding ping records. No client clock affects server rules/deadlines.

Keep at most 30 snapshots. Render opponent paddle, flying/held balls, drops and shots
about 100ms behind estimated server time, interpolating positions by stable entity ID.
Use latest authoritative discrete state for goals, damage, bricks, powers and entities.
Never interpolate across match/phase/goals/wave changes, held-state/owner transitions or
missing entities. Clear buffers on resumed welcome and full resync. Do not extrapolate
ball physics: hold at newest available sample; warn/freeze local movement after 250ms
without fresh state. There is no second collision engine on the client.

Predict only local paddle movement with shared width/clamp and 1200px/s limit. Pointer
changes take effect next frame, before 30Hz send; keyboard target remains 720px/s. Retain
up to 128 sequenced movement inputs, prune acknowledged sequences, and replay pending
movement from authoritative x/target/time to reconcile. Smooth display correction over
80ms, clamped to field; never predict actions, scores, catches, shots or goals. Held balls
follow the displayed paddle only when their held state is authoritative. Freeze/reset
prediction on nonplaying phases, resync or connection loss; no queued action is replayed.

## Acceptance and verification

Test real sockets for same-seat resume/token rotation, stale socket replacement, invalid
and old token rejection, third-party seat theft, sequence continuity, frozen full state,
recovery countdown preserving initial/goal countdowns, renewed disconnect, grace forfeit,
both gone, lobby reservation/expiry, result replay, lost rooms, heartbeat, slow sends,
stall freeze/healthy countdown/repeated-stall interruption and orderly shutdown. Preserve
existing server rate/origin/resource tests and all Solo/gameplay regressions.

Unit-test bounded exponential retries, cancel/reload/sessionStorage failure, invalid
stored data, URL binding, delayed callbacks and deadline stop using deterministic timer
injection. Test clock samples, interpolation/barriers/IDs, no extrapolation, stale freeze,
local movement before send, acknowledgement pruning/replay and smooth reconciliation.
UI checks show recovery state, disable actions while frozen, allow confirmed Solo escape,
and preserve results. Chromium two-page checks force a real socket loss and reclaim the
same room/seat with preserved state, then resume via countdown and complete existing
weapon/control/portrait/landscape/Solo smoke checks. Record actual coverage; no internet
jitter/physical-device/hosting claims. Run syntax, full tests and production base-path build.

## Implementation and verification record

Implemented in server/rooms.js, server/protocol.js, src/online-client.js,
src/duel-sync.js and src/multiplayer-ui.js, with optional protocol v1 fields in
shared/duel-protocol.js. Solo simulation and its save format remain unchanged.

Verified locally on 2026-11-11:

- `npm run check`: passed.
- `npm test`: all 144 tests passed, including 21 real-socket server tests,
  14 online UI tests and 11 synchronization/recovery tests. Includes lone-host
  lobby recovery, replaced/old-token rejection, retained results, grace expiry,
  frozen gameplay/countdowns, repeated stalls and existing Solo regressions.
- `npm run build -- --base=/break-the-wall-game/`: passed.
- `npm run test:browser`: passed with two Chromium pages. Forced transport loss
  recovered the same match/player/seat with token rotation, preserved frozen state
  and disabled actions, then resumed through the synchronized countdown. Existing
  wall/scoring/weapon/control/result/Solo checks passed with no runtime exceptions.
- Inspected portrait (390 × 844), landscape (844 × 390), and reconnect screenshots;
  controls fit. Screenshots are local `/tmp/brickfall-stage7-*.png` artifacts.
- `git diff --check`: passed.

Browser validation caught and fixed native timer receiver binding; socket coverage
also verifies that an unoccupied second seat does not block a recovered lobby host.
Real internet jitter, physical phones, hosting, manual pause/rematch/history and
release acceptance remain assigned to the later roadmap stages.
