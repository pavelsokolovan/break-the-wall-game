# Online Duel implementation specification

Status: Stages 1–6 implemented locally; Stages 7–10 pending. Not deployed.
Original handoff prepared 2026-11-11. See [the staged roadmap](ONLINE_DUEL_ROADMAP.md) for progress.

Repository: https://github.com/pavelsokolovan/break-the-wall-game
Frontend: https://pavelsokolovan.github.io/break-the-wall-game/
Baseline: `894b22a` — single-player game including sticky paddle and bazooka.

## 1. Goal and agreed decisions

Add competitive online play for two people on different phones. Paddles occupy opposite ends of one shared field. Both internet connections and the same Wi-Fi with internet access must work. Preserve the existing single-player mode and its saves.

### Permanent two-mode requirement

The product must keep **Solo (single player)** and add **Online Duel (two online players)**
as separate, explicitly selectable modes. Online Duel is an addition to Solo, never a
replacement. This requirement applies to every implementation stage and release.

- Solo retains its existing ten-level campaign, controls, bonuses, scores, settings and
  `brickfall-blitz:v1` saves. It requires no room, account, WebSocket connection, or
  running multiplayer backend; it must work when the backend is missing or unavailable.
- Online Duel uses the separate authoritative `DuelGame` and server for exactly two
  players in private rooms. Online rules, failures and later reconnect logic must not
  change Solo simulation or write into Solo records. Future duel history has its own key.
- The interface offers clear Solo and Online Duel choices. Entering Online Duel pauses
  an active Solo run; returning keeps it paused until the player explicitly resumes.
  Leaving a live duel requires confirmation and follows the duel forfeit policy.
- Every stage runs Solo regressions as well as its duel tests. Final acceptance includes
  both mode choices, preserved Solo saves, Solo play without a backend, and a complete
  two-client Online Duel match. Deployment must keep Solo available throughout.

The user selected competitive play, requested a free hosting plan, and approved preparing this handoff. The implementation below resolves remaining design choices into explicit defaults; these may be tuned through playtesting without redesigning the architecture.

- GitHub Pages hosts the existing browser client; GitHub Actions deploys it.
- Render **Free Web Service** hosts a Node.js WebSocket server.
- No paid database, account system, custom domain, matchmaking service, or subscription is needed.
- Two-player private rooms, room codes, shareable links, readiness, first-to-five goals, rematch, and reconnect are in scope.
- Keep the pixel graphics, local results, minimal interface, existing hazards, bonuses, and contact-time paddle physics.
- Preserve both modes throughout the staged implementation. Hosted deployment remains a later stage.

## 2. Existing project and development constraints

The repository uses JavaScript ES modules, Vite, Canvas 2D, and ordinary HTML/CSS. Do not migrate frameworks or rewrite the working solo game to introduce multiplayer.

Relevant files:

| File                           | Current responsibility                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `src/game.js`                  | Pure solo simulation; seeded RNG; wall generation; brick damage; drops; paddle bounce; sticky catches; bazooka shots |
| `src/main.js`                  | Canvas renderer, input, Web Audio, local saves, overlays and information panels                                      |
| `src/style.css`                | Responsive pixel arcade interface                                                                                    |
| `index.html`                   | Cabinet, menus, legend and scores dialog                                                                             |
| `tests/game.test.js`           | Solo simulation tests                                                                                                |
| `tests/interface.test.js`      | Happy DOM interface tests, including touch tap versus drag                                                           |
| `.github/workflows/deploy.yml` | Check, test, build, publish `dist/` to GitHub Pages                                                                  |

Current commands: `npm ci`, `npm run dev`, `npm run check`, `npm test`, and `npm run build -- --base=/break-the-wall-game/`. Baseline has 27 passing tests. Fonts are bundled locally; retain their license notices. No game-code license has been chosen.

Keep the existing solo `Game` API working. Extract small shared pure helpers if useful; introduce a separate `DuelGame` rather than adding networking to solo physics. The browser and Node must import shared rules without accessing DOM or audio. Do not ship server secrets in Vite variables.

## 3. Player experience and minimal interface

