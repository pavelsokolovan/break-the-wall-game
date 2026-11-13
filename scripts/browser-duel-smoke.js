/** Optional real-browser smoke test. Requires Chromium; not part of npm test. */
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createDuelServer } from "../server/index.js";
import { createServer } from "vite";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), "brickfall-chrome-"));
let chrome, vite, app, cdp, gateway;
let healthReady = false,
  healthRequests = 0;
try {
  app = await createDuelServer({
    host: "127.0.0.1",
    port: 0,
    origins: ["http://127.0.0.1:5173"],
  });
  // Simulate Render's loading response without exposing a production fixture route.
  gateway = createHttpServer((request, response) => {
    if (request.url === "/health") {
      healthRequests++;
      if (!healthReady) {
        response.writeHead(503, {
          "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
          "Content-Type": "text/html",
        });
        response.end("<html>Waking server</html>");
        return;
      }
    }
    app.server.emit("request", request, response);
  });
  gateway.on("upgrade", (request, socket, head) =>
    app.server.emit("upgrade", request, socket, head),
  );
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  process.env.VITE_MULTIPLAYER_URL = `ws://127.0.0.1:${gateway.address().port}/ws`;
  vite = await createServer({
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    logLevel: "error",
  });
  await vite.listen();
  chrome = spawn(
    process.env.CHROMIUM || "/usr/bin/chromium",
    [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let endpoint;
  for (let i = 0; i < 100; i++) {
    try {
      const [port, path] = (
        await readFile(join(profile, "DevToolsActivePort"), "utf8")
      )
        .trim()
        .split("\n");
      endpoint = `ws://127.0.0.1:${port}${path}`;
      break;
    } catch {
      await wait(50);
    }
  }
  assert(endpoint, "Chromium did not expose its debugging endpoint");
  cdp = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    cdp.once("open", resolve);
    cdp.once("error", reject);
  });
  let nextId = 0;
  const pending = new Map(),
    exceptions = [];
  cdp.on("message", (data) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error
        ? request.reject(new Error(JSON.stringify(message.error)))
        : request.resolve(message.result);
    }
  });
  function command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 10000);
      pending.set(id, { resolve, reject, timer });
      cdp.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }
  async function evaluate(page, expression) {
    const result = await command(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      page,
    );
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function until(page, expression, timeout = 10000) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      if (await evaluate(page, expression)) return;
      await wait(30);
    }
    const details = await evaluate(
      page,
      "JSON.stringify({status:document.getElementById('duel-status')?.textContent,hidden:document.hidden,rect:document.getElementById('duel-game')?.getBoundingClientRect().toJSON()})",
    );
    try {
      await command("Page.bringToFront", {}, page);
      const screenshot = await command(
        "Page.captureScreenshot",
        { format: "png" },
        page,
      );
      await writeFile(
        "/tmp/brickfall-stage9-failure.png",
        Buffer.from(screenshot.data, "base64"),
      );
    } catch {
      // Preserve the failed assertion even if diagnostic capture is unavailable.
    }
    throw new Error(`Browser condition timed out: ${expression}; ${details}`);
  }
  async function page() {
    const { targetId } = await command("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await command("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await command("Page.enable", {}, sessionId);
    await command(
      "Emulation.setFocusEmulationEnabled",
      { enabled: true },
      sessionId,
    );
    await command("Runtime.enable", {}, sessionId);
    await command(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
      sessionId,
    );
    await command(
      "Page.navigate",
      { url: "http://127.0.0.1:5173/" },
      sessionId,
    );
    await until(
      sessionId,
      "typeof document.getElementById('online-mode')?.onclick === 'function'",
    );
    return sessionId;
  }
  const a = await page(),
    b = await page();
  for (const p of [a, b])
    await evaluate(p, "document.getElementById('online-mode').click()");
  assert.equal(healthRequests, 0, "Selecting a mode must not wake the server");
  assert(
    await evaluate(
      a,
      "document.querySelectorAll('.mode-selector > button').length===2 && !document.getElementById('online-options').hidden && document.getElementById('arena-mode').parentElement.id==='online-options'",
    ),
    "Arena is nested under Online Duel",
  );
  await evaluate(a, "document.getElementById('duel-create').click()");
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('Waking server')",
  );
  await wait(150);
  assert(healthRequests > 0);
  assert.equal(app.manager.rooms.size, 0);
  await command("Page.bringToFront", {}, a);
  const waking = await command("Page.captureScreenshot", { format: "png" }, a);
  await writeFile(
    "/tmp/brickfall-stage9-waking.png",
    Buffer.from(waking.data, "base64"),
  );
  await evaluate(
    a,
    "document.getElementById('duel-cancel').click();document.getElementById('solo-mode').click()",
  );
  const cancelledHealth = healthRequests;
  await wait(1100);
  assert.equal(healthRequests, cancelledHealth);
  assert(await evaluate(a, "!document.getElementById('solo-panel').hidden"));
  healthReady = true;
  await evaluate(
    a,
    "document.getElementById('online-mode').click();document.getElementById('duel-create').click()",
  );
  await until(
    a,
    "document.getElementById('duel-room-code').textContent.length === 6",
  );
  const code = await evaluate(
    a,
    "document.getElementById('duel-room-code').textContent",
  );
  await evaluate(
    b,
    `document.getElementById('duel-code').value=${JSON.stringify(code)}; document.getElementById('duel-connect').requestSubmit()`,
  );
  for (const p of [a, b])
    await until(p, "!document.getElementById('duel-ready').disabled");
  for (const p of [a, b])
    await evaluate(p, "document.getElementById('duel-ready').click()");
  for (const p of [a, b])
    await until(p, "!document.getElementById('duel-game').hidden");
  // Verify one canonical brick has matching material pixels in the two rotated views.
  const initialBrick = [...app.manager.rooms.values()][0].game.getState()
    .bricks[0];
  const samples = [];
  for (const [p, slot] of [
    [a, 0],
    [b, 1],
  ]) {
    await command("Page.bringToFront", {}, p);
    await wait(100);
    const x =
      (slot === 0 ? initialBrick.x : 800 - initialBrick.x - initialBrick.w) + 5;
    const y =
      (slot === 0 ? initialBrick.y : 1000 - initialBrick.y - initialBrick.h) +
      10;
    samples.push(
      await evaluate(
        p,
        `Array.from(document.getElementById('duel-game').getContext('2d').getImageData(${x},${y},1,1).data)`,
      ),
    );
  }
  assert.deepEqual(samples[0], samples[1], "Rotated brick material differs");
  assert.notDeepEqual(samples[0], [14, 15, 32, 255], "Brick was not drawn");
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('First to five')",
  );
  for (const [p, normalized] of [
    [a, 0.125],
    [b, 0.875],
  ]) {
    await command("Page.bringToFront", {}, p);
    await wait(100);
    const pos = await evaluate(
      p,
      `(()=>{const r=document.getElementById('duel-game').getBoundingClientRect();return {x:r.left+r.width*${normalized},y:r.top+r.height*.92}})()`,
    );
    await command(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: pos.x, y: pos.y },
      p,
    );
    await until(
      p,
      `(()=>{const c=document.getElementById('duel-game').getContext('2d');const d=c.getImageData(${normalized * 800},925,1,1).data;return d[0]===211&&d[1]===250&&d[2]===101})()`,
    );
  }
  await until(
    a,
    "!document.getElementById('duel-goals').textContent.includes('YOU 0 : 0')",
  );
  const scoreTotal =
    (await evaluate(
      a,
      "parseInt(document.getElementById('duel-points').textContent)",
    )) +
    (await evaluate(
      b,
      "parseInt(document.getElementById('duel-points').textContent)",
    ));
  assert(scoreTotal > 0, "No naturally earned brick points displayed");
  // Force a real transport loss; the browser must reclaim the same seat without
  // exposing its private token or creating a replacement room.
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('First to five')",
  );
  const recoveryRoom = [...app.manager.rooms.values()][0];
  const recoveryMatch = recoveryRoom.game.matchId,
    recoveryPlayer = recoveryRoom.seats[0].playerId,
    previousToken = recoveryRoom.seats[0].token;
  recoveryRoom.seats[0].socket.terminate();
  await until(
    b,
    "document.getElementById('duel-status').textContent.includes('Waiting for reconnect')",
  );
  const frozenState = recoveryRoom.game.getState(),
    frozenTick = recoveryRoom.game.tick;
  await command("Page.bringToFront", {}, b);
  const waiting = await command("Page.captureScreenshot", { format: "png" }, b);
  await writeFile(
    "/tmp/brickfall-stage9-reconnecting.png",
    Buffer.from(waiting.data, "base64"),
  );
  await wait(150);
  assert.equal(recoveryRoom.game.tick, frozenTick);
  assert.deepEqual(recoveryRoom.game.getState(), frozenState);
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('Both players connected')",
  );
  assert.equal(recoveryRoom.game.matchId, recoveryMatch);
  assert.equal(recoveryRoom.seats[0].playerId, recoveryPlayer);
  assert(recoveryRoom.seats[0].token !== previousToken);
  assert.equal(
    await evaluate(a, "document.getElementById('duel-room-code').textContent"),
    code,
  );
  assert(await evaluate(a, "document.getElementById('duel-action').disabled"));
  assert.equal(recoveryRoom.game.tick, frozenTick);
  await command("Page.bringToFront", {}, a);
  const resuming = await command(
    "Page.captureScreenshot",
    { format: "png" },
    a,
  );
  await writeFile(
    "/tmp/brickfall-stage9-resuming.png",
    Buffer.from(resuming.data, "base64"),
  );
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('First to five')",
  );
  // Both resume consents are required; opening a panel spends the same rally budget.
  await evaluate(a, "document.getElementById('duel-pause').click()");
  await until(
    b,
    "document.getElementById('duel-status').textContent.includes('Paused')",
  );
  const pauseTick = recoveryRoom.game.tick;
  await evaluate(a, "document.getElementById('duel-pause').click()");
  await wait(100);
  assert.equal(recoveryRoom.game.tick, pauseTick);
  await evaluate(b, "document.getElementById('duel-pause').click()");
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('First to five')",
  );
  await evaluate(b, "document.getElementById('duel-legend').click()");
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('Paused')",
  );
  assert(await evaluate(b, "!document.getElementById('duel-info').hidden"));
  await evaluate(b, "document.getElementById('duel-info-close').click()");
  await evaluate(a, "document.getElementById('duel-pause').click()");
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('First to five')",
  );
  // Controlled, trusted server fixtures exercise power/armor rendering after natural play.
  // No fixture or mutation endpoint is exposed to browser clients.
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('First to five')",
  );
  const scenarioGame = [...app.manager.rooms.values()][0].game;
  Object.assign(scenarioGame.state.balls[0], { x: 100, y: 200, vx: 0, vy: 0 });
  scenarioGame.state.drops = [];
  for (const player of scenarioGame.state.players) {
    Object.assign(player, {
      x: 400,
      targetX: 400,
      vx: 0,
      damage: 0,
      wideRemainingMs: 0,
      slowRemainingMs: 0,
      shieldRemainingMs: 0,
      shieldCharges: 0,
      vestCharges: 0,
      invulnerabilityRemainingMs: 0,
    });
    scenarioGame.updatePaddleWidth(player);
  }
  const addDrop = (type, owner = 0, fields = {}) =>
    scenarioGame.state.drops.push({
      id: scenarioGame.nextEntityId++,
      type,
      owner,
      x: 400,
      y: owner === 0 ? 906 : 94,
      baseX: fields.x ?? 400,
      motionPhase: 0,
      ...fields,
    });
  const oldPoints = scenarioGame.state.players[0].points;
  addDrop("gem");
  addDrop("shield");
  await command("Page.bringToFront", {}, a);
  await until(
    a,
    `parseInt(document.getElementById('duel-points').textContent)>=${oldPoints + 500}`,
  );
  const shieldPixel =
    "(()=>{const d=document.getElementById('duel-game').getContext('2d').getImageData(400,914,1,1).data;return d[0]===102&&d[1]===223&&d[2]===209})()";
  await until(a, shieldPixel);
  addDrop("bomb");
  await until(a, `!${shieldPixel}`);
  assert.equal(
    scenarioGame.state.players[0].damage,
    0,
    "Shield did not absorb bomb",
  );
  addDrop("rocket");
  addDrop("worm");
  await until(
    a,
    "(()=>{const d=document.getElementById('duel-game').getContext('2d').getImageData(400,914,1,1).data;return d[0]===255&&d[1]===240&&d[2]===174})()",
  );
  assert.equal(
    scenarioGame.state.players[0].damage,
    1,
    "Multiple same-tick hazards caused extra damage",
  );
  addDrop("vest");
  addDrop("wide");
  addDrop("slow");
  addDrop("shield", 1);
  addDrop("bomb", 0, { x: 250, y: 700 });
  addDrop("rocket", 0, { x: 400, y: 680 });
  addDrop("worm", 0, { x: 550, y: 720 });
  addDrop("repair", 1, { x: 300, y: 300 });
  await wait(120);
  assert.equal(scenarioGame.state.players[0].vestCharges, 2);
  assert.equal(scenarioGame.state.players[0].width, 210);
  // Stage 6 trusted fixtures grant pickups; actual F, Space and mobile-button actions
  // must travel through the browser client and server input validation.
  scenarioGame.state.drops = [];
  scenarioGame.state.players[0].ammo = 0;
  scenarioGame.state.shots = [];
  addDrop("sticky");
  addDrop("bazooka");
  await until(
    a,
    "document.getElementById('duel-action').textContent==='FIRE (5)'",
  );
  scenarioGame.state.players[0].stickyCharges = 1;
  Object.assign(scenarioGame.state.balls[0], {
    x: 430,
    y: 905,
    vx: 0,
    vy: 360,
    owner: 1,
    held: false,
  });
  await until(
    a,
    "document.getElementById('duel-action').textContent==='RELEASE / FIRE (5)'",
  );
  assert.equal(scenarioGame.state.players[0].stickyCharges, 0);
  await evaluate(a, "document.getElementById('duel-game').focus()");
  const key = async (value, code, keyCode) => {
    await command(
      "Input.dispatchKeyEvent",
      { type: "keyDown", key: value, code, windowsVirtualKeyCode: keyCode },
      a,
    );
    await command(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key: value, code, windowsVirtualKeyCode: keyCode },
      a,
    );
  };
  await key("f", "KeyF", 70);
  await until(
    a,
    "document.getElementById('duel-action').textContent==='RELEASE / FIRE (4)'",
  );
  assert(scenarioGame.state.balls[0].held, "Fire-only released a held ball");
  await key(" ", "Space", 32);
  await until(
    a,
    "document.getElementById('duel-action').textContent.startsWith('FIRE (')",
  );
  assert(
    !scenarioGame.state.balls[0].held,
    "Space did not release after last catch charge",
  );
  Object.assign(scenarioGame.state.balls[0], { x: 400, y: 800, vx: 0, vy: 0 });
  const countBeforeBonus = scenarioGame.state.balls.length;
  const pointsBeforeBonus = scenarioGame.state.players[0].points;
  addDrop("multi");
  await until(
    a,
    `parseInt(document.getElementById('duel-points').textContent)>=${pointsBeforeBonus + 500}`,
  );
  assert.equal(scenarioGame.state.balls.length, countBeforeBonus);
  for (const ball of scenarioGame.state.balls) {
    ball.vx = 0;
    ball.vy = 0;
  }
  await until(
    a,
    "document.getElementById('duel-action').textContent.startsWith('FIRE (')&&!document.getElementById('duel-action').disabled",
  );
  scenarioGame.state.shots = [];
  const interceptPoints = scenarioGame.state.players[0].points;
  addDrop("bomb", 0, { y: 840 });
  await evaluate(a, "document.getElementById('duel-action').click()");
  await until(
    a,
    `parseInt(document.getElementById('duel-points').textContent)>=${interceptPoints + 100}`,
  );
  assert.equal(scenarioGame.state.players[0].points, interceptPoints + 100);
  // Preserve a snapshot showcase of gear, two balls and mirrored flying shots.
  addDrop("sticky");
  addDrop("bazooka", 1);
  await wait(100);
  Object.assign(scenarioGame.state.balls[0], {
    x: 430,
    y: 905,
    vx: 0,
    vy: 360,
    owner: 1,
    held: false,
  });
  await until(
    a,
    "document.getElementById('duel-action').textContent.startsWith('RELEASE')",
  );
  scenarioGame.state.shots = [
    { id: scenarioGame.nextEntityId++, owner: 0, x: 400, y: 750 },
    { id: scenarioGame.nextEntityId++, owner: 1, x: 600, y: 250 },
  ];
  await wait(100);
  for (const p of [a, b]) {
    const fits = await evaluate(
      p,
      "(()=>{const r=document.getElementById('duel-action').getBoundingClientRect();return r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()",
    );
    assert(fits, "Portrait controls overflow viewport");
  }
  const geometry = await evaluate(
    a,
    `(()=>{
    const field=document.getElementById('duel-game'), action=document.getElementById('duel-action'), bonuses=document.getElementById('duel-bonuses'), status=document.getElementById('duel-status'), loading=document.getElementById('duel-loading');
    const original={action:action.textContent,hidden:bonuses.hidden,html:bonuses.innerHTML,status:status.textContent,loading:loading.hidden};
    const before=field.getBoundingClientRect().toJSON();
    action.textContent='RELEASE / FIRE (15)';status.textContent='Waiting for the server to finish a very long connection request';
    bonuses.hidden=false;bonuses.innerHTML='<div class="duel-bonus">SHIELD ×1 15s</div><div class="duel-bonus">STICKY ×3</div><div class="duel-bonus">AMMO ×15</div><div class="duel-bonus">WIDE 12s</div>';loading.hidden=false;
    const after=field.getBoundingClientRect().toJSON();
    action.textContent=original.action;bonuses.hidden=original.hidden;bonuses.innerHTML=original.html;status.textContent=original.status;loading.hidden=original.loading;
    return {before,after};
  })()`,
  );
  assert.deepEqual(
    geometry.after,
    geometry.before,
    "Live toolbar/bonus/loading changes resized the field",
  );
  const portrait = await command(
    "Page.captureScreenshot",
    { format: "png" },
    a,
  );
  await writeFile(
    "/tmp/brickfall-stage9-portrait.png",
    Buffer.from(portrait.data, "base64"),
  );
  await command(
    "Emulation.setDeviceMetricsOverride",
    { width: 844, height: 390, deviceScaleFactor: 1, mobile: true },
    a,
  );
  await wait(150);
  assert(
    await evaluate(
      a,
      "document.getElementById('duel-action').getBoundingClientRect().bottom<=innerHeight",
    ),
    "Landscape controls overflow",
  );
  const landscape = await command(
    "Page.captureScreenshot",
    { format: "png" },
    a,
  );
  await writeFile(
    "/tmp/brickfall-stage9-landscape.png",
    Buffer.from(landscape.data, "base64"),
  );
  const previousMatch = scenarioGame.matchId;
  scenarioGame.finish(1, "five_goals");
  app.manager.flush(recoveryRoom, true);
  await until(
    b,
    "document.getElementById('duel-status').textContent.includes('YOU WIN')",
  );
  for (const p of [a, b]) {
    await evaluate(p, "document.getElementById('duel-history').click()");
    assert(
      await evaluate(
        p,
        "document.getElementById('duel-history-list').children.length === 1",
      ),
    );
    await evaluate(p, "document.getElementById('duel-info-close').click()");
    await evaluate(p, "document.getElementById('duel-rematch').click()");
  }
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('Get ready')",
  );
  assert.notEqual(recoveryRoom.game.matchId, previousMatch);
  assert.equal(recoveryRoom.seats[1].playerId, recoveryPlayer);
  assert.deepEqual(recoveryRoom.game.state.goals, [0, 0]);
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('First to five')",
  );
  await evaluate(
    a,
    "window.confirm=()=>true;document.getElementById('duel-leave').click()",
  );
  await until(
    b,
    "document.getElementById('duel-status').textContent.includes('YOU WIN')",
  );
  for (const p of [a, b]) {
    await evaluate(
      p,
      "document.getElementById('solo-mode').click();document.getElementById('primary').click()",
    );
    assert(
      await evaluate(
        p,
        "!document.getElementById('solo-panel').hidden && document.getElementById('overlay').hidden",
      ),
    );
  }
  // One page can enter a real server-hosted practice match without a second user.
  await evaluate(
    a,
    "document.getElementById('online-mode').click();document.getElementById('duel-practice').click()",
  );
  await until(a, "!document.getElementById('duel-ready').disabled");
  await evaluate(a, "document.getElementById('duel-ready').click()");
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('Practice vs bot')",
  );
  const practiceRoom = [...app.manager.rooms.values()].find((room) => room.bot);
  assert(practiceRoom);
  await wait(600);
  assert(
    practiceRoom.game.state.players[practiceRoom.bot.slot].lastAckInputSeq > 0,
  );
  await evaluate(a, "document.getElementById('duel-pause').click()");
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('Paused')",
  );
  await evaluate(a, "document.getElementById('duel-pause').click()");
  await until(
    a,
    "document.getElementById('duel-status').textContent.includes('Practice vs bot')",
  );
  await command("Page.bringToFront", {}, a);
  const practiceShot = await command(
    "Page.captureScreenshot",
    { format: "png" },
    a,
  );
  await writeFile(
    "/tmp/brickfall-practice.png",
    Buffer.from(practiceShot.data, "base64"),
  );
  await evaluate(
    a,
    "window.confirm=()=>true;document.getElementById('duel-leave').click()",
  );
  await until(a, "document.getElementById('duel-game').hidden");
  assert(!app.manager.rooms.has(practiceRoom.code));
  // Additional square-arena mode uses independent three/four-seat rooms.
  const arenaPages = [a, b, await page(), await page()];
  for (const p of arenaPages)
    await command(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
      p,
    );
  for (const count of [3, 4]) {
    app.manager.ipAttempts.clear(); // Separate test scenarios share one loopback IP.
    for (const p of arenaPages.slice(0, count))
      await evaluate(
        p,
        "document.getElementById('online-mode').click();document.getElementById('arena-mode').click()",
      );
    assert(
      await evaluate(
        a,
        "document.getElementById('online-mode').getAttribute('aria-pressed')==='true' && !document.getElementById('online-options').hidden && document.getElementById('duel-panel').hidden",
      ),
      "Arena keeps Online Duel selected",
    );
    if (count === 3) {
      await command("Page.bringToFront", {}, a);
      const shot = await command(
        "Page.captureScreenshot",
        { format: "png" },
        a,
      );
      await writeFile(
        "/tmp/brickfall-online-menu.png",
        Buffer.from(shot.data, "base64"),
      );
    }
    await evaluate(
      a,
      `document.getElementById('arena-create${count}').click()`,
    );
    await until(
      a,
      "document.getElementById('arena-status').textContent.includes('Room ')",
    );
    const arenaRoom = [...app.arenaManager.rooms.values()].find(
      (r) => r.count === count,
    );
    assert(arenaRoom);
    for (const p of arenaPages.slice(1, count)) {
      await evaluate(
        p,
        `document.getElementById('arena-code').value=${JSON.stringify(arenaRoom.code)};document.getElementById('arena-join').click()`,
      );
      await until(
        p,
        "document.getElementById('arena-status').textContent.includes('Room ')||document.getElementById('arena-status').textContent.includes('All players')",
      );
    }
    for (const p of arenaPages.slice(0, count)) {
      await until(p, "!document.getElementById('arena-ready').disabled");
      await evaluate(p, "document.getElementById('arena-ready').click()");
    }
    await until(
      a,
      "document.getElementById('arena-status').textContent.includes('You defend')",
    );
    assert.equal(arenaRoom.game.balls.length, count);
    assert(
      await evaluate(
        a,
        `(()=>{const r=document.getElementById('arena-game').getBoundingClientRect();return Math.abs(r.width-r.height)<1&&r.width>=320&&r.right<=innerWidth;})()`,
      ),
      "Arena must remain square and usable on a phone",
    );
    for (const [slot, p] of arenaPages.slice(0, count).entries()) {
      await evaluate(
        p,
        `(()=>{const c=document.getElementById('arena-game'),r=c.getBoundingClientRect();c.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:r.left+r.width*.6,clientY:r.top+r.height*.6}));})()`,
      );
    }
    await wait(150);
    assert(arenaRoom.game.players.every((p) => Math.abs(p.t - 480) < 1));
    await command("Page.bringToFront", {}, a);
    const arenaShot = await command(
      "Page.captureScreenshot",
      { format: "png" },
      a,
    );
    await writeFile(
      `/tmp/brickfall-arena-${count}.png`,
      Buffer.from(arenaShot.data, "base64"),
    );
    for (const p of arenaPages.slice(0, count - 1))
      await evaluate(
        p,
        "window.confirm=()=>true;document.getElementById('arena-leave').click()",
      );
    await until(
      arenaPages[count - 1],
      "document.getElementById('arena-status').textContent.includes('YOU WIN')",
    );
    await evaluate(
      arenaPages[count - 1],
      "document.getElementById('arena-leave').click()",
    );
    assert(!app.arenaManager.rooms.has(arenaRoom.code));
    await evaluate(a, "document.getElementById('duel-mode').click()");
    assert(
      await evaluate(
        a,
        "!document.getElementById('duel-panel').hidden && document.getElementById('arena-panel').hidden && !document.getElementById('online-options').hidden",
      ),
      "Nested 2 Players returns to Duel setup",
    );
    for (const p of arenaPages.slice(0, count))
      await evaluate(p, "document.getElementById('solo-mode').click()");
  }
  // One human can select all supported practice sizes through the same selector.
  for (const bots of [1, 2, 3]) {
    app.manager.ipAttempts.clear();
    await evaluate(
      a,
      `document.getElementById('online-mode').click();document.getElementById('arena-mode').click();document.getElementById('arena-bots').value='${bots}';document.getElementById('arena-practice').click()`,
    );
    if (bots === 1) {
      await until(a, "!document.getElementById('duel-ready').disabled");
      await evaluate(a, "document.getElementById('duel-ready').click()");
      await until(
        a,
        "!document.getElementById('duel-game').hidden && document.getElementById('duel-status').textContent.includes('Practice')",
      );
      assert([...app.manager.rooms.values()].some((r) => r.bot));
      await evaluate(
        a,
        "window.confirm=()=>true;document.getElementById('duel-leave').click()",
      );
      await until(a, "document.getElementById('duel-game').hidden");
      assert.equal(app.manager.rooms.size, 0);
    } else {
      await until(
        a,
        "document.getElementById('arena-status').textContent.includes('Practice')",
      );
      const room = [...app.arenaManager.rooms.values()][0];
      assert.equal(room.count, bots + 1);
      assert.equal(room.bots.length, bots);
      await until(
        a,
        `document.getElementById('arena-members').textContent.includes('BOT ${bots}')`,
      );
      await wait(350);
      assert(room.game.players.slice(1).every((p) => p.seq > 0));
      await evaluate(
        a,
        "window.confirm=()=>true;document.getElementById('arena-leave').click()",
      );
      await until(a, "document.getElementById('arena-game').hidden");
      await wait(50);
      assert.equal(app.arenaManager.rooms.size, 0);
    }
    await evaluate(a, "document.getElementById('solo-mode').click()");
  }
  assert.deepEqual(exceptions, [], "Browser runtime exceptions");
  console.log(
    "PASS: two Chromium pages create/join/ready/countdown/move/walls/brick points/goals/result/Solo; fixture pickups/shield/hazards/sticky/points bonus/bazooka; real F/Space/button actions; cold wake/HTML/cancel/Solo/retry; same-seat reconnect/countdown; pause/consent/panel/history/rematch/slot swap; portrait and landscape fit; single-page bot practice/pause/leave; nested online menu; real 3/4-page square arenas; selectable 1/2/3-bot practice; no runtime exceptions.",
  );
  console.log(
    "Screenshots: /tmp/brickfall-stage9-portrait.png, /tmp/brickfall-stage9-landscape.png",
  );
} finally {
  cdp?.close();
  chrome?.kill("SIGTERM");
  await vite?.close();
  await app?.close();
  if (gateway) {
    gateway.closeAllConnections();
    await new Promise((resolve) => gateway.close(resolve));
  }
  await wait(200);
  await rm(profile, { recursive: true, force: true });
}
