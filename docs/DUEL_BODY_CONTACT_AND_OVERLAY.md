# Solid paddle overlap and in-field bonus indicators

## Direct-placement missed contact

The front-face sweep still rejected ball centres behind the paddle's front plane, even
when a newly received direct pointer jump placed the solid paddle body over the circle.
For example: lower paddle rectangle y=918..936, radius-10 ball centre at y=925, moving
toward the lower goal. The new paddle at the ball's x visibly overlaps it, but the old
`y > face` rejection skipped the collision. The mirrored upper paddle had the same issue.

On a tick that applies a direct target, test circle overlap against the whole paddle
rectangle before the normal front-face sweep. If the ball approaches that paddle and
still overlaps its solid body/edge, resolve contact immediately and reflect back into
the field. This does not sweep the paddle through unrelated balls between old/new
positions. It does not rescue a ball already clear of the whole paddle, restore an
already-awarded goal or change normal keyboard/bot backside-contact policy. Collision
scoring remains server-owned. Real network delay beyond the overlap window can still
produce a miss; no claim of arbitrary latency compensation is made.

Local direct rendering also uses the newest confirmed paddle width, rather than an
older interpolated Wide sample. That prevents showing extra coverage after power expiry
or damage has already narrowed the paddle on the server.

## Bonus overlay

Canvas and bonus indicators now share a relative-positioned field wrapper. The bonus
bar is absolutely positioned inside it, above the local paddle, with translucent cards
and shrinking time strips. Charge counts remain readable. It has pointer-events:none,
so dragging passes through it. It takes no layout space, even when hidden, populated,
wrapped or expired. The earlier reserved external bonus row is overridden completely.
Only genuine viewport changes may alter canvas dimensions.

## Validation

Regression tests cover direct targets arriving while circles overlap front/middle/rear
parts of both paddles, no rescue beyond the body or after a goal, real WebSocket delivery,
latest-width rendering, and the overlay's field-parent/leave lifecycle. Existing direct
sweep, collision, snapshot, input, bot and Solo regressions remain active. Chromium's
existing geometry assertion compares field bounds across changing labels, bonus content,
visibility and loading state. Portrait overlay screenshot was inspected locally.

Verified locally: 198 automated tests, syntax checks, production base-path build and
Chromium two-player/bot smoke pass. The browser geometry check passed with the bonus
bar inside the field. No push or deployment was performed for this change.

## Five-pixel end margin and lighter indicators

Duel's ball/paddle collision half-width now includes paddleCollisionPadding=5 logical
game pixels on each side. This applies to the swept front/corner test and direct-body
overlap. Visible paddle width, field clamping, drop/hazard catches and sticky attachment
remain based on the visible width; Solo is unchanged. Bounce aiming still uses the visible
width and existing angle cap. This is a small edge-forgiveness margin, not arbitrary
network rewind or retroactive goal recovery.

Bonus indicators shrink from 14px to 13px text with smaller padding, 3px timer strips,
70% overall opacity and a lighter translucent background/border. Their in-field position
and touch-through/no-layout-space behavior are unchanged.

Boundary tests cover both ends of both paddles, normal/narrow/wide widths, stationary
and direct jump cases, inside-margin catches and outside-margin misses. The full suite
passes 199 tests; syntax/build and Chromium session smoke also pass.