1. Initial menu offers **Solo**, **Online Duel**, and the existing Legend/Scores buttons.
2. Online Duel offers **Create room** and **Join room** (six-character room code).
3. Room creator receives the code and a **Share invite** button. Use the native share API if available; otherwise copy/display a link. Clipboard failure must have a manual-copy fallback.
4. Invite format: `https://pavelsokolovan.github.io/break-the-wall-game/?room=ABC234`. Parse and validate the query; open the join screen, but require an explicit Join gesture. This format works on Pages without SPA route rewrites.
5. The lobby shows two slots, connected/ready status, and a Ready button. Both players must be present and ready before the server starts a three-second countdown.
6. Each phone sees its own paddle at the bottom and the opponent at the top. HUD: current match goals, personal brick points, and connection/reconnect state when relevant. Put detailed stats, instructions, and legend behind buttons.
7. Play controls remain drag/mouse/A-D/arrows; tap the paddle or Space releases/fires; F fires only. Maintain the existing tap-versus-drag threshold. Keep a mobile Release/Fire action button.
8. End screen shows result, goals, personal points, and **Rematch** / **Leave room**. Both players must request rematch; a single request cannot restart the other player's match.
9. Leaving a live match requires confirmation and is a forfeit. Leaving a lobby does not record a match result.

Room codes must be case-insensitive on input and displayed uppercase. Use six cryptographically random characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; check collisions server-side. The host has no gameplay advantage or power to alter rules after joining.

## 4. Competitive match rules

### World and viewpoint

Use an 800 × 1,000 logical world, uniformly scaled and letterboxed to fit the viewport; never crop play space or rely on page scrolling to reach the paddle. Use dynamic viewport height and safe-area insets on mobile. Recompute sizing on resize/orientation change without changing simulation coordinates.

- Bottom player (slot 0) paddle: top edge y=918, height=18, initial center x=400.
- Top player (slot 1) paddle: top edge y=64, height=18, initial center x=400.
- Initial widths: 160; ball radius: 10. Side walls reflect; top/bottom behind the paddles are goal exits.
- Build a random central wall with eight columns of 86 × 32 bricks and 8-pixel horizontal / vertical gaps, centered around y=500. Existing `makeLevel` can supply grid/material data, but remap its solo y positions into the central band.
- Slot 0 draws canonical coordinates. Slot 1 rotates the entire world 180 degrees: point `(x,y)` becomes `(800-x,1000-y)`; rectangle top-left becomes `(800-x-w,1000-y-h)`. Apply the same transform to balls, paddles, shots, drops, and trails, not HUD text.
- Input x is normalized in the player's view. Server converts slot 0 to `800*x`, slot 1 to `800*(1-x)`. Keep this conversion in one tested helper.

### Goals, serves, and winners

- First player to five goals wins. Brick points are a separate statistic and never override goals.
- A ball fully crossing the bottom exit (`ball.y-ball.r > 1000`) awards slot 1 a goal. Crossing the top exit (`ball.y+ball.r < 0`) awards slot 0 a goal.
- A goal ends the whole rally: remove all balls, drops, projectiles, held balls, temporary powers, armor, ammo, and sticky charges. Preserve wall damage, personal brick points, and each player's accumulated paddle damage.
- The conceding player receives one paddle-damage increment (maximum three). Start a two-second serve countdown, then release a new ball automatically. There is no manual unlimited serve delay.
- First server uses a seeded fair coin; later the conceding player serves. Spawn the ball centered just inside that player's paddle, with a 15-degree angle off the inward vertical. Alternate the horizontal sign each serve.
- Resolve all exits in a fixed simulation tick together. Multiple balls exiting one end award only one goal. Exits at both ends in the same tick award neither player a goal: replay the rally with the same server and no additional damage. Never let entity iteration order choose a winner.
- Goal resolution takes precedence over brick-clear transitions in that tick. Already earned brick points remain; clearing the wall cannot cancel a goal.
- On five goals, emit one terminal result, stop simulation, and clear remaining weapons/entities. No extra winning brick-points bonus.

### Wall waves and fairness

