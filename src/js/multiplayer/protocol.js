import { ACTIONS } from '../game/constants.js';
import { SEAT_DECISIONS } from './tableEngine.js';

/**
 * The Blackjack Lab local-multiplayer wire protocol.
 *
 * Every DataChannel frame is one JSON envelope:
 *
 *   { v: PROTOCOL_VERSION, t: <type>, id: <unique message id>,
 *     seq: <per-sender monotonic counter>, p: <payload object> }
 *
 * The host is authoritative: clients only send *intents* (join, ready,
 * bet, action, decision, leave) and render *confirmed host state*
 * (STATE_SNAPSHOT with a monotonically increasing revision). Everything
 * received from the network is validated structurally here before any
 * game code sees it; unknown versions, unknown types, malformed payloads,
 * duplicated or out-of-order sequence numbers are all rejected.
 */

export const PROTOCOL_VERSION = 1;

/** Maximum accepted display-name length (codepoints). */
export const MAX_NAME_LENGTH = 24;

/** Maximum accepted frame size in UTF-16 code units (~128 KiB). */
export const MAX_FRAME_LENGTH = 131072;

export const MESSAGE_TYPES = Object.freeze({
  // client → host
  JOIN_REQUEST: 'JOIN_REQUEST',
  PLAYER_READY: 'PLAYER_READY',
  PLACE_BET: 'PLACE_BET',
  CLEAR_BET: 'CLEAR_BET',
  GAME_ACTION: 'GAME_ACTION',
  DECISION: 'DECISION',
  LEAVE_ROOM: 'LEAVE_ROOM',
  // host → client
  JOIN_ACCEPTED: 'JOIN_ACCEPTED',
  JOIN_REJECTED: 'JOIN_REJECTED',
  PLAYER_LIST: 'PLAYER_LIST',
  STATE_SNAPSHOT: 'STATE_SNAPSHOT',
  ROUND_STARTED: 'ROUND_STARTED',
  TURN_CHANGED: 'TURN_CHANGED',
  ROUND_COMPLETED: 'ROUND_COMPLETED',
  PLAYER_DISCONNECTED: 'PLAYER_DISCONNECTED',
  SESSION_ENDED: 'SESSION_ENDED',
  ERROR: 'ERROR',
});

/** Message types a host accepts from clients. */
export const CLIENT_MESSAGE_TYPES = Object.freeze([
  MESSAGE_TYPES.JOIN_REQUEST,
  MESSAGE_TYPES.PLAYER_READY,
  MESSAGE_TYPES.PLACE_BET,
  MESSAGE_TYPES.CLEAR_BET,
  MESSAGE_TYPES.GAME_ACTION,
  MESSAGE_TYPES.DECISION,
  MESSAGE_TYPES.LEAVE_ROOM,
]);

/** Message types a client accepts from the host. */
export const HOST_MESSAGE_TYPES = Object.freeze([
  MESSAGE_TYPES.JOIN_ACCEPTED,
  MESSAGE_TYPES.JOIN_REJECTED,
  MESSAGE_TYPES.PLAYER_LIST,
  MESSAGE_TYPES.STATE_SNAPSHOT,
  MESSAGE_TYPES.ROUND_STARTED,
  MESSAGE_TYPES.TURN_CHANGED,
  MESSAGE_TYPES.ROUND_COMPLETED,
  MESSAGE_TYPES.PLAYER_DISCONNECTED,
  MESSAGE_TYPES.SESSION_ENDED,
  MESSAGE_TYPES.ERROR,
]);

/** Machine-readable protocol / command rejection codes. */
export const ERROR_CODES = Object.freeze({
  MALFORMED: 'MALFORMED',
  INCOMPATIBLE_PROTOCOL: 'INCOMPATIBLE_PROTOCOL',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  UNEXPECTED_TYPE: 'UNEXPECTED_TYPE',
  DUPLICATE_MESSAGE: 'DUPLICATE_MESSAGE',
  OUT_OF_ORDER: 'OUT_OF_ORDER',
  NOT_JOINED: 'NOT_JOINED',
  ALREADY_JOINED: 'ALREADY_JOINED',
  ROOM_FULL: 'ROOM_FULL',
  BAD_NAME: 'BAD_NAME',
  BAD_TOKEN: 'BAD_TOKEN',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ILLEGAL_ACTION: 'ILLEGAL_ACTION',
  ILLEGAL_BET: 'ILLEGAL_BET',
  WRONG_STATE: 'WRONG_STATE',
  SESSION_ENDED: 'SESSION_ENDED',
});

