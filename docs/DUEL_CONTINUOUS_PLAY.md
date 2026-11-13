# Continuous two-ball play and stable touch tracking

This replaces the waiting/round-reset rules in ONLINE_DUEL_PAIRED_ROUNDS_SPEC.md.
Solo is unchanged. No Multiball is reintroduced.

- On a goal, remove the lost ball and create its replacement on the conceding paddle.
  Keep the other ball, powers, drops, weapons, wall and active simulation moving.
  The replacement follows the paddle and auto-releases after one second of active play;
  the existing action control can release it sooner. Pauses/recovery freeze this timer.
- Goals damage the conceding paddle normally. Each goal renews the manual-pause budget.
  There is no whole-field goal countdown or between-round power reset. Terminal results,
  rematch and the active-time cap retain their existing full cleanup.
- Resolve all same-tick goals, then end immediately if a player has at least five and
  a lead. A tied simultaneous fifth goal continues. Do not wait for the other ball.
- Local paddle rendering follows the last finger target monotonically at the shared
  legal speed limit. Late snapshots retain pending-input reconciliation without pulling
  the display backward toward an older position. Near-contact display never overwrites
  the local paddle with authority; this snap-back caused the reported left/right shake.
  Individual goals and wall repairs no longer reset the local intent/render buffer.
- Keep near-paddle ball positions current, remote interpolation and the server collision
  fix. Client display does not invent bounces or change authoritative scoring. Late
  network input can still miss. Stale/disconnected input remains frozen and cleared.
- Size the finger strip to the field width, including landscape layouts, so its drag
  coordinate range matches the playfield instead of a wider parent container.

Validation: stationary finger regression with delayed snapshots, nearby balls and goal
updates; independent lost-ball replacement with surviving-ball/gear preservation;
exact one-second release, pause freeze, terminal result, bot and existing mechanics.
Full automated suite, production build, syntax and Chromium session smoke are recorded
with this change. Real-phone confirmation of the reported touch behavior remains needed.

Verified locally: all 182 automated tests pass, along with syntax checks, production
base-path build and the two-page Chromium smoke (including server bot practice).
No push or deployment was performed as part of this fix.

Presentation update: [DUEL_SHARED_TIMELINE.md](DUEL_SHARED_TIMELINE.md) supersedes the
local prediction described here. The Duel UI now renders the local paddle and balls
from the same authoritative timeline to prevent false coverage and rebound angles.
Continuous respawning and the underlying physics fix remain active.