- Seed all room randomness on the server. A room receives a new seed for each match; rematches get a new seed and swap slots.
- Choose among the current six wall silhouettes. Make the initial wall's occupied cells and material layout symmetric under 180-degree rotation so neither end has easier access. Use material pairs when placing steel; steel must remain isolated and cannot enclose breakable targets.
- Waves unlock brick types using the current solo progression (standard, armor, explosive, reinforced, steel). The first wave should include enough destructible bricks to teach the duel without a dense steel barrier.
- Clearing the wall ends neither the rally nor the match. Play continues in open space for two seconds, then create a new central wall in an unoccupied simulation tick. Postpone spawning while any ball, drop, or shot overlaps the proposed wall bounds. Never spawn a brick around an entity. Pause this scheduling during disconnects.
- Advancing a wave repairs both paddles' accumulated damage. Powers and live balls continue unless a goal simultaneously resets the rally. No lives or solo campaign victory condition in duel mode.

### Damage, speeds, and paddle strokes

- Failure damage: each increment removes 20 pixels of paddle width, minimum 100. Hazard hits add one increment; conceding a goal adds one increment. A hazard hit does **not** award a goal or reset the rally. At most one unprotected hazard-damage increment per player per tick; grant one second of invulnerability after a damaging hazard hit.
- Use a base ball speed of `min(360 + 25*(wave-1), 585)` pixels/second. Disable the solo paddle-return acceleration in duels initially to avoid unbounded rally escalation.
- Each ball stores `lastTouch` (slot 0 or 1). The current speed is base speed × `(1 + 0.12 * damage[lastTouch])` × `0.65` if that player's slow power is active. This preserves the slow bonus without unexpectedly slowing an opponent's balls. A serve belongs to the server. Ownership and speed change only when the ball is returned or explicitly split.
- Measure paddle velocity from actual clamped movement per server tick, capped at 1,200 pixels/second. Keyboard aims for 720 pixels/second; pointer input provides a target, never a teleport or client-supplied velocity.
- Preserve `paddleBounce`: slow/stationary paddles use contact position; fast lateral strokes add a bounded sideways component. Compute offset and velocity in the paddle owner's view, then transform the outgoing velocity back to world coordinates. Slot 0 returns toward negative y; slot 1 returns toward positive y. Enforce the existing maximum 1.13-radian angle from inward vertical.
- Transfer direction without adding ball speed. Collision microsteps bound ball/shot travel to four pixels; handle paddle tunneling and duplicate brick damage.

## 5. Brick ownership, scoring, drops, and weapons

### Ownership and points

A ball's brick damage is credited to `lastTouch`; a shot's damage is credited to its shooter. Carry that owner through explosive chains. Award destruction points using the existing brick values and independent two-second combo counters per player. Nonlethal hits award no points. Steel awards no points. Gems award 500; shooting a hazard awards 100 to the shooter without a combo multiplier.

Drops belong to the player credited with destroying the brick, including hazards. Spawn them at the destroyed brick and send them toward that player's paddle. The opponent cannot catch them, consume their armor against them, or take damage from them. Any player's shot may destroy a hazard; the shooter earns the interception points. Shots do not destroy prizes or damage paddles/balls.

### Drop probabilities

Roll once per destroyed breakable brick on the server:

| Outcome   | Chance | Duel behavior                                                 |
| --------- | -----: | ------------------------------------------------------------- |
| Nothing   |    56% | No drop                                                       |
| Sticky    |     3% | Refill to three catches                                       |
| Bazooka   |     3% | +5 shots, maximum 15                                          |
| Gem       |    10% | +500 points                                                   |
| Wide      |     5% | Current base paddle width ×1.5 for 12 seconds                 |
| Slow      |     6% | Owner's balls run at 65% speed for 10 seconds                 |
| Shield    |     3% | One hazard hit, expires after 15 seconds                      |
| Multiball |     4% | Add up to two balls, respecting the global three-ball cap     |
| Repair    |     1% | Remove one damage increment; if undamaged, award 1,000 points |
| Vest      |     3% | Refill to two hazard-block charges                            |
| Bomb      |     2% | Falls at 150 pixels/second toward owner                       |
| Rocket    |     2% | Falls at 260 pixels/second toward owner                       |
| Worm      |     2% | Falls at 110 pixels/second with sideways weaving              |

