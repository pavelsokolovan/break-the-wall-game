# Faster Duel response without predicted collision positions

The previous coherent presentation avoided false saves but retained three sources of
perceived lag: input throttling at 30Hz, periodic snapshots at 20Hz, a 50ms display
buffer, plus a 1200-game-pixels/second movement cap. Internet round-trip time and browser
frame scheduling add further delay. These are update/delivery delays, not object
regeneration or slow ball physics.

Current profile:

| Setting                          | Previous | New                         |
| -------------------------------- | -------- | --------------------------- |
| Human input cap                  | 30Hz     | 60Hz, negotiated by welcome |
| Periodic authoritative snapshots | 20Hz     | 30Hz                        |
| Client interpolation buffer      | 50ms     | 16.67ms                     |
| Duel paddle maximum speed        | 1200px/s | 1800px/s                    |
| Server physics                   | 60Hz     | 60Hz, unchanged             |
| Ball speeds                      | Existing | Unchanged                   |

The Duel UI still renders balls and paddles on the same authoritative timeline, without
local collision-position prediction or guessed bounces. The shorter buffer trades some
interpolation smoothness under jitter for lower visible response delay. The higher
movement cap reduces travel time to distant finger targets without teleporting paddles.
Keyboard target travel and the fallible bot's reaction/aim limits remain unchanged.
Solo physics and controls are untouched.

Welcome adds optional maximumInputHz (30 or 60). New clients keep the old 30Hz cap when
talking to an older server, and switch to 60Hz only after a compatible welcome. Old
clients ignore the optional field. Server transport allowance is now 80 messages/second
with a 90-message burst so 60Hz input plus control/heartbeat messages is accepted; room
creation and resume request limits are unchanged. Flood protection remains tested.

Snapshots remain bounded by the existing send-buffer protection; routine snapshot
traffic increases by 50%, with the existing immediate contact snapshots also retained.
Actual internet latency is not removed by these changes. This is not a measured claim
about phone-to-Render RTT. Server-region/network investigation is still relevant if
response remains poor after deployment.

Validation covers 30Hz authoritative snapshot spacing, sustained 60Hz real-socket input,
client negotiation/fallback, faster paddle travel, moving corner/drop contact fixtures,
existing game mechanics, shared-timeline display, browser sessions and bot practice.
Deploy both backend and frontend to use the complete faster profile.

Verified locally: all 191 tests pass, plus syntax checks, the production base-path build
and Chromium two-player/bot smoke. No push or deployment was performed for this change.
