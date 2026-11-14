import { renderBonuses } from "./bonus-ui.js";
import { mountArena } from "./arena-ui.js";
import { drawPaddleGear, drawShot } from "./weapon-drawing.js";
import { drawDrop } from "./drop-drawing.js";
import { drawBrick } from "./brick-drawing.js";
import { pixelRect } from "./pixel-drawing.js";
import { mountMultiplayer } from "./multiplayer-ui.js";
import { Game, W, H, PADDLE_Y, COLORS, THEMES } from "./game.js";
const $ = (id) => document.getElementById(id),
  canvas = $("game"),
  ctx = canvas.getContext("2d");
let onlineActive = false;
const STORE = "brickfall-blitz:v1";
function readSave() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "{}");
    return {
      best: Number.isFinite(s.best) && s.best >= 0 ? s.best : 0,
      runs: Array.isArray(s.runs)
        ? s.runs
            .filter(
              (r) =>
                r &&
                Number.isFinite(r.score) &&
                Number.isFinite(r.level) &&
                typeof r.win === "boolean",
            )
            .slice(0, 5)
        : [],
      sound: s.sound !== false,
      motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  } catch {
    return {
      best: 0,
      runs: [],
      sound: true,
      motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  }
}
let save = readSave(),
  storageOK = true;
function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify(save));
  } catch {
    storageOK = false;
    $("status").textContent = "STORAGE UNAVAILABLE · SESSION ONLY";
  }
}
let ac;
function audio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume().catch(() => {});
  } catch {
    /* Silent play remains available. */
  }
}
function tone(
  freq,
  duration = 0.08,
  type = "square",
  volume = 0.035,
  delay = 0,
  end = freq,
) {
  if (!save.sound || !ac) return;
  try {
    const o = ac.createOscillator(),
      g = ac.createGain(),
      t = ac.currentTime + delay;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, end), t + duration);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t);
    o.stop(t + duration);
  } catch {}
}
function sound(name) {
  switch (name) {
    case "paddle":
      tone(240, 0.065, "square", 0.025, 0, 500);
      break;
    case "brick":
      tone(650, 0.07, "square", 0.02, 0, 360);
      break;
    case "hit":
      tone(160, 0.045, "triangle");
      break;
    case "wall":
      tone(180, 0.025, "triangle", 0.012);
      break;
    case "pickup":
      [660, 880, 1320].forEach((f, i) =>
        tone(f, 0.1, "square", 0.025, i * 0.065),
      );
      break;
    case "damage":
      tone(140, 0.45, "sawtooth", 0.045, 0, 35);
      break;
    case "explosion":
      tone(95, 0.25, "sawtooth", 0.035, 0, 30);
      break;
    case "clear":
    case "end":
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(f, 0.25, "square", 0.03, i * 0.12),
      );
      break;
    case "fire":
      tone(150, 0.14, "sawtooth", 0.025, 0, 60);
      break;
    case "launch":
      tone(260, 0.12, "square", 0.025, 0, 880);
      break;
    case "shield":
      tone(1300, 0.3, "sine", 0.04, 0, 400);
  }
}
let particles = [],
  popups = [],
  shake = 0,
  flash = 0,
  toastTime = 0,
  t = 0,
  ended = false;
