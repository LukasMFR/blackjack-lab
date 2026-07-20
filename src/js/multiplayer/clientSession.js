import {
  createMessage,
  HOST_MESSAGE_TYPES,
  MESSAGE_TYPES,
  parseMessage,
  SequenceGuard,
  serializeMessage,
} from './protocol.js';
import { SnapshotStore, createEmitter } from './stateSync.js';

/**
 * The client side of a local multiplayer room: joins the host over one
 * transport, sends player intents, and exposes only *confirmed* host
 * state to the UI. It never computes game outcomes locally.
 *
 * Events (via `on(event, listener)`):
 *   'accepted'     {playerId, reconnectToken, sessionId, room}
 *   'rejected'     {code}
 *   'state'        snapshot payload (only when newer than the last)
 *   'event'        {type, payload} - ROUND_STARTED / TURN_CHANGED / …
 *   'error'        {code, detail?, ref?}
 *   'ended'        {reason}
 *   'closed'       {} - the transport dropped
 */
export class ClientSession {
  /**
   * @param {object} options
   * @param {object} options.transport - `{ id, send(frame), close() }`;
   *   `onMessage` / `onClose` are assigned by this session
   * @param {string} options.name - display name to request
   * @param {{playerId: string, token: string}|null} [options.resume]
   */
  constructor({ transport, name, resume = null }) {
    this.transport = transport;
    this.name = name;
    this.resume = resume;
    this.playerId = null;
    this.reconnectToken = null;
    this.sessionId = null;
    this.room = null;
    this.store = new SnapshotStore();
    this.guard = new SequenceGuard();
    this.outSeq = 0;
    this.joined = false;
    this.ended = false;
    this.events = createEmitter();
    transport.onMessage = (raw) => this.#handleFrame(raw);
    transport.onClose = () => {
      if (!this.ended) this.events.emit('closed', {});
    };
  }

  on(event, listener) {
    return this.events.on(event, listener);
  }

  /** Ask the host to join (or resume) the room. */
  join() {
    this.#send(MESSAGE_TYPES.JOIN_REQUEST, {
      name: this.name,
      ...(this.resume ? { resume: this.resume } : {}),
    });
  }

  /** @returns {object|null} last confirmed snapshot payload */
  get snapshot() {
    return this.store.latest;
  }

  /* ------------------------------------------------------------- intents */

  /** @param {boolean} ready */
  setReady(ready) {
    this.#send(MESSAGE_TYPES.PLAYER_READY, { ready: Boolean(ready) });
  }

  /** @param {number} betCents */
  placeBet(betCents) {
    this.#send(MESSAGE_TYPES.PLACE_BET, { betCents });
  }

  clearBet() {
    this.#send(MESSAGE_TYPES.CLEAR_BET, {});
  }

  /** @param {string} action - an ACTIONS value */
  act(action) {
    this.#send(MESSAGE_TYPES.GAME_ACTION, { action });
  }

  /**
   * @param {string} decision - a SEAT_DECISIONS value
   * @param {boolean} accept
   */
  decide(decision, accept) {
    this.#send(MESSAGE_TYPES.DECISION, { decision, accept: Boolean(accept) });
  }

  /** Leave the room for good (the seat is released). */
  leave() {
    this.#send(MESSAGE_TYPES.LEAVE_ROOM, {});
    this.ended = true;
    try {
      this.transport.close();
    } catch { /* already gone */ }
  }

  #send(type, payload) {
    this.outSeq += 1;
    const frame = serializeMessage(createMessage(type, payload, this.outSeq));
    try {
      this.transport.send(frame);
    } catch {
      this.events.emit('closed', {});
    }
  }

  /* ------------------------------------------------------------- incoming */

  #handleFrame(raw) {
    const parsed = parseMessage(raw, { allowedTypes: HOST_MESSAGE_TYPES });
    if (!parsed.ok) return; // never render unvalidated host frames
    const { message } = parsed;
    if (!this.guard.accept(message).ok) return; // duplicate / stale frame
    const payload = message.p;
    switch (message.t) {
      case MESSAGE_TYPES.JOIN_ACCEPTED:
        this.joined = true;
        this.playerId = payload.playerId;
        this.reconnectToken = payload.reconnectToken;
        this.sessionId = payload.sessionId;
        this.room = payload.room;
        this.events.emit('accepted', payload);
        break;
      case MESSAGE_TYPES.JOIN_REJECTED:
        this.events.emit('rejected', payload);
        break;
      case MESSAGE_TYPES.STATE_SNAPSHOT:
        if (this.store.apply(payload)) this.events.emit('state', payload);
        break;
      case MESSAGE_TYPES.PLAYER_LIST:
      case MESSAGE_TYPES.ROUND_STARTED:
      case MESSAGE_TYPES.TURN_CHANGED:
      case MESSAGE_TYPES.ROUND_COMPLETED:
      case MESSAGE_TYPES.PLAYER_DISCONNECTED:
        this.events.emit('event', { type: message.t, payload });
        break;
      case MESSAGE_TYPES.SESSION_ENDED:
        this.ended = true;
        this.events.emit('ended', payload);
        break;
      case MESSAGE_TYPES.ERROR:
        this.events.emit('error', payload);
        break;
      default:
        break;
    }
  }
}
