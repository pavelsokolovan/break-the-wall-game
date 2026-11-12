import { parseClientMessage } from "../shared/duel-protocol.js";

export { parseClientMessage };
export const LIMITS = Object.freeze({
  rooms: 20,
  sockets: 100,
  payloadBytes: 8192,
  bufferedBytes: 65536,
});

/** Monotonic token bucket. No timers or unbounded history. */
export class Bucket {
  constructor(capacity, perSecond, now) {
    this.capacity = capacity;
    this.rate = perSecond / 1000;
    this.tokens = capacity;
    this.last = now;
  }
  take(now) {
    this.tokens = Math.min(
      this.capacity,
      this.tokens + Math.max(0, now - this.last) * this.rate,
    );
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
export function send(socket, message) {
  if (!socket || socket.readyState !== 1) return false;
  if (socket.bufferedAmount > LIMITS.bufferedBytes) {
    socket.close(1013, "Connection too slow");
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}
export function error(socket, code, message, requestId, terminal = false) {
  send(socket, {
    v: 1,
    type: "error",
    code,
    message,
    ...(requestId ? { requestId } : {}),
    ...(terminal ? { terminal: true } : {}),
  });
}
