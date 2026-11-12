import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { ServerWake, healthUrl } from "../src/server-wake.js";
import {
  clientAddressResolver,
  lifecycleLogger,
} from "../server/operations.js";

const ready = { ok: true, v: 1, features: ["duel-paired-v1"] };
const response = (data = ready, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
});

test("health URLs preserve the backend origin, not the Pages base path, and reject credential/query URLs", () => {
  assert.equal(
    healthUrl("wss://duel.example/ws"),
    "https://duel.example/health",
  );
  assert.equal(
    healthUrl("ws://127.0.0.1:3001/ws"),
    "http://127.0.0.1:3001/health",
  );
  for (const url of [
    "https://duel.example/ws",
    "wss://u:p@duel.example/ws",
    "wss://duel.example/ws?token=private",
    "wss://duel.example/path",
  ])
    assert.throws(() => healthUrl(url));
});
test("cold server wake backs off HTML, errors and 5xx without sending tokens or duplicate room requests", async () => {
  let now = 0,
    n = 0;
  const sleeps = [],
    calls = [],
    statuses = [];
  const wake = new ServerWake({
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    onStatus: (s) => statuses.push(s),
    fetcher: async (url, options) => {
      calls.push({ url, options });
      n++;
      if (n === 1) return response("<html>loading</html>");
      if (n === 2) throw Error("network");
      if (n === 3) return response({}, 503);
      return response();
    },
  });
  await wake.wake("wss://duel.example/ws");
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
  assert.equal(calls.length, 4);
  assert.match(statuses[0], /Waking server.*90s/);
  assert(
    calls.every(
      (c) =>
        c.url === "https://duel.example/health" &&
        c.options.credentials === "omit" &&
        c.options.cache === "no-store" &&
        c.options.redirect === "error",
    ),
  );
});
test("incompatible health, missing session capability and origin errors fail once without retry", async () => {
  for (const bad of [
    response({ ok: true, v: 2, features: ready.features }),
    response({ ok: true, v: 1 }),
    response({}, 403),
    response({}, 404),
  ]) {
    let calls = 0;
    const wake = new ServerWake({
      fetcher: async () => {
        calls++;
        return bad;
      },
      sleep: () => assert.fail("must not retry"),
    });
    await assert.rejects(
      wake.wake("wss://duel.example/ws"),
      /incompatible|Cannot access/,
    );
    assert.equal(calls, 1);
  }
});
test("wake has capped 1/2/4/8 backoff and a total deadline for repeated loading responses", async () => {
  let now = 0;
  const sleeps = [];
  const wake = new ServerWake({
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    fetcher: async () => response("loading"),
  });
  await assert.rejects(wake.wake("wss://duel.example/ws"), /90 seconds/);
  assert.equal(now, 90000);
  assert.deepEqual(sleeps.slice(0, 6), [1000, 2000, 4000, 8000, 8000, 8000]);
  assert(sleeps.every((ms) => ms <= 8000));
});
test("hung fetch/body calls are bounded even if the transport ignores abort", async () => {
  let calls = 0;
  const wake = new ServerWake({
    budgetMs: 60,
    attemptMs: 15,
    sleep: async () => {},
    fetcher: () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const start = performance.now();
  await assert.rejects(wake.wake("wss://duel.example/ws"), /90 seconds/);
  assert(performance.now() - start < 1000);
  assert(calls >= 2);
});
test("cancel aborts fetch or backoff immediately; retry ignores old transport completion", async () => {
  let finish, signal;
  const wake = new ServerWake({
    fetcher: (_url, options) => {
      signal = options.signal;
      return new Promise((resolve) => (finish = resolve));
    },
  });
  const first = wake.wake("wss://duel.example/ws");
  wake.cancel();
  assert(signal.aborted);
  await assert.rejects(first, { name: "AbortError" });
  wake.fetcher = async () => response();
  await wake.wake("wss://duel.example/ws");
  finish(response());
  assert.equal(wake.controller, null);
  const waiting = new ServerWake({ fetcher: async () => response({}, 503) });
  const pending = waiting.wake("wss://duel.example/ws");
  await new Promise((r) => setTimeout(r, 5));
  waiting.cancel();
  await assert.rejects(pending, { name: "AbortError" });
});
test("proxy identities require a trusted peer and walk right-to-left; invalid chains fall back", () => {
  const request = (peer, xff) => ({
    socket: { remoteAddress: peer },
    headers: { "x-forwarded-for": xff },
  });
  const direct = clientAddressResolver();
  assert.equal(
    direct(request("::ffff:127.0.0.1", "198.51.100.4")),
    "127.0.0.1",
  );
  const resolve = clientAddressResolver(
    "127.0.0.1/32,10.0.0.0/8,2001:db8:1::/48",
  );
  assert.equal(
    resolve(request("127.0.0.1", "192.0.2.99, 198.51.100.4, 10.2.3.4")),
    "198.51.100.4",
  );
  assert.equal(resolve(request("198.51.100.8", "192.0.2.99")), "198.51.100.8");
  assert.equal(
    resolve(request("2001:db8:1::1", "2001:db8:2::3")),
    "2001:db8:2::3",
  );
  for (const header of [undefined, "bad", "198.51.100.4, bad", "", "1.2.3.4,"])
    assert.equal(resolve(request("127.0.0.1", header)), "127.0.0.1");
  for (const cidr of [
    "*",
    "127.0.0.1",
    "10.0.0.0/33",
    "0.0.0.0/0",
    "::/0",
    "::/129",
    "bad/1",
    "1.2.3.4/24/1",
  ])
    assert.throws(() => clientAddressResolver(cidr));
});
test("lifecycle logging projects only operational metadata and can be disabled", () => {
  const lines = [];
  const log = lifecycleLogger("info", (line) => lines.push(line));
  log("seat_resumed", {
    code: "ABC234",
    matchId: "m",
    token: "private",
    headers: { authorization: "secret" },
    stream: [1, 2],
  });
  assert.deepEqual(JSON.parse(lines[0]), {
    event: "seat_resumed",
    code: "ABC234",
    matchId: "m",
  });
  lifecycleLogger("silent", () => assert.fail())("anything");
  assert.throws(() => lifecycleLogger("debug"));
});
test("release builds accept optional backend configuration and reject malformed nonempty values", () => {
  for (const [url, status] of [
    ["", 0],
    ["wss://duel.example/ws", 0],
    ["ws://localhost:3001/ws", 1],
    ["https://duel.example/ws", 1],
    ["wss://secret@duel.example/ws", 1],
  ]) {
    const r = spawnSync(process.execPath, ["scripts/validate-release.js"], {
      env: { ...process.env, VITE_MULTIPLAYER_URL: url },
      encoding: "utf8",
    });
    assert.equal(r.status, status);
    assert(!r.stderr.includes("secret@"));
  }
});