The solo life pickup becomes **Repair** in duels; do not introduce an extra-life counter. Suppress a hazard roll when three hazards for that owner are already active. Repeated wide/slow/shield pickups refresh, not stack, duration. Unused vest/sticky charges persist until consumed or rally reset.

### Sticky and multiball

- Each return caught while sticky charges remain consumes one charge and attaches the ball at its contact offset. Held balls follow the paddle and count toward the global three-ball cap.
- Release all of that player's held balls on an action. Apply current paddle-stroke aiming and assign their ownership to that player.
- **Automatically release held balls after three seconds** of server simulation time to prevent stalling. Pauses freeze this timeout. Release must work after the final sticky charge is consumed.
- Multiball selects the owner's lowest-ID ball (held or flying); if none is owned, select the globally lowest-ID ball. New balls belong to the pickup owner and launch toward the opponent with diverging angles. Leave an original held ball attached.
- At the global cap, a multiball pickup gives 500 points instead. Simultaneous splits resolve in stable drop-ID order; the cap is never exceeded.

### Bazooka, armor, and update order

- Cannon mounts on the owner's paddle. Shots travel toward the opponent at 720 pixels/second, cooldown 250ms. Ammo and cooldown are server-owned. Fire requests without ammo or while paused/counting down are rejected without consuming ammo.
- Action releases held balls and fires at most one shot. Fire-only action does not release. Tap gesture uses the existing displacement/time threshold; dragging must not fire.
- Each shot hits at most one target: destroy a hazard for 100 points or deal one brick damage. Steel consumes the shot without damage. Explosive bricks retain chain effects. Two shooters hitting the same brick resolve by time of collision, with stable entity-ID tie-breaking.
- Shield blocks before vest. Vest does not expire with time. Armor never saves a ball crossing a goal boundary.
- Tick order: apply validated inputs; update paddles/power timers; advance balls and shots with collision ordering; move drops; process beneficial pickups before hazard hits; aggregate goals; apply at most one hazard damage per player if no rally reset occurred; resolve goal/win; schedule wall replacement; emit events/snapshot. Intercepted hazards cannot damage a player later in that tick.
- Assign stable IDs to balls, bricks, drops, and shots. Preserve deterministic ordering under a fixed seed and input sequence.

## 6. Architecture and proposed files

Use one Node.js process and one in-memory room manager, with the `ws` package for WebSocket transport and built-in HTTP for health/config endpoints. No Redis, database, or horizontal scaling for the first version.

Suggested additions (names may change if responsibilities remain clear):

```text
shared/duel-rules.js       world, limits, protocol version, transforms, pure helpers
shared/duel-game.js        pure authoritative DuelGame simulation
server/index.js           HTTP server, WebSocket upgrade, shutdown
server/rooms.js           room lifecycle, seats, tokens, reconnect, scheduler
server/protocol.js        input parsing, validation, rate limits
src/online-client.js      socket, room actions, connection state, clock samples
src/duel-view.js          render snapshots, view transform, interpolation, input
src/multiplayer-ui.js     mode selector, lobby, invites, results
tests/duel-game.test.js   pure rules/physics tests
tests/server.test.js      real local WebSocket clients, room isolation/lifecycle
tests/online-ui.test.js   menus and network failure handling
render.yaml               reproducible Free Web Service configuration
.env.example              documented public/local configuration placeholders
```

Do not duplicate renderer/audio behavior wholesale. Refactor reusable drawing primitives gradually while retaining solo tests. Server imports no frontend module. Share rule helpers, not server tokens, room maps, or filesystem-dependent code.

## 7. Server simulation and client synchronization

