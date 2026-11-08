# Brickfall Blitz

Tagline: **Break the wall. Catch the rewards. Dodge the fallout.**

Status: design reference for the first playable release. See README.md for implemented behavior. Balance values remain subject to playtesting.

Implementation update: JavaScript ES modules with Vite; pixel fonts Press Start 2P and VT323. The paddle starts at 160 pixels and loses 20 pixels per failure down to 100. Failures add 12% speed each (maximum 36%); new levels reset damage and speed penalty. Slow pickups apply a 35% reduction for 10 seconds. Bricks are 86 × 32 pixels; ball radius is 10 pixels. Six procedural wall silhouettes replace the original fixed layouts. Drop odds: nothing 68%, gem 10%, wide 5%, slow 6%, shield 3%, multiball 4%, life 1%, bomb 3%. These implemented values supersede the original proposal below. Results and settings are saved locally.

## 1. Concept and goal

A single-player arcade brick breaker. The player moves a small paddle along the bottom of the screen, bouncing a ball into a wall of bricks above. Broken bricks award points and sometimes drop prizes or dangerous bombs. Clear every breakable brick to advance; finish all ten levels to win.

The central decision is whether to chase a falling reward or stay in position to return the ball safely.

## 2. Screen and controls

- Responsive browser game for desktop and mobile, using a 960 × 720 logical playfield scaled to fit the available space.
- HUD: score, best score, lives, level, active power-up timers, and pause button.
- Bricks occupy the upper part of the field. A clear gap below the bricks gives the player time to react to drops.
- Paddle moves horizontally near the bottom; ball escapes through the bottom boundary.
- Mouse: move pointer to position paddle; click to launch.
- Keyboard: Left/Right arrows or A/D to move, Space to launch, P or Escape to pause.
- Touch: drag within the playfield to move, tap Launch to release the ball. Prevent page scrolling only while interacting with the playfield.
- Clamp the paddle inside the playfield. Keyboard speed: 720 logical pixels/second. Pointer and touch movement follow the requested position immediately.
- Initial paddle width: 120 pixels. Ball radius: 8 pixels.

## 3. Core rules

1. Start a new run with three lives, zero points, and the ball resting on the paddle.
2. Launch sends the ball upward, 15 degrees left or right of vertical, alternating launch direction.
3. The ball bounces from the side walls, ceiling, paddle, and bricks.
4. The paddle contact position controls the outgoing angle: near the center sends it mostly upward; near an edge sends it diagonally, up to 65 degrees from vertical. Enforce at least 15 degrees from vertical and at least 25 degrees above horizontal.
5. Normal brick impacts remove one durability point. A destroyed brick awards its score and rolls once for a falling item.
6. If the last active ball falls below the field, lose one life.
7. A bomb striking an unprotected paddle also costs one life.
8. Each life loss triggers a single reset: remove balls and drops, clear temporary powers and combo, and place a fresh ball on the paddle. Keep score and current brick damage. If no lives remain, show Game Over.
9. Bomb and ball failures during the same simulation step cost at most one life.
10. Clear all breakable bricks to finish a level. Remove remaining drops immediately so nothing can damage the player during the transition.

## 4. Bricks and points

| Brick | Durability | Points on destruction | Behavior |
|---|---:|---:|---|
| Standard | 1 | 100 | Common colored brick |
| Armored | 2 | 250 | Visible crack after first hit |
| Reinforced | 3 | 450 | Visible damage at each stage |
| Explosive | 1 | 150 | Deals one damage to all adjacent bricks, including diagonals; can trigger other explosive bricks |
| Steel | Indestructible | 0 | Reflects ball; excluded from level completion |

Only destruction awards brick points; nonlethal hits do not. Explosive damage uses a queue so each destroyed explosive brick detonates once. Blast-destroyed bricks award points and can drop items using the same rules as ball-destroyed bricks. Steel blocks blasts.

### Combo and level bonuses

