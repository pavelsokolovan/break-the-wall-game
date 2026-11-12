# Brickfall Blitz

**Break the wall. Catch the rewards. Dodge the fallout.**

A browser arcade game with original pixel graphics, synthesized chiptune sounds, ten levels with randomly generated diamond, invader, chevron, twin-tower, wave, and portal walls, explosive bricks, power-ups, and local high scores. Built with JavaScript, Canvas 2D, and Vite; no game engine or server required.

The game has two separate modes: **Solo**, the existing single-player campaign, and
**Online Duel**, the additional two-player online mode. Solo stays available without
a multiplayer backend and keeps its existing saves. Online Duel is currently a local
preview with connection recovery and complete session controls; hosted deployment
is configured in Stage 9 but still needs account setup; real-device release validation
is Stage 10.

## Play

Once GitHub Pages is configured and the project is pushed to `main`:

https://pavelsokolovan.github.io/break-the-wall-game/

| Action         | Desktop                    | Mobile                 |
| -------------- | -------------------------- | ---------------------- |
| Move paddle    | Mouse, ← / →, A / D        | Drag in the game field |
| Launch ball    | Click or Space             | Launch Ball button     |
| Pause / resume | P, Escape, or pause button | Pause button           |
| Sound          | Header button              | Header button          |

Hit near the paddle edges to aim diagonally. Clear every breakable brick to advance. Steel bricks are indestructible. Armored bricks need two hits; reinforced bricks need three. Orange explosive bricks damage adjacent bricks and trigger chains.

Start with three lives. Missing the last ball or catching an unprotected bomb, rocket, or worm costs one life and shortens the 160-pixel paddle by 20 pixels, down to a 100-pixel minimum, and adds 12% ball speed (up to 36%). Each new level repairs the paddle and clears the speed penalty. Power-ups disappear on life loss or level completion.

| Drop                 | Effect                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------- |
| Gem                  | +500 points                                                                            |
| Wide                 | 50% wider paddle for 12 seconds                                                        |
| Slow                 | 35% slower balls for 10 seconds                                                        |
| Shield               | Absorb one hazard hit within 15 seconds                                                |
| Vest                 | Absorb two hazard hits; lasts until consumed, life loss, or level clear                |
| Multiball            | Up to three balls                                                                      |
| Heart                | Extra life, maximum five; +1,000 points at the cap                                     |
| Bomb / rocket / worm | Bombs fall; rockets dive faster; worms weave sideways. An unprotected hit costs a life |

Destroy bricks within two seconds to build a combo, up to ×4. Clearing a level awards 1,000 × level + 500 × remaining lives. Clearing without damage adds 2,000 points.

Best score, the five most recent completed runs, sound settings are stored in this browser's local storage. Results include score, level, win/loss, date, duration, bricks, gems, and bomb hits. No data is sent to a server. Private browsing or clearing site data can remove saved results; unavailable storage falls back to this session. Active runs are not restored after reload.

## Develop

Node.js 22.12+ (or a supported newer version) and npm:

```sh
npm ci
npm run dev
```

```sh
npm run check
npm test
npm run build -- --base=/break-the-wall-game/
npm run preview
```

Tests exercise scoring, durability, explosive chains, paddle damage, drops, shields, multiball, power expiry, pause, high-speed collisions, level completion, and a seeded simulation. The pure simulation lives in `src/game.js`; rendering, input, audio, and persistence live in `src/main.js`.

## Deploy on GitHub Pages

1. Open repository **Settings → Pages**.
2. Set **Build and deployment → Source** to **GitHub Actions**.
3. Commit and push the game and `.github/workflows/deploy.yml` to `main`.
4. Watch **Actions → Deploy game to GitHub Pages**.

The workflow tests the game, builds with the repository base path, and deploys `dist/` using GitHub's short-lived token. No extra secret is required. A local commit alone does not deploy; the commit must reach GitHub.

