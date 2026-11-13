# Three/four-player square arena

Separate additional mode; existing Solo and two-player Duel retain their rules, field,
protocol, saves and controls. Create a room for three or four players. Three-player
rooms use bottom/right/top paddles and a solid left wall; four-player rooms use all sides.
All participants ready before a shared countdown. Each starts with five lives and one
ball. Balls traverse the whole square and pass through each other. Returns transfer
ownership and brick points. Central bricks are square. Missing your side costs a life
and respawns that ball at your paddle. At zero lives your side becomes a wall and you
spectate. Last player standing wins; a simultaneous elimination may draw. Ten-minute
active-time cap: remaining lives then points decide, tied best is a draw. Leave/disconnect
during play forfeits that player's remaining lives; no hidden bots replace players.

Use a separate /arena WebSocket endpoint on the same backend, exact Origin/transport
limits, three or four reserved slots according to selected room size, secure random room
codes, bounded room/input requests and snapshots, fixed-step server authority, heartbeat,
expiry and clean shutdown. No resume tokens/history/powers/rematch in this first arena
release: errors visibly interrupt, leave and create another room to play again. Never
claim Duel's recovery policies for arena. No public endpoint can change physics/scores.

Browser offers a new explicit 3–4 Players mode: create 3/create 4 or join code, Ready,
Leave, visible member readiness/lives/points and clear results. Square canvas, own side
labelled/coloured, touch/mouse movement along the player's actual horizontal/vertical
side plus arrow keys, no rotation surprises. Touch area over the square plus finger strip
below for the normalized own-side target. Waiting/loading/error states remain visible.
Arena networking starts only on an explicit create/join. Mode changes close/leave arena;
Solo stays available without backend and its active run requires explicit resume.

Validate isolated physics, square layout, all four paddle transforms, misses/elimination/
solid walls, lifecycle/third/fourth connections/ready/inputs/forfeit/expiry, UI and browser
flows. Commit repository work; no implicit push/deployment. Both frontend/backend deploy
are needed. Physical phone/network fairness testing remains release acceptance work.

## Implementation and verification

Implemented in `shared/arena-game.js`, `server/arena-rooms.js` and `src/arena-ui.js`.
Arena and Duel share transport/Origin protections, the global room budget and IP room
request bucket. Their simulations, messages and room memberships remain separate.
Server simulation runs at 60 Hz with 30 Hz snapshots; paddle targets apply directly
at the next tick. Physics substeps prevent fast balls skipping paddle faces; the
existing five-pixel invisible end tolerance also applies to arena paddles.

Validation completed locally:

- All 209 tests pass, including ten arena simulation/protocol/lifecycle tests.
- JavaScript syntax checks, formatting checks and Pages production build pass.
- Real Chromium sessions create, join, ready, move, forfeit, finish and clean up both
  three- and four-player rooms; portrait layout stays square and at least 320 pixels.
- Existing Solo, two-player Duel, bot, recovery, bonus and session browser checks pass.

This is repository validation, not physical-phone/network acceptance or a deployment.
Initial arena play has one central brick layout, no bonus drops and no saved results.
After disconnect, use Leave and create/join another room. Existing Duel features remain
available in Online Duel. Push and deploy both the backend and Pages to enable arena
on the public site; the existing multiplayer URL configuration remains valid.

## Selectable bot practice

The arena setup offers a bot-count selector and **Test with bots** button:

- One bot opens the established two-player Duel practice mode; press Ready to start.
- Two bots start a three-player square arena: human bottom, bots right/top, left wall.
- Three bots start a four-player square arena: human bottom, bots on the other sides.

Arena practice uses the real backend through `/arena` with `{v:1,type:"practice",bots:2|3}`.
The server validates the count, enforces the shared room/IP budgets, fills labelled bot
seats and starts the usual countdown automatically. Other humans cannot join practice.
Snapshots identify `practice` rooms and `bot` seats; human room setup/readiness is unchanged.
Practice requires a server connection and uses the same physics, lives, respawns and
results as human arenas. The sole human leaving/disconnecting deletes the room even
while bots remain. Expiry, stalled-server interruption and shutdown skip bot transports.

Bots read current incoming balls and submit ordinary sequenced paddle inputs. They
react every 150–300 ms, move at most 100 game pixels per decision, and make aiming
errors, including deliberate misses. They do not change balls, lives, points, speed or
collision rules. Eliminated bots stop controlling their paddle. The selector does not
introduce bots into human rooms or replace disconnected humans.

Validation adds protocol count rejection, all four side-axis controls, bounded reaction/
travel, deterministic matches with returns and misses, real two/three-bot WebSocket
practice, join rejection and leave/disconnect cleanup. Browser checks exercise all three
selector choices alongside the existing Solo, Duel and human arena flows.

Bot extension verification: all 212 automated tests pass (13 arena tests), along with
syntax/formatting checks, the Pages production build and the full Chromium smoke run.
The browser run selects one, two and three bots, starts each game, verifies bot seats
and movement, and leaves without orphan rooms. No physical-phone or hosted deployment
validation is claimed by these local checks.
