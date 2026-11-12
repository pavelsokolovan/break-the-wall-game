# Two-ball capture and paired rounds

User-approved replacement for the Duel single-ball/Multiball rules. Solo is unchanged.

- Every round automatically serves exactly two balls after the shared countdown, one
  from each paddle, with mirrored trajectories and distinct owner colours.
- Both traverse the whole field and pass through each other. Returning a ball changes
  its owner; subsequent brick points, combos and drops belong to the current owner.
- Each fully exited ball awards one goal to the opponent of the conceding paddle and
  is removed exactly once. Two exits at the same end award two goals; opposite exits
  award one goal each, regardless of entity ordering or microstep timing.
- The remaining ball keeps moving, including after a fifth goal. Powers, shots, drops,
  held balls and timers continue until both balls finish. Goals still damage the
  conceding paddle. Drops/hazards follow existing end-of-round ordering on the final exit.
- After both score, reset transient powers/entities and pause budgets, preserve brick
  points/walls/damage, and start the existing two-second round countdown.
- A completed round with at least five goals and unequal totals ends the match. A tied
  completed round at five or above continues to a deciding round. Round outcomes are
  2–0, 1–1 or 0–2. The existing active-time cap and forfeits may end a round early.
- Duel Multiball's 4% drop probability becomes extra gems, bringing gems to 14%.
  Existing injected/legacy multi pickups award +500 without creating a ball. Solo's
  drop table and Multiball are unchanged.
- Health capability changes to duel-paired-v1 so new clients reject old backend rules
  before creating/joining. Protocol envelopes remain v1; deploy backend before frontend.
- Validate default two-ball start, surviving-ball continuity, same/opposite exits,
  equalization after the fifth goal, ownership, no spawned extras, round resets,
  existing physics/powers and full socket/UI/browser regressions.

Implemented and verified locally: 175 automated tests pass, including explicit two-ball
start/remaining-ball continuity/equalization tests, real-socket rounds and existing Solo
regressions. Syntax checks, production base-path build and the two-page Chromium smoke
pass. The browser checks include points-only legacy pickups, powers, recovery, rematch,
mobile layouts and Solo. No deployment was performed for this change.
