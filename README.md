# Brickfall Blitz

**Break the wall. Catch the rewards. Dodge the fallout.**

A browser arcade game with original pixel graphics, synthesized chiptune sounds, ten levels with randomly generated diamond, invader, chevron, twin-tower, wave, and portal walls, explosive bricks, power-ups, and local high scores. Built with JavaScript, Canvas 2D, and Vite; no game engine or server required.

## Play

Once GitHub Pages is configured and the project is pushed to `main`:

https://pavelsokolovan.github.io/break-the-wall-game/

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move paddle | Mouse, ← / →, A / D | Drag in the game field |
| Launch ball | Click or Space | Launch Ball button |
| Pause / resume | P, Escape, or pause button | Pause button |
| Sound | Header button | Header button |

Hit near the paddle edges to aim diagonally. Clear every breakable brick to advance. Steel bricks are indestructible. Armored bricks need two hits; reinforced bricks need three. Orange explosive bricks damage adjacent bricks and trigger chains.

Start with three lives. Missing the last ball or catching an unprotected bomb, rocket, or worm costs one life and shortens the 160-pixel paddle by 20 pixels, down to a 100-pixel minimum, and adds 12% ball speed (up to 36%). Each new level repairs the paddle and clears the speed penalty. Power-ups disappear on life loss or level completion.

| Drop | Effect |
| --- | --- |
| Gem | +500 points |
| Wide | 50% wider paddle for 12 seconds |
| Slow | 35% slower balls for 10 seconds |
| Shield | Absorb one hazard hit within 15 seconds |
| Vest | Absorb two hazard hits; lasts until consumed, life loss, or level clear |
| Multiball | Up to three balls |
| Heart | Extra life, maximum five; +1,000 points at the cap |
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

## Planned online multiplayer

The implementation handoff for opposite-end competitive play on GitHub Pages + Render Free is in [docs/ONLINE_DUEL_SPEC.md](docs/ONLINE_DUEL_SPEC.md). It defines gameplay, server/client responsibilities, the WebSocket protocol, deployment, and acceptance tests. Multiplayer is not implemented yet.
