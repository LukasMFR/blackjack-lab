/**
 * Authoritative-state synchronization helpers.
 *
 * The host broadcasts complete STATE_SNAPSHOT payloads with a
 * monotonically increasing revision. Clients render only confirmed host
 * state: `SnapshotStore` ignores any snapshot whose revision is not newer
 * than the one already applied, which makes delayed, duplicated and
 * out-of-order snapshots harmless.
 */

/** Session-level phases (the table has its own round states inside). */
export const ROOM_PHASES = Object.freeze({
  LOBBY: 'LOBBY',
  TABLE: 'TABLE',
  ENDED: 'ENDED',
});

/**
 * Build the payload of a STATE_SNAPSHOT message.
 * @param {object} options
 * @param {number} options.revision - monotonic state revision
 * @param {string} options.phase - ROOM_PHASES value
 * @param {boolean} options.paused
 * @param {object} options.room - static room facts (name, limits, profile)
 * @param {object[]} options.players - lobby-level player list
 * @param {object|null} options.table - MultiplayerTable snapshot or null
 * @param {object[]} options.history - recent per-round summaries
 * @returns {object}
 */
export function buildSnapshotPayload({
  revision, phase, paused, room, players, table, history,
}) {
  return {
    revision,
    phase,
    paused: Boolean(paused),
    room,
    players,
    table,
    history,
  };
}

/**
 * Client-side store of the last confirmed host state.
 */
export class SnapshotStore {
  constructor() {
    this.revision = -1;
    this.latest = null;
  }

  /**
   * Apply a STATE_SNAPSHOT payload if it is newer than what we have.
   * @param {object} payload - validated STATE_SNAPSHOT payload
   * @returns {boolean} true when the snapshot was applied
   */
  apply(payload) {
    if (payload.revision <= this.revision) return false;
    this.revision = payload.revision;
    this.latest = payload;
    return true;
  }
}

/**
 * Minimal event emitter for the session classes.
 * @returns {{on: Function, off: Function, emit: Function}}
 */
export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) {
        try {
          listener(payload);
        } catch (error) {
          console.error(`Listener for ${event} failed:`, error);
        }
      }
    },
  };
}

/**
 * Random id helper shared by the session modules.
 * @param {string} prefix
 * @returns {string}
 */
export function randomId(prefix) {
  const uuid = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),
      (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${uuid}`;
}
