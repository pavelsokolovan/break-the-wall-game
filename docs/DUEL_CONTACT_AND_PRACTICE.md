# Duel contact correction and practice bot

## Investigation

Two distinct failure paths were identified:

1. `paddleContact` rejected a front-edge overlap if the entry root was negative. For
   example, a radius-10 ball at y=915 approaching the lower paddle face y=918 already
   overlaps its front. The old face sweep starts behind its entry point and returns a
   negative t; the corner roots can also be negative. It then crosses the paddle.
   This can arise when a paddle moves into a ball's contact region. Resolve an existing
   front-face/corner overlap at t=0 when approaching, while retaining the rejection of
   ball centres behind the face. Both rotated paddles use this same check.
2. The client combined a current input-predicted paddle with a delayed interpolated
   ball. Under network delay, that display could show apparent coverage that was never
   present at the server's collision time. Within 110 canonical pixels of either paddle,
   display that paddle and nearby balls from the same latest authoritative snapshot.
   Keep normal interpolation and local prediction elsewhere, and do not invent bounces
   or send client-authoritative collision/score messages.

Tests reproduce front overlap and reject backside overlap at both ends, and exercise
contact rendering with delayed snapshots and prediction. Existing swept collision,
rounded corner, moving paddle, high-speed and ownership tests remain. These fixes do
not remove internet latency or retroactively turn late inputs into saves. Physical-phone
retesting of the reported situation is still required.

## Test vs bot

Select Online Duel → Test vs Bot → Ready. This creates a real server room with one
human seat and one server-controlled bot, using the same DuelGame, snapshots, input
sequencing, paddle speed limits, two-ball scoring, pauses, reconnect and rematch flow
as human online play. The backend is required, intentionally retaining the network
path so practice is useful for investigating online input issues. Solo is unchanged.

The bot reads currently visible ball positions/velocities and issues ordinary inputs:
140–300ms reaction intervals, bounded target travel, aiming error, and 22% intentionally
poor tracking choices. It has no future collision/brick prediction, teleportation,
score manipulation or automatic catches. Held balls release through the normal action
path; bazooka shots use the same ammo/cooldown rules. Seeded bot-vs-bot tests show actual
paddle hits and goals conceded by both sides, reproducibly.

Protocol adds an explicit `practice` room request and optional room.practice boolean.
The bot occupies a reserved seat, shares room/request limits, consents to human pause
resume/rematch, swaps slots on rematch and stops updating while frozen. Practice rooms
cannot accept a third player. Leaving removes bot-only rooms. Practice results are
labelled in the live UI and excluded from competitive local Duel history. Deploy the
new server before using the new button; older servers reject the unsupported request
rather than silently create an ordinary two-human room.

## Verification

- Full suite: 181 tests, including real WebSocket practice/start/pause/resume/rematch/
  cleanup, explicit practice UI/history behavior, front overlap, delayed contact
  presentation and seeded fallible bot matches.
- Syntax checks and Pages base-path production build.
- Two-page Chromium session smoke extended with single-page server bot practice,
  bot movement, pause/resume and leave cleanup; screenshot `/tmp/brickfall-practice.png`.
- No claim of physical-phone or real-internet latency acceptance from local automation.

Update: the local-paddle authority override described above caused snap-back against
finger prediction and has been removed. See DUEL_CONTINUOUS_PLAY.md for the current
stable target rendering and independent respawn rules. The front-overlap physics fix
and bot practice remain active.