- Fixed 60 Hz authoritative simulation using a monotonic clock and accumulator; use adaptive collision microsteps inside ticks. Broadcast complete snapshots at 20 Hz initially.
- Cap catch-up to five ticks per scheduler iteration. Do not apply one enormous physics delta after an event-loop stall. On a stall exceeding 500ms, pause the room with `server_busy`, clear accumulated catch-up, then restart through a synchronized countdown once healthy. Repeated stalls should end the match as interrupted rather than inventing goals.
- Run room simulation only for countdown/playing phases. Stop timers for idle/empty rooms and clear them on deletion. Use a shared scheduler if simpler; avoid one uncontrolled interval per entity.
- Render the local paddle immediately with the same speed/clamp rules, reconcile toward authoritative x using acknowledged input sequences, and interpolate ball/opponent state about 100ms behind the latest server timeline.
- Never run a second authoritative ball/brick collision engine on the client. Short extrapolation may be capped at 100ms; beyond that show a connection warning and freeze rather than letting the ball drift through a wall.
- Local predicted paddle must not change scores or confirm catches/goals. Use authoritative events for those effects. Reconcile predicted position without camera jumps.
- Send input at most 30 Hz, latest target only, with sequenced actions. Do not send every raw pointer event. Stationary players need only a heartbeat. Do not use input velocity supplied by the client.
- Deduplicate audio/particles with authoritative event IDs and results with match IDs. A full snapshot is sufficient after reconnect; events are cosmetic, not required to reconstruct rules.

## 8. Protocol v1

JSON text over secure WebSockets at `/ws`; local development can use `ws://localhost:3001/ws`. Enforce version 1 and reject incompatible clients with a readable update message. All numbers must be finite; unknown message types return a bounded error, not a process exception.

Client messages:

```json
{"v":1,"type":"create","requestId":"c1"}
{"v":1,"type":"join","requestId":"j1","code":"ABC234"}
{"v":1,"type":"resume","requestId":"r1","code":"ABC234","token":"opaque-token"}
{"v":1,"type":"ready","ready":true}
{"v":1,"type":"input","seq":42,"x":0.6,"action":"none"}
{"v":1,"type":"input","seq":43,"x":0.6,"action":"release_fire"}
{"v":1,"type":"input","seq":44,"x":0.6,"action":"fire"}
{"v":1,"type":"pause","requested":true}
{"v":1,"type":"resume_play"}
{"v":1,"type":"rematch","ready":true}
{"v":1,"type":"leave"}
{"v":1,"type":"ping","id":7,"clientTime":12345}
```

Server messages:

```json
{"v":1,"type":"welcome","requestId":"c1","code":"ABC234","playerId":"p0","slot":0,"token":"opaque-token","matchId":null}
{"v":1,"type":"room","code":"ABC234","phase":"lobby","players":[{"slot":0,"connected":true,"ready":false},{"slot":1,"connected":false,"ready":false}]}
{"v":1,"type":"snapshot","matchId":"m123","tick":600,"serverTime":10000,"phase":"playing","state":{}}
{"v":1,"type":"events","matchId":"m123","items":[{"id":55,"tick":600,"type":"goal","scorer":0}]}
{"v":1,"type":"result","matchId":"m123","winner":0,"reason":"five_goals","goals":[5,3],"points":[2400,1850],"durationMs":180000}
{"v":1,"type":"error","code":"ROOM_FULL","requestId":"j1","message":"This room already has two players."}
{"v":1,"type":"pong","id":7,"clientTime":12345,"serverTime":12370}
```

The example `state:{}` is a placeholder; implement and document a concrete snapshot schema before client rendering. It must contain:

- Wave, countdown remaining, serving slot, goals, pause/reconnect reason and deadline.
- Per-player canonical x/target/velocity/width, damage, points/combo, armor charges, sticky charges, ammo, cooldown, remaining power durations, connected state, last acknowledged input sequence.
- Balls: ID, x/y/vx/vy/radius, owner, held flag/offset, remaining auto-release time.
- Bricks: ID, x/y/w/h, type, remaining/max durability. Serialize steel durability as `null`, not JavaScript `Infinity`.
- Drops: ID, type, owner, x/y, motion phase/base x if needed for rendering.
- Shots: ID, owner, x/y. Do not send the RNG state, other players' resume tokens, raw socket IDs, or internal objects.

Use monotonically increasing per-seat input sequences across reconnects (welcome/resume supplies the expected next sequence), ignore duplicates/out-of-order inputs, and validate actions against current server phase. Bound normalized x to [0,1]; reject non-finite or wildly invalid payloads instead of coercing strings.