const stars = Array.from({ length: 75 }, (_, i) => ({
  x: (i * 137.3) % W,
  y: (i * 73.7) % H,
  size: i % 7 === 0 ? 2 : 1,
  speed: 3 + (i % 9),
}));
const dropNames = {
  gem: "+500 GEM",
  wide: "WIDE PADDLE · 12s",
  slow: "SLOW BALL -35% · 10s",
  shield: "SHIELD · 15s",
  multi: "TRIPLE BALL!",
  life: "EXTRA LIFE",
  vest: "VEST · 2 HITS",
  sticky: "STICKY · 3 CATCHES",
  bazooka: "BAZOOKA · +5 SHOTS",
};
function burst(x, y, color, count = 14) {
  if (!save.motion) return;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2,
      s = 40 + Math.random() * 220;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.35 + Math.random() * 0.5,
      max: 0.85,
      size: 2 + Math.random() * 4,
      color,
    });
  }
  if (particles.length > 450) particles.splice(0, particles.length - 450);
}
function toast(text) {
  $("toast").textContent = text;
  toastTime = 1.6;
  $("toast").classList.add("visible");
}
const game = new Game({
  event(name, data) {
    sound(name);
    switch (name) {
      case "brick":
        burst(data.x + data.w / 2, data.y + data.h / 2, data.color, 18);
        popups.push({
          x: data.x + data.w / 2,
          y: data.y,
          text: "+" + data.points,
          life: 0.7,
          color: data.color,
        });
        break;
      case "explosion":
        burst(data.x + data.w / 2, data.y + data.h / 2, "#ffb570", 40);
        shake = save.motion ? 7 : 0;
        break;
      case "paddle":
        burst(data.x, data.y, "#d3fa65", 5);
        break;
      case "stick":
        toast("BALL HELD · TAP PADDLE TO RELEASE");
        sound("pickup");
        break;
      case "fire":
        burst(data.x, data.y, "#ffb570", 8);
        break;
      case "intercept":
        sound("explosion");
        burst(data.x, data.y, "#ffb570", 25);
        break;
      case "pickup":
        toast(dropNames[data.type]);
        burst(data.x, PADDLE_Y, "#c49aff", 20);
        break;
      case "shield":
        toast("SHIELD BLOCKED THE HIT");
        burst(game.paddle.x, PADDLE_Y, "#66dfd1", 35);
        break;
      case "vest-block":
        toast(`VEST · ${data.charges} HITS LEFT`);
        sound("shield");
        burst(game.paddle.x, PADDLE_Y, "#ffb570", 25);
        break;
      case "damage":
        shake = save.motion ? 13 : 0;
        flash = 0.3;
        toast(
          data.reason !== "miss"
            ? `${data.reason.toUpperCase()} HIT · SPEED +12%`
            : "BALL LOST · SPEED +12%",
        );
        break;
      case "clear":
        showOverlay(
          "WALL DEMOLISHED",
          `LEVEL ${String(game.level).padStart(2, "0")} CLEAR`,
          `+${data.bonus.toLocaleString()} points`,
          "NEXT LEVEL ↗",
          "Score saved. Keep the streak alive.",
        );
        break;
      case "end":
        finish(data.win);
        break;
      case "level":
        $("status").textContent = THEMES[game.level - 1];
        break;
    }
  },
});
function showOverlay(kicker, title, copy, button, foot = "") {
  $("overlay").hidden = false;
  $("overlay-kicker").textContent = kicker;
  $("overlay-title").textContent = title;
  $("overlay-copy").textContent = copy;
  $("overlay-copy").hidden = !copy;
  $("primary").textContent = button;
  $("overlay-foot").textContent = foot;
  $("secondary").hidden = !["paused", "over", "victory"].includes(game.state);
  $("primary").focus({ preventScroll: true });
}
function hideOverlay() {
  $("overlay").hidden = true;
  canvas.focus({ preventScroll: true });
}
function renderRecords() {
  const list = $("records");
  list.replaceChildren();
  if (!save.runs.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Your next run starts the story.";
    list.append(li);
  }
  save.runs.forEach((r, i) => {
    const li = document.createElement("li"),
      label = document.createElement("span"),
      score = document.createElement("b");
    label.textContent = `${String(i + 1).padStart(2, "0")} ${r.win ? "WIN" : "LV " + String(r.level).padStart(2, "0")}`;
    score.textContent = String(r.score).padStart(6, "0");
    li.append(label, score);
    list.append(li);
  });
}
function finish(win) {
  if (ended) return;
  ended = true;
  save.best = Math.max(save.best, game.score);
  save.runs.unshift({
    score: game.score,
    level: game.level,
    win,
    date: new Date().toISOString(),
    seconds: Math.round(game.elapsed),
    ...game.stats,
  });
  save.runs = save.runs.slice(0, 5);
  persist();
  renderRecords();
  showOverlay(
    win ? "YOU BROKE THROUGH" : "EVERY LEGEND MISSES SOMETIMES",
    win ? "WALLS: ZERO. YOU: HERO." : "ONE MORE TRY?",
    `${game.score.toLocaleString()} POINTS · LEVEL ${game.level}/10\n${game.stats.bricks} bricks · ${game.stats.gems} gems · ${Math.floor(game.elapsed / 60)}m ${Math.floor(game.elapsed % 60)}s\n${storageOK ? "Result saved on this device." : "Storage unavailable; result kept for this session."}`,
    "PLAY AGAIN ↗",
    "A fresh paddle. A fresh start.",
  );
}
function start() {
  audio();
  ended = false;
  particles = [];
  popups = [];
  game.start();
  hideOverlay();
}
function pause() {
  if (["playing", "ready"].includes(game.state)) {
    game.beforePause = game.state;
    game.state = "paused";
    game.paddle.vx = 0;
    game.paddle.target = game.paddle.x;
    showOverlay(
      "TAKE A BREATHER",
      "ON A BREAK.",
      "",
      "BACK TO THE BLITZ ↗",
      "P / ESC TO RESUME",
    );
  } else if (game.state === "paused") {
    game.state = game.beforePause;
    hideOverlay();
  }
}
$("primary").onclick = () => {
  audio();
  if (
    game.state === "title" ||
    game.state === "over" ||
    game.state === "victory"
  )
    start();
  else if (game.state === "paused") pause();
  else if (game.state === "clear") {
    game.level++;
    game.nextLevel();
    hideOverlay();
  }
};
$("secondary").onclick = () => {
  if (
    game.state === "paused" &&
    !window.confirm("End this run and return to the menu?")
  )
    return;
  if (game.state === "paused") finish(false);
  game.state = "title";
  showOverlay(
    "INSERT A LITTLE COURAGE",
    "BREAK THE WALL",
    "",
    "LET’S PLAY ↗",
    "← → MOVE / SPACE TO LAUNCH",
  );
};
$("pause").onclick = pause;
$("mobile-pause").onclick = pause;
$("launch").onclick = () => {
  audio();
  if (game.state === "title") start();
  else game.action();
};
function settings() {
  $("sound").textContent = save.sound ? "♪ SOUND ON" : "♪ SOUND OFF";
  $("sound").setAttribute("aria-pressed", String(save.sound));
}
$("sound").onclick = () => {
  audio();
  save.sound = !save.sound;
  persist();
  settings();
  if (save.sound) sound("pickup");
};
const panel = $("info-panel");
let panelSource,
  panelWasActive = false;