- Each brick destroyed within two seconds of the previous destruction continues the combo.
- Destructions 1–4 use ×1, 5–9 use ×2, 10–14 use ×3, and 15+ use ×4. Apply the multiplier after incrementing the combo count.
- A gap longer than two seconds or any life loss resets the combo. Paddle hits do not reset it.
- A blast chain uses a stable row-then-column resolution order for consistent combo scoring.
- Clearing level N awards 1,000 × N points, plus 500 points for each remaining life. Level bonuses are not multiplied.
- A perfect clear, with no life lost during that level, adds 2,000 points.
- Collecting a prize gem gives 500 points, without a combo multiplier.

## 5. Prizes and bombs

Each destroyed breakable brick independently rolls one outcome. The probabilities below sum to 100%; a brick drops at most one item. Drops fall at 150 pixels/second. Missing a prize or letting a bomb leave the screen has no penalty.

| Outcome | Probability | Effect when caught |
|---|---:|---|
| Nothing | 72% | No item |
| Prize gem | 10% | +500 points |
| Wide paddle | 5% | Paddle becomes 180 pixels wide for 12 seconds |
| Slow ball | 4% | All active balls move at 75% of current normal speed for 10 seconds |
| Shield | 3% | Absorbs one bomb hit; expires after 15 seconds |
| Multiball | 2% | Adds two balls, up to three total |
| Extra life | 1% | +1 life, maximum five; at the cap, awards 1,000 points instead |
| Bomb | 3% | Costs one life unless shielded |

- Prizes mean in-game rewards and collectible gems; no real-money prizes or purchases in the first release.
- Bombs have a distinctive spiked silhouette, warning icon, and fuse animation. Rewards use different shapes as well as colors.
- A bomb damages only when its hitbox touches the paddle. Balls cannot detonate or deflect falling items.
- Only one bomb may be falling at a time. A bomb roll while one is active becomes no drop.
- Wide and slow pickups refresh their duration; effects do not multiply. A second shield refreshes its timer and still stores only one charge.
- Slow applies to balls created while it is active; expiration restores normal speed. Speed is tracked separately from the temporary multiplier.
- Multiball splits from the current ball with the lowest stable ID, using two diverging upward directions. If one or two balls already exist, add only enough to reach three. At three balls, the pickup awards 500 points instead.
- Losing one ball during multiball is harmless while another remains. Bomb damage still triggers the normal life-loss reset.
- Shield absorbs a bomb, consumes its charge, and removes that bomb without interrupting play.
- For simultaneous overlaps, process shield pickups first, other rewards second, and bomb damage last. Resolve level completion before drops and life loss; resolve at most one life loss per simulation step.

## 6. Levels and difficulty

Ten authored levels form one campaign. No time limit. Clear time is shown as a personal statistic, not used to penalize the player.

| Level | Layout theme | New challenge |
|---:|---|---|
| 1 | First Contact | Four rows of standard bricks; learn aiming and drops |
| 2 | Split Wall | Gaps and first armored bricks |
| 3 | Chain Reaction | First explosive bricks |
| 4 | Steel Gates | First steel obstacles; preserve routes to every target |
| 5 | Fortress | Introduce reinforced bricks |
| 6 | Crossfire | Staggered walls and narrow entry lanes |
| 7 | Vault | Armored clusters around explosive bricks |
| 8 | Labyrinth | Steel corridors with multiple reachable entrances |
| 9 | Reactor | Dense explosive chains and reinforced barriers |
| 10 | Final Breach | A balanced combination of all brick types |

- Starting normal ball speed on level N: min(360 + 25 × (N − 1), 585) pixels/second.
- Every ten paddle returns adds 3% of that level's starting speed, capped at 120% of starting speed. Reset this increase on life loss or level change.
- All levels use the same drop odds and starting paddle width. Difficulty comes from layout, brick durability, and ball speed.
- Keep the lowest brick at least 260 pixels above the paddle. Levels must leave every breakable brick reachable.
- If no brick is hit for 12 seconds, rotate a ball's direction slightly on its next wall bounce while preserving speed and minimum angles; show a brief trail flash. This breaks repetitive loops without moving the paddle.
- Advance with a Continue button; reset temporary powers, combo, and ball speed, retaining score and lives. After level 10, show victory and final statistics.

