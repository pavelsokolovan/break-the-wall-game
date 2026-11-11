# Stage 3 specification: local multiplayer vertical slice

Depends on Stages 1–2; implements milestone A from [ONLINE_DUEL_SPEC.md](ONLINE_DUEL_SPEC.md).
Status: implemented locally; not deployed.

## Permanent two-mode requirement

Keep **Solo (single player)** and **Online Duel (two online players)** as separate mode
choices. This stage adds to Online Duel without replacing Solo or changing its campaign,
controls, bonuses or `brickfall-blitz:v1` saves. Solo must run without a multiplayer backend.
Follow the [master two-mode requirement](ONLINE_DUEL_SPEC.md#permanent-two-mode-requirement)
and this stage's [mode-specific acceptance](ONLINE_DUEL_ROADMAP.md#two-mode-acceptance-in-every-stage).
Run Solo regressions alongside the stage's duel checks; networking failures must not block Solo.

## Deliverable and boundaries

Two local browser clients create/join a private room, ready up, watch a synchronized
three-second countdown, move opposite paddles, concede goals, and finish first-to-five.
Reuse the pure DuelGame without client-side ball physics. Preserve Solo and its saves.
Online Duel is an empty-field preview; no bricks/bonuses yet. No deploy or paid resource.
Reconnect/resume/interpolation are Stage 7; invites/pause/rematch/history Stage 8;
production hosting/wake-up Stage 9. Do not claim those features work in this stage.
Unexpected disconnects visibly interrupt a live match; never invent an opponent result.
A voluntary live leave is a forfeit. Rematch requires creating a new room for now.

## Server and contracts

- `server/index.js` exports async `createDuelServer(options)` returning HTTP server,
  WebSocket server, room manager, actual bound port, and async close(). Direct execution
  listens on 0.0.0.0, PORT default 3001; import has no listener side effects.
- `server/rooms.js` owns two-seat rooms, cryptographic codes/tokens/IDs, ready state,
  seed generation, scheduler, snapshots/events/results, expiry, disconnect and leave.
  Reuse Stage 1 protocol v1; welcome returns nextInputSeq=1 and a private token.
  Tokens are not resumable in this stage; reject resume with generic AUTH_FAILED.
- `server/protocol.js` validates messages and implements bounded token-bucket limits.
  Socket determines room/seat; ignore client-supplied physics/score/slot fields.
- Exactly two connected ready seats start once. Seats cannot join an active/finished
  room. Inputs accepted only in playing; stale sequences ignored. Both clients receive
  identical canonical state; each transforms its own view. Finish broadcasts once.
- A shared monotonic accumulator advances at 60 Hz with at most five ticks per turn.
  Snapshots every three simulation ticks (20 Hz), immediately on start/finish. Each
  loop drains authoritative events. A >500 ms stall interrupts affected live matches
  with SERVER_BUSY instead of applying a giant delta; recovery is deferred to Stage 7.
- Health GET /health returns {ok:true,v:1}. Same exact Origin allowlist for HTTP CORS
  and WebSocket /ws. Reject missing/unapproved WebSocket Origin. Defaults are explicit
  localhost/127.0.0.1 origins on Vite 5173 and preview 4173 in development, Pages origin
  in production. ALLOWED_ORIGINS comma-separated override; no wildcard.
- Defaults: 20 rooms (including retained rooms), 100 sockets, 8192-byte inbound limit,
  50 messages/sec with ten extra burst tokens, five create/join attempts/minute/IP.
  Key IP limits by socket.remoteAddress; ignore forwarding headers until trusted proxy
  handling is configured. Prune unused limiter entries. Bound request-id replay cache
  to 64 entries per connection; reject further unique requests rather than evicting
  idempotency records. Reuse of an ID with different payload is BAD_MESSAGE.
- Avoid unbounded outgoing buffers: disconnect at >64 KiB buffered output. Binary,
  malformed JSON, invalid phases and incompatible versions return bounded errors.
  Unknown room/full room return explicit errors; no tokens in logs or public messages.
- Empty rooms deleted immediately. Unstarted lobbies expire after 10 minutes; completed
  rooms after five. Heartbeat pings every ten seconds; missing pong for 25 seconds closes
  socket. A live disconnect closes that room visibly as interrupted. Lobby disconnect
  releases its seat; reconnect reservation comes in Stage 7. Shutdown closes clients
  as interrupted and cancels timers. No competitive result on shutdown/abandonment.
- Add `DuelGame.finish(winner,reason)` for trusted room-layer forfeit termination;
  clear transient state, return boolean, freeze finished games, emit one terminal event.
  Existing five-goal path uses the same method. Only five_goals/forfeit/time_limit
  reasons accepted; caller chooses time-limit winner in Stage 8.

## Browser integration

- Add mode selector Solo / Online Duel. Entering online pauses an active Solo run;
  returning leaves it paused for explicit resume. Online keys never control Solo.
- `src/online-client.js`: socket connection timeout, validated server messages, bounded
  create/join request timeout, sequence tracking, at most 30 Hz input, protocol pings,
  explicit error/close states, cancellation and stale-connection guards. No auto retry,
  token persistence, or ball prediction. Duplicate submissions disabled while pending.
- `src/multiplayer-ui.js`: create/join code form, two lobby slots, readiness toggle,
  room code, goals and personal points, countdown/result/status and Leave Room action.
  Render network strings with textContent. Codes normalize case and reject invalid input.
  Local preview instructions explain automatic serves/first-to-five/no bricks.
- `src/duel-view.js`: uniformly fitted 800x1000 Canvas world, pixel paddles/balls,
  owner's paddle always at bottom via Stage 1 transforms, upright HUD. Latest snapshots
  only in Stage 3; freeze with a visible warning after 250 ms stale state. No client
  scoring/collision engine. At most one animation loop while online, stop it on Solo.
- Controls: pointer/mouse/touch targets, captured drags, arrows/A-D target at 720 px/s;
  tap (<12 client pixels, <500 ms, starting near paddle) or Space requests release_fire;
  F requests fire; dedicated action button. No actions on drag. Clear keys on blur/hidden.
  Actions have no weapons to operate until later stages; serves remain automatic.
- Responsive sizing respects dynamic viewport/safe areas and letterboxes without
  changing world coordinates. Fit landscape as well as portrait; cancel touches safely.
- Development derives ws://<frontend-host>:3001/ws; production requires explicit
  VITE_MULTIPLAYER_URL, never defaults to localhost. Missing/invalid configuration shows
  an unavailable message while Solo works. Production requires wss; .env.example documents
  public configuration and exact LAN development origins. Full health wake-up comes later.
- Reuse a small pixel drawing primitive between modes rather than copying Solo renderer.
  Reuse authoritative paddle/goal audio through existing sound function, deduplicated
  by matchId/event ID. No local history changes in this stage.

## Acceptance tests

Run existing tests plus real local ws clients: create/join/ready, full/unknown rooms,
room isolation, idempotency, movement sequence checks, countdown through goals and
first-to-five result, leave forfeit, disconnect interruption, malformed/binary/oversize
messages, version/origin checks, health CORS, limiter/resource/send-buffer limits,
expiry, bounded scheduler catch-up/stalls and orderly shutdown. Drive the production
scheduler clock explicitly where needed; do not replace the pure simulation.

Happy DOM tests cover mode switching/Solo isolation, unavailable backend, create/join
pending/errors, lobby readiness, transformed drawing, countdown/results, pointer
thresholds, keyboard/actions, stale display and cancellation of delayed connections.
Run a real Chromium two-page smoke test when available: join, ready, move both paddles,
see both bottom viewpoints/countdown/goals/result, return to Solo, and verify no page
errors. Record actual browser/device coverage. CI must run syntax/tests/build via existing
workflow; add server/client modules and tests to scripts. No deployment in this stage.

## Verification record — 2026-11-11

- Syntax checks and `git diff --check`: passed.
- 71 automated tests passed: 27 Solo, 9 shared contracts, 16 pure duel simulation,
  11 real WebSocket/server lifecycle/resource tests, 8 client/UI tests.
- GitHub Pages base-path production build: passed with backend URL absent; Online
  Duel reports unavailable and does not fall back to localhost in production.
- Optional Chromium smoke test: passed using two browser pages emulating 390x844.
  Both pages created/joined/readied, counted down, moved paddles through real sockets,
  displayed a goal, received a voluntary-leave forfeit result, and returned to Solo.
  No runtime exceptions. Screenshot inspection confirmed controls/field fit portrait
  and 844x390 landscape. The full first-to-five match was verified by real WebSocket
  integration clients using the production simulation and scheduler with an explicit
  clock; the browser smoke test terminates via forfeit after a natural goal.
- Screenshots: `/tmp/brickfall-stage3-portrait.png` and
  `/tmp/brickfall-stage3-landscape.png` (local validation artifacts).
- Local socket listeners required execution outside this environment's restricted
  command sandbox. Tests were run with that permission; no test was skipped for it.

No physical phones, real Wi-Fi/mobile-data pairing, internet jitter, free-host wake-up,
reconnect/resume, or rematch validation was performed. Those belong to later stages.
No service was provisioned, no deployment performed, and no data was sent to other people.
