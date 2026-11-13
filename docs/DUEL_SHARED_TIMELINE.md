# Duel paddle and ball presentation on one server timeline

## Confirmed rendering mismatch

The local paddle's predicted position could run ahead of the authoritative paddle by
network latency plus input travel time. Meanwhile balls were interpolated in the past,
and near-contact overrides sometimes switched only the ball to the newest snapshot.
A moving paddle could therefore appear to cover a ball at a position where it had not
been on the server. A bounce could also appear relative to the wrong visible paddle
centre, producing a misleading rebound angle. Prior fixes that alternated prediction
and authority caused snap-back; keeping prediction everywhere avoided shake but retained
the mismatch. The earlier front-overlap collision fix remains in the simulation.

## Current solution

- Duel UI sets predictLocal=false. Render both paddles and all balls from the same
  authoritative snapshot pair at the same interpolation fraction, with a 50ms render
  buffer and no physics extrapolation. Finger targets still send normally and obey
  the shared movement cap, but do not substitute an unconfirmed visible paddle.
- For a rebound, owner/held transition, respawn, entity change or paddle-width change,
  hold the entire earlier state until the later state's server time, then switch the
  complete state. Do not mix a post-bounce ball with an older paddle, or draw a false
  straight path through a collision. This also avoids rewinding the display afterward.
- At a paddle_hit, the server sends a complete snapshot immediately, even between its
  normal 20Hz snapshot ticks. Contact state is no longer withheld until a periodic tick.
- Input/sequence validation, authoritative collision/angle calculations, goals, drops,
  independent respawn, bot play, pause and reconnect rules are unchanged.
- Existing prediction utilities remain available for their isolated regression tests;
  the actual Duel UI explicitly uses authoritative presentation. Solo is unchanged.

This prioritizes matching the visible paddle/contact/rebound over hiding network delay.
Movement now includes real network round-trip response rather than pretending an input
has already reached the server. Late inputs can still miss; this change does not award
retroactive saves or claim to eliminate internet latency. Physical-phone retesting is
required to confirm the reported symptom under the user's network conditions.

## Verification

Regression tests cover delayed unacknowledged finger movement (no false displayed save),
both rotated paddle views, synchronized rebound/paddle transition, interpolation at an
identical fraction, disconnect freeze and immediate between-tick contact snapshots.
Run the full regression suite, syntax/build and Chromium two-user/bot session smoke.

Verified locally: 188 automated tests pass, including the new timing/contact regressions;
syntax checks, Pages production build and Chromium two-player/bot session smoke pass.
No push or deployment was performed for this change.

Speed-profile update: the buffer is now 16.67ms and periodic snapshots 30Hz; see
[DUEL_RESPONSE_SPEED.md](DUEL_RESPONSE_SPEED.md). Coherent authoritative presentation
and immediate paddle-contact snapshots are retained.

Pointer-control preference update: DUEL_DIRECT_POINTER.md supersedes the authoritative-
only local paddle view. Finger control is now immediate locally and uses direct server
placement on receipt; balls and remote paddles remain authoritative. This intentionally
prioritizes immediate finger response over hiding the remaining network transit gap.
