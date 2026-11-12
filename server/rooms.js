import {
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
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
    this.resumeAttempts = new Map();
    this.lastTime = now();
    this.accumulator = 0;
  }
  connected(seat) {
    return !!seat?.socket && seat.socket.readyState === 1;
  }
  effectivePhase(room) {
    if (room.recovery?.kind === "reconnect") return "reconnecting";
    if (room.recovery?.kind === "countdown") return "countdown";
    if (room.recovery?.kind === "server_busy") return "paused";
    if (room.manual) return "paused";
    return room.game?.phase || "lobby";
  }
  welcome(connection, requestId, resumed) {
    const room = connection.room,
      seat = room.seats[connection.slot];
    return {
      v: 1,
      type: "welcome",
      requestId,
      code: room.code,
      playerId: seat.playerId,
      slot: connection.slot,
      token: seat.token,
      matchId: room.game?.matchId || null,
      nextInputSeq:
        (room.game?.state.players[connection.slot].lastAckInputSeq || 0) + 1,
      resumed,
    };
  }
  freeze(room) {
    if (room.game && LIVE.includes(room.game.phase)) room.game.setPaused(true);
  }
  recoveryCountdown(room, graceDeadline = null) {
    if (!room.game || room.game.phase === "finished") {
      room.recovery = null;
      return;
    }
    this.freeze(room);
    room.recovery = {
      kind: "countdown",
      deadline: this.now() + 3000,
      graceDeadline,
    };
    this.broadcast(room, this.roomMessage(room));
    this.snapshot(room);
  }
  reserve(room) {
    if (room.game?.phase === "finished") return;
    this.freeze(room);
    const graceDeadline = room.recovery?.graceDeadline ?? this.now() + 30000;
    room.recovery = {
      kind: "reconnect",
      deadline: graceDeadline,
      graceDeadline,
    };
    this.broadcast(room, this.roomMessage(room));
    this.snapshot(room);
  }
  resumeSeat(connection, message, fail, respond) {
    let limiter = this.resumeAttempts.get(connection.ip);
    if (!limiter) {
      limiter = new Bucket(20, 20 / 60, this.now());
      this.resumeAttempts.set(connection.ip, limiter);
    }
    if (!limiter.take(this.now()))
      return fail("RATE_LIMITED", "Too many resume attempts.");
    this.maintenance(this.now());
    const room = this.rooms.get(message.code);
    if (!room)
      return fail("ROOM_NOT_FOUND", "Session unavailable. Match interrupted.");
    const supplied = Buffer.from(message.token);
    const slot = room.seats.findIndex((seat) => {
      if (!seat) return false;
      const expected = Buffer.from(seat.token);
      return (
        expected.length === supplied.length &&
        timingSafeEqual(expected, supplied)
      );
    });
    if (slot < 0) return fail("AUTH_FAILED", "Unable to resume this session.");
    const seat = room.seats[slot],
      oldSocket = seat.socket;
    if (oldSocket && oldSocket !== connection.socket) {
      const old = this.connections.get(oldSocket);
      if (old) {
        old.room = null;
        old.slot = null;
      }
      oldSocket.close(4001, "Seat resumed elsewhere");
    }
    seat.token = randomBytes(16).toString("hex");
    seat.socket = connection.socket;
    if (!room.game) seat.ready = false;
    connection.room = room;
    connection.slot = slot;
    respond(this.welcome(connection, message.requestId, true));
    if (room.game?.phase === "finished") {
      send(connection.socket, this.roomMessage(room));
      this.snapshot(room);
      send(connection.socket, room.game.getResult());
      return;
    }
    if (room.seats.every((s) => !s || this.connected(s)))
      this.recoveryCountdown(room, room.recovery?.graceDeadline ?? null);
    else if (room.recovery?.kind !== "reconnect") this.reserve(room);
    this.broadcast(room, this.roomMessage(room));
    this.snapshot(room);
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
    for (const seat of room.seats)
      if (this.connected(seat)) send(seat.socket, message);
  }
  roomMessage(room) {
    return {
      v: 1,
      type: "room",
      code: room.code,
      phase: this.effectivePhase(room),
      pauseUsed: room.pauseUsed || [false, false],
      serverTime: this.now(),
      reconnectDeadlineServerTime:
        room.recovery?.kind === "reconnect" ? room.recovery.deadline : null,
      players: [0, 1].map((slot) => ({
        slot,
        connected: this.connected(room.seats[slot]),
        ready: !!room.seats[slot]?.ready,
        rematchReady: !!room.seats[slot]?.rematchReady,
      })),
    };
  }
  snapshot(room) {
    if (!room.game) return;
    const state = room.game.getState();
    state.players.forEach((p, slot) => {
      p.connected = this.connected(room.seats[slot]);
    });
    if (room.manual && !room.recovery)
      state.pause = {
        reason: room.manual.reason,
        deadlineServerTime: room.manual.deadline,
        resumePhase: room.game.resumePhase,
        consents: [...room.manual.consents],
      };
    if (room.recovery) {
      const r = room.recovery;
      state.pause = {
        reason: r.kind === "server_busy" ? "server_busy" : "reconnect",
        deadlineServerTime: r.deadline,
        resumePhase: room.game.resumePhase || "playing",
      };
      if (r.kind === "countdown")
        state.countdownRemainingMs = Math.max(0, r.deadline - this.now());
    }
    room.lastSnapshotAt = this.now();
    this.broadcast(room, {
      v: 1,
      type: "snapshot",
      matchId: room.game.matchId,
      tick: room.game.tick,
      serverTime: this.now(),
      phase: this.effectivePhase(room),
      state,
    });
  }
  flush(room, immediate = false) {
    const game = room.game;
    if (!game) return;
    if (game.phase === "finished") {
      room.recovery = null;
      room.manual = null;
    }
    const items = game.drainEvents();
    if (items.some((e) => ["goal", "rally_replay"].includes(e.type))) {
      room.pauseUsed = [false, false];
      this.broadcast(room, this.roomMessage(room));
    }
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
    if (connection.room)
      return fail("INVALID_PHASE", "Leave your current room first.");
    if (message.type === "resume")
      return this.resumeSeat(connection, message, fail, respond);
    if (!this.attempt(connection.ip))
      return fail(
        "RATE_LIMITED",
        "Too many room requests. Try again in a minute.",
      );

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
        recovery: null,
        stalls: [],
        manual: null,
        pauseUsed: [false, false],
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
    respond(this.welcome(connection, message.requestId, false));
    this.broadcast(room, this.roomMessage(room));
  }
  manualPause(c, message) {
    const room = c.room,
      game = room.game;
    if (!game || game.phase === "finished" || room.recovery)
      return error(
        c.socket,
        "INVALID_PHASE",
        "Pause is unavailable during recovery or after a match.",
      );
    if (!message.requested) return this.consent(c);
    room.pauseUsed ||= [false, false];
    if (room.pauseUsed[c.slot]) {
      if (message.reason === "background") {
        game.pendingActions[c.slot] = { release: false, fire: false };
      }
      return error(
        c.socket,
        "INVALID_PHASE",
        "Your pause was used this rally. Play continues unless already paused.",
      );
    }
    room.pauseUsed[c.slot] = true;
    this.freeze(room);
    room.manual ||= {
      deadline: this.now() + 30000,
      reason: message.reason || "manual",
      consents: [false, false],
    };
    room.manual.consents[c.slot] = false;
    this.broadcast(room, this.roomMessage(room));
    this.snapshot(room);
  }
  consent(c) {
    const room = c.room;
    if (!room.manual)
      return error(
        c.socket,
        "INVALID_PHASE",
        "There is no manual pause to resume.",
      );
    room.manual.consents[c.slot] = true;
    if (room.manual.consents.every(Boolean)) this.endManual(room);
    else this.snapshot(room);
  }
  endManual(room) {
    room.manual = null;
    if (!room.recovery) room.game.setPaused(false);
    this.broadcast(room, this.roomMessage(room));
    this.snapshot(room);
  }
  rematch(c, ready) {
    const room = c.room;
    if (room.game?.phase !== "finished")
      return error(
        c.socket,
        "INVALID_PHASE",
        "Finish the current match first.",
      );
    room.seats[c.slot].rematchReady = ready;
    if (!room.seats.every((s) => this.connected(s) && s.rematchReady)) {
      this.broadcast(room, this.roomMessage(room));
      return;
    }
    room.seats.reverse();
    room.requiresMatchId = true;
    room.game = new DuelGame({
      seed: randomBytes(4).readUInt32LE(),
      matchId: randomUUID(),
    });
    room.resultSent = false;
    delete room.finishedAt;
    room.manual = null;
    room.recovery = null;
    room.pauseUsed = [false, false];
    room.stalls = [];
    room.game.start();
    room.seats.forEach((seat, slot) => {
      seat.token = randomBytes(16).toString("hex");
      seat.rematchReady = false;
      seat.ready = false;
      const connection = this.connections.get(seat.socket);
      connection.slot = slot;
      connection.cache.clear();
      send(seat.socket, {
        ...this.welcome(connection, `rematch:${room.game.matchId}`, false),
        rematch: true,
      });
    });
    this.broadcast(room, this.roomMessage(room));
    this.snapshot(room);
  }
  handle(socket, message) {
    const c = this.connections.get(socket);
    if (!c || socket.readyState !== 1) return;
    if (message.type === "ping")
      return send(socket, {
        v: 1,
        type: "pong",
        id: message.id,
        clientTime: message.clientTime,
        serverTime: this.now(),
      });
    if (["create", "join", "resume"].includes(message.type))
      return this.request(c, message);
    const room = c.room;
    if (!room) return error(socket, "INVALID_PHASE", "Join a room first.");
    if (message.type === "leave") return this.leave(c, true);
    if (message.type === "pause") return this.manualPause(c, message);
    if (message.type === "resume_play") return this.consent(c);
    if (message.type === "rematch") return this.rematch(c, message.ready);
    if (message.type === "ready" && !room.game && !room.recovery) {
      room.seats[c.slot].ready = message.ready;
      if (room.seats.every((seat) => this.connected(seat) && seat.ready)) {
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
    if (
      message.type === "input" &&
      this.effectivePhase(room) === "playing" &&
      room.game?.phase === "playing"
    ) {
      if (
        (room.requiresMatchId || message.matchId !== undefined) &&
        message.matchId !== room.game.matchId
      )
        return;
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
    for (const seat of room.seats) if (seat) seat.rematchReady = false;
    if (room.game && room.game.phase !== "finished") {
      if (voluntary) {
        room.game.finish(1 - connection.slot, "forfeit");
        this.flush(room, true);
      } else {
        room.seats[connection.slot].socket = null;
        connection.room = null;
        connection.slot = null;
        this.reserve(room);
        return;
      }
    }
    if (!voluntary) {
      room.seats[connection.slot].socket = null;
      if (!room.game) room.seats[connection.slot].ready = false;
      connection.room = null;
      connection.slot = null;
      if (!room.game) this.reserve(room);
      else this.broadcast(room, this.roomMessage(room));
      return;
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
      if (!seat?.socket) continue;
      const c = this.connections.get(seat.socket);
      if (c) {
        c.room = null;
        c.slot = null;
      }
      error(seat.socket, code, message, undefined, true);
      seat.socket?.close(1012, "Match interrupted");
    }
  }
  advance(now = this.now()) {
    const elapsed = Math.max(0, now - this.lastTime);
    this.lastTime = now;
    this.maintenance(now);
    if (elapsed > 500) {
      this.accumulator = 0;
      for (const room of this.rooms.values())
        if (room.game && room.game.phase !== "finished") {
          room.stalls = room.stalls.filter((t) => now - t < 60000);
          room.stalls.push(now);
          if (room.stalls.length >= 3) {
            this.interrupt(
              room,
              "Server repeatedly stalled. Match interrupted.",
            );
            continue;
          }
          if (room.recovery?.kind === "reconnect") continue;
          this.freeze(room);
          room.recovery = {
            kind: "server_busy",
            deadline: now + 1000,
            healthySince: null,
            graceDeadline: room.recovery?.graceDeadline ?? null,
          };
          this.broadcast(room, this.roomMessage(room));
          this.snapshot(room);
        }
      return;
    }
    for (const room of this.rooms.values())
      if (room.recovery?.kind === "server_busy") {
        const r = room.recovery;
        if (elapsed > 100) {
          r.healthySince = null;
          r.deadline = now + 1000;
        } else {
          r.healthySince ??= now;
          r.deadline = r.healthySince + 1000;
          if (now >= r.deadline) this.recoveryCountdown(room, r.graceDeadline);
        }
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
    for (const [ip, bucket] of this.resumeAttempts)
      if (now - bucket.last > 60000) this.resumeAttempts.delete(ip);
    for (const c of this.connections.values())
      if (now - c.lastPong > 25000) {
        c.socket.terminate();
        this.detach(c.socket);
      }
    for (const room of this.rooms.values()) {
      if (room.manual && now >= room.manual.deadline) this.endManual(room);
      const r = room.recovery;
      if (r?.kind === "reconnect" && now >= r.deadline) {
        const connected = room.seats.map((s) => this.connected(s));
        if (room.game) {
          if (connected.filter(Boolean).length === 1) {
            room.game.finish(connected[0] ? 0 : 1, "forfeit");
            room.recovery = null;
            this.flush(room, true);
          } else {
            this.interrupt(room, "Both players disconnected. Match abandoned.");
            continue;
          }
        } else {
          room.seats = room.seats.map((s) => (this.connected(s) ? s : null));
          room.recovery = null;
          if (!room.seats.some(Boolean)) {
            this.rooms.delete(room.code);
            continue;
          }
          this.broadcast(room, this.roomMessage(room));
        }
      } else if (r?.kind === "countdown" && now >= r.deadline) {
        if (!room.manual) room.game.setPaused(false);
        room.recovery = null;
        this.broadcast(room, this.roomMessage(room));
        this.snapshot(room);
      }
      if (room.recovery && now - (room.lastSnapshotAt ?? -Infinity) >= 50)
        this.snapshot(room);
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
    this.resumeAttempts.clear();
  }
}