Press Start 2P and VT323 pixel fonts are bundled locally under the SIL Open Font License; their notices are included in `public/licenses/` and in the built site. Game visuals and audio are created in code.

See [DEPLOYMENT.md](DEPLOYMENT.md) and [GAME_DESIGN.md](GAME_DESIGN.md) for more detail. No license has been selected yet.

Brick visuals distinguish masonry, bolted armor, reinforced plates, dynamite, and riveted steel. Bricks measure 86 × 32 pixels and balls have a 10-pixel radius in the 800 × 640 playfield. Multiball drops have a 4% chance per destroyed brick, and slow-ball drops have a 6% chance.

The compact header shows the full game name and a sound toggle. Motion effects follow the device’s reduced-motion preference automatically.

Scores and the legend open from buttons beneath the game. Opening a panel freezes the run; closing it returns to the previous playing or paused state. The main screen shows only score, level, lives, and controls.

Paddle strokes transfer lateral momentum at contact: slow or stationary movement keeps position-based aiming; faster strokes push the rebound in the stroke direction. Paddle speed is measured from actual clamped travel, capped at 1,200 pixels/second; the ball retains its current speed and a safe upward angle. Keyboard and touch/mouse use the same collision model.

Current drop odds: none 56%, sticky 3%, bazooka 3%, gem 10%, wide 5%, slow 6%, shield 3%, multiball 4%, life 1%, vest 3%, bomb 2%, rocket 2%, worm 2%. At most three hazards fall at once. Shield is consumed before vest armor; simultaneous armor pickups are resolved before hazard hits. Armor cannot prevent losing the last ball.

Sticky pickups recharge three catches. A caught ball follows the paddle at its contact position and waits for a paddle tap, Space, or the action button. All held balls release together, using the current paddle stroke for aiming. Unused catches persist until consumed, life loss, or level completion.

Bazooka pickups add five stored shots, capped at fifteen. The cannon is visible on the paddle while ammunition remains. A paddle tap or Space releases held balls and fires one shot; F fires without releasing. The mobile action button changes to Release / Fire or Fire with the ammo count. Touch drags do not fire. Shots travel upward at 720 pixels/second, with a 250ms cooldown. Each shot destroys one hazard for 100 points or deals one damage to a brick; steel stops shots. Bricks retain their usual scores and explosive reactions. Ammo, shots, and sticky catches reset on life loss or level completion. Pausing freezes shots and cooldowns.

## Online Duel local preview

[Stage 9](docs/ONLINE_DUEL_STAGE_09_SPEC.md) builds on private rooms and readiness
with symmetric central walls, opposite paddles, automatic serves, damage, and first-to-five
results. Break bricks for personal points and independent combos; goals decide the winner.
Walls include armor, explosive chains, reinforced plates, and isolated steel as waves
advance. Clearing a wave repairs both paddles and replaces the wall after two seconds
of active play, waiting until the central band is clear. Each player sees their own paddle at the bottom. Solo remains
available without a server and keeps its existing saves.

Your brick drops travel toward your own paddle; your opponent cannot collect or take
hits from them. Catch gems (+500), Wide (12s), Slow (10s), Shield (one hit within 15s),
Vest (two hits), and Repair (one damage repaired, or +1,000 when undamaged). Slow applies
to your returns while active; balls keep their current speed until returned. Bombs,
fast rockets and weaving worms damage the owner once and grant one second of
invulnerability, keeping the rally alive. Shield blocks before vest; neither stops a
goal. There are at most three falling hazards per owner. All drop outcomes are enabled.

Sticky refills three catches. Held balls follow your paddle and automatically release
after three seconds of active play. Tap the paddle, press Space, or use the action
button to release all held balls and fire once; F fires without releasing. Bazooka
adds five shots up to fifteen, with a 250ms firing cooldown. Each shot damages one brick
or intercepts either player's hazard for +100 points. Multiball adds up to two balls,
owned by the pickup player, sharing a three-ball cap including held balls; at the cap
it gives +500 points instead. Goals reset weapons and powers; wave advancement preserves
them. The action button shows current server-confirmed ammo and held-ball state.