function openInfo(kind) {
  panelSource = document.activeElement;
  panelWasActive = ["ready", "playing"].includes(game.state);
  if (panelWasActive) pause();
  keys.clear();
  $("legend-content").hidden = kind !== "legend";
  $("scores-content").hidden = kind !== "scores";
  $("info-title").textContent = kind === "legend" ? "LEGEND" : "SCORES";
  panel.hidden = false;
  document.querySelector(".shell").inert = true;
  $("close-info").focus();
}
function closeInfo() {
  panel.hidden = true;
  document.querySelector(".shell").inert = false;
  if (panelWasActive && game.state === "paused") pause();
  panelSource?.focus({ preventScroll: true });
}
$("legend-button").onclick = () => openInfo("legend");
$("scores-button").onclick = () => openInfo("scores");
$("close-info").onclick = closeInfo;
panel.onclick = (e) => {
  if (e.target === panel) closeInfo();
};
const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (onlineActive) return;
  if (!panel.hidden) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeInfo();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      $("close-info").focus();
    }
    return;
  }
  if (e.target instanceof HTMLButtonElement && [" ", "Enter"].includes(e.key))
    return;
  const key = e.key.toLowerCase();
  if (
    ["arrowleft", "arrowright", " ", "a", "d", "f", "p", "escape"].includes(key)
  )
    e.preventDefault();
  if (e.repeat && [" ", "f", "p", "escape"].includes(key)) return;
  keys.add(key);
  if (key === " ") {
    audio();
    if (
      game.state === "title" ||
      game.state === "over" ||
      game.state === "victory"
    )
      start();
    else if (game.state === "clear") $("primary").click();
    else game.action();
  }
  if (key === "f") {
    audio();
    game.fire();
  }
  if (key === "p" || key === "escape") pause();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
