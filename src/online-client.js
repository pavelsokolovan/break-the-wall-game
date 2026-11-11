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

/** Connection only. No simulation, persistence or automatic reconnect. */
export class OnlineClient {
  constructor({
    socketFactory = (url) => new WebSocket(url),
    now = () => performance.now(),
    timeoutMs = 8000,
    onMessage = () => {},
    onStatus = () => {},
  } = {}) {
    Object.assign(this, { socketFactory, now, timeoutMs, onMessage, onStatus });
    this.generation = 0;
    this.requestId = 0;
    this.slot = null;
    this.nextSeq = 1;
    this.lastInputAt = -Infinity;
  }
  connect(url) {
    if (this.socket?.readyState === 1) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const generation = ++this.generation;
    this.onStatus("Connecting…");
    this.connecting = new Promise((resolve, reject) => {
      this.rejectConnect = reject;
      let socket;
      try {
        socket = this.socketFactory(url);
        this.socket = socket;
      } catch (e) {
        reject(e);
        return;
      }
      this.connectTimer = setTimeout(() => {
        if (generation === this.generation)
          this.disconnect("Connection timed out. Try again.");
      }, this.timeoutMs);
      socket.addEventListener("open", () => {
        if (generation !== this.generation) return;
        clearTimeout(this.connectTimer);
        this.connecting = null;
        this.rejectConnect = null;
        this.pingTimer = setInterval(
          () =>
            this.send({
              type: "ping",
              id: ++this.requestId,
              clientTime: this.now(),
            }),
          10000,
        );
        this.onStatus("Connected");
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
        if (message.type === "welcome") {
          this.slot = message.slot;
          this.nextSeq = message.nextInputSeq;
          this.lastInputAt = -Infinity;
        }
        if (
          this.pending &&
          message.requestId === this.pending.id &&
          ["welcome", "error"].includes(message.type)
        ) {
          clearTimeout(this.pending.timer);
          const pending = this.pending;
          this.pending = null;
          if (message.type === "error")
            pending.reject(new Error(message.message));
          else pending.resolve(message);
        }
        this.onMessage(message);
      });
      socket.addEventListener("error", () => {
        if (generation === this.generation)
          this.disconnect("Cannot reach the duel server. Try again.");
      });
      socket.addEventListener("close", () => {
        if (generation === this.generation)
          this.disconnect(
            "Connection closed. Match interrupted; create or join a new room.",
          );
      });
    });
    // A synchronous constructor failure must not leave a rejected cached connection.
    const connecting = this.connecting;
    connecting.catch(() => {
      if (generation === this.generation) this.connecting = null;
    });
    return connecting;
  }
  send(message) {
    if (this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify({ v: 1, ...message }));
    return true;
  }
  request(type, fields = {}) {
    if (this.pending)
      return Promise.reject(new Error("A room request is already pending."));
    const id = `r${++this.requestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.disconnect("Room request timed out. Try again."),
        this.timeoutMs,
      );
      this.pending = { id, resolve, reject, timer };
      if (!this.send({ type, requestId: id, ...fields }))
        this.disconnect("Not connected. Try again.");
    });
  }
  input(x, action = "none") {
    if (
      !Number.isFinite(x) ||
      x < 0 ||
      x > 1 ||
      !["none", "release_fire", "fire"].includes(action)
    )
      return false;
    if (this.now() - this.lastInputAt < 1000 / 30) return false;
    if (!this.send({ type: "input", seq: this.nextSeq, x, action }))
      return false;
    this.nextSeq++;
    this.lastInputAt = this.now();
    return true;
  }
  disconnect(message = "Disconnected") {
    this.generation++;
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    const socket = this.socket;
    this.socket = null;
    const rejectConnect = this.rejectConnect;
    this.rejectConnect = null;
    this.connecting = null;
    rejectConnect?.(new Error(message));
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(message));
      this.pending = null;
    }
    this.slot = null;
    if (socket && socket.readyState < 2) socket.close();
    this.onStatus(message);
  }
}
