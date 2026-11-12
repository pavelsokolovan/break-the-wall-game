import { multiplayerUrl } from "./online-client.js";
import { PROTOCOL_VERSION, SESSION_FEATURE } from "../shared/duel-rules.js";

const aborted = () =>
  Object.assign(new Error("Server wake-up cancelled."), { name: "AbortError" });
export function healthUrl(websocketUrl) {
  if (!multiplayerUrl({ DEV: true, VITE_MULTIPLAYER_URL: websocketUrl }))
    throw new Error("Invalid multiplayer server URL.");
  const url = new URL(websocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/health";
  return url.href;
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(aborted());
    const cancel = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
const terminal = (message) =>
  Object.assign(new Error(message), { terminal: true });
/** Explicit create/join preflight only. No tokens, sockets or room requests. */
export class ServerWake {
  constructor({
    fetcher = (...args) => fetch(...args),
    now = () => performance.now(),
    sleep = delay,
    budgetMs = 90000,
    attemptMs = 8000,
    onStatus = () => {},
  } = {}) {
    Object.assign(this, { fetcher, now, sleep, budgetMs, attemptMs, onStatus });
    this.controller = null;
  }
  cancel() {
    this.controller?.abort();
    this.controller = null;
  }
  async attempt(url, signal, timeout) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal.aborted) throw aborted();
    signal.addEventListener("abort", cancel, { once: true });
    let rejectAbort;
    const cancelled = new Promise((_, reject) => {
      rejectAbort = () => reject(aborted());
    });
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    const timer = setTimeout(cancel, timeout);
    try {
      return await Promise.race([
        cancelled,
        (async () => {
          const response = await this.fetcher(url, {
            signal: controller.signal,
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
          });
          if ([400, 401, 403, 404].includes(response.status))
            throw terminal(
              "Cannot access the multiplayer server. Check its URL and allowed site origin, then retry.",
            );
          if (!response.ok) return false;
          const text = await response.text();
          if (text.length > 4096) return false;
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            return false;
          }
          if (data?.ok !== true) return false;
          if (
            data.v !== PROTOCOL_VERSION ||
            !Array.isArray(data.features) ||
            !data.features.includes(SESSION_FEATURE)
          )
            throw terminal(
              "Server and game versions are incompatible. Refresh the game or retry after the server update.",
            );
          return true;
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", rejectAbort);
    }
  }
  async wake(websocketUrl) {
    this.cancel();
    const url = healthUrl(websocketUrl),
      controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal,
      deadline = this.now() + this.budgetMs;
    let attempt = 0;
    try {
      while (!signal.aborted && this.now() < deadline) {
        this.onStatus(
          `Waking server… ${Math.ceil((deadline - this.now()) / 1000)}s remaining`,
        );
        try {
          if (
            await this.attempt(
              url,
              signal,
              Math.min(this.attemptMs, deadline - this.now()),
            )
          ) {
            if (signal.aborted) throw aborted();
            if (this.now() >= deadline) break;
            return;
          }
        } catch (e) {
          if (signal.aborted) throw aborted();
          if (e.terminal) throw e;
          // Loading HTML, unavailable service, request timeout or network failure: back off.
        }
        const left = deadline - this.now();
        if (left <= 0) break;
        await this.sleep(
          Math.min(left, 1000 * 2 ** Math.min(attempt++, 3)),
          signal,
        );
      }
      if (signal.aborted) throw aborted();
      throw new Error(
        "Server did not wake within 90 seconds. Retry or play Solo.",
      );
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}
