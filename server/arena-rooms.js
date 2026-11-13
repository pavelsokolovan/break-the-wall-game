import { randomBytes, randomInt } from "node:crypto";
import { ArenaBot } from "../shared/arena-bot.js";
import { ArenaGame } from "../shared/arena-game.js";
import { Bucket, send } from "./protocol.js";
import { normalizeRoomCode, ROOM_CODE_ALPHABET } from "../shared/duel-rules.js";
export function parseArenaMessage(text) {
  try {
    const m = JSON.parse(text);
    if (m.v !== 1)
      return {
        ok: false,
        code: "VERSION_MISMATCH",
        message: "Refresh the game.",
      };
    if (m.type === "practice" && [2, 3].includes(m.bots))
      return { ok: true, value: { type: "practice", bots: m.bots } };
    if (m.type === "create" && [3, 4].includes(m.count))
      return { ok: true, value: { type: "create", count: m.count } };
    if (m.type === "join" && normalizeRoomCode(m.code))
      return {
        ok: true,
        value: { type: "join", code: normalizeRoomCode(m.code) },
      };
    if (m.type === "ready" && typeof m.ready === "boolean")
      return { ok: true, value: { type: "ready", ready: m.ready } };
    if (
      m.type === "input" &&
      Number.isSafeInteger(m.seq) &&
      m.seq > 0 &&
      Number.isFinite(m.x) &&
      m.x >= 0 &&
      m.x <= 1
    )
      return { ok: true, value: { type: "input", seq: m.seq, x: m.x } };
    if (["leave", "ping"].includes(m.type))
      return { ok: true, value: { type: m.type } };
  } catch {}
  return { ok: false, code: "BAD_MESSAGE", message: "Invalid arena request." };
}
export class ArenaRooms {
  constructor({
    now = () => performance.now(),
    maxRooms = 20,
    roomCount = () => 0,
  } = {}) {
    this.now = now;
    this.maxRooms = maxRooms;
    this.roomCount = roomCount;
    this.rooms = new Map();
    this.connections = new Map();
    this.attempts = new Map();
    this.last = now();
    this.accumulator = 0;
  }
  attach(socket, ip) {
    this.connections.set(socket, {
      socket,
      ip,
      room: null,
      slot: null,
      lastPong: this.now(),
      bucket: new Bucket(90, 80, this.now()),
    });
  }
  message(room) {
    return {
      v: 1,
      type: "arena",
      code: room.code,
      count: room.count,
      practice: !!room.bots,
      players: room.seats.map((c, slot) => ({
        slot,
        connected: !!c,
        ready: !!c?.ready,
        bot: !!c?.bot,
      })),
      state: room.game?.snapshot() ?? null,
    };
  }
  broadcast(room) {
    for (const c of room.seats)
      if (c && !c.bot) send(c.socket, this.message(room));
  }
  handle(socket, m) {
    const c = this.connections.get(socket);
    if (!c) return;
    const fail = (message) =>
      send(socket, { v: 1, type: "arena_error", message });
    if (m.type === "ping") return send(socket, { v: 1, type: "arena_pong" });
    if (["create", "practice", "join"].includes(m.type)) {
      if (c.room) return fail("Leave your current room first.");
      let bucket = this.attempts.get(c.ip);
      if (!bucket) {
        bucket = new Bucket(5, 5 / 60, this.now());
        this.attempts.set(c.ip, bucket);
      }
      if (!bucket.take(this.now()))
        return fail("Too many room requests. Wait a minute.");
      let room;
      if (["create", "practice"].includes(m.type)) {
        if (this.rooms.size + this.roomCount() >= this.maxRooms)
          return fail("Rooms are busy. Try later.");
        let code;
        do {
          code = Array.from(
            { length: 6 },
            () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
          ).join("");
        } while (this.rooms.has(code));
        room = {
          code,
          count: m.type === "practice" ? m.bots + 1 : m.count,
          seats: Array(m.type === "practice" ? m.bots + 1 : m.count).fill(null),
          created: this.now(),
          game: null,
        };
        this.rooms.set(code, room);
      } else {
        room = this.rooms.get(m.code);
        if (!room) return fail("Room not found. Check the code.");
        if (room.game || room.seats.every(Boolean))
          return fail("Room is full or has started.");
      }
      c.slot = room.seats.indexOf(null);
      c.room = room;
      c.ready = m.type === "practice";
      room.seats[c.slot] = c;
      if (m.type === "practice") {
        room.bots = Array.from(
          { length: m.bots },
          (_, i) => new ArenaBot(i + 1, randomBytes(4).readUInt32LE()),
        );
        for (const bot of room.bots)
          room.seats[bot.slot] = { bot: true, ready: true };
        room.game = new ArenaGame(room.count, randomBytes(4).readUInt32LE());
      }
      send(socket, { v: 1, type: "arena_welcome", slot: c.slot });
      this.broadcast(room);
      return;
    }
    const room = c.room;
    if (!room) return fail("Create or join a room first.");
    if (m.type === "leave") {
      this.leave(c);
      return;
    }
    if (m.type === "ready" && !room.game) {
      c.ready = m.ready;
      if (room.seats.every((p) => p?.ready)) {
        room.game = new ArenaGame(room.count, randomBytes(4).readUInt32LE());
      }
      this.broadcast(room);
      return;
    }
    if (m.type === "input" && room.game) {
      room.game.input(c.slot, m);
      return;
    }
    fail("Action unavailable now.");
  }
  leave(c) {
    const room = c.room;
    if (!room) return;
    if (room.game) {
      room.game.forfeit(c.slot);
      if (room.game.phase === "finished") room.finished ??= this.now();
    }
    room.seats[c.slot] = null;
    c.room = null;
    c.slot = null;
    c.ready = false;
    if (!room.seats.some((seat) => seat && !seat.bot))
      this.rooms.delete(room.code);
    else this.broadcast(room);
  }
  detach(socket) {
    const c = this.connections.get(socket);
    if (c) this.leave(c);
    this.connections.delete(socket);
  }
  advance() {
    const now = this.now(),
      delta = now - this.last;
    this.last = now;
    this.maintenance(now);
    if (delta > 500) {
      for (const room of this.rooms.values())
        if (room.game && room.game.phase !== "finished")
          this.interrupt(room, "Server stalled. Arena interrupted.");
      this.accumulator = 0;
      return;
    }
    this.accumulator += Math.max(0, delta);
    let steps = 0;
    while (this.accumulator >= 1000 / 60 - 1e-8 && steps++ < 5) {
      this.accumulator -= 1000 / 60;
      for (const room of this.rooms.values())
        if (room.game && room.game.phase !== "finished") {
          for (const bot of room.bots ?? []) bot.update(room.game);
          room.game.step();
          if (room.game.tick % 2 === 0 || room.game.phase === "finished")
            this.broadcast(room);
          if (room.game.phase === "finished") room.finished ??= now;
        }
    }
    if (steps >= 5) this.accumulator = 0;
  }
  interrupt(room, message) {
    for (const c of room.seats)
      if (c && !c.bot) {
        send(c.socket, { v: 1, type: "arena_error", message, terminal: true });
        c.room = null;
        c.slot = null;
        c.socket.close(1012, "Arena interrupted");
      }
    this.rooms.delete(room.code);
  }
  maintenance(now) {
    for (const c of this.connections.values())
      if (now - c.lastPong > 25000) {
        c.socket.terminate();
        this.detach(c.socket);
      }
    for (const room of this.rooms.values())
      if (
        (!room.game && now - room.created > 600000) ||
        (room.finished !== undefined && now - room.finished > 300000)
      )
        this.interrupt(room, "Room expired. Create another arena.");
    for (const [ip, b] of this.attempts)
      if (now - b.last > 60000) this.attempts.delete(ip);
  }
  close() {
    for (const room of this.rooms.values())
      this.interrupt(room, "Server shutting down. Arena interrupted.");
    this.connections.clear();
    this.attempts.clear();
  }
}
