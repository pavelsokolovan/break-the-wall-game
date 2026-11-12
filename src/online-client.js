import { validateServerMessage } from "../shared/duel-protocol.js";

export function multiplayerUrl(env = {}, location = globalThis.location) {
  const configured = env.VITE_MULTIPLAYER_URL;
  try {
    const url = new URL(
      configured ||
        (env.DEV
          ? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.hostname}:3001/ws`
          : ""),
    );
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      url.pathname !== "/ws" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    if (!env.DEV && url.protocol !== "wss:") return null;
    return url.href;
  } catch {
    return null;
  }
}

import { ServerClock } from "./duel-sync.js";
import { normalizeRoomCode } from "../shared/duel-rules.js";

export const ONLINE_SESSION_KEY = "brickfall-blitz:duel:session:v1";
/** Transport, private online identity and bounded same-seat recovery. No game rules. */
export class OnlineClient {
  constructor({
    socketFactory = (url) => new WebSocket(url),
    now = () => performance.now(),
    timeoutMs = 8000,
    onMessage = () => {},
    onStatus = () => {},
    onInput = () => {},
    clock = new ServerClock(),
    storage,
    setTimer = (...args) => setTimeout(...args),
    clearTimer = (...args) => clearTimeout(...args),
    setRepeater = (...args) => setInterval(...args),
    clearRepeater = (...args) => clearInterval(...args),
  } = {}) {
    Object.assign(this, {
      socketFactory,
      now,
      timeoutMs,
      onMessage,
      onStatus,
      onInput,
      clock,
      setTimer,
      clearTimer,
      setRepeater,
      clearRepeater,
    });
    try {
      this.storage =
        storage === undefined ? globalThis.sessionStorage : storage;
    } catch {
      this.storage = null;
    }
    this.generation = 0;
    this.requestId = 0;
    this.pingId = 0;
    this.slot = null;
    this.nextSeq = 1;
    this.lastInputAt = -Infinity;
    this.state = "idle";
    this.recovering = false;
    this.session = this.readSession();
    this.pings = new Map();
  }
  readSession() {
    try {
      const s = JSON.parse(this.storage?.getItem(ONLINE_SESSION_KEY) || "null");
      if (
        !s ||
        typeof s.url !== "string" ||
        !multiplayerUrl({ DEV: true, VITE_MULTIPLAYER_URL: s.url }) ||
        normalizeRoomCode(s.code) !== s.code ||
        typeof s.token !== "string" ||
        !s.token.length ||
        s.token.length > 256 ||
        typeof s.playerId !== "string" ||
        !s.playerId.length ||
        s.playerId.length > 128 ||
        ![0, 1].includes(s.slot) ||
        !Number.isSafeInteger(s.nextSeq) ||
        s.nextSeq < 1
      )
        return null;
      return {
        url: s.url,
        code: s.code,
        token: s.token,
        playerId: s.playerId,
        slot: s.slot,
        nextSeq: s.nextSeq,
      };
    } catch {
      return null;
    }
  }
  persist() {
    try {
      if (this.session)
        this.storage?.setItem(ONLINE_SESSION_KEY, JSON.stringify(this.session));
      else this.storage?.removeItem(ONLINE_SESSION_KEY);
    } catch {
      /* In-memory recovery remains available. */
    }
  }
  hasSession(url) {
    return this.session?.url === url;
  }
  connect(url) {
    if (this.socket?.readyState === 1) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.url = url;
    const generation = ++this.generation;
    this.state = this.recovering ? "resuming" : "connecting";
    this.onStatus(
      this.recovering ? "Reconnecting to your room…" : "Connecting…",
    );
    this.connecting = new Promise((resolve, reject) => {
      this.rejectConnect = reject;
      let socket;
      try {
        socket = this.socketFactory(url);
        this.socket = socket;
      } catch (e) {
        this.rejectConnect = null;
        reject(e);
        return;
      }
      this.connectTimer = this.setTimer(() => {
        if (generation === this.generation)
          this.lost("Connection timed out. Try again.");
      }, this.timeoutMs);
      socket.addEventListener("open", () => {
        if (generation !== this.generation) return;
        this.clearTimer(this.connectTimer);
        this.connecting = null;
        this.rejectConnect = null;
        this.lastReceivedAt = this.now();
        this.pingTimer = this.setRepeater(() => {
          if (this.now() - this.lastReceivedAt > 25000)
            this.lost("Server heartbeat timed out.");
          else this.ping();
        }, 10000);
        this.state = this.recovering ? "resuming" : "connected";
        this.onStatus(this.recovering ? "Restoring your seat…" : "Connected");
        resolve();
      });
      socket.addEventListener("message", (event) => {
        if (generation !== this.generation) return;
        let parsed;
        try {
          parsed = validateServerMessage(JSON.parse(event.data));
        } catch {
          parsed = { ok: false };
        }
        if (!parsed.ok) {
          this.disconnect(
            parsed.code === "VERSION_MISMATCH"
              ? parsed.message
              : "Invalid server response.",
          );
          return;
        }
        const message = parsed.value;
        this.lastReceivedAt = this.now();
        if (message.type === "pong") {
          const sent = this.pings.get(message.id);
          if (sent === undefined || sent !== message.clientTime) return;
          this.pings.delete(message.id);
          this.clock.sample(sent, message.serverTime, this.now());
        }
        if (
          (message.type === "snapshot" || message.type === "room") &&
          Number.isFinite(message.serverTime)
        )
          this.clock.observe(message.serverTime, this.now());
        if (message.type === "snapshot") this.matchId = message.matchId;
        if (message.type === "welcome") {
          this.matchId = message.matchId;
          const same =
            !message.rematch && this.session?.playerId === message.playerId;
          this.slot = message.slot;
          this.nextSeq = same
            ? Math.max(this.nextSeq, this.session.nextSeq, message.nextInputSeq)
            : message.nextInputSeq;
          this.lastInputAt = -Infinity;
          this.session = {
            url: this.url,
            code: message.code,
            token: message.token,
            playerId: message.playerId,
            slot: message.slot,
            nextSeq: this.nextSeq,
          };
          this.clearTimer(this.deadlineTimer);
          this.persist();
          this.recovering = false;
          this.recoveryDeadline = null;
          this.retryAttempt = 0;
          this.clearTimer(this.retryTimer);
          this.state = "connected";
          this.ping();
        }
        if (
          this.pending &&
          message.requestId === this.pending.id &&
          ["welcome", "error"].includes(message.type)
        ) {
          this.clearTimer(this.pending.timer);
          const pending = this.pending;
          this.pending = null;
          if (message.type === "error") {
            const e = new Error(message.message);
            e.code = message.code;
            pending.reject(e);
          } else pending.resolve(message);
        }
        this.onMessage(message);
        if (message.type === "error" && message.terminal)
          this.disconnect(message.message);
      });
      socket.addEventListener("error", () => {
        if (generation === this.generation)
          this.lost("Cannot reach the duel server. Try again.");
      });
      socket.addEventListener("close", (event) => {
        if (generation !== this.generation) return;
        if (event.code === 4001)
          this.disconnect("This seat was resumed in another connection.");
        else this.lost("Connection lost.");
      });
    });
    const connecting = this.connecting;
    connecting.catch(() => {
      if (generation === this.generation) this.connecting = null;
    });
    return connecting;
  }
  ping() {
    const id = ++this.pingId,
      at = this.now();
    if (this.send({ type: "ping", id, clientTime: at })) {
      this.pings.set(id, at);
      while (this.pings.size > 4)
        this.pings.delete(this.pings.keys().next().value);
    }
  }
  send(message) {
    if (this.socket?.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify({ v: 1, ...message }));
      return true;
    } catch {
      this.lost("Connection lost.");
      return false;
    }
  }
  request(type, fields = {}) {
    if (this.pending)
      return Promise.reject(new Error("A room request is already pending."));
    const id = `r${++this.requestId}`;
    return new Promise((resolve, reject) => {
      const timer = this.setTimer(
        () => this.lost("Room request timed out. Try again."),
        this.timeoutMs,
      );
      this.pending = { id, resolve, reject, timer };
      if (!this.send({ type, requestId: id, ...fields }))
        this.lost("Not connected. Try again.");
    });
  }
  input(x, action = "none") {
    if (
      this.recovering ||
      !Number.isFinite(x) ||
      x < 0 ||
      x > 1 ||
      !["none", "release_fire", "fire"].includes(action)
    )
      return false;
    if (this.now() - this.lastInputAt < 1000 / 30) return false;
    const seq = this.nextSeq;
    if (
      !this.send({
        type: "input",
        ...(this.matchId ? { matchId: this.matchId } : {}),
        seq,
        x,
        action,
      })
    )
      return false;
    this.nextSeq++;
    this.lastInputAt = this.now();
    if (this.session) {
      this.session.nextSeq = this.nextSeq;
      this.persist();
    }
    this.onInput({ seq, x, at: this.now() });
    return true;
  }
  stopSocket(message) {
    this.generation++;
    this.clearTimer(this.connectTimer);
    this.clearRepeater(this.pingTimer);
    this.pings.clear();
    const socket = this.socket;
    this.socket = null;
    const reject = this.rejectConnect;
    this.rejectConnect = null;
    this.connecting = null;
    reject?.(new Error(message));
    if (this.pending) {
      this.clearTimer(this.pending.timer);
      this.pending.reject(new Error(message));
      this.pending = null;
    }
    if (socket && socket.readyState < 2) socket.close();
  }
  lost(message) {
    this.stopSocket(message);
    if (!this.session || this.session.url !== this.url) {
      this.state = "interrupted";
      this.onStatus(message);
      return;
    }
    this.recovering = true;
    this.state = "reconnecting";
    if (this.recoveryDeadline == null) {
      this.recoveryDeadline = this.now() + 30000;
      this.deadlineTimer = this.setTimer(
        () => this.disconnect("Reconnect timed out. Match interrupted."),
        30000,
      );
    }
    this.scheduleRetry();
  }
  scheduleRetry(immediate = false) {
    this.clearTimer(this.retryTimer);
    const left = this.recoveryDeadline - this.now();
    if (left <= 0) {
      this.disconnect("Reconnect timed out. Match interrupted.");
      return;
    }
    const delay = immediate
      ? 0
      : Math.min(8000, 1000 * 2 ** Math.min(this.retryAttempt || 0, 3));
    this.retryAttempt = (this.retryAttempt || 0) + 1;
    this.onStatus(`Reconnecting… ${Math.ceil(left / 1000)}s remaining`);
    this.retryScheduled = true;
    this.retryTimer = this.setTimer(
      () => {
        this.retryScheduled = false;
        this.tryResume();
      },
      Math.min(delay, left),
    );
  }
  resumeSaved(url) {
    if (!this.hasSession(url) || this.recovering) return false;
    this.url = url;
    this.recovering = true;
    this.state = "reconnecting";
    this.recoveryDeadline = this.now() + 30000;
    this.retryAttempt = 0;
    this.deadlineTimer = this.setTimer(
      () => this.disconnect("Reconnect timed out. Match interrupted."),
      30000,
    );
    this.scheduleRetry(true);
    return true;
  }
  async tryResume() {
    if (!this.recovering) return;
    if (this.now() >= this.recoveryDeadline) {
      this.disconnect("Reconnect timed out. Match interrupted.");
      return;
    }
    const session = this.session;
    try {
      await this.connect(session.url);
      if (!this.recovering || this.session !== session) return;
      await this.request("resume", {
        code: session.code,
        token: session.token,
      });
    } catch (e) {
      if (!this.recovering) return;
      if (
        [
          "AUTH_FAILED",
          "ROOM_NOT_FOUND",
          "ROOM_EXPIRED",
          "VERSION_MISMATCH",
        ].includes(e.code)
      ) {
        this.disconnect(e.message);
        return;
      }
      // A socket error already scheduled the next bounded retry. Request errors need one.
      if (this.socket) this.stopSocket(e.message);
      if (!this.retryScheduled) this.scheduleRetry();
    }
  }
  disconnect(message = "Disconnected") {
    this.clearTimer(this.deadlineTimer);
    this.retryScheduled = false;
    this.recovering = false;
    this.recoveryDeadline = null;
    this.retryAttempt = 0;
    this.clearTimer(this.retryTimer);
    this.stopSocket(message);
    this.session = null;
    this.persist();
    this.slot = null;
    this.matchId = null;
    this.state = "idle";
    this.clock.reset();
    this.onStatus(message);
  }
}