function backgroundPause() {
  keys.clear();
  if (["playing", "ready"].includes(game.state)) pause();
}
window.addEventListener("blur", backgroundPause);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) backgroundPause();
});
function pointer(e) {
  const r = canvas.getBoundingClientRect();
  game.move(((e.clientX - r.left) / r.width) * W);
}
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse" || canvas.hasPointerCapture(e.pointerId))
    pointer(e);
});
const dragArea = $("solo-drag-area");
let dragPointer = null;
dragArea.addEventListener("pointerdown", (e) => {
  if (e.isPrimary === false) return;
  dragPointer = e.pointerId;
  dragArea.setPointerCapture(e.pointerId);
  pointer(e);
});
dragArea.addEventListener("pointermove", (e) => {
  if (dragPointer === e.pointerId) pointer(e);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  dragArea.addEventListener(type, (e) => {
    if (dragPointer !== e.pointerId) return;
    dragPointer = null;
    if (dragArea.hasPointerCapture(e.pointerId))
      dragArea.releasePointerCapture(e.pointerId);
  });
let paddleTap;
canvas.addEventListener("pointerdown", (e) => {
  audio();
  const r = canvas.getBoundingClientRect(),
    x = ((e.clientX - r.left) / r.width) * W,
    y = ((e.clientY - r.top) / r.height) * H;
  paddleTap = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    time: performance.now(),
    onPad:
      Math.abs(x - game.paddle.x) <= game.paddle.w / 2 + 16 &&
      y >= PADDLE_Y - 26 &&
      y <= PADDLE_Y + 36,
  };
  pointer(e);
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === "mouse" && game.state === "ready") game.launch();
});
canvas.addEventListener("pointerup", (e) => {
  if (
    paddleTap?.id === e.pointerId &&
    paddleTap.onPad &&
    Math.hypot(e.clientX - paddleTap.x, e.clientY - paddleTap.y) < 12 &&
    performance.now() - paddleTap.time < 500
  )
    game.action();
  paddleTap = null;
});
canvas.addEventListener("pointercancel", () => {
  paddleTap = null;
});
function rect(x, y, w, h, color) {
  pixelRect(ctx, x, y, w, h, color);
}
function label(text, x, y, color, size = 12, align = "center") {
  ctx.font = `${size * 1.35}px "VT323", monospace`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, Math.round(x), Math.round(y));
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  rect(0, 0, W, H, "#0b0b1b");
  for (const star of stars) {
    const y = (star.y + t * star.speed) % H;
    rect(
      star.x,
      y,
      star.size,
      star.size,
      star.size === 2 ? "#79748a88" : "#514c6a66",
    );
  }
  ctx.strokeStyle = "#24213e55";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.save();
  if (shake > 0 && save.motion)
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  for (const b of game.bricks) drawBrick(ctx, b);
  if (game.combo >= 5) {
    label(
      `${Math.min(4, 1 + Math.floor(game.combo / 5))}× COMBO`,
      W / 2,
      380,
      "#d3fa65",
      22,
    );
    label(`${game.combo} BRICKS IN A ROW`, W / 2, 401, "#9891aa", 10);
  }
  for (const d of game.drops) drawDrop(ctx, d, { time: t });
  for (const shot of game.shots) drawShot(ctx, shot);
  const p = game.paddle;
  ctx.shadowColor = "#d3fa65";
  ctx.shadowBlur = save.motion ? 16 : 0;
  rect(p.x - p.w / 2, PADDLE_Y, p.w, 18, "#d3fa65");
  ctx.shadowBlur = 0;
  rect(p.x - p.w / 2 + 4, PADDLE_Y + 3, p.w - 8, 3, "#f3ffc4");
  rect(p.x - p.w / 2, PADDLE_Y, 10, 18, "#88b73f");
  rect(p.x + p.w / 2 - 10, PADDLE_Y, 10, 18, "#88b73f");
  drawPaddleGear(
    ctx,
    { x: p.x, y: PADDLE_Y, w: p.w, h: 18 },
    { ammo: game.ammo, stickyCharges: game.stickyCharges },
  );
  if (game.vestCharges > 0) {
    for (let k = 0; k < game.vestCharges; k++)
      rect(p.x - 14 + k * 18, PADDLE_Y + 5, 12, 9, "#be6b35");
  }
  if (game.powers.shield > 0) {
    ctx.strokeStyle = "#66dfd1";
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - p.w / 2 - 10, PADDLE_Y - 7, p.w + 14, 32);
  }
  for (const b of game.balls) {
    if (save.motion)
      b.trail.forEach((q, i) => {
        ctx.globalAlpha = (1 - i / 9) * 0.3;
        rect(q.x - 4, q.y - 4, 8, 8, "#d3fa65");
      });
    ctx.globalAlpha = 1;
    ctx.shadowColor = "#eaffb8";
    ctx.shadowBlur = save.motion ? 15 : 0;
    rect(b.x - 6, b.y - 10, 12, 20, "#f5ffe3");
    rect(b.x - 10, b.y - 6, 20, 12, "#f5ffe3");
    ctx.shadowBlur = 0;
    rect(b.x - 3, b.y - 4, 4, 4, "#fff");
  }
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life / 0.3);
    rect(p.x, p.y, p.size, p.size, p.color);
  }
  ctx.globalAlpha = 1;
  for (const p of popups) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    label(p.text, p.x, p.y, p.color, 13);
  }
  ctx.globalAlpha = 1;
  if (game.state === "ready") {
    label("↑", game.paddle.x, PADDLE_Y - 64, "#d3fa65", 25);
    label("CLICK / SPACE / TAP LAUNCH", W / 2, 500, "#d3fa65", 12);
  }
  ctx.strokeStyle = "#ff76954d";
  ctx.setLineDash([4, 7]);
  ctx.beginPath();
  ctx.moveTo(20, H - 40);
  ctx.lineTo(W - 20, H - 40);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  if (flash > 0) {
    ctx.globalAlpha = flash;
    rect(0, 0, W, H, "#ff335f");
    ctx.globalAlpha = 1;
  }
}
let last = performance.now(),
  acc = 0,
  previousScore = -1;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  t += dt;
  const active = ["playing", "ready"].includes(game.state);
  if (active) {
    acc += dt;
    while (acc >= 1 / 120) {
      game.update(
        1 / 120,
        (keys.has("arrowright") || keys.has("d") ? 1 : 0) -
          (keys.has("arrowleft") || keys.has("a") ? 1 : 0),
      );
      acc -= 1 / 120;
    }
  } else acc = 0;
  if (game.state !== "paused") {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const p of popups) {
      p.y -= 35 * dt;
      p.life -= dt;
    }
    popups = popups.filter((p) => p.life > 0);
    shake = Math.max(0, shake - dt * 32);
    flash = Math.max(0, flash - dt);
    toastTime -= dt;
    if (toastTime <= 0) $("toast").classList.remove("visible");
  }
  if (previousScore !== game.score) {
    previousScore = game.score;
    $("score").textContent = String(game.score).padStart(6, "0");
    if (game.score > save.best) {
      save.best = game.score;
      persist();
    }
  }
  $("launch").textContent =
    game.state === "ready"
      ? "↑ LAUNCH BALL"
      : game.balls.some((b) => b.stuck)
        ? "↑ RELEASE / FIRE"
        : game.ammo > 0
          ? `↑ FIRE (${game.ammo})`
          : "↑ LAUNCH BALL";
  $("best").textContent = String(save.best).padStart(6, "0");
  $("level").textContent = `${String(game.level).padStart(2, "0")} / 10`;
  $("lives").textContent =
    game.lives > 0 ? "♥ ".repeat(game.lives).trim() : "—";
  $("lives").setAttribute("aria-label", `${game.lives} lives remaining`);
  const integrity = Math.round((game.baseWidth() / 160) * 100);
  $("integrity").textContent = integrity + "%";
  $("integrity-bar").style.width = integrity + "%";
  $("pause").disabled = !["playing", "ready", "paused"].includes(game.state);
  $("mobile-pause").disabled = $("pause").disabled;
  renderBonuses($("solo-bonuses"), {
    wideRemainingMs: (game.powers.wide || 0) * 1000,
    slowRemainingMs: (game.powers.slow || 0) * 1000,
    shieldRemainingMs: (game.powers.shield || 0) * 1000,
    shieldCharges: game.powers.shield > 0 ? 1 : 0,
    vestCharges: game.vestCharges,
    stickyCharges: game.stickyCharges,
    ammo: game.ammo,
  });
  if (!["playing", "ready"].includes(game.state))
    $("solo-bonuses").hidden = true;
  draw();
  requestAnimationFrame(frame);
}
settings();
renderRecords();
requestAnimationFrame(frame);

const duelUI = mountMultiplayer({
  onModeChange(active) {
    if (active) backgroundPause();
    onlineActive = active;
    $("online-options").hidden = !active;
    $("duel-mode").setAttribute("aria-pressed", String(active));
  },
  onUserGesture: audio,
  onSound: sound,
});

mountArena({
  onEnter() {
    duelUI.switchMode(false);
    if (!$("duel-panel").hidden) return false;
    backgroundPause();
    onlineActive = true;
    return true;
  },
  onExit() {
    onlineActive = !$("duel-panel").hidden;
  },
});
