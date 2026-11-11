import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { DuelGame } from "../shared/duel-game.js";
import { ROOM_CODE_ALPHABET, DUEL_RULES as R } from "../shared/duel-rules.js";
import { Bucket, LIMITS, error, send } from "./protocol.js";

const LIVE = ["countdown", "playing", "goal_countdown"];
export class RoomManager {
  constructor({ now = () => performance.now(), maxRooms = LIMITS.rooms } = {}) {
    this.now = now;
    this.maxRooms = maxRooms;
    this.rooms = new Map();
    this.connections = new Map();
    this.ipAttempts = new Map();
    this.lastTime = now();
    this.accumulator = 0;
  }
  attach(socket, ip) {
    this.connections.set(socket, {
      socket,
      ip,
      room: null,
      slot: null,
      cache: new Map(),
      bucket: new Bucket(60, 50, this.now()),
      lastPong: this.now(),
    });
  }
  broadcast(room, message) {
    for (const seat of room.seats) if (seat) send(seat.socket, message);
  }
  roomMessage(room) {
    return {
      v: 1,
      type: "room",
      code: room.code,
      phase: room.game?.phase || "lobby",
      players: [0, 1].map((slot) => ({
        slot,
        connected: !!room.seats[slot],
        ready: !!room.seats[slot]?.ready,
      })),
    };
  }
  snapshot(room) {
    if (!room.game) return;
    const state = room.game.getState();
    state.players.forEach((p, slot) => {
      p.connected = !!room.seats[slot];
    });
    this.broadcast(room, {
      v: 1,
      type: "snapshot",
      matchId: room.game.matchId,
      tick: room.game.tick,
      serverTime: this.now(),
      phase: room.game.phase,
      state,
    });
  }
  flush(room, immediate = false) {
    const game = room.game;
    if (!game) return;
    const items = game.drainEvents();
    if (items.length)
      this.broadcast(room, {
        v: 1,
        type: "events",
        matchId: game.matchId,
        items,
      });
    if (immediate || game.tick % 3 === 0 || game.phase === "finished")
      this.snapshot(room);
    if (game.phase === "finished" && !room.resultSent) {
      room.resultSent = true;
      room.finishedAt = this.now();
      this.broadcast(room, game.getResult());
      this.broadcast(room, this.roomMessage(room));
    }
  }
  attempt(ip) {
    let entry = this.ipAttempts.get(ip);
    if (!entry) {
      entry = new Bucket(5, 5 / 60, this.now());
      this.ipAttempts.set(ip, entry);
    }
    return entry.take(this.now());
  }
  request(connection, message) {
    const { socket } = connection;
    const replay = connection.cache.get(message.requestId);
    const fingerprint = JSON.stringify(message);
    if (replay) {
      if (replay.fingerprint !== fingerprint)
        return error(
          socket,
          "BAD_MESSAGE",
          "Request ID was already used.",
          message.requestId,
        );
      send(socket, replay.response);
      if (connection.room) send(socket, this.roomMessage(connection.room));
      return;
    }
    if (connection.cache.size >= 64)
      return error(
        socket,
        "RATE_LIMITED",
        "Reconnect before making more room requests.",
        message.requestId,
      );
    const respond = (response) => {
      connection.cache.set(message.requestId, { fingerprint, response });
      send(socket, response);
    };
    const fail = (code, text) =>
      respond({
        v: 1,
        type: "error",
        code,
        message: text,
        requestId: message.requestId,
      });
    if (!this.attempt(connection.ip))
      return fail(
        "RATE_LIMITED",
        "Too many room requests. Try again in a minute.",
      );
    if (connection.room)
      return fail("INVALID_PHASE", "Leave your current room first.");
    let room;
    if (message.type === "create") {
      if (this.rooms.size >= this.maxRooms)
        return fail("SERVER_BUSY", "All rooms are busy. Try again later.");
      let code;
      do {
        code = Array.from(
          { length: 6 },
          () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
        ).join("");
      } while (this.rooms.has(code));
      room = {
        code,
        seats: [null, null],
        createdAt: this.now(),
        game: null,
        resultSent: false,
      };
      this.rooms.set(code, room);
    } else {
      room = this.rooms.get(message.code);
      if (!room)
        return fail("ROOM_NOT_FOUND", "Room not found. Check the code.");
      if (room.game || room.seats.every(Boolean))
        return fail("ROOM_FULL", "This room is full or has already started.");
    }
    const slot = room.seats.findIndex((seat) => !seat);
    const seat = {
      socket,
      ready: false,
      playerId: randomUUID(),
      token: randomBytes(16).toString("hex"),
    };
    room.seats[slot] = seat;
    connection.room = room;
    connection.slot = slot;
    respond({
      v: 1,
      type: "welcome",
      requestId: message.requestId,
      code: room.code,
      playerId: seat.playerId,
      slot,
      token: seat.token,
      matchId: null,
      nextInputSeq: 1,
    });
    this.broadcast(room, this.roomMessage(room));
  }
  handle(socket, message) {
    const c = this.connections.get(socket);
    if (!c) return;
    if (message.type === "ping")
      return send(socket, {
        v: 1,
        type: "pong",
        id: message.id,
        clientTime: message.clientTime,
        serverTime: this.now(),
      });
    if (message.type === "create" || message.type === "join")
      return this.request(c, message);
    if (message.type === "resume")
      return error(
        socket,
        "AUTH_FAILED",
        "Unable to resume this session.",
        message.requestId,
      );
    const room = c.room;
    if (!room) return error(socket, "INVALID_PHASE", "Join a room first.");
    if (message.type === "leave") return this.leave(c, true);
    if (message.type === "ready" && !room.game) {
      room.seats[c.slot].ready = message.ready;
      if (room.seats.every((seat) => seat?.ready)) {
        room.game = new DuelGame({
          seed: randomBytes(4).readUInt32LE(),
          matchId: randomUUID(),
        });
        room.game.start();
      }
      this.broadcast(room, this.roomMessage(room));
      this.snapshot(room);
      return;
    }
    if (message.type === "input" && room.game?.phase === "playing") {
      room.game.applyInput(c.slot, message);
      return;
    }
    error(
      socket,
      "INVALID_PHASE",
      "This action is unavailable in the current phase.",
    );
  }
  leave(connection, voluntary = false) {
    const room = connection.room;
    if (!room) return;
    if (room.game && LIVE.includes(room.game.phase)) {
      if (voluntary) {
        room.game.finish(1 - connection.slot, "forfeit");
        this.flush(room, true);
      } else {
        this.interrupt(room, "Opponent disconnected. Match interrupted.");
        return;
      }
    }
    room.seats[connection.slot] = null;
    connection.room = null;
    connection.slot = null;
    if (!room.seats.some(Boolean)) this.rooms.delete(room.code);
    else this.broadcast(room, this.roomMessage(room));
  }
  detach(socket) {
    const c = this.connections.get(socket);
    if (c) {
      this.leave(c);
      this.connections.delete(socket);
    }
  }
  interrupt(room, message, code = "SERVER_BUSY") {
    this.rooms.delete(room.code);
    for (const seat of room.seats) {
      if (!seat) continue;
      const c = this.connections.get(seat.socket);
      if (c) {
        c.room = null;
        c.slot = null;
      }
      error(seat.socket, code, message);
      seat.socket.close(1012, "Match interrupted");
    }
  }
  advance(now = this.now()) {
    const elapsed = Math.max(0, now - this.lastTime);
    this.lastTime = now;
    this.maintenance(now);
    if (elapsed > 500) {
      this.accumulator = 0;
      for (const room of this.rooms.values())
        if (room.game && LIVE.includes(room.game.phase))
          this.interrupt(room, "Server stalled. Match interrupted.");
      return;
    }
    this.accumulator += elapsed;
    let ticks = 0;
    while (this.accumulator + 1e-8 >= 1000 / R.simulationHz && ticks < 5) {
      this.accumulator -= 1000 / R.simulationHz;
      ticks++;
      for (const room of this.rooms.values())
        if (room.game && LIVE.includes(room.game.phase)) {
          room.game.step();
          this.flush(room);
        }
    }
    if (ticks === 5) this.accumulator = 0;
  }
  maintenance(now) {
    for (const [ip, bucket] of this.ipAttempts)
      if (now - bucket.last > 60000) this.ipAttempts.delete(ip);
    for (const c of this.connections.values())
      if (now - c.lastPong > 25000) c.socket.terminate();
    for (const room of this.rooms.values()) {
      const expired = !room.game
        ? now - room.createdAt > 600000
        : room.finishedAt !== undefined && now - room.finishedAt > 300000;
      if (expired)
        this.interrupt(
          room,
          "Room expired. Create or join another room.",
          "ROOM_EXPIRED",
        );
    }
  }
  close() {
    for (const room of this.rooms.values())
      this.interrupt(room, "Server shutting down. Match interrupted.");
    for (const c of this.connections.values())
      c.socket.close(1012, "Server shutting down");
    this.rooms.clear();
    this.connections.clear();
    this.ipAttempts.clear();
  }
}