## 7. Screens and feedback

- Title: Play, How to Play, best score, sound toggle, reduced motion setting.
- During play: clear HUD, colored brick damage states, short destruction particles, score popups, and visible power timers.
- Pause: Resume, Restart Run, and Main Menu. Restart and exit require confirmation during a live run.
- Level clear: points earned, level bonus, perfect-clear bonus if any, lives remaining, Continue.
- Game Over / Victory: total score, best score, levels completed, bricks destroyed, gems collected, bombs hit, run duration, Play Again, Main Menu.
- Sound cues for paddle hits, brick damage, destruction, pickups, shield absorption, life loss, and level clear. Audio begins after a user gesture and can be muted.
- Bomb damage gives a brief red border flash and optional light screen shake; reduced motion removes shake and reduces particles.
- Pause automatically when the tab loses visibility or focus. Resume only after explicit player input; power timers and combo windows freeze while paused.
- Before the first launch, show one short hint: “Move the paddle. Break every brick. Catch prizes. Dodge bombs.”

## 8. Persistence and release scope

- Save best score, sound preference, and reduced motion preference in browser local storage. Fall back to in-memory values if storage is unavailable.
- Best score updates whenever the current score exceeds it, including during a run.
- First release has no account, server, online leaderboard, multiplayer, shop, or persistent upgrades. Reloading ends the active run.
- Target current desktop Chrome, Firefox, Safari, and Edge, plus mobile Safari and Chrome. Support portrait and landscape through scaling and letterboxing.
- Use original geometric art and generated game sounds so the repository has no third-party asset dependency.

## 9. Implementation plan

Suggested stack: TypeScript, Vite, HTML Canvas 2D for gameplay, and HTML/CSS for menus and accessible controls. A static build can be hosted on GitHub Pages.

- Fixed-step simulation at 120 Hz, independent of rendering; clamp long frame gaps and pause on backgrounding.
- Use swept collision detection or sufficient adaptive substeps so fast balls cannot pass through thin bricks. Resolve contact normals and separate overlapping objects to prevent duplicate damage.
- Keep game rules independent from rendering. Use stable entity IDs and an injectable seeded random generator for repeatable tests.
- State flow: title → ready → playing ↔ paused → life lost / level clear → ready, ending at game over or victory.
- Proposed repository: `brickfall-blitz`, with source, level data, gameplay tests, README, this design, and GitHub Pages deployment workflow.
- README should cover controls, rules, setup, development, production build, and deployment. Decide a license before adding a LICENSE file.
- Build order: paddle and ball physics; bricks and level progression; score and lives; prizes and bombs; menus and feedback; mobile support; validation and GitHub delivery.
- GitHub delivery: create the project and validate locally, commit source and docs, then push to the chosen repository. Repository owner and remote URL are still to be specified. This design step does not create or publish a repository.

## 10. Acceptance checks for the playable release

1. Mouse, keyboard, and touch can move the paddle and launch the ball.
2. Edge and center paddle hits produce predictable trajectories; balls do not tunnel through bricks at maximum speed.
3. Brick durability, explosive chains, steel collisions, and reachability behave correctly.
4. Scores match base points, combo thresholds, gems, life-cap conversion, and level bonuses.
5. Each pickup applies, refreshes, expires, and resets as specified; multiball never exceeds three balls.
6. A bomb removes one life, a shield absorbs one bomb, and simultaneous failures cannot remove multiple lives.
7. Losing the last ball consumes a life; remaining multiballs prevent ball-loss damage.
8. The last brick clears the level safely even if a bomb or ball would otherwise cause damage during the same simulation step.
9. All ten levels can be completed; the game reaches victory or game over correctly, and restart resets a run.
10. Pause and focus loss freeze physics, drop movement, score timers, and power durations.
11. HUD and controls remain usable on narrow mobile screens; muted audio and reduced motion work.
12. Local best score survives reload; unavailable storage does not prevent play.
13. Production build succeeds and runs at the configured GitHub Pages base path without missing assets.