Error codes should include `BAD_MESSAGE`, `VERSION_MISMATCH`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_EXPIRED`, `AUTH_FAILED`, `INVALID_PHASE`, `RATE_LIMITED`, and `SERVER_BUSY`. Create/join request IDs are idempotent within a connection; disable repeated UI submissions while pending.

## 9. Room lifecycle, pause, and reconnect

State machine:

```text
lobby → countdown → playing → goal countdown → playing → finished
                     ↕
               paused / reconnecting
finished → rematch readiness → countdown
```

- Reserve exactly two seats. A disconnected seat remains reserved during its reconnect grace period; a third socket must not steal it.
- Generate a cryptographically random resume token (at least 128 bits) for each seat. Return only to that seat over WSS. Store it in sessionStorage, never invite URLs, logs, or public snapshots. Rotate it on successful resume, replacing/closing any stale socket for that seat.
- Ping/pong heartbeat every 10 seconds; mark disconnected after 25 seconds without a response. Respond to real disconnect events immediately.
- On disconnect, freeze all gameplay timers, powers, shots, held-ball release timers, and ball movement. Show a 30-second reconnect grace period based on real wall-clock time.
- Retry with capped exponential backoff (for example 1,2,4,8 seconds), always displaying state. Rejoin the original room/seat using the token. Do not silently create a new match.
- When both players reconnect, send a full snapshot and restart via a three-second countdown. If one never returns, award the connected opponent a forfeit win. If neither returns, discard as abandoned and record no competitive win. If the server restarted and the room disappeared, show interrupted, not a fabricated result.
- Manual pause freezes immediately, is limited to one 30-second pause per player per rally, and resumes when both players choose Resume or the wall-clock timeout expires. The same budget applies to opening Legend/Scores during live play; closing a panel sends that player's resume consent but cannot unilaterally bypass the opponent's pause. Browser tab backgrounding requests a pause if available; otherwise mark inactive and retain the paddle's last target. Disconnection uses the separate grace policy.
- Countdown freezes during disconnect. No inputs can score, consume ammo, or accumulate movement during a pause/countdown. Clear stale targets/velocity before resuming.
- Expire unfilled lobbies after 10 minutes, finished rooms after 5 minutes, and abandoned rooms after grace expires. Cap a match at 15 minutes of active play: higher goals wins, tied goals is a draw; points never break ties. This bounds server usage and stalled matches.
- Rematch requires both connected seats' consent, resets all stats/entities, swaps slots, rotates resume-seat mapping safely, and assigns a new match ID. Issue fresh seat tokens only to their corresponding players after swapping; discard the previous match’s queued inputs and events. Existing completed results remain immutable.

## 10. Free-host resource and security limits

Initial configurable defaults: 20 concurrent active rooms, 100 open sockets, 8 KiB inbound message limit, 50 messages/second per connection with a small burst allowance, and 5 create/join attempts per minute per IP. Same-Wi-Fi clients share an IP, so do not limit to one player per IP. Tune limits after measurement.

- Validate the WebSocket Origin against `https://pavelsokolovan.github.io` (Origins contain no repository path). Permit explicit localhost origins only in development. CORS/Origin checks are not authentication; retain seat tokens and rate limits.
- Bind each socket to its authenticated room/seat. Never accept client-provided score, damage, owner, slot, arbitrary room ID, or physics state.
- Use the hosting proxy's documented trusted forwarding configuration before using forwarded IPs for rate limiting. Never blindly trust arbitrary `X-Forwarded-For` values.
- Stop sending stale snapshots to slow clients: check buffered bytes, skip snapshots or disconnect with a recoverable reason. Avoid unbounded queues.
- Return generic auth failures. Do not log resume tokens or complete gameplay streams; log sanitized connection, room, error, and match lifecycle summaries.
- Use plain text insertion for room codes/status; no unsafe HTML rendering of network input. Keep dependencies minimal and lock versions through `package-lock.json`.
- In-memory rooms are deliberately temporary. A deploy/restart can interrupt matches. Close gracefully on SIGTERM, notify clients of interruption, stop simulation, and exit within Render's shutdown window. Do not claim persistent reconnect across server restarts.

