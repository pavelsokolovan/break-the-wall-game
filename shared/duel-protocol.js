import { PROTOCOL_VERSION, normalizeRoomCode } from "./duel-rules.js";

/** @typedef {0|1} Slot */
/** @typedef {'none'|'release_fire'|'fire'} InputAction */
/** @typedef {{seq:number,x:number,action:InputAction}} DuelInput */
/** @typedef {'countdown'|'playing'|'goal_countdown'|'paused'|'reconnecting'|'finished'} DuelPhase */
/** @typedef {{ok:true,value:object}|{ok:false,code:string,message:string}} ValidationResult */

/**
 * @typedef {object} DuelPlayer
 * @property {Slot} slot
 * @property {number} x Canonical paddle center.
 * @property {number} targetX
 * @property {number} vx
 * @property {number} width
 * @property {number} damage
 * @property {number} points
 * @property {number} comboCount
 * @property {number} comboRemainingMs
 * @property {number} shieldCharges
 * @property {number} vestCharges
 * @property {number} stickyCharges
 * @property {number} ammo
 * @property {number} fireCooldownMs
 * @property {number} wideRemainingMs
 * @property {number} slowRemainingMs
 * @property {number} shieldRemainingMs
 * @property {number} invulnerabilityRemainingMs
 * @property {boolean} connected
 * @property {number} lastAckInputSeq
 */
/** @typedef {{id:number,x:number,y:number,vx:number,vy:number,r:number,owner:Slot,held:boolean,heldOffsetX:number,autoReleaseRemainingMs:number}} DuelBall */
/** @typedef {{id:number,x:number,y:number,w:number,h:number,type:'standard'|'armored'|'reinforced'|'explosive'|'steel',hp:number|null,maxHp:number|null}} DuelBrick */
/** @typedef {{id:number,type:'sticky'|'bazooka'|'gem'|'wide'|'slow'|'shield'|'multi'|'repair'|'vest'|'bomb'|'rocket'|'worm',owner:Slot,x:number,y:number,baseX:number,motionPhase:number}} DuelDrop */
/** @typedef {{id:number,owner:Slot,x:number,y:number}} DuelShot */
/** @typedef {{reason:'manual'|'background'|'reconnect'|'server_busy',deadlineServerTime:number,resumePhase:'countdown'|'playing'|'goal_countdown'}} DuelPause */
/** @typedef {{wave:number,goals:[number,number],servingSlot:Slot,countdownRemainingMs:number,activeDurationMs:number,pause:DuelPause|null,players:[DuelPlayer,DuelPlayer],balls:DuelBall[],bricks:DuelBrick[],drops:DuelDrop[],shots:DuelShot[]}} DuelState */
/** @typedef {{v:1,type:'snapshot',matchId:string,tick:number,serverTime:number,phase:DuelPhase,state:DuelState}} DuelSnapshot */

// Schemas both validate and project: unknown fields never cross the boundary.
const object = (fields) => ({ kind: "object", fields });
const array = (item, length) => ({ kind: "array", item, length });
const enumeration = (...values) => ({ kind: "enum", values });
const nullable = (schema) => ({ kind: "nullable", schema });
const optional = (schema) => ({ kind: "optional", schema });
const string = (max) => ({ kind: "string", max });
const number = (min = -Infinity, max = Infinity, integer = false) => ({
  kind: "number",
  min,
  max,
  integer,
});
const finite = number(),
  nonnegative = number(0),
  integer = number(0, Infinity, true);
const positive = number(1, Infinity, true),
  slot = enumeration(0, 1),
  bool = enumeration(true, false);
const pair = array(integer, 2),
  requestId = string(64),
  token = string(256),
  matchId = string(128);
