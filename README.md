# Brickfall Blitz

**Break the wall. Catch the rewards. Dodge the fallout.**

A browser arcade game with original pixel graphics, synthesized chiptune sounds, ten levels, explosive bricks, power-ups, and local high scores. Built with JavaScript, Canvas 2D, and Vite; no game engine or server required.

## Play

Once GitHub Pages is configured and the project is pushed to `main`:

https://pavelsokolovan.github.io/break-the-wall-game/

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move paddle | Mouse, ← / →, A / D | Drag in the game field |
| Launch ball | Click or Space | Launch Ball button |
| Pause / resume | P, Escape, or pause button | Pause button |
| Sound / reduced effects | Header buttons | Header buttons |

Hit near the paddle edges to aim diagonally. Clear every breakable brick to advance. Steel bricks are indestructible. Armored bricks need two hits; reinforced bricks need three. Orange explosive bricks damage adjacent bricks and trigger chains.

Start with three lives. Missing the last ball or catching an unshielded bomb costs one life and shortens the paddle by 16 pixels, down to a 72-pixel minimum. Each new level repairs it. Power-ups disappear on life loss or level completion.

| Drop | Effect |
| --- | --- |
| Gem | +500 points |
| Wide | 50% wider paddle for 12 seconds |
| Slow | 25% slower balls for 10 seconds |
| Shield | Absorb one bomb within 15 seconds |
| Multiball | Up to three balls |
| Heart | Extra life, maximum five; +1,000 points at the cap |
| Bomb | Lose a life and damage the paddle unless shielded |

Destroy bricks within two seconds to build a combo, up to ×4. Clearing a level awards 1,000 × level + 500 × remaining lives. Clearing without damage adds 2,000 points.

Best score, the five most recent completed runs, sound settings, and reduced effects settings are stored in this browser's local storage. Results include score, level, win/loss, date, duration, bricks, gems, and bomb hits. No data is sent to a server. Private browsing or clearing site data can remove saved results; unavailable storage falls back to this session. Active runs are not restored after reload.

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

Space Grotesk and Space Mono fonts are bundled locally under the SIL Open Font License; their notices are included in `public/licenses/` and in the built site. Game visuals and audio are created in code.

See [DEPLOYMENT.md](DEPLOYMENT.md) and [GAME_DESIGN.md](GAME_DESIGN.md) for more detail. No license has been selected yet.
