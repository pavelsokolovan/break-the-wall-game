# Online Duel: staged implementation roadmap

Source of truth: [ONLINE_DUEL_SPEC.md](ONLINE_DUEL_SPEC.md).
Each stage receives its own detailed implementation specification before coding.
Keep **Solo (single player)** and add **Online Duel (two online players)** as permanent,
separate mode choices. Online Duel must never replace Solo. Preserve Solo's campaign,
saves, controls, bonuses and pixel style; Solo requires no multiplayer backend.

Completed locally: [Stage 1](ONLINE_DUEL_STAGE_01_SPEC.md),
[Stage 2](ONLINE_DUEL_STAGE_02_SPEC.md), [Stage 3](ONLINE_DUEL_STAGE_03_SPEC.md),
[Stage 4](ONLINE_DUEL_STAGE_04_SPEC.md), [Stage 5](ONLINE_DUEL_STAGE_05_SPEC.md),
[Stage 6](ONLINE_DUEL_STAGE_06_SPEC.md), and [Stage 7](ONLINE_DUEL_STAGE_07_SPEC.md).
Milestones A–B are playable locally, including walls, full bonuses, hazards and weapons,
with connection recovery and smooth rendering implemented.
Next: Stage 8, complete session experience.
Hosted multiplayer is not deployed yet.

| Stage                                        | Description                                                                                                                                                                   | Completion checkpoint                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Shared foundations and contracts          | Constants, coordinate/input transforms, protocol v1, snapshot serialization, and simulation interfaces.                                                                       | Node/browser-compatible modules; contract tests and Solo checks pass.                 |
| 2. Pure competitive simulation               | Opposite paddles, authoritative movement/stroke physics, one ball, serves, damage, aggregated goals, first-to-five. Empty field initially.                                    | Deterministic physics, rally, and terminal-result tests pass.                         |
| 3. Local multiplayer vertical slice          | HTTP/WebSocket server, two-seat rooms, create/join/ready, scheduler, snapshots, minimal browser controls/view. Validate inputs, origins, and transport limits from the start. | Two local clients complete a match. Milestone A complete.                             |
| 4. Symmetric walls and competitive scoring   | Seeded symmetric walls, durability, steel, explosive chains, ownership, independent combos, safe wave replacement, paddle repair.                                             | Deterministic scoring and fair layouts; no spawning over entities.                    |
| 5. Drops, hazards, and defensive powers      | Owner-directed drops, gems, wide/slow, Repair, shield/vest, hazards, caps, damage limits, invulnerability.                                                                    | Probabilities, armor priority, ownership, expiry, and goal/hazard ordering pass.      |
| 6. Multiball, sticky, and bazooka            | Three-ball cap, split ownership, timed sticky release, ammo, projectiles/interception, authoritative visual/audio events.                                                     | Combined mechanics and tap-versus-drag tests pass. Milestone B complete.              |
| 7. Connection recovery and smooth rendering  | Seat resume/token rotation, heartbeats, backoff/grace, full-state recovery, acknowledgements, prediction/interpolation, stalls and interruptions.                             | Same-seat recovery; theft rejected; frozen timers and authoritative scoring verified. |
| 8. Complete session experience               | Invites/share fallback, pause/background/panel consent, forfeits, timeout, rematch/slot swaps, expiry, separate duel history and visible errors.                              | Match/result/rematch and failure paths pass; results save once. Milestone C complete. |
| 9. Free hosting and release configuration    | Render Free, health/CORS, shutdown, public backend URL, cold-start UI, CI, deployment documentation. Deploy server before Pages configuration.                                | Real backend works through Pages; Solo survives backend failure; no paid resources.   |
| 10. Device validation and release acceptance | Two phones across Wi-Fi/mobile networks, orientations, jitter, reconnect/background, sleep/wake/rematch; bandwidth and responsiveness measurements.                           | Acceptance checks and actual URLs/limitations documented. Milestone D complete.       |

## Two-mode acceptance in every stage

All detailed stage specifications inherit the permanent two-mode requirement in
[the master specification](ONLINE_DUEL_SPEC.md#permanent-two-mode-requirement).
Keep the Solo `Game` and online `DuelGame` separate, and keep online data out of Solo saves.

| Stage | Required Solo / Online Duel behavior                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Shared contracts import without initiating networking or changing the Solo API/storage.                                               |
| 2     | Duel simulation remains separate; Solo physics and campaign continue unchanged.                                                       |
| 3     | Add explicit Solo / Online Duel selection; Solo stays usable with no configured backend.                                              |
| 4     | Add duel walls and scoring while preserving Solo layouts, progression and points.                                                     |
| 5     | Add owner-based online powers/hazards; retain Solo lives, drop behavior and saves.                                                    |
| 6     | Add duel weapons/held balls without changing Solo versions of those mechanics.                                                        |
| 7     | Restrict recovery, prediction and interpolation to Online Duel; socket failure never blocks Solo.                                     |
| 8     | Test mode switching, explicit Solo resume and confirmed duel leave; keep results storage separate.                                    |
| 9     | Backend configuration is optional for Solo; publish both choices and preserve Solo during outages/deploys.                            |
| 10    | Validate the Solo campaign/save flow without a backend and a complete two-client Online Duel session, plus transitions between modes. |

Entering Online Duel pauses an active Solo run; returning requires explicit Solo resume.
Every stage must pass existing Solo regressions alongside its new online acceptance tests.

## Delivery rules

Implement sequentially; later stages extend the earlier working slice. Each detailed
specification defines deliverables, exclusions, contracts, transitions, automated tests,
manual acceptance scenarios, and a completion checklist. Keep each stage reviewable.
Public availability waits for reliability and deployment checks. Retain JavaScript ES
modules, a separate DuelGame, authoritative server, private rooms, Pages, and Render Free.
Run Solo regressions throughout; add simulation, real WebSocket, and UI tests alongside
the corresponding behavior. Real-phone release validation belongs to Stage 10.
