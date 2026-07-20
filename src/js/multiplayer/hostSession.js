import {
  CLIENT_MESSAGE_TYPES,
  createMessage,
  ERROR_CODES,
  MESSAGE_TYPES,
  parseMessage,
  sanitizeName,
  SequenceGuard,
  serializeMessage,
} from './protocol.js';
import { MultiplayerTable, SEAT_DECISIONS, TABLE_STATES } from './tableEngine.js';
import {
  buildSnapshotPayload, createEmitter, randomId, ROOM_PHASES,
} from './stateSync.js';
import { unitsToCents } from '../game/money.js';

/**
 * The authoritative host side of a local multiplayer room.
 *
 * The host owns the room, the seats, the shoe (via MultiplayerTable), the
 * bankrolls, the turn order and every settlement. Clients only submit
 * intents over attached transports; every frame is validated by the
 * protocol module, checked against a per-connection sequence guard, and
 * then executed against the table engine, which throws on anything
 * illegal. After every accepted command the host broadcasts a full
 * snapshot with a new revision.
 *
 * This class is transport-agnostic: a transport is any object with
 * `{ id, send(frame), close() }` whose `onMessage` / `onClose` properties
 * the session assigns. In the browser that is a WebRTC DataChannel
 * wrapper (peerConnection.js); in tests it is an in-memory fake.
 */

const HISTORY_LIMIT = 30;

/** localStorage key (via ui/storage.js) for host room persistence. */
export const HOST_ROOM_STORAGE_KEY = 'mp.hostRoom';

const PERSISTABLE_TABLE_STATES = [TABLE_STATES.BETTING, TABLE_STATES.ROUND_COMPLETE];

export class HostSession {
  /**
   * @param {object} options
   * @param {object} options.config
   * @param {string} options.config.roomName
   * @param {number} options.config.maxPlayers - total seats incl. the host
   * @param {boolean} options.config.hostPlays
   * @param {string} options.config.hostName
   * @param {object} options.config.profile - resolved, validated profile
   * @param {number} [options.config.startingBankrollUnits]
   * @param {number} [options.config.minBetUnits]
   * @param {number} [options.config.maxBetUnits]
   * @param {object|null} [options.storage] - ui/storage.js-compatible store
   * @param {object} [options.tableOptions] - extra MultiplayerTable options
   *   (deterministic shoe injection in tests)
   * @param {object|null} [options.restore] - persisted record to restore
   */
  constructor({ config, storage = null, tableOptions = {}, restore = null }) {
    this.config = {
      roomName: sanitizeName(config.roomName) ?? 'Blackjack Lab',
      maxPlayers: config.maxPlayers,
      hostPlays: Boolean(config.hostPlays),
      hostName: sanitizeName(config.hostName) ?? 'Host',
      profile: config.profile,
      startingBankrollUnits: config.startingBankrollUnits
        ?? config.profile.startingBankrollUnits,
      minBetUnits: config.minBetUnits ?? config.profile.minBetUnits,
      maxBetUnits: config.maxBetUnits ?? config.profile.maxBetUnits,
    };
    if (!Number.isInteger(this.config.maxPlayers)
      || this.config.maxPlayers < 1 || this.config.maxPlayers > 7) {
      throw new Error(`Invalid maxPlayers: ${config.maxPlayers}`);
    }
    this.storage = storage;
    this.tableOptions = tableOptions;
    this.sessionId = restore?.sessionId ?? randomId('room');
    this.phase = ROOM_PHASES.LOBBY;
    this.paused = false;
    this.revision = 0;
    this.outSeq = 0;
    this.table = null;
    this.history = [];
    this.lastRecordedRound = 0;
    this.lastActivePlayerId = null;
    this.events = createEmitter();

    /** @type {Map<string, object>} playerId → player record */
    this.players = new Map();
    this.hostPlayerId = null;

    if (this.config.hostPlays) {
      this.hostPlayerId = restore?.hostPlayerId ?? randomId('player');
      this.players.set(this.hostPlayerId, {
        playerId: this.hostPlayerId,
        name: this.config.hostName,
        token: randomId('token'),
        isHost: true,
        connected: true,
        ready: false,
        transport: null,
        guard: null,
        bankrollCents: restore?.players
          ?.find((p) => p.playerId === restore.hostPlayerId)?.bankrollCents ?? null,
      });
    }
    if (restore) {
      for (const saved of restore.players ?? []) {
        if (saved.playerId === restore.hostPlayerId) continue;
        this.players.set(saved.playerId, {
          playerId: saved.playerId,
          name: saved.name,
          token: saved.token,
          isHost: false,
          connected: false,
          ready: false,
          transport: null,
          guard: null,
          bankrollCents: saved.bankrollCents ?? null,
        });
      }
      this.history = restore.history ?? [];
      this.lastRecordedRound = restore.roundCounter ?? 0;
    }
  }

