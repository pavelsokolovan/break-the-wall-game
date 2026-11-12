# Stage 8 specification: complete session experience

Status: implemented locally. Builds on Stage 7; hosting is Stage 9. Not deployed.

## Permanent modes and scope

Keep Solo and Online Duel as permanent separate choices. Solo requires no backend,
keeps brickfall-blitz:v1 saves, and resumes only through its existing explicit control.
All new controls, pauses, links and history belong to Online Duel. No deployment.

## Invitations and errors

Use a room-only `?duel=ABCDEF` invitation on the current frontend origin/path, preserving
unrelated query parameters. Never include a token, backend URL or player identity.
Validate six-character codes with shared rules. An invitation prefills the code and
shows a prompt in Solo; entry/join requires an explicit gesture. A saved seat takes
precedence when entering Online. Share via Web Share when supported; cancellation
stops without an error. Otherwise copy via clipboard; if unavailable/denied, reveal a
selectable read-only link. Show room/server/expiry/auth errors in the existing live
status. No silent replacement room or fabricated result.

## Authoritative session lifecycle

- Add optional pause.reason (manual/background/panel) to pause requests, preserving
  requested:boolean. requested=false and resume_play both mean resume consent.
- During countdown, playing or goal countdown, a player can request one manual pause
  per rally, including panels/background. Freeze immediately with DuelGame.setPaused;
  retain all entity, power and serve timers. A pause lasts at most 30 wall-clock seconds.
  Both players must consent to resume, or its deadline expires. Repeated requests do
  not extend the deadline. Each player requesting a pause consumes their own budget.
  Consent can be withdrawn only by spending an unused budget. Reset budgets on a goal
  or replay/new match, not on reconnect or wave advancement.
- Pauses have server-owned consent/used flags, exposed as optional state.pause.consents
  and room.pauseUsed. Recovery has priority. Preserve a manual pause through connection
  loss; after the recovery countdown, restore any unexpired pause/consents, otherwise
  resume. Disconnect/stall never replenishes budgets. Inputs/actions cannot queue during
  any pause; background without budget clears pending actions and retains the last target.
- UI Pause/Resume, P/Escape, Legend and Duel History panels use that same pause budget.
  Closing a panel/returning to foreground sends only that player's consent. Background
  requests pause once on visibility transition, clears controls, and marks inactive.
  Hidden/panel clients send no movement/actions. A player may use Resume to consent
  while the opponent still has a panel open; closing it supplies the second consent.
- Cap matches at 15 minutes of active simulation play (exclude all countdowns/pauses).
  At the first tick reaching the cap, higher goals wins; a goals tie is a draw regardless
  of points. Return reason=time_limit, immutable terminal result, normal retention.
- Leaving a live match remains an explicit confirmed forfeit. For a connected voluntary
  leave, save its authoritative result before clearing client state; if delivery is lost,
  show no invented record. Offline leave cancels recovery and may forfeit at grace expiry.
  Keep existing 10-minute lobby/5-minute finished expiry and 30-second abandonment.
- Both connected finished seats may toggle rematch consent. Disconnect/leave clears it.
  Starting requires two consents; swap seat objects/connection slots atomically, retain
  player identities, rotate both tokens privately, clear old request caches and inputs,
  reset all simulation/events/points/budgets, new seed/match ID, three-second countdown.
  Inputs gain optional matchId; rematches require the new ID so delayed previous-match
  movement or actions cannot poison the reset input sequence.
  Send each corresponding player a welcome with optional rematch=true before room/full
  snapshot; reset input sequence to 1 even for the same player. Old result stays immutable.
  A lone finished seat cannot rematch and new players cannot join a finished room.

## Separate local history

Use brickfall-blitz:duel:v1 localStorage, maximum latest 20 validated records. Store
match ID, local receipt date, outcome, reason, goals for/against, points for/against,
duration and wave count. Save only server result messages, once per match ID, before
render/leave/rematch transitions. Re-read and merge storage at save to reduce cross-tab
lost updates; bounded in-memory dedup persists if storage fails. Validate reads and
project allowlisted fields; corrupted/unavailable storage never breaks play. No tokens,
backend URLs or Solo data. History/Legend are accessible before joining and after results.

## Validation and completion

Add deterministic simulation tests for active-time cap/tie/frozen time. Real sockets
verify budgets, two consents, timeout, no queued input, goal reset, reconnect preservation,
rematch identity/slot/token/sequence reset, old-token rejection, immutable results and
expiry/forfeit behavior. UI/storage tests cover links/share fallback, explicit join,
panels/background/consents, result dedup/rematch/leave, unavailable storage, and Solo
escape. Extend two-page Chromium smoke with manual pause, panels, rematch and history;
retain recovery/weapons/mobile layout checks. Run full tests, syntax and Pages build.
Record actual coverage; physical phones, real network jitter and hosting remain later.

## Implementation and verification record

Implemented on 2026-11-12 in the room manager, protocol, DuelGame, OnlineClient,
multiplayer UI and new src/duel-session.js utilities. New UI stays separate from Solo's
panels and storage. Rematch inputs carry a match ID; stale previous-match sequences
are rejected before acknowledgement. Public invitations contain only the room code.

Local verification:

- `npm run check`: passed.
- `npm test`: 157 tests passed, including 24 real-socket server tests, 19 online UI
  tests, four history/invitation tests and the active-time-limit simulation check.
  Coverage includes consent/deadline/budget behavior, frozen queued actions, pause
  preservation on resume, rematch identity/token/slot/sequence reset, stale input and
  old-token rejection, deduplicated history, voluntary forfeit recording, optional
  storage, invitation gestures/share fallbacks and existing Solo/gameplay regressions.
- `npm run test:browser`: passed with two Chromium pages and no runtime exceptions.
  Existing create/join/readiness/gameplay/recovery/weapons/Solo checks remain. New
  flows exercise both pause consents, a Legend panel, saved history, rematch side swaps
  and fresh countdowns. Portrait/landscape controls fit; screenshots inspected at
  `/tmp/brickfall-stage8-portrait.png` and `/tmp/brickfall-stage8-landscape.png`.
- `npm run build -- --base=/break-the-wall-game/`: passed.
- `git diff --check`: passed.

The match/result/rematch session milestone C is complete locally. Hosting and cold
starts remain Stage 9; physical phones and real network/release acceptance remain
Stage 10. No service was provisioned and nothing was published or deployed.
