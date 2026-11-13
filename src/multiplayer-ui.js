import { ServerWake } from "./server-wake.js";
import {
  DuelHistory,
  invitationCode,
  invitationUrl,
  shareInvitation,
} from "./duel-session.js";
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
  wakeFactory = (options) => new ServerWake(options),
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
    viewSlot = null,
    panel = null,
    panelFocus = null,
    resolveLeave = null,
    leaving = false,
    lastRequest = null,
    waitingControl = null;
  const keys = new Set();
  let localStorage;
  try {
    localStorage = win.localStorage;
  } catch {
    /* Storage is optional. */
  }
  const history = new DuelHistory(localStorage);
  const invited = invitationCode(win.location);
  if (invited) {
    $("duel-code").value = invited;
    $("online-mode").textContent = `ONLINE DUEL · JOIN ${invited}`;
  }
  const clock = new ServerClock(),
    sync = new DuelSync({
      clock,
      interpolationMs: 50,
      correctionMs: 40,
      predictLocal: false,
    });
  const motionQuery = win.matchMedia?.("(prefers-reduced-motion: reduce)");
  function bonusEntries(player) {
    const entries = [];
    for (const [key, name, total] of [
      ["wideRemainingMs", "WIDE", 12000],
      ["slowRemainingMs", "SLOW", 10000],
      ["shieldRemainingMs", "SHIELD", 15000],
    ]) {
      if (
        player[key] > 0 &&
        (key !== "shieldRemainingMs" || player.shieldCharges > 0)
      )
        entries.push({
          key,
          label: `${name}${name === "SHIELD" ? " ×" + player.shieldCharges : ""} ${Math.ceil(player[key] / 1000)}s`,
          ratio: Math.min(1, player[key] / total),
        });
    }
    for (const [key, name] of [
      ["vestCharges", "VEST"],
      ["stickyCharges", "STICKY"],
      ["ammo", "AMMO"],
    ])
      if (player[key] > 0)
        entries.push({ key, label: `${name} ×${player[key]}` });
    return entries;
  }
  function showBonuses(player) {
    const bar = $("duel-bonuses"),
      entries = bonusEntries(player);
    const activeKeys = new Set(entries.map((e) => e.key));
    for (const node of [...bar.children])
      if (!activeKeys.has(node.dataset.bonus)) node.remove();
    for (const entry of entries) {
      let node = [...bar.children].find((n) => n.dataset.bonus === entry.key);
      if (!node) {
        node = doc.createElement("div");
        node.className = "duel-bonus";
        node.dataset.bonus = entry.key;
        node.append(doc.createElement("span"));
        if (entry.ratio !== undefined) {
          const strip = doc.createElement("i");
          strip.className = "duel-bonus-time";
          strip.setAttribute("aria-hidden", "true");
          node.append(strip);
        }
        bar.append(node);
      }
      node.firstElementChild.textContent = entry.label;
      if (entry.ratio !== undefined)
        node.lastElementChild.style.width = `${entry.ratio * 100}%`;
    }
    bar.hidden = !entries.length;
  }
  function status(text) {
    $("duel-status").textContent = text;
  }
  function clearControlWait() {
    if (waitingControl) win.clearTimeout(waitingControl.timer);
    waitingControl = null;
  }
  function sendControl(message, label) {
    if (waitingControl?.type === "resume_play" && message.type === "pause")
      clearControlWait();
    if (waitingControl || client.recovering || client.socket?.readyState !== 1)
      return;
    waitingControl = {
      type: message.type,
      label,
      timer: win.setTimeout(() => {
        waitingControl = null;
        status("Server response timed out. Try again.");
        controls();
      }, 8000),
    };
    if (!client.send(message)) clearControlWait();
    controls();
  }
  function controls() {
    const busy = pending || leaving || client.recovering || !!waitingControl;
    $("duel-loading").hidden = !busy;
    $("duel-panel").setAttribute("aria-busy", String(busy));
    $("duel-loading-text").textContent =
      waitingControl?.label ||
      (leaving
        ? "Leaving match…"
        : client.recovering
          ? "Reconnecting…"
          : $("duel-status").textContent || "Waiting for server…");
    $("duel-practice").disabled =
      pending || !!room || client.recovering || !url;
    $("duel-create").disabled = pending || !!room || client.recovering || !url;
    $("duel-join").disabled = pending || !!room || client.recovering || !url;
    $("duel-code").disabled = pending || !!room || client.recovering;
    $("duel-ready").hidden = !room || !!snapshot;
    $("duel-ready").disabled =
      !!waitingControl || !room?.players.every((p) => p.connected);
    $("duel-leave").hidden = !room;
    $("duel-connect").hidden = !!room;
    $("duel-cancel").hidden = !pending || !!room;
    $("duel-retry").hidden = pending || !!room || !lastRequest;
    const connected = client.socket?.readyState === 1 && !client.recovering;
    $("duel-share").hidden = !room || !!room.practice;
    $("duel-pause").hidden = !snapshot || !!result;
    $("duel-pause").textContent =
      snapshot?.phase === "paused" &&
      ["manual", "panel", "background"].includes(snapshot.state.pause?.reason)
        ? "RESUME"
        : "PAUSE";
    $("duel-pause").disabled =
      !connected ||
      !!waitingControl ||
      !!leaving ||
      !!panel ||
      !["playing", "countdown", "goal_countdown", "paused"].includes(
        snapshot?.phase,
      ) ||
      (!!room?.pauseUsed?.[client.slot] && snapshot?.phase !== "paused") ||
      (!!snapshot?.state.pause &&
        ["reconnect", "server_busy"].includes(snapshot.state.pause.reason));
    $("duel-rematch").hidden = !result;
    $("duel-rematch").disabled =
      !connected ||
      !!waitingControl ||
      leaving ||
      !room?.players.every((p) => p.connected);
    $("duel-rematch").textContent = room?.players[client.slot]?.rematchReady
      ? "CANCEL REMATCH"
      : "REMATCH";
    $("duel-result").hidden = !result || !active;
    $("duel-result-rematch").disabled = $("duel-rematch").disabled;
    $("duel-result-rematch").textContent = $("duel-rematch").textContent;
    $("duel-result-leave").disabled = leaving;
    if (result) {
      const slot = client.slot ?? viewSlot;
      $("duel-result-title").textContent =
        result.winner === null
          ? "DRAW"
          : result.winner === slot
            ? "YOU WIN!"
            : "YOU LOSE";
      $("duel-result-score").textContent =
        `${result.goals[slot]} – ${result.goals[1 - slot]}`;
      $("duel-result-note").textContent = waitingControl
        ? waitingControl.label
        : !connected
          ? "Connection lost. Leave to start again."
          : room?.players[slot]?.rematchReady
            ? "Waiting for your opponent…"
            : !room?.players.every((p) => p.connected)
              ? "Your opponent has left the room."
              : result.reason === "time_limit"
                ? "Time is up. Play again?"
                : result.reason === "forfeit"
                  ? "Match ended by forfeit. Play again?"
                  : "Play again?";
    }
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
      if (!client.socket) clearControlWait();
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
      if (
        waitingControl &&
        (message.type === "error" ||
          message.type === "result" ||
          (waitingControl.type === "ready" && message.type === "room") ||
          (waitingControl.type === "rematch" &&
            ["room", "welcome"].includes(message.type)) ||
          (["pause", "resume_play"].includes(waitingControl.type) &&
            message.type === "snapshot" &&
            (waitingControl.type === "pause"
              ? message.phase === "paused"
              : message.phase !== "paused" ||
                message.state.pause?.consents?.[client.slot])))
      )
        clearControlWait();
      if (message.type === "welcome") {
        if (message.rematch) {
          snapshot = null;
          result = null;
          eventMatchId = null;
          lastEventId = 0;
          closePanel(false);
          status("Rematch · sides swapped. Get ready…");
        }
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
              `${p.slot === client.slot ? "YOU" : room.practice ? "BOT" : "OPPONENT"}: ${!p.connected ? "waiting" : p.ready ? "ready" : "not ready"}`,
          )
          .join(" · ");
        $("duel-ready").textContent = room.players[client.slot]?.ready
          ? "NOT READY"
          : "READY";
        controls();
        if (message.phase === "lobby") {
          status(
            message.players.every((p) => p.connected)
              ? message.practice
                ? "Press Ready to start against the bot."
                : "Press Ready to start. Both players must be ready."
              : "Share this room code with your friend, then press Ready.",
          );
        }
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
        $("duel-drag-area").hidden = false;
        $("duel-hud").hidden = false;
        $("duel-action").hidden = false;
        const local = message.state.players[client.slot];
        showBonuses(local);
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
        controls();
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
        if (!room?.practice) history.save(message, client.slot ?? viewSlot);
        if (result?.matchId === message.matchId) return;
        result = message;
        closePanel(false);
        status(
          `${message.winner === null ? "DRAW" : message.winner === client.slot ? "YOU WIN" : "OPPONENT WINS"} · ${message.goals[client.slot]}–${message.goals[1 - client.slot]} · ${message.reason.replaceAll("_", " ")} · Rematch or leave room`,
        );
        $("duel-action").disabled = true;
        controls();
        if (active && !leaving) $("duel-result-rematch").focus();
        resolveLeave?.();
      }
      if (message.type === "error") {
        if (!result) status(message.message);
        controls();
      }
    },
  });
  const wake = wakeFactory({
    fetcher: (...args) => win.fetch(...args),
    now,
    onStatus: (text) => {
      if (active && pending) {
        status(text);
        controls();
      }
    },
  });
  function cancelRequest() {
    if (!pending || room) return;
    clearControlWait();
    generation++;
    wake.cancel();
    client.disconnect("Connection cancelled. Retry or play Solo.");
    pending = false;
    controls();
  }
  function reset() {
    clearControlWait();
    lastRequest = null;
    sync.reset();
    closePanel(false);
    $("duel-invite-fallback").hidden = true;
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
    $("duel-bonuses").replaceChildren();
    $("duel-bonuses").hidden = true;
    canvas.hidden = true;
    $("duel-drag-area").hidden = true;
    $("duel-hud").hidden = true;
    $("duel-action").hidden = true;
    controls();
  }
  async function leave() {
    if (leaving) return;
    generation++;
    wake.cancel();
    leaving = true;
    controls();
    inactive();
    const live =
      snapshot &&
      !result &&
      client.socket?.readyState === 1 &&
      !client.recovering;
    if (live) {
      // Wait briefly for the server's forfeit result before discarding identity.
      await new Promise((resolve) => {
        const timer = win.setTimeout(() => {
          resolveLeave = null;
          resolve();
        }, 800);
        resolveLeave = () => {
          win.clearTimeout(timer);
          resolveLeave = null;
          resolve();
        };
        client.send({ type: "leave" });
      });
    } else client.send({ type: "leave" });
    client.disconnect();
    ((leaving = false), (lastRequest = null));
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
        !leaving && url && client.hasSession(url) && client.resumeSaved(url);
      if (!recovering)
        status(
          url
            ? invited
              ? `Invitation to ${invited}. Press Join Room to enter.`
              : "Choose how to play."
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
    if (pending || room || leaving || client.recovering) return;
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
    lastRequest = type;
    pending = true;
    status("Waking server…");
    controls();
    onUserGesture();
    try {
      await wake.wake(url);
      if (current !== generation || !active) return;
      await client.connect(url);
      if (current !== generation) return;
      status(
        type === "join"
          ? "Joining room…"
          : type === "practice"
            ? "Preparing bot…"
            : "Creating room…",
      );
      controls();
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
  $("duel-cancel").onclick = cancelRequest;
  $("duel-retry").onclick = () => request(lastRequest);
  $("duel-practice").onclick = () => request("practice");
  $("duel-create").onclick = () => request("create");
  $("duel-connect").onsubmit = (e) => {
    e.preventDefault();
    request("join");
  };
  $("duel-ready").onclick = () => {
    onUserGesture();
    sendControl(
      { type: "ready", ready: !room?.players[client.slot]?.ready },
      "Confirming readiness…",
    );
  };
  $("duel-leave").onclick = async () => {
    if (
      snapshot &&
      !result &&
      !win.confirm("Leave this match? Your opponent wins by forfeit.")
    )
      return;
    await leave();
    status("Choose how to play.");
  };
  function queueAction(type) {
    if (
      !leaving &&
      !panel &&
      !doc.hidden &&
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
  function aim(e) {
    target = Math.max(0, Math.min(1, position(e).x / R.width));
    sync.setTarget(target, now());
    if (now() - receivedAt <= 250) client.input(target);
  }
  let dragId = null;
  const dragArea = $("duel-drag-area");
  dragArea.addEventListener("pointerdown", (e) => {
    if (
      e.isPrimary === false ||
      leaving ||
      panel ||
      doc.hidden ||
      client.recovering ||
      snapshot?.phase !== "playing" ||
      client.socket?.readyState !== 1
    )
      return;
    dragId = e.pointerId;
    dragArea.setPointerCapture(e.pointerId);
    aim(e);
  });
  dragArea.addEventListener("pointermove", (e) => {
    if (
      dragId === e.pointerId &&
      snapshot?.phase === "playing" &&
      !client.recovering &&
      !panel
    )
      aim(e);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    dragArea.addEventListener(type, (e) => {
      if (dragId !== e.pointerId) return;
      dragId = null;
      if (dragArea.hasPointerCapture(e.pointerId))
        dragArea.releasePointerCapture(e.pointerId);
    });
  canvas.addEventListener("pointerdown", (e) => {
    if (
      leaving ||
      panel ||
      doc.hidden ||
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
      !leaving &&
      !panel &&
      !doc.hidden &&
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
      active &&
      !["INPUT", "TEXTAREA"].includes(e.target.tagName) &&
      ["p", "escape"].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
      if (panel) closePanel();
      else if (!e.repeat) $("duel-pause").click();
      return;
    }
    if (
      leaving ||
      panel ||
      doc.hidden ||
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
    dragId = null;
  }
  win.addEventListener("blur", inactive);
  doc.addEventListener("visibilitychange", () => {
    if (!active) return;
    inactive();
    if (doc.hidden) requestPause("background");
    else if (!panel && snapshot?.state.pause)
      sendControl({ type: "resume_play" }, "Resuming match…");
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
          : ["manual", "panel", "background"].includes(pause.reason)
            ? `Paused · ${left}s remaining · ${pause.consents?.[client.slot] ? "Waiting for opponent consent" : "Choose Resume when ready"}`
            : `Waiting for reconnect… ${left}s remaining`,
      );
    } else if (pause && s.phase === "countdown")
      status(
        `Both players connected · resuming in ${Math.ceil(s.state.countdownRemainingMs / 1000)}…`,
      );
    else
      status(
        s.phase === "playing"
          ? room?.practice
            ? "Practice vs bot · first to five"
            : "First to five · drag or ← → / A D"
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
        (win.visualViewport?.height ?? win.innerHeight) -
          canvas.getBoundingClientRect().top -
          60,
      );
      const width = Math.min(
        $("duel-panel").clientWidth || 800,
        (available * R.width) / R.height,
      );
      canvas.style.width = `${Math.floor(width)}px`;
      canvas.style.height = `${Math.floor((width * R.height) / R.width)}px`;
      $("duel-drag-area").style.width = canvas.style.width;
      const stale = !result && now() - receivedAt > 250;
      if (panel || doc.hidden || leaving) inactive();
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
        !leaving &&
        !panel &&
        !doc.hidden &&
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
  function requestPause(reason = "manual") {
    inactive();
    sync.desired = null;
    if (
      snapshot &&
      !result &&
      !client.recovering &&
      client.socket?.readyState === 1
    )
      sendControl({ type: "pause", requested: true, reason }, "Pausing match…");
  }
  function closePanel(consent = true) {
    if (!panel) return;
    panel = null;
    $("duel-info").hidden = true;
    if (consent && !doc.hidden && snapshot && !result)
      sendControl({ type: "resume_play" }, "Resuming match…");
    panelFocus?.focus();
    panelFocus = null;
    inactive();
    controls();
  }
  function openPanel(kind) {
    if (panel) return;
    panelFocus = doc.activeElement;
    panel = kind;
    requestPause("panel");
    $("duel-info-title").textContent =
      kind === "history" ? "DUEL HISTORY" : "DUEL LEGEND";
    const body = $("duel-info-body");
    body.replaceChildren();
    if (kind === "history") {
      const records = history.read();
      const list = doc.createElement("ol");
      list.id = "duel-history-list";
      if (!records.length)
        body.textContent =
          "No completed duels yet. Only server-confirmed results are saved.";
      for (const r of records) {
        const item = doc.createElement("li");
        item.textContent = `${r.outcome.toUpperCase()} · ${r.goalsFor}–${r.goalsAgainst} · ${r.pointsFor} / ${r.pointsAgainst} points · ${r.reason.replaceAll("_", " ")} · ${Math.round(r.durationMs / 1000)}s · wave ${r.waveCount} · ${new Date(r.date).toLocaleString()}`;
        list.append(item);
      }
      body.append(list);
    } else
      body.textContent =
        "First to five goals; brick points do not break ties. Matches end after 15 minutes of active play. Move with drag, mouse, arrows or A/D. Tap your paddle or Space to release held balls and fire; F fires only. Sticky holds for three seconds; bazooka stores up to fifteen shots; two balls stay in play. Returning a ball captures it. A lost ball returns to the conceding paddle and launches after one second, or tap to release sooner. The other ball keeps moving. First to five with a lead wins; simultaneous tied goals continue. Multiball is replaced by gems. Gems give points; Wide and Slow help returns; Repair fixes damage. Shield and Vest stop hazards, never goals. Your drops travel toward you. Pause, panels and background share one 30-second pause per player per rally. Both players must consent to resume, or the timer expires. Panels do not stop play after the pause budget expires.";
    if (kind === "legend" && snapshot) {
      const details = doc.createElement("p");
      details.textContent =
        "Opponent bonuses: " +
        (bonusEntries(snapshot.state.players[1 - client.slot])
          .map((e) => e.label)
          .join(" · ") || "None");
      body.append(details);
    }
    $("duel-info").hidden = false;
    $("duel-info-close").focus();
    controls();
  }
  $("duel-info-close").onclick = () => closePanel();
  $("duel-info").addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      $("duel-info-close").focus();
    }
  });
  $("duel-legend").onclick = () => openPanel("legend");
  $("duel-history").onclick = () => openPanel("history");
  $("duel-pause").onclick = () => {
    if (
      snapshot?.phase === "paused" &&
      ["manual", "panel", "background"].includes(snapshot.state.pause?.reason)
    )
      sendControl({ type: "resume_play" }, "Resuming match…");
    else requestPause();
  };
  $("duel-rematch").onclick = () => {
    inactive();
    sendControl(
      {
        type: "rematch",
        ready: !room?.players[client.slot]?.rematchReady,
      },
      "Confirming rematch…",
    );
  };
  $("duel-result-rematch").onclick = () => $("duel-rematch").click();
  $("duel-result-leave").onclick = () => $("duel-leave").click();
  $("duel-result").addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const rematch = $("duel-result-rematch"),
      leaveButton = $("duel-result-leave");
    (doc.activeElement === rematch || rematch.disabled
      ? leaveButton
      : rematch
    ).focus();
  });
  $("duel-share").onclick = async () => {
    if (!room) return;
    const link = invitationUrl(win.location, room.code);
    const shared = await shareInvitation(win.navigator, link);
    if (shared === "manual") {
      $("duel-invite-link").value = link;
      $("duel-invite-fallback").hidden = false;
      $("duel-invite-link").focus();
      $("duel-invite-link").select();
      if (!result) status("Copy the invitation link below.");
    } else if (shared === "copied" && !result) status("Invitation copied.");
  };
  controls();
  return { client, switchMode, leave, history };
}