Run two terminals after `npm ci`:

```sh
npm run start:server
```

```sh
npm run dev
```

Open the Vite URL in two tabs. Select **Online Duel**, create a room in one tab, join
its six-character code in the other, and press **Ready** in both. Move with drag,
mouse, arrows, or A/D. Serves are automatic; tap/Space releases and fires, F fires only.
Leave a live match to forfeit. An unexpected disconnect freezes gameplay and reserves
the seat for 30 seconds. The client retries automatically; once both players are back,
a three-second countdown resumes the same match with its timers and powers preserved.
If only one player returns, the other forfeits when grace expires; if neither returns,
the match is abandoned without a winner. A server restart loses its in-memory rooms
and shows an interruption.

The private seat token is kept in this tab's session storage, separately from Solo
saves. After a reload, select Online Duel to attempt recovery on the same backend.
Selecting Solo or leaving clears that identity and cancels recovery. Paddle movement
is predicted locally and remote motion is interpolated; collisions, actions and scores
remain authoritative on the server. Stale state freezes movement and disables actions.

For LAN development, copy `.env.example` to `.env` and add the frontend's actual LAN
origin to `ALLOWED_ORIGINS`; both devices need access to frontend port 5173 and server
port 3001. The development client uses the frontend hostname on port 3001. Production
requires public `VITE_MULTIPLAYER_URL=wss://<actual-backend>/ws`; without it, Online Duel
shows an unavailable message. No hosted backend has been provisioned in this stage.

Use **Invite** to share a room-only link, copy it, or select it manually when sharing
is unavailable. Invitations prefill the room code; entering and joining stay explicit.
**Pause**, P/Escape, opening **Legend / Duel History**, and backgrounding share one
30-second pause per player per rally. Both players choose Resume (closing a panel or
returning to the foreground supplies your consent), or play resumes when the deadline
expires. Panels cannot keep play frozen after that deadline. Disconnect recovery has
its separate grace period and preserves any unexpired manual pause.

Matches end after 15 minutes of active play: higher goals wins, tied goals draws;
brick points never break ties. After a result, both connected players can choose
**Rematch** to swap sides and start a fresh match. **Duel History** stores the latest
20 server-confirmed results separately under `brickfall-blitz:duel:v1`; unavailable
storage falls back to memory. Connected voluntary leave briefly waits for the server's
forfeit result before clearing identity; missed results are never invented.

Stage 9 adds a single-service Render Free blueprint and CI-gated release configuration.
Before create/join the client checks server health for up to 90 seconds, handles loading
pages and offers Cancel/Retry while Solo stays available. Merely loading the page or
selecting Online Duel does not wake the server. Release builds use public repository
variable `VITE_MULTIPLAYER_URL` and reject malformed nonempty values. Actual Render
provisioning and Pages multiplayer release still need account setup; see
[DEPLOYMENT.md](DEPLOYMENT.md) for the backend-first steps and pending acceptance record.

The server enforces Origin checks, message and resource
limits, input sequencing, bounded send buffers, and idle cleanup. Forwarded IP headers
are ignored unless explicitly verified proxy CIDRs are configured. The default trust
list stays empty; lifecycle logs exclude tokens and input streams.

`npm test` includes real loopback WebSocket clients and UI tests. `npm run test:browser`
runs the optional two-page Chromium smoke test with portrait/landscape screenshots;
set `CHROMIUM` if Chromium is installed elsewhere. It requires local port 5173 to be free.
Physical phones and real internet/network conditions are not yet validated.

The full target is [ONLINE_DUEL_SPEC.md](docs/ONLINE_DUEL_SPEC.md). Delivery stages and
completed specifications are in [the roadmap](docs/ONLINE_DUEL_ROADMAP.md).
