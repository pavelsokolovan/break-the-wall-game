import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { RoomManager } from "./rooms.js";
import { LIMITS, parseClientMessage, error } from "./protocol.js";

function positiveLimit(value, fallback) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new TypeError("Invalid server resource limit");
  return result;
}
export async function createDuelServer({
  host = "0.0.0.0",
  port = Number(process.env.PORT || 3001),
  origins = (
    process.env.ALLOWED_ORIGINS ||
    (process.env.NODE_ENV === "production"
      ? "https://pavelsokolovan.github.io"
      : "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173")
  )
    .split(",")
    .map((s) => s.trim()),
  now,
  autoSchedule = true,
  maxRooms = positiveLimit(process.env.MAX_ROOMS, LIMITS.rooms),
  maxSockets = positiveLimit(process.env.MAX_SOCKETS, LIMITS.sockets),
} = {}) {
  const allow = new Set(origins);
  for (const origin of allow)
    if (!/^https?:\/\//.test(origin) || new URL(origin).origin !== origin)
      throw new TypeError("Origins must be exact HTTP origins");
  const manager = new RoomManager({ now, maxRooms });
  let closing = false;
  const server = createServer((request, response) => {
    const origin = request.headers.origin;
    if (origin && !allow.has(origin)) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Vary", "Origin");
    if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
    if (request.url === "/health" && request.method === "GET") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ ok: true, v: 1 }));
      return;
    }
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: LIMITS.payloadBytes,
    perMessageDeflate: false,
  });
  server.on("upgrade", (request, socket, head) => {
    const status = closing
      ? 503
      : request.url !== "/ws"
        ? 404
        : !allow.has(request.headers.origin)
          ? 403
          : wss.clients.size >= maxSockets
            ? 503
            : null;
    if (status) {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });
  wss.on("connection", (socket, request) => {
    manager.attach(socket, request.socket.remoteAddress);
    socket.on("error", () => {});
    socket.on("pong", () => {
      const c = manager.connections.get(socket);
      if (c) c.lastPong = manager.now();
    });
    socket.on("message", (data, binary) => {
      const c = manager.connections.get(socket);
      if (!c || closing) return;
      if (!c.bucket.take(manager.now())) {
        error(socket, "RATE_LIMITED", "Too many messages.");
        socket.close(1008, "Rate limit");
        return;
      }
      const parsed = binary
        ? { ok: false, code: "BAD_MESSAGE", message: "Use JSON text messages." }
        : parseClientMessage(data.toString());
      if (!parsed.ok) {
        error(socket, parsed.code, parsed.message);
        return;
      }
      manager.handle(socket, parsed.value);
    });
    socket.on("close", () => manager.detach(socket));
  });
  const scheduler = autoSchedule
    ? setInterval(() => manager.advance(), 1000 / 120)
    : null;
  const heartbeat = setInterval(() => {
    manager.maintenance(manager.now());
    for (const socket of wss.clients)
      if (socket.readyState === 1) socket.ping();
  }, 10000);
  heartbeat.unref();
  scheduler?.unref();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (e) {
    clearInterval(scheduler);
    clearInterval(heartbeat);
    wss.close();
    throw e;
  }
  return {
    server,
    wss,
    manager,
    port: server.address().port,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(scheduler);
      clearInterval(heartbeat);
      manager.close();
      const force = setTimeout(() => {
        for (const socket of wss.clients) socket.terminate();
      }, 200);
      await Promise.all([
        new Promise((resolve) => wss.close(resolve)),
        new Promise((resolve) => server.close(resolve)),
      ]);
      clearTimeout(force);
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const app = await createDuelServer();
  console.log(`Duel server listening on port ${app.port}`);
  const stop = async () => {
    await app.close();
    process.exitCode = 0;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