## 11. Render Free deployment and GitHub Actions

Official hosting information was checked on 2026-11-11; verify again at implementation time:

- https://render.com/docs/free — 750 free instance-hours per workspace/month, sleep after 15 minutes without incoming traffic, approximately one-minute wake-up, bandwidth/build quotas, possible restarts.
- https://render.com/docs/websocket — public WebSocket support.
- https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages — active incoming WebSocket messages prevent idle spin-down.

A free service is appropriate for this hobby release, not guaranteed production availability. When no payment method is attached, the documented free quota behavior includes suspension rather than paid bandwidth overage. Never auto-select a paid instance, database, disk, or other chargeable service. Use normal heartbeats during real matches; do not add artificial traffic solely to defeat idle sleeping.

### Server configuration

Add a `render.yaml` Free Web Service definition with:

- Node runtime, one instance, `plan: free`.
- Build command `npm ci` and start command `npm run start:server`.
- Node version 22.12+ through Render's supported configuration mechanism.
- Listen on `0.0.0.0` and Render's supplied `PORT` (local default 3001).
- Health path `/health`, returns 200 with a small JSON status and protocol version; no secrets or detailed room listings.
- `ALLOWED_ORIGINS=https://pavelsokolovan.github.io`, plus explicit development settings in `.env.example`.
- Configurable room/socket limits and log level. No database URL required.

Provision the service from this repository in the user's Render account, selecting a region reasonably close to the expected players. Obtain the actual assigned URL; do not hardcode an invented service hostname.

### Client configuration

- Public build variable `VITE_MULTIPLAYER_URL=wss://<actual-service>.onrender.com/ws`.
- Derive the health URL from this URL's origin with HTTPS and `/health`, or define a separate public health URL if needed.
- If the variable is absent, Solo remains fully usable and Online Duel shows a setup/unavailable message; do not connect to localhost in a production build.
- Before opening/joining a room, perform a bounded health wake-up flow. Show “Waking server…” with cancel/retry; allow approximately 90 seconds and back off requests. Handle the service's non-JSON loading/error responses. Do not create duplicate rooms across retries.
- Cross-origin health responses must explicitly allow the configured frontend origin. WSS handshake checks must use the same allowlist.

### CI and deployment

- Keep the existing GitHub Pages workflow and base path `/break-the-wall-game/`.
- Add duel, server-integration, and client tests to required checks before the Pages build.
- Supply `VITE_MULTIPLAYER_URL` from a GitHub **repository variable**, not a secret; it is public client configuration. Pass it into the build step's environment.
- Render can auto-deploy the server from `main`. Prefer deployment only after required CI passes; configure this when supported or use a separate deployment job after tests. Keep frontend/server protocol backward compatible across non-atomic deployments. Fail incompatible handshakes cleanly.
- Initial deployment order: working server and `/health`; configure frontend URL; publish Pages; validate two phones. Existing Solo must stay available throughout.
- External account connection/service creation may need the user to complete Render login/authorization. Prepare code/config/tests first; never request account passwords or tokens in chat. If blocked, hand off the exact dashboard steps and leave completed implementation reviewable.

## 12. Local results and compatibility

Keep existing solo storage intact (`brickfall-blitz:v1`). Store duel results separately, for example `brickfall-blitz:duel:v1`, bounded to the latest 20 matches. Validate storage content and handle unavailable storage without breaking play.

Store match ID, date, win/loss/draw, termination reason, goals for/against, personal points, opponent points, duration, and wave count. No auth tokens or server secrets. Save exactly once when receiving an authoritative terminal result; repeats/reconnects must not duplicate it. A client that misses a server result should label the match interrupted rather than inventing a winner. Duel result delivery may be retried while the finished room remains retained.

Do not implement global rankings or use these local records as cheat-proof evidence. Finished room memory is the only authoritative short-lived match history for this version.

## 13. Implementation milestones

### A. Small playable duel

Add the shared coordinate/protocol helpers, pure `DuelGame`, server room manager, and client connection. Two local clients can join, ready, count down, move opposite paddles, return one ball, concede goals, and finish first-to-five. Start without bricks/bonuses. Test both player transforms and paddle-stroke physics before adding content.