  /* ------------------------------------------------------------ transports */

  /**
   * Wire a freshly connected transport into the session. The peer is not
   * a player until its JOIN_REQUEST is accepted.
   * @param {object} transport
   */
  attachTransport(transport) {
    transport.onMessage = (raw) => this.#handleFrame(transport, raw);
    transport.onClose = () => this.#handleTransportClosed(transport);
    transport.guard = new SequenceGuard();
    transport.playerId = null;
  }

  #handleTransportClosed(transport) {
    const player = transport.playerId ? this.players.get(transport.playerId) : null;
    if (!player || player.transport !== transport) return;
    player.transport = null;
    player.connected = false;
    player.ready = false;
    this.table?.setConnected(player.playerId, false);
    this.#sendEventToAll(MESSAGE_TYPES.PLAYER_DISCONNECTED, { playerId: player.playerId });
    this.#commit();
  }

  #send(transport, type, payload) {
    this.outSeq += 1;
    const frame = serializeMessage(createMessage(type, payload, this.outSeq));
    try {
      transport.send(frame);
    } catch {
      /* the transport died mid-send; its onClose handler cleans up */
    }
  }

  #sendError(transport, code, detail, refId = null) {
    this.#send(transport, MESSAGE_TYPES.ERROR, {
      code,
      ...(detail ? { detail } : {}),
      ...(refId ? { ref: refId } : {}),
    });
  }

  #connectedTransports() {
    return [...this.players.values()]
      .filter((p) => p.transport)
      .map((p) => p.transport);
  }

  #sendEventToAll(type, payload) {
    for (const transport of this.#connectedTransports()) {
      this.#send(transport, type, payload);
    }
  }

  /* ---------------------------------------------------------- join handling */

  #handleFrame(transport, raw) {
    const parsed = parseMessage(raw, { allowedTypes: CLIENT_MESSAGE_TYPES });
    if (!parsed.ok) {
      this.#sendError(transport, parsed.code, parsed.detail);
      return;
    }
    const { message } = parsed;
    const order = transport.guard.accept(message);
    if (!order.ok) {
      // Duplicates are dropped silently: resent intents must not execute
      // twice, and the sender already acted on the first copy.
      return;
    }
    if (this.phase === ROOM_PHASES.ENDED) {
      this.#sendError(transport, ERROR_CODES.SESSION_ENDED, null, message.id);
      return;
    }
    if (message.t === MESSAGE_TYPES.JOIN_REQUEST) {
      try {
        this.#handleJoin(transport, message);
      } catch (error) {
        // A join must never take the host down; the peer is told to retry.
        console.error('Join failed:', error);
        this.#send(transport, MESSAGE_TYPES.JOIN_REJECTED, { code: ERROR_CODES.WRONG_STATE });
      }
      return;
    }
    if (!transport.playerId) {
      this.#sendError(transport, ERROR_CODES.NOT_JOINED, null, message.id);
      return;
    }
    this.#executeCommand(transport, transport.playerId, message);
  }

  #handleJoin(transport, message) {
    if (transport.playerId) {
      this.#sendError(transport, ERROR_CODES.ALREADY_JOINED, null, message.id);
      return;
    }
    const { resume } = message.p;
    if (resume) {
      const player = this.players.get(resume.playerId);
      if (!player || player.token !== resume.token) {
        this.#send(transport, MESSAGE_TYPES.JOIN_REJECTED, { code: ERROR_CODES.BAD_TOKEN });
        return;
      }
      this.#bindTransport(player, transport);
      this.events.emit('playerReconnected', { playerId: player.playerId });
      this.#acceptJoin(transport, player);
      return;
    }
    const name = sanitizeName(message.p.name);
    if (!name) {
      this.#send(transport, MESSAGE_TYPES.JOIN_REJECTED, { code: ERROR_CODES.BAD_NAME });
      return;
    }
    if (this.players.size >= this.config.maxPlayers) {
      this.#send(transport, MESSAGE_TYPES.JOIN_REJECTED, { code: ERROR_CODES.ROOM_FULL });
      return;
    }
    const player = {
      playerId: randomId('player'),
      name,
      token: randomId('token'),
      isHost: false,
      connected: true,
      ready: false,
      transport: null,
      guard: null,
      bankrollCents: null,
    };
    this.players.set(player.playerId, player);
    if (this.table) this.#seatPlayer(player);
    this.#bindTransport(player, transport);
    this.events.emit('playerJoined', { playerId: player.playerId, name });
    this.#acceptJoin(transport, player);
  }

  #bindTransport(player, transport) {
    const previous = player.transport;
    player.transport = transport;
    player.connected = true;
    transport.playerId = player.playerId;
    if (previous && previous !== transport) {
      // Unbind before closing so the close handler cannot mistake this
      // deliberate replacement for a disconnection.
      previous.playerId = null;
      try {
        previous.close();
      } catch { /* already gone */ }
    }
    this.table?.setConnected(player.playerId, true);
  }

  #acceptJoin(transport, player) {
    this.#send(transport, MESSAGE_TYPES.JOIN_ACCEPTED, {
      playerId: player.playerId,
      reconnectToken: player.token,
      sessionId: this.sessionId,
      room: this.#roomFacts(),
    });
    this.#sendEventToAll(MESSAGE_TYPES.PLAYER_LIST, { players: this.#playerList() });
    this.#commit();
  }

  #seatPlayer(player) {
    if (this.table.getSeat(player.playerId)) return;
    this.table.addPlayer({
      playerId: player.playerId,
      name: player.name,
      bankrollCents: player.bankrollCents
        ?? unitsToCents(this.config.startingBankrollUnits),
    });
  }

  /* ------------------------------------------------------------- commands */

  #executeCommand(transport, playerId, message) {
    const { t: type, p: payload, id } = message;
    const gameplayPaused = this.paused
      && type !== MESSAGE_TYPES.LEAVE_ROOM;
    if (gameplayPaused) {
      this.#sendError(transport, ERROR_CODES.WRONG_STATE, 'session paused', id);
      return;
    }
    try {
      switch (type) {
        case MESSAGE_TYPES.PLAYER_READY:
          this.#commandReady(playerId, payload.ready);
          break;
        case MESSAGE_TYPES.PLACE_BET:
          this.#requireTable().placeBet(playerId, payload.betCents);
          break;
        case MESSAGE_TYPES.CLEAR_BET:
          this.#requireTable().clearBet(playerId);
          break;
        case MESSAGE_TYPES.GAME_ACTION:
          this.#requireTable().act(playerId, payload.action);
          break;
        case MESSAGE_TYPES.DECISION:
          if (payload.decision === SEAT_DECISIONS.INSURANCE) {
            this.#requireTable().decideInsurance(playerId, payload.accept);
          } else {
            this.#requireTable().decideEarlySurrender(playerId, payload.accept);
          }
          break;
        case MESSAGE_TYPES.LEAVE_ROOM:
          this.#commandLeave(playerId);
          break;
        default:
          this.#sendError(transport, ERROR_CODES.UNEXPECTED_TYPE, type, id);
          return;
      }
    } catch (error) {
      this.#sendError(transport, this.#errorCode(type, error), error.message, id);
      return;
    }
    this.#commit();
  }

  #errorCode(type, error) {
    const text = String(error.message);
    if (text.includes('turn')) return ERROR_CODES.NOT_YOUR_TURN;
    if (type === MESSAGE_TYPES.PLACE_BET || type === MESSAGE_TYPES.CLEAR_BET) {
      return ERROR_CODES.ILLEGAL_BET;
    }
    if (text.includes('state')) return ERROR_CODES.WRONG_STATE;
    return ERROR_CODES.ILLEGAL_ACTION;
  }

  #requireTable() {
    if (!this.table) throw new Error('Expected table state: the game has not started');
    return this.table;
  }

  #commandReady(playerId, ready) {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Unknown player: ${playerId}`);
    player.ready = Boolean(ready);
    if (this.table && this.table.state === TABLE_STATES.BETTING) {
      this.table.setReady(playerId, ready);
    }
  }

  #commandLeave(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (this.table?.getSeat(playerId)) this.table.removePlayer(playerId);
    this.players.delete(playerId);
    if (player.transport) {
      player.transport.playerId = null;
      try {
        player.transport.close();
      } catch { /* already gone */ }
      player.transport = null;
    }
    this.events.emit('playerLeft', { playerId });
    this.#sendEventToAll(MESSAGE_TYPES.PLAYER_LIST, { players: this.#playerList() });
  }

  /* ----------------------------------------------------- host-only controls */

  /**
   * Execute a command as a locally seated player (the host playing on the
   * host device). Uses exactly the same validation path as remote players:
   * the table engine enforces turn ownership and legality.
   * @param {string} type - a client MESSAGE_TYPES value
   * @param {object} [payload]
   */
  localCommand(type, payload = {}) {
    if (!this.hostPlayerId) throw new Error('Host is not seated as a player');
    if (this.phase === ROOM_PHASES.ENDED) throw new Error('Session ended');
    if (this.paused) throw new Error('Session paused');
    switch (type) {
      case MESSAGE_TYPES.PLAYER_READY:
        this.#commandReady(this.hostPlayerId, payload.ready);
        break;
      case MESSAGE_TYPES.PLACE_BET:
        this.#requireTable().placeBet(this.hostPlayerId, payload.betCents);
        break;
      case MESSAGE_TYPES.CLEAR_BET:
        this.#requireTable().clearBet(this.hostPlayerId);
        break;
      case MESSAGE_TYPES.GAME_ACTION:
        this.#requireTable().act(this.hostPlayerId, payload.action);
        break;
      case MESSAGE_TYPES.DECISION:
        if (payload.decision === SEAT_DECISIONS.INSURANCE) {
          this.#requireTable().decideInsurance(this.hostPlayerId, payload.accept);
        } else {
          this.#requireTable().decideEarlySurrender(this.hostPlayerId, payload.accept);
        }
        break;
      default:
        throw new Error(`Unsupported local command: ${type}`);
    }
    this.#commit();
  }

  /**
   * Move from the lobby to the table: seat every joined player (and the
   * host, when playing) and open the betting phase.
   */
  startGame() {
    if (this.phase !== ROOM_PHASES.LOBBY) throw new Error('Game already started');
    if (this.players.size === 0) throw new Error('No players have joined');
    this.table = new MultiplayerTable({
      profile: this.config.profile,
      maxSeats: this.config.maxPlayers,
      startingBankrollCents: unitsToCents(this.config.startingBankrollUnits),
      minBetCents: unitsToCents(this.config.minBetUnits),
      maxBetCents: unitsToCents(this.config.maxBetUnits),
      ...this.tableOptions,
    });
    for (const player of this.players.values()) {
      this.#seatPlayer(player);
      if (!player.connected && !player.isHost) {
        this.table.setConnected(player.playerId, false);
      }
    }
    this.phase = ROOM_PHASES.TABLE;
    this.#commit();
  }

  /** Deal the next round once bets are in. */
  startRound() {
    const table = this.#requireTable();
    if (this.paused) throw new Error('Session paused');
    table.startRound();
    this.#sendEventToAll(MESSAGE_TYPES.ROUND_STARTED, { round: table.roundCounter });
    this.#commit();
  }

  /** Return the table to betting after a completed round. */
  nextRound() {
    this.#requireTable().nextRound();
    this.#commit();
  }

  /**
   * Pause or resume gameplay commands (connections stay up).
   * @param {boolean} paused
   */
  setPaused(paused) {
    this.paused = Boolean(paused);
    this.#commit();
  }

  /**
   * End the room for everyone.
   * @param {string} [reason]
   */
  endSession(reason = 'HOST_ENDED') {
    if (this.phase === ROOM_PHASES.ENDED) return;
    this.#sendEventToAll(MESSAGE_TYPES.SESSION_ENDED, { reason });
    this.phase = ROOM_PHASES.ENDED;
    for (const player of this.players.values()) {
      const transport = player.transport;
      if (transport) {
        player.transport = null;
        transport.playerId = null;
        try {
          transport.close();
        } catch { /* already gone */ }
      }
      player.connected = player.isHost;
    }
    this.storage?.clear(HOST_ROOM_STORAGE_KEY);
    this.events.emit('ended', { reason });
    this.events.emit('change');
  }

  /* -------------------------------------------------------------- snapshots */

  #roomFacts() {
    return {
      name: this.config.roomName,
      maxPlayers: this.config.maxPlayers,
      hostPlays: this.config.hostPlays,
      hostPlayerId: this.hostPlayerId,
      profileId: this.config.profile.id,
      startingBankrollUnits: this.config.startingBankrollUnits,
      minBetUnits: this.config.minBetUnits,
      maxBetUnits: this.config.maxBetUnits,
      protocolVersion: 1,
    };
  }

  #playerList() {
    return [...this.players.values()].map((p) => ({
      playerId: p.playerId,
      name: p.name,
      isHost: p.isHost,
      connected: p.connected,
      ready: p.ready,
    }));
  }

  /** @returns {object} the payload clients receive in STATE_SNAPSHOT */
  buildSnapshot() {
    return buildSnapshotPayload({
      revision: this.revision,
      phase: this.phase,
      paused: this.paused,
      room: this.#roomFacts(),
      players: this.#playerList(),
      table: this.table ? this.table.getSnapshot() : null,
      history: this.history,
    });
  }

  /**
   * Record state changes: bump the revision, capture round history,
   * notify clients and the host UI, and persist between rounds.
   */
  #commit() {
    if (this.phase === ROOM_PHASES.ENDED) return;
    this.revision += 1;
    this.#recordCompletedRound();
    const payload = this.buildSnapshot();
    this.outSeq += 1;
    const frame = serializeMessage(
      createMessage(MESSAGE_TYPES.STATE_SNAPSHOT, payload, this.outSeq),
    );
    for (const transport of this.#connectedTransports()) {
      try {
        transport.send(frame);
      } catch { /* transport closing; its onClose cleans up */ }
    }
    this.#emitTurnChange();
    this.#persist();
    this.events.emit('change');
  }

  #emitTurnChange() {
    const active = this.table?.getSnapshot ? this.table.seats[this.table.activeSeatIndex] : null;
    const activePlayerId = active?.playerId ?? null;
    if (activePlayerId !== this.lastActivePlayerId) {
      this.lastActivePlayerId = activePlayerId;
      this.#sendEventToAll(MESSAGE_TYPES.TURN_CHANGED, { playerId: activePlayerId });
    }
  }

  #recordCompletedRound() {
    const table = this.table;
    if (!table || table.state !== TABLE_STATES.ROUND_COMPLETE) return;
    if (table.roundCounter <= this.lastRecordedRound) return;
    this.lastRecordedRound = table.roundCounter;
    this.history.push({
      round: table.roundCounter,
      summaries: table.roundSummaries,
    });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    // Bankrolls survive on the player record even if the seat later leaves.
    for (const player of this.players.values()) {
      const seat = table.getSeat(player.playerId);
      if (seat) player.bankrollCents = seat.bankrollCents;
    }
    this.#sendEventToAll(MESSAGE_TYPES.ROUND_COMPLETED, { round: table.roundCounter });
  }

  /* ------------------------------------------------------------ persistence */

  /**
   * Persist the room between rounds so an accidental host-page rerender
   * can restore names, tokens and bankrolls. Mid-round card state is
   * never persisted; peer connections cannot survive a reload anyway.
   */
  #persist() {
    if (!this.storage) return;
    if (this.table && !PERSISTABLE_TABLE_STATES.includes(this.table.state)) return;
    this.storage.setObject(HOST_ROOM_STORAGE_KEY, {
      sessionId: this.sessionId,
      savedAt: Date.now(),
      roomName: this.config.roomName,
      maxPlayers: this.config.maxPlayers,
      hostPlays: this.config.hostPlays,
      hostName: this.config.hostName,
      hostPlayerId: this.hostPlayerId,
      profileId: this.config.profile.id,
      startingBankrollUnits: this.config.startingBankrollUnits,
      minBetUnits: this.config.minBetUnits,
      maxBetUnits: this.config.maxBetUnits,
      roundCounter: this.table?.roundCounter ?? 0,
      history: this.history,
      players: [...this.players.values()].map((p) => ({
        playerId: p.playerId,
        name: p.name,
        token: p.token,
        bankrollCents: p.bankrollCents
          ?? (this.table?.getSeat(p.playerId)?.bankrollCents ?? null),
      })),
    });
  }

  /**
   * Read a previously persisted room record.
   * @param {object} storage - ui/storage.js-compatible store
   * @returns {object|null}
   */
  static readPersisted(storage) {
    const record = storage.getObject(HOST_ROOM_STORAGE_KEY);
    if (!record || typeof record.sessionId !== 'string'
      || !Array.isArray(record.players)) {
      return null;
    }
    return record;
  }

  /** @param {object} storage */
  static clearPersisted(storage) {
    storage.clear(HOST_ROOM_STORAGE_KEY);
  }
}
