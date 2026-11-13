# Immediate finger control and stable live layout

User preference supersedes the local-authority-only presentation in DUEL_SHARED_TIMELINE.md.

Pointer/drag targets now place the visible local paddle at the clamped finger position
on the next display frame, with no interpolation, easing, speed ramp or wait for a reply.
Older snapshots do not drag that visible paddle back to an older position. Balls and
remote paddles retain authoritative rendering; collisions and scoring remain server-owned.
The last finger target is also retained when using Release/Fire, rather than substituting
an older simulated position from pending movement.

Input gains optional direct:boolean. The server applies the latest sequenced direct
target at the beginning of its next physics tick, clamped to the field and paddle width.
It tests collisions at that destination, not along a fictitious sweep across the entire
jump. Direct placement has no artificial stroke velocity; keyboard and bot movement
retain their existing speed limits and stroke behavior. Pause/resync clears pending
direct placement. Solo is unchanged.

This eliminates the deliberate travel ramp for finger control, but not transit time:
the server cannot receive a network input before it arrives. Local position is immediate
and may briefly lead authority. Both client and server must deploy this change; older
servers discard the optional field and retain their older travel behavior.

During a match, status, action toolbar, HUD and bonus bar use reserved fixed heights.
Long status text truncates in its reserved line; the toolbar has fixed-size cells;
bonus cards scroll horizontally inside one reserved row. An empty bonus row remains
reserved. Loading feedback overlays the live area instead of removing the status row
and pushing the field. Room setup retains its larger controls. The canvas may still
resize for a genuine viewport/orientation change, but not for gameplay label changes.

Validation covers same-frame finger target placement at both rotated paddles, rejection
of snapshot recoil, direct server collision at the new position without a cross-field
sweep, and pause cancellation. Chromium compares canvas bounds before and after longer
action/status text, bonus visibility/content changes and loading visibility.

Verified locally: 193 automated tests pass, plus syntax checks, production base-path
build and Chromium two-player/bot smoke with the live field-geometry assertion.
No push or deployment was performed for this change.