const VALID_ACTIONS = Object.values(ACTIONS);
const VALID_DECISIONS = Object.values(SEAT_DECISIONS);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value, maxLength = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isCents(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Normalize a submitted display name: trim, collapse whitespace, cap
 * length. Returns null when nothing displayable remains.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return [...cleaned].slice(0, MAX_NAME_LENGTH).join('');
}

/** Structural payload validators, one per message type. */
const PAYLOAD_VALIDATORS = {
  [MESSAGE_TYPES.JOIN_REQUEST]: (p) => {
    // Blank / unusable names are the host session's call (JOIN_REJECTED
    // with BAD_NAME); the protocol only bounds the field structurally.
    if (typeof p.name !== 'string' || p.name.length > 200) return 'invalid name';
    if (p.resume !== undefined) {
      if (!isPlainObject(p.resume)) return 'invalid resume';
      if (!isNonEmptyString(p.resume.playerId)) return 'invalid resume.playerId';
      if (!isNonEmptyString(p.resume.token)) return 'invalid resume.token';
    }
    return null;
  },
  [MESSAGE_TYPES.PLAYER_READY]: (p) => (
    typeof p.ready === 'boolean' ? null : 'invalid ready'
  ),
  [MESSAGE_TYPES.PLACE_BET]: (p) => (
    isCents(p.betCents) && p.betCents > 0 ? null : 'invalid betCents'
  ),
  [MESSAGE_TYPES.CLEAR_BET]: () => null,
  [MESSAGE_TYPES.GAME_ACTION]: (p) => (
    VALID_ACTIONS.includes(p.action) ? null : 'invalid action'
  ),
  [MESSAGE_TYPES.DECISION]: (p) => {
    if (!VALID_DECISIONS.includes(p.decision)) return 'invalid decision';
    if (typeof p.accept !== 'boolean') return 'invalid accept';
    return null;
  },
  [MESSAGE_TYPES.LEAVE_ROOM]: () => null,

  [MESSAGE_TYPES.JOIN_ACCEPTED]: (p) => {
    if (!isNonEmptyString(p.playerId)) return 'invalid playerId';
    if (!isNonEmptyString(p.reconnectToken)) return 'invalid reconnectToken';
    if (!isNonEmptyString(p.sessionId)) return 'invalid sessionId';
    if (!isPlainObject(p.room)) return 'invalid room';
    return null;
  },
  [MESSAGE_TYPES.JOIN_REJECTED]: (p) => (
    isNonEmptyString(p.code) ? null : 'invalid code'
  ),
  [MESSAGE_TYPES.PLAYER_LIST]: (p) => (
    Array.isArray(p.players) ? null : 'invalid players'
  ),
  [MESSAGE_TYPES.STATE_SNAPSHOT]: (p) => {
    if (!Number.isSafeInteger(p.revision) || p.revision < 0) return 'invalid revision';
    if (p.table !== null && !isPlainObject(p.table)) return 'invalid table';
    if (!isNonEmptyString(p.phase, 32)) return 'invalid phase';
    return null;
  },
  [MESSAGE_TYPES.ROUND_STARTED]: (p) => (
    Number.isSafeInteger(p.round) ? null : 'invalid round'
  ),
  [MESSAGE_TYPES.TURN_CHANGED]: (p) => (
    p.playerId === null || isNonEmptyString(p.playerId) ? null : 'invalid playerId'
  ),
  [MESSAGE_TYPES.ROUND_COMPLETED]: (p) => (
    Number.isSafeInteger(p.round) ? null : 'invalid round'
  ),
  [MESSAGE_TYPES.PLAYER_DISCONNECTED]: (p) => (
    isNonEmptyString(p.playerId) ? null : 'invalid playerId'
  ),
  [MESSAGE_TYPES.SESSION_ENDED]: (p) => (
    isNonEmptyString(p.reason, 64) ? null : 'invalid reason'
  ),
  [MESSAGE_TYPES.ERROR]: (p) => {
    if (!isNonEmptyString(p.code, 64)) return 'invalid code';
    return null;
  },
};

let messageCounter = 0;

