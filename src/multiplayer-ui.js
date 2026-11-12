import { DuelSync, ServerClock } from "./duel-sync.js";
import { OnlineClient, multiplayerUrl } from "./online-client.js";
import { drawDuel } from "./duel-view.js";
import {
  normalizeRoomCode,
  DUEL_RULES as R,
  worldToViewPoint,
} from "../shared/duel-rules.js";

export function mountMultiplayer({
  document: doc = document,
  window: win = window,
  url = multiplayerUrl(import.meta.env || {}, win.location),
  onModeChange = () => {},
  onUserGesture = () => {},
  onSound = () => {},
  clientFactory = (options) => new OnlineClient(options),
  now = () => performance.now(),
} = {}) {
  const $ = (id) => doc.getElementById(id),
    canvas = $("duel-game");
  let active = false,
    pending = false,
    room = null,
    snapshot = null,
    result = null,
    receivedAt = 0,
    target = null,
    action = "none",
    raf = null,
    lastFrame = null,
    generation = 0,
    tap = null,
    lastEventId = 0,
    eventMatchId = null,
    viewSlot = null;
  const keys = new Set();
  const clock = new ServerClock(),
    sync = new DuelSync({ clock });
  const motionQuery = win.matchMedia?.("(prefers-reduced-motion: reduce)");
  function status(text) {
    $("duel-status").textContent = text;
  }
  function controls() {
    $("duel-create").disabled = pending || !!room || client.recovering || !url;
    $("duel-join").disabled = pending || !!room || client.recovering || !url;
    $("duel-code").disabled = pending || !!room || client.recovering;
    $("duel-ready").hidden = !room || !!snapshot;
    $("duel-ready").disabled = !room?.players.every((p) => p.connected);
    $("duel-leave").hidden = !room;
    $("duel-connect").hidden = !!room;
  }
  const client = clientFactory({
    now,
    clock,
    storage: (() => {
      try {
        return win.sessionStorage;
      } catch {
        return null;
      }
    })(),
    onInput(input) {
      sync.recordInput(input);
    },
    onStatus(text) {
      if (!result) status(text);
      if (client.recovering || !client.socket) {
        inactive();
        sync.pending = [];
        sync.desired = null;
      }
      controls();
      if (!client.socket && room && !result) {
        $("duel-ready").disabled = true;
        $("duel-action").disabled = true;
      }
    },
    onMessage(message) {
      if (message.type === "welcome") {
        viewSlot = message.slot;
        sync.reset();
        inactive();
        if (message.resumed) status("Seat restored. Synchronizing…");
        controls();
      }
      if (message.type === "room") {
        room = message;
        $("duel-room-code").textContent = message.code;
        $("duel-slots").textContent = message.players
          .map(
            (p) =>
              `${p.slot === client.slot ? "YOU" : "OPPONENT"}: ${!p.connected ? "waiting" : p.ready ? "ready" : "not ready"}`,
          )
          .join(" · ");
        $("duel-ready").textContent = room.players[client.slot]?.ready
          ? "NOT READY"
          : "READY";
        controls();
        if (message.phase === "reconnecting") {
          inactive();
          status("Waiting for the other player to reconnect…");
        }
      }
      if (message.type === "snapshot") {
        if (
          snapshot &&
          message.matchId === snapshot.matchId &&
          message.tick < snapshot.tick
        )
          return;
        snapshot = message;
        receivedAt = now();
        sync.push(message, receivedAt, client.slot);
        canvas.hidden = false;
        $("duel-hud").hidden = false;
        $("duel-action").hidden = false;
        const local = message.state.players[client.slot];
        const held = message.state.balls.some(
          (b) => b.held && b.owner === client.slot,
        );
        $("duel-action").textContent = held
          ? local.ammo > 0
            ? `RELEASE / FIRE (${local.ammo})`
            : "RELEASE"
          : local.ammo > 0
            ? `FIRE (${local.ammo})`
            : "AUTO SERVE";
        $("duel-action").disabled =
          client.recovering ||
          message.phase !== "playing" ||
          (!held && (local.ammo <= 0 || local.fireCooldownMs > 0));
        $("duel-slots").hidden = true;
        $("duel-ready").hidden = true;
        $("duel-goals").textContent =
          `YOU ${message.state.goals[client.slot]} : ${message.state.goals[1 - client.slot]} OPPONENT`;
        $("duel-points").textContent =
          `${message.state.players[client.slot].points} POINTS · WAVE ${message.state.wave}`;
        if (message.phase !== "playing") {
          keys.clear();
          target = null;
          action = "none";
        }
        if (!result) showSnapshotStatus(message);
      }
      if (message.type === "events") {
        if (eventMatchId !== message.matchId) {
          eventMatchId = message.matchId;
          lastEventId = 0;
        }
        for (const e of message.items)
          if (e.id > lastEventId) {
            lastEventId = e.id;
            if (e.type === "paddle_hit") onSound("paddle");
            if (e.type === "ball_held") onSound("pickup");
            if (e.type === "ball_released") onSound("launch");
            if (e.type === "shot_fired") onSound("fire");
            if (e.type === "hazard_intercepted") onSound("explosion");
            if (e.type === "pickup") onSound("pickup");
            if (e.type === "hazard_blocked")
              onSound(e.defense === "invulnerability" ? "hit" : "shield");
            if (e.type === "hazard_damage") onSound("damage");
            if (e.type === "brick_hit") onSound("hit");
            if (e.type === "brick_destroyed") onSound("brick");
            if (e.type === "explosion") onSound("explosion");
            if (e.type === "wave_started" && e.wave > 1) onSound("clear");
            if (e.type === "goal") onSound("clear");
          }
      }
      if (message.type === "result") {
        if (result?.matchId === message.matchId) return;
        result = message;
        status(
          `${message.winner === null ? "DRAW" : message.winner === client.slot ? "YOU WIN" : "OPPONENT WINS"} · ${message.goals[client.slot]}–${message.goals[1 - client.slot]} · Leave to create a new match`,
        );
        $("duel-action").disabled = true;
      }
      if (message.type === "error" && !result) status(message.message);
    },
  });
  function reset() {
    sync.reset();
    room = null;
    snapshot = null;
    result = null;
    target = null;
    action = "none";
    tap = null;
    keys.clear();
    lastEventId = 0;
    eventMatchId = null;
    $("duel-room-code").textContent = "";
    $("duel-slots").textContent = "";
    $("duel-slots").hidden = false;
    canvas.hidden = true;
    $("duel-hud").hidden = true;
    $("duel-action").hidden = true;
    controls();
  }
  function leave() {
    generation++;
    client.send({ type: "leave" });
    client.disconnect();
    pending = false;
    reset();
  }
  function switchMode(online) {
    if (active === online) return;
    if (
      !online &&
      snapshot &&
      !result &&
      !win.confirm("Leave this match? Your opponent wins by forfeit.")
    )
      return;
    if (!online) leave();
    active = online;
    onModeChange(active);
    $("solo-panel").hidden = active;
    $("solo-tools").hidden = active;
    $("duel-panel").hidden = !active;
    $("solo-mode").setAttribute("aria-pressed", String(!active));
    $("online-mode").setAttribute("aria-pressed", String(active));
    if (active) {
      const recovering =
        url && client.hasSession(url) && client.resumeSaved(url);
      if (!recovering)
        status(
          url
            ? "Create a room or enter a friend’s code."
            : "Online Duel is unavailable here. A multiplayer server must be configured. Solo is ready to play.",
        );
      if (raf === null) {
        lastFrame = null;
        raf = win.requestAnimationFrame(frame);
      }
      (url ? $("duel-create") : $("solo-mode")).focus();
    } else {
      if (raf !== null) win.cancelAnimationFrame(raf);
      raf = null;
      $("solo-mode").focus();
    }
  }
  async function request(type) {
    if (pending || room) return;
    const code =
      type === "join" ? normalizeRoomCode($("duel-code").value) : null;
    if (type === "join" && !code) {
      status("Enter a valid six-character room code.");
      return;
    }
    if (!url) {
      status("A multiplayer server must be configured.");
      return;
    }
    const current = ++generation;
    pending = true;
    controls();
    onUserGesture();
    try {
      await client.connect(url);
      if (current !== generation) return;
      await client.request(type, code ? { code } : {});
    } catch (e) {
      if (current === generation) status(e.message);
    } finally {
      if (current === generation) {
        pending = false;
        controls();
      }
    }
  }
  $("online-mode").onclick = () => switchMode(true);
  $("solo-mode").onclick = () => {
    if (active) switchMode(false);
  };
  $("duel-create").onclick = () => request("create");
  $("duel-connect").onsubmit = (e) => {
    e.preventDefault();
    request("join");
  };
  $("duel-ready").onclick = () => {
    onUserGesture();
    client.send({ type: "ready", ready: !room?.players[client.slot]?.ready });
  };
  $("duel-leave").onclick = () => {
    if (
      snapshot &&
      !result &&
      !win.confirm("Leave this match? Your opponent wins by forfeit.")
    )
      return;
    leave();
    status("Create a room or enter a friend’s code.");
  };
  function queueAction(type) {
    if (
      !client.recovering &&
      client.socket?.readyState === 1 &&
      snapshot?.phase === "playing"
    ) {
      action =
        action === "release_fire" || type === "release_fire"
          ? "release_fire"
          : type;
      onUserGesture();
    }
  }
  $("duel-action").onclick = () => queueAction("release_fire");
  function position(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * R.width,
      y: ((e.clientY - r.top) / r.height) * R.height,
    };
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (
      e.isPrimary === false ||
      client.recovering ||
      client.socket?.readyState !== 1 ||
      client.slot === null ||
      !snapshot ||
      snapshot.phase !== "playing"
    )
      return;
    const p = snapshot.state.players[client.slot],
      center = worldToViewPoint(client.slot, { x: p.x, y: 0 }).x,
      pos = position(e);
    tap = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      time: now(),
      onPad:
        Math.abs(pos.x - center) <= p.width / 2 + 16 &&
        pos.y >= 892 &&
        pos.y <= 954,
    };
    target = Math.max(0, Math.min(1, pos.x / R.width));
    canvas.setPointerCapture(e.pointerId);
    canvas.focus({ preventScroll: true });
    onUserGesture();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (
      snapshot?.phase === "playing" &&
      (e.pointerType === "mouse" || tap?.id === e.pointerId)
    )
      target = Math.max(0, Math.min(1, position(e).x / R.width));
  });
  canvas.addEventListener("pointerup", (e) => {
    if (tap?.id === e.pointerId) {
      if (
        tap.onPad &&
        Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12 &&
        now() - tap.time < 500
      )
        queueAction("release_fire");
      tap = null;
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener("pointercancel", () => {
    tap = null;
  });
  win.addEventListener("keydown", (e) => {
    if (
      !active ||
      snapshot?.phase !== "playing" ||
      ["INPUT", "TEXTAREA", "BUTTON"].includes(e.target.tagName)
    )
      return;
    const key = e.key.toLowerCase();
    if (["arrowleft", "arrowright", "a", "d", " ", "f"].includes(key)) {
      e.preventDefault();
      keys.add(key);
    }
    if (!e.repeat && key === " ") queueAction("release_fire");
    if (!e.repeat && key === "f") queueAction("fire");
  });
  win.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  function inactive() {
    keys.clear();
    target = null;
    action = "none";
    tap = null;
  }
  win.addEventListener("blur", inactive);
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) inactive();
  });
  function showSnapshotStatus(s) {
    const pause = s.state.pause;
    if (pause && (s.phase === "reconnecting" || s.phase === "paused")) {
      const left = Math.max(
        0,
        Math.ceil((pause.deadlineServerTime - clock.serverNow(now())) / 1000),
      );
      status(
        pause.reason === "server_busy"
          ? "Server busy. Match frozen while it recovers…"
          : `Waiting for reconnect… ${left}s remaining`,
      );
    } else if (pause && s.phase === "countdown")
      status(
        `Both players connected · resuming in ${Math.ceil(s.state.countdownRemainingMs / 1000)}…`,
      );
    else
      status(
        s.phase === "playing"
          ? "First to five · drag or ← → / A D"
          : s.phase === "finished"
            ? "Match finished"
            : "Get ready · automatic serve",
      );
  }
  function frame(time) {
    if (!active) {
      raf = null;
      return;
    }
    const dt =
      lastFrame === null
        ? 0
        : Math.min(0.05, Math.max(0, (time - lastFrame) / 1000));
    lastFrame = time;
    if (!snapshot && room?.phase === "reconnecting" && !client.recovering)
      status(
        `Waiting for reconnect… ${Math.max(0, Math.ceil((room.reconnectDeadlineServerTime - clock.serverNow(now())) / 1000))}s remaining`,
      );
    if (snapshot) {
      if (
        !result &&
        !client.recovering &&
        snapshot.phase !== "playing" &&
        snapshot.state.pause
      )
        showSnapshotStatus(snapshot);
      const available = Math.max(
        80,
        win.innerHeight - canvas.getBoundingClientRect().top - 68,
      );
      const width = Math.min(
        $("duel-panel").clientWidth || 800,
        (available * R.width) / R.height,
      );
      canvas.style.width = `${Math.floor(width)}px`;
      canvas.style.height = `${Math.floor((width * R.height) / R.width)}px`;
      const stale = !result && now() - receivedAt > 250;
      if (stale) {
        inactive();
        sync.desired = null;
        $("duel-action").disabled = true;
      }
      if (
        stale &&
        !client.recovering &&
        snapshot.phase === "playing" &&
        client.socket?.readyState === 1
      )
        status("Waiting for server… play is frozen on this screen.");
      if (
        !stale &&
        snapshot.phase === "playing" &&
        !client.recovering &&
        client.socket?.readyState === 1
      ) {
        const direction =
          (keys.has("arrowright") || keys.has("d") ? 1 : 0) -
          (keys.has("arrowleft") || keys.has("a") ? 1 : 0);
        const p = snapshot.state.players[client.slot];
        const localX = sync.local?.x ?? p.x;
        const viewX = client.slot === 0 ? localX : R.width - localX;
        if (direction)
          target = Math.max(
            p.width / 2 / R.width,
            Math.min(
              1 - p.width / 2 / R.width,
              (target ?? viewX / R.width) +
                (direction * R.keyboardSpeed * dt) / R.width,
            ),
          );
        if (target !== null) sync.setTarget(target, now());
        if (
          (target !== null || action !== "none") &&
          client.input(target ?? viewX / R.width, action)
        ) {
          action = "none";
          if (!direction) target = null;
        }
      }
      const presented = sync.frame(
        now(),
        client.socket?.readyState === 1 && !client.recovering,
      );
      drawDuel(
        canvas,
        presented?.snapshot ?? snapshot,
        client.slot ?? viewSlot ?? 0,
        {
          motion: !motionQuery?.matches,
        },
      );
    }
    raf = win.requestAnimationFrame(frame);
  }
  controls();
  return { client, switchMode, leave };
}
