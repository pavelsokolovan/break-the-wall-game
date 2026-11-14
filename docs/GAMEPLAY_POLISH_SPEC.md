# Bonus display, multiball, ball impacts and cannon damage

This update supersedes earlier pass-through ball rules and the Solo three-ball cap.
The existing Solo campaign, two-player Duel and three/four-player arena remain separate.

## Bonus display

Solo and Duel share `src/bonus-ui.js`: translucent, compact badges inside the playing
field, above the own paddle. Wide/Slow/Shield show remaining seconds and a shrinking
bar. Vest, Sticky and Ammo show charges. Badges do not resize the field or capture
pointer input; expired/consumed powers disappear. Solo badges hide behind paused/menu
states. Existing power durations, charge counts and pause behavior remain unchanged.

## Solo multiball

A pickup snapshots every current ball and adds two independent, rotated copies of each:
1 → 3 → 9 → 27. Copy trajectories rotate ±0.65 radians from the source heading; copied
balls have independent trails and begin slightly separated. A held source stays held;
its new copies launch freely. The live-ball limit is 27 to bound mobile simulation work.
A pickup that cannot add any balls awards 500 points. Duel continues to replace
multiball drops with gems; arena has no bonus drops in this release.

## Ball-to-ball physics

All three simulations use shared swept circle/circle contact and equal-mass, perfectly
elastic impulses. Normal velocity components exchange; tangential components, total
momentum and kinetic energy are conserved at impact. Overlap correction separates
spawn/contact overlaps; separating balls are not bounced again. Held/sticky balls are
excluded until release. Impacts do not transfer ownership, cause damage or award points.
Paddle returns keep their existing ownership, aiming and speed rules.

Duel integrates pair impacts with its global earliest ball/shot/scene contact ordering.
Solo and arena advance all free balls together through continuous pair contacts inside
small scene microsteps. Total kinetic energy bounds travel when choosing microsteps.
Solo applies power/level/damage speed changes proportionally, preserving velocity
exchanged at ball impacts instead of normalizing away the physics every microstep.

## Cannon against opponent

Duel cannon projectiles sweep against the opponent's paddle at its position at the
contact time, including lateral paddle movement. A projectile stops at its first
brick, hazard or opponent paddle. Opponent hits use the established damage/defense
path: invulnerability blocks, then shield, then vest; an unprotected hit increments
paddle damage (maximum three), shortens it and grants one second of invulnerability.
A cannon hit does not score a goal or points, delete balls or damage its shooter.
Missed shots leave the field normally. Arena still has no cannon pickup or firing.
The existing damage/block events carry the projectile's global entity ID as source.

## Verification

Tests cover head-on and glancing impacts, high-speed crossings, momentum/energy,
separating contacts, simultaneous chains, deterministic ordering, held/spawn overlaps,
actual Solo/Duel/three/four-player simulations, repeated multiball and its cap, shared
badge refresh/expiry, both cannon directions, misses, moving paddles and every defense.
Existing campaign, multiplayer, recovery, bot, arena and browser sessions remain part
of regression validation. Both server and frontend deployment are needed after push.

Validation completed: all 222 automated tests pass, including the new collision and
cannon-defense coverage. The final focused collision run also verifies that Solo keeps
post-impact momentum across subsequent frames. Syntax/formatting checks, the Pages
production build and the full Chromium session suite pass. Browser checks exercise
Solo badge display/expiry with all six powers, pointer transparency and unchanged
canvas bounds; the phone-size screenshot was reviewed. Hosted deployment and physical
network/device acceptance are not claimed by these local checks.
