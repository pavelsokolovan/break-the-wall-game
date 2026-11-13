import { multiplayerUrl } from "./online-client.js";
import { ServerWake } from "./server-wake.js";
import {
  ARENA_COLORS,
  ARENA_SIDES,
  arenaPaddle,
} from "../shared/arena-game.js";
import { normalizeRoomCode } from "../shared/duel-rules.js";
export function mountArena({
  onEnter = () => true,
  onExit = () => {},
  document: doc = document,
  window: win = window,
  url = multiplayerUrl(import.meta.env || {}, win.location),
} = {}) {
  const $ = (id) => doc.getElementById(id),
    canvas = $("arena-game"),
    ctx = canvas.getContext("2d");
  let active = false,
    socket = null,
    slot = null,
    room = null,
    pending = false,
    seq = 0,
    generation = 0,
    timer = null,
    heartbeat = null,
    target = null,
    lastInput = -Infinity,
    lastReceived = 0,
    drag = null;
  const wake = new ServerWake({
    fetcher: (...args) => win.fetch(...args),
    onStatus: (text) => status(text),
  });
  function status(text) {
    $("arena-status").textContent = text;
  }
  function controls() {
    for (const id of [
      "arena-create3",
      "arena-create4",
      "arena-join",
      "arena-practice",
      "arena-bots",
    ])
      $(id).disabled = pending || !!room || !url;
    $("arena-code").disabled = pending || !!room;
    $("arena-ready").hidden = !room || !!room.state;
    $("arena-ready").disabled =
      pending ||
      socket?.readyState !== 1 ||
      !room?.players.every((p) => p.connected);
    $("arena-ready").textContent = room?.players[slot]?.ready
      ? "NOT READY"
      : "READY";
    $("arena-leave").hidden = !room && !pending;
    $("arena-setup").hidden = !!room;
    $("arena-loading").hidden = !pending;
    canvas.hidden = !room?.state;
    $("arena-drag").hidden = !room?.state;
  }
  function teardown() {
    generation++;
    wake.cancel();
    win.clearTimeout(timer);
    win.clearInterval(heartbeat);
    if (socket) {
      try {
        if (socket.readyState === 1)
          socket.send(JSON.stringify({ v: 1, type: "leave" }));
      } catch {}
      socket.close();
    }
    socket = null;
    slot = null;
    room = null;
    pending = false;
    target = null;
    drag = null;
    $("arena-members").replaceChildren();
    controls();
  }
  function exit(showSolo = true) {
    if (!active) return;
    teardown();
    active = false;
    $("arena-panel").hidden = true;
    $("arena-mode").setAttribute("aria-pressed", "false");
    if (showSolo) {
      $("solo-panel").hidden = false;
      $("solo-tools").hidden = false;
      $("solo-mode").setAttribute("aria-pressed", "true");
    }
    onExit();
  }
  function enter() {
    if (active) return;
    if (!onEnter()) return;
    active = true;
    $("solo-panel").hidden = true;
    $("solo-tools").hidden = true;
    $("duel-panel").hidden = true;
    $("arena-panel").hidden = false;
    for (const id of ["solo-mode", "online-mode"])
      $(id).setAttribute("aria-pressed", "false");
    $("arena-mode").setAttribute("aria-pressed", "true");
    status(
      url
        ? "Create a 3- or 4-player room, or join a friend's code."
        : "Online server unavailable. Solo remains available.",
    );
    controls();
  }
  function send(message) {
    if (socket?.readyState !== 1) return false;
    socket.send(JSON.stringify({ v: 1, ...message }));
    return true;
  }
  function fail(text) {
    pending = false;
    win.clearTimeout(timer);
    status(text);
    controls();
  }
  function members() {
    const list = $("arena-members");
    list.replaceChildren();
    for (const p of room.players) {
      const node = doc.createElement("span"),
        state = room.state?.players[p.slot];
      node.style.color = ARENA_COLORS[p.slot];
      node.textContent = `${p.slot === slot ? "YOU" : p.bot ? `BOT ${p.slot}` : `P${p.slot + 1}`} ${ARENA_SIDES[p.slot]} · ${state ? `${state.lives} lives · ${state.points} pts` : !p.connected ? "waiting" : p.ready ? "ready" : "not ready"}`;
      list.append(node);
    }
  }
  function receive(message) {
    if (message.type === "arena_error" || message.type === "error") {
      fail(message.message);
      if (message.terminal) {
        socket?.close();
      }
      return;
    }
    if (message.type === "arena_welcome") {
      slot = message.slot;
      seq = 0;
    }
    if (message.type !== "arena") return;
    room = message;
    pending = false;
    win.clearTimeout(timer);
    controls();
    members();
    if (!room.state) {
      status(
        room.players.every((p) => p.connected)
          ? "All players connected. Everyone must press Ready."
          : `Room ${room.code} · share this code · waiting for ${room.count} players`,
      );
      return;
    }
    const s = room.state;
    status(
      s.phase === "finished"
        ? (s.winner === null
            ? "DRAW"
            : s.winner === slot
              ? "YOU WIN!"
              : `PLAYER ${s.winner + 1} WINS`) +
            " · Leave to start another arena."
        : s.phase === "countdown"
          ? `Starting in ${Math.ceil(s.countdown / 60)}…`
          : !s.players[slot].lives
            ? "Eliminated · spectating"
            : `${room.practice ? "Practice · " : ""}You defend ${ARENA_SIDES[slot]} · drag along your side`,
    );
    draw();
  }
  async function request(message) {
    if (pending || room || !url) return;
    pending = true;
    controls();
    const current = ++generation;
    win.clearInterval(heartbeat);
    socket?.close();
    try {
      await wake.wake(url);
      if (current !== generation || !active) return;
      const endpoint = new URL(url);
      endpoint.pathname = "/arena";
      socket = new win.WebSocket(endpoint.href);
      timer = win.setTimeout(() => {
        if (current === generation) {
          socket?.close();
          fail("Arena server did not respond. Retry or play Solo.");
        }
      }, 10000);
      socket.addEventListener("open", () => {
        if (current !== generation) return;
        status("Connecting to arena…");
        lastReceived = performance.now();
        send(message);
        heartbeat = win.setInterval(() => {
          if (performance.now() - lastReceived > 25000) {
            socket.close();
            return;
          }
          send({ type: "ping" });
        }, 10000);
      });
      socket.addEventListener("message", (e) => {
        if (current !== generation) return;
        try {
          const m = JSON.parse(e.data);
          if (m.v !== 1) throw Error();
          lastReceived = performance.now();
          receive(m);
        } catch {
          socket.close();
          fail("Invalid arena server response.");
        }
      });
      socket.addEventListener("error", () => {
        if (current === generation)
          fail(
            "Cannot reach arena server. Check that the latest backend is deployed.",
          );
      });
      socket.addEventListener("close", () => {
        if (current !== generation) return;
        win.clearInterval(heartbeat);
        target = null;
        fail(
          room?.state?.phase === "finished"
            ? $("arena-status").textContent
            : "Connection closed. Arena interrupted. Leave and create another room.",
        );
      });
    } catch (e) {
      if (current === generation) fail(e.message);
    }
  }
  function aim(e) {
    if (
      !room?.state ||
      room.state.phase !== "playing" ||
      !room.state.players[slot].lives
    )
      return;
    const rect =
      e.currentTarget === canvas
        ? canvas.getBoundingClientRect()
        : $("arena-drag").getBoundingClientRect();
    target = Math.max(
      0,
      Math.min(
        1,
        (slot % 2 === 0 || e.currentTarget !== canvas
          ? e.clientX - rect.left
          : e.clientY - rect.top) /
          (slot % 2 === 0 || e.currentTarget !== canvas
            ? rect.width
            : rect.height),
      ),
    );
  }
  for (const element of [canvas, $("arena-drag")]) {
    element.addEventListener("pointerdown", (e) => {
      if (e.isPrimary === false) return;
      drag = e.pointerId;
      element.setPointerCapture(e.pointerId);
      aim(e);
    });
    element.addEventListener("pointermove", (e) => {
      if (drag === e.pointerId || e.pointerType === "mouse") aim(e);
    });
    for (const type of ["pointerup", "pointercancel"])
      element.addEventListener(type, () => (drag = null));
  }
  win.addEventListener("keydown", (e) => {
    if (
      !active ||
      !room?.state ||
      ["INPUT", "BUTTON"].includes(e.target.tagName)
    )
      return;
    const direction = ["ArrowLeft", "ArrowUp", "a"].includes(e.key)
      ? -1
      : ["ArrowRight", "ArrowDown", "d"].includes(e.key)
        ? 1
        : 0;
    if (direction) {
      e.preventDefault();
      target = Math.max(
        0,
        Math.min(
          1,
          (target ?? room.state.players[slot].t / 800) + direction * 0.04,
        ),
      );
    }
  });
  function draw() {
    if (!active || !room?.state) return;
    const s = room.state;
    ctx.fillStyle = "#0c0d20";
    ctx.fillRect(0, 0, 800, 800);
    ctx.lineWidth = 4;
    for (let side = 0; side < 4; side++) {
      ctx.strokeStyle = ARENA_COLORS[side];
      ctx.globalAlpha = s.players[side]?.lives ? 0.4 : 0.15;
      ctx.strokeRect(
        side === 1 ? 796 : 0,
        side === 0 ? 796 : 0,
        side % 2 === 0 ? 800 : 4,
        side % 2 === 0 ? 4 : 800,
      );
      ctx.globalAlpha = 1;
    }
    for (const b of s.bricks) {
      ctx.fillStyle = "#b895ff";
      ctx.fillRect(b.x, b.y, 32, 32);
      ctx.fillStyle = "#dfc9ff";
      ctx.fillRect(b.x + 3, b.y + 3, 26, 4);
    }
    for (const p of s.players) {
      if (!p.lives) continue;
      const g = arenaPaddle(p.slot, p.t);
      ctx.fillStyle = ARENA_COLORS[p.slot];
      ctx.fillRect(
        g.x - (p.slot % 2 === 0 ? 60 : 8),
        g.y - (p.slot % 2 === 0 ? 8 : 60),
        p.slot % 2 === 0 ? 120 : 16,
        p.slot % 2 === 0 ? 16 : 120,
      );
      if (p.slot === slot) {
        ctx.strokeStyle = "#fff";
        ctx.strokeRect(
          g.x - (p.slot % 2 === 0 ? 64 : 12),
          g.y - (p.slot % 2 === 0 ? 12 : 64),
          p.slot % 2 === 0 ? 128 : 24,
          p.slot % 2 === 0 ? 24 : 128,
        );
      }
    }
    for (const b of s.balls) {
      ctx.fillStyle = ARENA_COLORS[b.owner];
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (s.phase !== "playing") {
      ctx.fillStyle = "#050510bb";
      ctx.fillRect(0, 280, 800, 240);
      ctx.fillStyle = "#fff";
      ctx.font = '48px "VT323", monospace';
      ctx.textAlign = "center";
      ctx.fillText(
        s.phase === "countdown"
          ? `GET READY ${Math.ceil(s.countdown / 60)}`
          : s.winner === null
            ? "DRAW"
            : s.winner === slot
              ? "YOU WIN!"
              : `PLAYER ${s.winner + 1} WINS`,
        400,
        400,
      );
    }
  }
  function frame() {
    if (active && room?.state) {
      if (
        target !== null &&
        performance.now() - lastInput >= 1000 / 60 &&
        performance.now() - lastReceived < 250 &&
        send({ type: "input", seq: ++seq, x: target })
      ) {
        lastInput = performance.now();
        target = null;
      }
      const available = Math.max(
          320,
          win.innerHeight - canvas.getBoundingClientRect().top - 65,
        ),
        width = Math.min($("arena-panel").clientWidth, available);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${width}px`;
      $("arena-drag").style.width = `${width}px`;
      draw();
    }
    win.requestAnimationFrame(frame);
  }
  $("arena-mode").onclick = enter;
  $("solo-mode").addEventListener("click", () => exit(true));
  $("online-mode").addEventListener("click", () => exit(false));
  $("arena-practice").onclick = () => {
    const bots = Number($("arena-bots").value);
    if (bots === 1) {
      $("online-mode").click();
      $("duel-practice").click();
    } else request({ type: "practice", bots });
  };
  $("arena-create3").onclick = () => request({ type: "create", count: 3 });
  $("arena-create4").onclick = () => request({ type: "create", count: 4 });
  $("arena-join").onclick = () => {
    const code = normalizeRoomCode($("arena-code").value);
    if (code) request({ type: "join", code });
    else status("Enter a six-character arena room code.");
  };
  $("arena-code").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !$("arena-join").disabled)
      $("arena-join").click();
  });
  $("arena-ready").onclick = () => {
    if (send({ type: "ready", ready: !room.players[slot].ready })) {
      pending = true;
      controls();
      timer = win.setTimeout(
        () => fail("Ready request timed out. Try again."),
        8000,
      );
    }
  };
  $("arena-leave").onclick = () => {
    if (
      room?.state &&
      room.state.phase !== "finished" &&
      !win.confirm("Leave this arena? You will forfeit.")
    )
      return;
    teardown();
    status("Create or join another arena.");
  };
  win.addEventListener("blur", () => (target = null));
  controls();
  win.requestAnimationFrame(frame);
  return { exit };
}