/**
 * Unique message id: monotonic counter + random suffix, unique within and
 * across peers for the lifetime of a session.
 * @returns {string}
 */
export function nextMessageId() {
  messageCounter += 1;
  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(4)),
      (b) => b.toString(16).padStart(2, '0')).join('')
    : Math.floor(Math.random() * 0xffffffff).toString(16);
  return `m${messageCounter}-${random}`;
}

/**
 * Build a protocol envelope.
 * @param {string} type - a MESSAGE_TYPES value
 * @param {object} payload
 * @param {number} seq - per-sender monotonic sequence number
 * @returns {object}
 */
export function createMessage(type, payload, seq) {
  if (!Object.values(MESSAGE_TYPES).includes(type)) {
    throw new Error(`Unknown message type: ${type}`);
  }
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error(`Invalid seq: ${seq}`);
  return {
    v: PROTOCOL_VERSION,
    t: type,
    id: nextMessageId(),
    seq,
    p: payload ?? {},
  };
}

/** @param {object} message @returns {string} */
export function serializeMessage(message) {
  return JSON.stringify(message);
}

/**
 * Parse and validate one incoming frame.
 *
 * @param {unknown} raw - the DataChannel frame (expected: JSON string)
 * @param {object} [options]
 * @param {string[]} [options.allowedTypes] - accepted message types
 *   (CLIENT_MESSAGE_TYPES on a host, HOST_MESSAGE_TYPES on a client)
 * @returns {{ok: true, message: object} |
 *   {ok: false, code: string, detail: string}}
 */
export function parseMessage(raw, { allowedTypes = null } = {}) {
  const fail = (code, detail) => ({ ok: false, code, detail });
  if (typeof raw !== 'string') return fail(ERROR_CODES.MALFORMED, 'frame is not a string');
  if (raw.length > MAX_FRAME_LENGTH) return fail(ERROR_CODES.MALFORMED, 'frame too large');
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return fail(ERROR_CODES.MALFORMED, 'frame is not valid JSON');
  }
  if (!isPlainObject(message)) return fail(ERROR_CODES.MALFORMED, 'envelope is not an object');
  if (message.v !== PROTOCOL_VERSION) {
    return fail(
      ERROR_CODES.INCOMPATIBLE_PROTOCOL,
      `protocol version ${message.v} (expected ${PROTOCOL_VERSION})`,
    );
  }
  if (!isNonEmptyString(message.id, 64)) return fail(ERROR_CODES.MALFORMED, 'invalid message id');
  if (!Number.isSafeInteger(message.seq) || message.seq < 0) {
    return fail(ERROR_CODES.MALFORMED, 'invalid sequence number');
  }
  const validator = PAYLOAD_VALIDATORS[message.t];
  if (!validator) return fail(ERROR_CODES.UNKNOWN_TYPE, `unknown type ${message.t}`);
  if (allowedTypes && !allowedTypes.includes(message.t)) {
    return fail(ERROR_CODES.UNEXPECTED_TYPE, `unexpected type ${message.t}`);
  }
  if (!isPlainObject(message.p)) return fail(ERROR_CODES.MALFORMED, 'payload is not an object');
  const problem = validator(message.p);
  if (problem) return fail(ERROR_CODES.MALFORMED, `${message.t}: ${problem}`);
  return { ok: true, message };
}

/**
 * Per-sender replay / ordering guard. Sequence numbers must strictly
 * increase; duplicates and stale messages are rejected.
 */
export class SequenceGuard {
  constructor() {
    this.lastSeq = -1;
    this.seenIds = new Set();
  }

  /**
   * @param {object} message - a validated envelope
   * @returns {{ok: true} | {ok: false, code: string, detail: string}}
   */
  accept(message) {
    if (this.seenIds.has(message.id)) {
      return { ok: false, code: ERROR_CODES.DUPLICATE_MESSAGE, detail: message.id };
    }
    if (message.seq <= this.lastSeq) {
      return {
        ok: false,
        code: ERROR_CODES.OUT_OF_ORDER,
        detail: `seq ${message.seq} after ${this.lastSeq}`,
      };
    }
    this.seenIds.add(message.id);
    // The id set only needs to cover the reordering window.
    if (this.seenIds.size > 512) {
      const oldest = this.seenIds.values().next().value;
      this.seenIds.delete(oldest);
    }
    this.lastSeq = message.seq;
    return { ok: true };
  }
}