### B. Brick battle and full bonuses

Add symmetric generated wall waves, ownership/points, drops, hazards, slow/repair/armor, multiball, sticky auto-release, and bazooka interactions. Add seed/replay tests and resource caps. Preserve solo behavior and the minimal UI.

### C. Reliable session flow

Add invitations, share/copy fallback, reconnect tokens, snapshots/interpolation, manual pause, background handling, rematch, room cleanup, cold-start states, errors, and separate local result storage. Test with a real local WebSocket server and two clients.

### D. Free hosting and phone validation

Add Render definition and public build configuration; deploy in the user's account, update GitHub Pages, and run real two-device checks. Profile responsiveness and bandwidth; tune tick/snapshot/input rates from measurements. Record actual limitations and URLs in `DEPLOYMENT.md`.

Suggested separate reviewable commits follow these milestones; never deploy a partially exposed Online Duel button that breaks Solo or joins an incompatible server.

## 14. Verification and release acceptance

Automated tests must exercise:

1. Mirrored coordinate/input transforms and symmetric wall layout; both players can aim and score correctly.
2. Slow/static versus fast stroke rebounds for both ends, inward bounce angles, clamped paddle movement, and collision safety at maximum speed.
3. Goal aggregation: several balls exiting one end, simultaneous opposite exits, five-goal victory, and goal/last-brick conflicts.
4. Point/drop ownership, explosive chain ownership, independent combos, steel behavior, repair conversion, and no hostile prize catches.
5. Shield/vest priority, all three hazard motions, one-damage-per-tick/invulnerability, slow ownership, multiball cap, sticky three-second release, bazooka damage/interception/cooldown.
6. No actions, motion accumulation, timeouts, ammo consumption, or power expiry during gameplay pause; reconnect and pause deadlines still advance on wall-clock time.
7. Full room, unknown room, malformed JSON/oversized input, non-finite targets, invalid phase/action, duplicate/out-of-order input, event deduplication, origin checks, room isolation, token authorization, and bounded send queues.
8. Two real WebSocket clients completing a match and rematch; reconnect to the same seat; third-party seat theft rejected; expired reconnect, voluntary leave, both players gone, server shutdown, and idle cleanup.
9. Protocol mismatch, missing backend URL, cold-start loading response, join timeout, room-code normalization, invite handling, and clipboard/share fallback.
10. Scores/Legend focus handling; tap versus drag; touch and keyboard actions; repeated terminal snapshots saved once; corrupted/unavailable storage; solo saves unchanged.

For manual/browser QA, use the environment-supported browser workflow. If unavailable, record the limit; do not claim visual/device tests passed. Before calling multiplayer production-ready, validate:

- Two phones on the same Wi-Fi, then one phone on mobile data; both open the real Pages URL and complete a match.
- Both phones see their own paddle at the bottom and the same goals, wall damage, and outcome.
- Portrait and landscape are playable with all controls in reach; no browser scrolling steals a drag; modal/start buttons fit on small screens.
- Typical network delay and jitter (for example 80–150ms latency) remain playable; loss/stale snapshots show a visible connection state instead of divergent scoring.
- Disconnect/reconnect, backgrounding a phone, manual pause, server sleep/wake, and rematch behave as specified.
- Solo still loads and plays if the backend is unavailable.
- GitHub Actions passes; Render uses the Free instance; no paid resource was provisioned; the actual WSS URL is configured in the built Pages client.

## 15. Next-session starting prompt

> Implement Online Duel from docs/ONLINE_DUEL_SPEC.md in pavelsokolovan/break-the-wall-game. Preserve Solo. Start with milestone A, then finish the remaining milestones with tests and free Render deployment configuration. Use the current repository state, inspect local instructions, and verify current hosting limits. Keep UI minimal and maintain pixel graphics, paddle-stroke physics, sticky paddle, bazooka, armor, and hazards. Do not provision paid resources. If Render account access is unavailable, finish the code and checks and provide exact free deployment steps. Report which real-device/browser checks were actually performed.