const phase = enumeration(
  "countdown",
  "playing",
  "goal_countdown",
  "paused",
  "reconnecting",
  "finished",
);
const roomPhase = enumeration(
  "lobby",
  "countdown",
  "playing",
  "goal_countdown",
  "paused",
  "reconnecting",
  "finished",
);
const reason = enumeration("five_goals", "forfeit", "time_limit");
export const ERROR_CODES = Object.freeze([
  "BAD_MESSAGE",
  "VERSION_MISMATCH",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "ROOM_EXPIRED",
  "AUTH_FAILED",
  "INVALID_PHASE",
  "RATE_LIMITED",
  "SERVER_BUSY",
]);
const player = object({
  slot,
  x: finite,
  targetX: finite,
  vx: finite,
  width: number(100, 240),
  damage: number(0, 3, true),
  points: integer,
  comboCount: integer,
  comboRemainingMs: nonnegative,
  shieldCharges: number(0, 1, true),
  vestCharges: number(0, 2, true),
  stickyCharges: number(0, 3, true),
  ammo: number(0, 15, true),
  fireCooldownMs: nonnegative,
  wideRemainingMs: nonnegative,
  slowRemainingMs: nonnegative,
  shieldRemainingMs: nonnegative,
  invulnerabilityRemainingMs: nonnegative,
  connected: bool,
  lastAckInputSeq: integer,
});
const ball = object({
  id: positive,
  x: finite,
  y: finite,
  vx: finite,
  vy: finite,
  r: number(Number.MIN_VALUE),
  owner: slot,
  held: bool,
  heldOffsetX: finite,
  autoReleaseRemainingMs: nonnegative,
});
const brick = object({
  id: positive,
  x: finite,
  y: finite,
  w: number(Number.MIN_VALUE),
  h: number(Number.MIN_VALUE),
  type: enumeration("standard", "armored", "reinforced", "explosive", "steel"),
  hp: nullable(positive),
  maxHp: nullable(positive),
});
const drop = object({
  id: positive,
  type: enumeration(
    "sticky",
    "bazooka",
    "gem",
    "wide",
    "slow",
    "shield",
    "multi",
    "repair",
    "vest",
    "bomb",
    "rocket",
    "worm",
  ),
  owner: slot,
  x: finite,
  y: finite,
  baseX: finite,
  motionPhase: finite,
});
const shot = object({ id: positive, owner: slot, x: finite, y: finite });
const stateSchema = object({
  wave: positive,
  goals: pair,
  servingSlot: slot,
  countdownRemainingMs: nonnegative,
  activeDurationMs: nonnegative,
  pause: nullable(
    object({
      reason: enumeration(
        "manual",
        "background",
        "panel",
        "reconnect",
        "server_busy",
      ),
      deadlineServerTime: nonnegative,
      resumePhase: enumeration("countdown", "playing", "goal_countdown"),
      consents: optional(array(bool, 2)),
    }),
  ),
  players: array(player, 2),
  balls: array(ball),
  bricks: array(brick),
  drops: array(drop),
  shots: array(shot),
});
const code = { kind: "code" };
const clientSchemas = {
  create: { requestId },
  join: { requestId, code },
  resume: { requestId, code, token },
  ready: { ready: bool },
  input: {
    matchId: optional(matchId),
    seq: positive,
    x: number(0, 1),
    action: enumeration("none", "release_fire", "fire"),
  },
  pause: {
    requested: bool,
    reason: optional(enumeration("manual", "background", "panel")),
  },
  resume_play: {},
  rematch: { ready: bool },
  leave: {},
  ping: { id: integer, clientTime: nonnegative },
};
const eventFields = {
  ball_held: { ballId: positive, owner: slot },
  ball_released: { ballId: positive, owner: slot, automatic: bool },
  ball_split: { ballId: positive, sourceBallId: positive, owner: slot },
  shot_fired: { shotId: positive, owner: slot, x: finite, y: finite },
  shot_hit: { shotId: positive, owner: slot, brickId: positive },
  hazard_intercepted: {
    shotId: positive,
    dropId: positive,
    owner: slot,
    points: enumeration(100),
    x: finite,
    y: finite,
  },
  drop_spawned: {
    dropId: positive,
    owner: slot,
    dropType: enumeration(
      "sticky",
      "bazooka",
      "multi",
      "gem",
      "wide",
      "slow",
      "shield",
      "repair",
      "vest",
      "bomb",
      "rocket",
      "worm",
    ),
    x: finite,
    y: finite,
  },
  pickup: {
    dropId: positive,
    owner: slot,
    dropType: enumeration(
      "sticky",
      "bazooka",
      "multi",
      "gem",
      "wide",
      "slow",
      "shield",
      "repair",
      "vest",
    ),
    points: integer,
  },
  hazard_blocked: {
    dropId: positive,
    owner: slot,
    defense: enumeration("shield", "vest", "invulnerability"),
  },
  hazard_damage: { dropId: positive, owner: slot, damage: number(0, 3, true) },
  brick_hit: { brickId: positive, owner: slot, hp: nullable(positive) },
  brick_destroyed: {
    brickId: positive,
    owner: slot,
    points: positive,
    x: finite,
    y: finite,
    brickType: enumeration("standard", "armored", "reinforced", "explosive"),
  },
  explosion: { brickId: positive, owner: slot, x: finite, y: finite },
  wave_cleared: { wave: positive },
  wave_started: { wave: positive },
  serve: { servingSlot: slot },
  paddle_hit: { slot, ballId: positive },
  goal: { scorer: slot, goals: pair },
  rally_replay: { servingSlot: slot },
  match_finished: { winner: nullable(slot), reason },
};
const serverSchemas = {
  welcome: {
    requestId,
    code,
    playerId: string(128),
    slot,
    token,
    matchId: nullable(matchId),
    nextInputSeq: positive,
    resumed: optional(bool),
    rematch: optional(bool),
  },
  room: {
    code,
    serverTime: optional(nonnegative),
    reconnectDeadlineServerTime: optional(nullable(nonnegative)),
    phase: roomPhase,
    pauseUsed: optional(array(bool, 2)),
    players: array(
      object({
        slot,
        connected: bool,
        ready: bool,
        rematchReady: optional(bool),
      }),
      2,
    ),
  },
  snapshot: {
    matchId,
    tick: integer,
    serverTime: nonnegative,
    phase,
    state: stateSchema,
  },
  events: { matchId, items: array({ kind: "event" }) },
  result: {
    matchId,
    winner: nullable(slot),
    reason,
    goals: pair,
    points: pair,
    durationMs: nonnegative,
    waveCount: positive,
  },
  error: {
    code: enumeration(...ERROR_CODES),
    terminal: optional(bool),
    requestId: optional(requestId),
    message: string(256),
  },
  pong: { id: integer, clientTime: nonnegative, serverTime: nonnegative },
};
function project(schema, value) {
  switch (schema.kind) {
    case "optional":
      return value === undefined ? undefined : project(schema.schema, value);
    case "nullable":
      return value === null ? null : project(schema.schema, value);
    case "enum":
      if (schema.values.includes(value)) return value;
      break;
    case "string":
      if (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= schema.max
      )
        return value;
      break;
    case "number":
      if (
        Number.isFinite(value) &&
        value >= schema.min &&
        value <= schema.max &&
        (!schema.integer || Number.isSafeInteger(value))
      )
        return value;
      break;
    case "code": {
      const normalized = normalizeRoomCode(value);
      if (normalized) return normalized;
      break;
    }
    case "array":
      if (
        Array.isArray(value) &&
        (schema.length === undefined || schema.length === value.length)
      )
        return Array.from(value, (item) => project(schema.item, item));
      break;
    case "event":
      if (value && Object.hasOwn(eventFields, value.type))
        return project(
          object({
            id: positive,
            tick: integer,
            type: enumeration(value.type),
            ...eventFields[value.type],
          }),
          value,
        );
      break;
    case "object":
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const result = {};
        for (const [key, child] of Object.entries(schema.fields)) {
          const item = project(
            child,
            Object.hasOwn(value, key) ? value[key] : undefined,
          );
          if (item !== undefined) result[key] = item;
        }
        return result;
      }
      break;
  }
  throw new TypeError("Invalid duel contract");
}
function assertState(state) {
  if (state.players.some((p, i) => p.slot !== i) || state.balls.length > 3)
    throw new TypeError("Invalid slots or ball cap");
  const ids = new Set();
  for (const entity of [
    ...state.balls,
    ...state.bricks,
    ...state.drops,
    ...state.shots,
  ]) {
    if (ids.has(entity.id)) throw new TypeError("Duplicate entity ID");
    ids.add(entity.id);
  }
  for (const b of state.bricks) {
    if (
      b.type === "steel"
        ? b.hp !== null || b.maxHp !== null
        : b.hp === null || b.maxHp === null || b.hp > b.maxHp
    )
      throw new TypeError("Invalid durability");
  }
}
function validateMessage(value, schemas) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid message");
  if (Object.hasOwn(value, "v") && value.v !== PROTOCOL_VERSION)
    return {
      ok: false,
      code: "VERSION_MISMATCH",
      message: "Update the game to use protocol version 1.",
    };
  if (!Object.hasOwn(schemas, value.type)) throw new TypeError("Unknown type");
  const clean = project(
    object({
      v: enumeration(PROTOCOL_VERSION),
      type: enumeration(value.type),
      ...schemas[value.type],
    }),
    value,
  );
  if (clean.type === "snapshot") assertState(clean.state);
  if (clean.type === "room" && clean.players.some((p, i) => p.slot !== i))
    throw new TypeError("Invalid room slots");
  if (
    clean.type === "events" &&
    clean.items.some((e, i, items) => i > 0 && e.id <= items[i - 1].id)
  )
    throw new TypeError("Unordered events");
  return { ok: true, value: clean };
}
const badMessage = () => ({
  ok: false,
  code: "BAD_MESSAGE",
  message: "Invalid duel message.",
});
/** @returns {ValidationResult} Does not throw for malformed network input. */
export function parseClientMessage(text) {
  try {
    return typeof text === "string"
      ? validateMessage(JSON.parse(text), clientSchemas)
      : badMessage();
  } catch {
    return badMessage();
  }
}
/** @returns {ValidationResult} Unknown fields are discarded recursively. */
export function validateServerMessage(value) {
  try {
    return validateMessage(value, serverSchemas);
  } catch {
    return badMessage();
  }
}
/** Detached allowlisted state; programmer errors throw. Steel Infinity becomes JSON null.
 * @param {DuelState} internalState
 * @returns {DuelState}
 */
export function toPublicDuelState(internalState) {
  const state = project(stateSchema, {
    ...internalState,
    bricks: internalState.bricks.map((b) =>
      b.type === "steel" ? { ...b, hp: null, maxHp: null } : b,
    ),
  });
  assertState(state);
  return state;
}
