import { test, assert, assertEqual, assertThrows } from './runner.js';
import { HostSession, HOST_ROOM_STORAGE_KEY } from '../src/js/multiplayer/hostSession.js';
import { ClientSession } from '../src/js/multiplayer/clientSession.js';
import {
  createMessage, ERROR_CODES, MESSAGE_TYPES, serializeMessage,
} from '../src/js/multiplayer/protocol.js';
import { ROOM_PHASES } from '../src/js/multiplayer/stateSync.js';
import { TABLE_STATES } from '../src/js/multiplayer/tableEngine.js';
import { Shoe } from '../src/js/game/shoe.js';
import { ACTIONS } from '../src/js/game/constants.js';
import { PROFILES } from '../src/js/config/profiles.js';
import { useFakeStorage } from './fakeStorage.js';
import * as storage from '../src/js/ui/storage.js';

const C = (rank, suit = 'SPADES') => ({ rank, suit });
const UNITS = 100;

/** Two synchronously linked transport endpoints (host end, client end). */
function transportPair(id = 'pair') {
  let closed = false;
  const hostEnd = { id: `${id}-host` };
  const clientEnd = { id: `${id}-client` };
  hostEnd.send = (frame) => { if (!closed) clientEnd.onMessage?.(frame); };
  clientEnd.send = (frame) => { if (!closed) hostEnd.onMessage?.(frame); };
  const close = () => {
    if (closed) return;
    closed = true;
    hostEnd.onClose?.();
    clientEnd.onClose?.();
  };
  hostEnd.close = close;
  clientEnd.close = close;
  return [hostEnd, clientEnd];
}

function createRoom({
  hostPlays = true, maxPlayers = 4, sequence = null, withStorage = null,
} = {}) {
  return new HostSession({
    config: {
      roomName: 'Test Room',
      maxPlayers,
      hostPlays,
      hostName: 'Host',
      profile: PROFILES.FRENCH_STANDARD,
    },
    storage: withStorage,
    tableOptions: sequence ? { shoe: Shoe.fromSequence(sequence) } : {},
  });
}

function connectClient(session, name, resume = null) {
  const [hostEnd, clientEnd] = transportPair(name);
  session.attachTransport(hostEnd);
  const client = new ClientSession({ transport: clientEnd, name, resume });
  const events = { errors: [], states: [], ended: [], rejected: [], accepted: [] };
  client.on('error', (e) => events.errors.push(e));
  client.on('state', (s) => events.states.push(s));
  client.on('ended', (e) => events.ended.push(e));
  client.on('rejected', (e) => events.rejected.push(e));
  client.on('accepted', (e) => events.accepted.push(e));
  client.join();
  return { client, events, hostEnd, clientEnd };
}

/** A raw scripted peer for adversarial frames (no ClientSession rules). */
function connectRaw(session) {
  const [hostEnd, clientEnd] = transportPair('raw');
  session.attachTransport(hostEnd);
  const received = [];
  clientEnd.onMessage = (frame) => received.push(JSON.parse(frame));
  return {
    send: (type, payload, seq) => clientEnd.send(
      serializeMessage(createMessage(type, payload, seq)),
    ),
    sendFrame: (frame) => clientEnd.send(frame),
    received,
    clientEnd,
  };
}

// -------------------------------------------------------------- join flow

test('a client joins the lobby and receives identity plus a snapshot', () => {
  const session = createRoom();
  const { client, events } = connectClient(session, 'Ana');
  assert(client.joined, 'client joined');
  assert(client.playerId, 'player id assigned');
  assert(client.reconnectToken, 'reconnect token assigned');
  assertEqual(events.accepted[0].room.name, 'Test Room');
  assertEqual(client.snapshot.phase, ROOM_PHASES.LOBBY);
  const names = client.snapshot.players.map((p) => p.name).sort();
  assertEqual(JSON.stringify(names), JSON.stringify(['Ana', 'Host']));
});

test('joining with a blank name or into a full room is rejected', () => {
  const session = createRoom({ maxPlayers: 1 }); // the playing host fills it
  const bad = connectClient(session, '   ');
  assertEqual(bad.events.rejected[0].code, ERROR_CODES.BAD_NAME);
  const full = connectClient(session, 'Late');
  assertEqual(full.events.rejected[0].code, ERROR_CODES.ROOM_FULL);
});

test('a host that does not play is absent from the player list', () => {
  const session = createRoom({ hostPlays: false });
  const { client } = connectClient(session, 'Solo');
  assertEqual(client.snapshot.players.length, 1);
  assertThrows(() => session.localCommand(MESSAGE_TYPES.PLACE_BET, { betCents: 5000 }),
    'not seated');
});

// ------------------------------------------------------------ full rounds

test('host and two clients complete a round; every device sees the result', () => {
  const session = createRoom({
    sequence: [
      C('10'), C('10', 'HEARTS'), C('10', 'DIAMONDS'), // first cards
      C('9', 'CLUBS'),                                  // upcard
      C('9'), C('8', 'HEARTS'), C('7', 'DIAMONDS'),     // second cards
      C('8', 'DIAMONDS'),                               // dealer -> 17
    ],
  });
  const a = connectClient(session, 'Ana');
  const b = connectClient(session, 'Bob');
  session.startGame();
  assertEqual(session.phase, ROOM_PHASES.TABLE);
  assertEqual(a.client.snapshot.table.seats.length, 3);

  session.localCommand(MESSAGE_TYPES.PLACE_BET, { betCents: 50 * UNITS });
  a.client.placeBet(50 * UNITS);
  b.client.placeBet(50 * UNITS);
  session.localCommand(MESSAGE_TYPES.PLAYER_READY, { ready: true });
  a.client.setReady(true);
  b.client.setReady(true);
  assert(session.table.allBettersReady(), 'all ready');
  session.startRound();

  // Host seat acts first (host 19), then Ana (18), then Bob (17).
  session.localCommand(MESSAGE_TYPES.GAME_ACTION, { action: ACTIONS.STAND });
  a.client.act(ACTIONS.STAND);
  b.client.act(ACTIONS.STAND);

  const table = b.client.snapshot.table;
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  const bank = (snapshotTable, name) => snapshotTable.seats
    .find((s) => s.name === name).bankrollCents / UNITS;
  assertEqual(bank(table, 'Host'), 1050); // 19 v 17 win
  assertEqual(bank(table, 'Ana'), 1050);  // 18 v 17 win
  assertEqual(bank(table, 'Bob'), 1000);  // 17 v 17 push
  // Every client converged on the same revision.
  assertEqual(a.client.snapshot.revision, b.client.snapshot.revision);
  assertEqual(session.history.length, 1);
});

test('acting out of turn returns NOT_YOUR_TURN and does not change state', () => {
  const session = createRoom({
    sequence: [
      C('10'), C('10', 'HEARTS'), C('9', 'CLUBS'),
      C('9'), C('8', 'HEARTS'), C('8', 'DIAMONDS'),
    ],
  });
  const a = connectClient(session, 'Ana');
  session.startGame();
  session.localCommand(MESSAGE_TYPES.PLACE_BET, { betCents: 50 * UNITS });
  a.client.placeBet(50 * UNITS);
  session.startRound();

  const revisionBefore = session.revision;
  a.client.act(ACTIONS.HIT); // host seat is first: not Ana's turn
  assertEqual(a.events.errors[0].code, ERROR_CODES.NOT_YOUR_TURN);
  assertEqual(session.revision, revisionBefore, 'rejected intent changes nothing');
});

test('a client cannot bet more than the host-tracked bankroll', () => {
  const session = createRoom();
  const a = connectClient(session, 'Ana');
  session.startGame();
  a.client.placeBet(5000 * UNITS);
  assertEqual(a.events.errors[0].code, ERROR_CODES.ILLEGAL_BET);
});

// ------------------------------------------- duplicates, ordering, unknowns

test('duplicated intents execute only once', () => {
  const session = createRoom({ hostPlays: false });
  const raw = connectRaw(session);
  raw.send(MESSAGE_TYPES.JOIN_REQUEST, { name: 'Raw' }, 1);
  session.startGame();
  const frame = serializeMessage(createMessage(MESSAGE_TYPES.PLACE_BET, { betCents: 5000 }, 2));
  raw.sendFrame(frame);
  const afterFirst = session.revision;
  raw.sendFrame(frame); // exact duplicate: dropped silently
  assertEqual(session.revision, afterFirst);
  assertEqual(session.table.seats[0].betCents, 5000);
});

test('out-of-order intents are dropped', () => {
  const session = createRoom({ hostPlays: false });
  const raw = connectRaw(session);
  raw.send(MESSAGE_TYPES.JOIN_REQUEST, { name: 'Raw' }, 1);
  session.startGame();
  raw.send(MESSAGE_TYPES.PLACE_BET, { betCents: 100 * UNITS }, 10);
  raw.send(MESSAGE_TYPES.PLACE_BET, { betCents: 50 * UNITS }, 5); // stale
  assertEqual(session.table.seats[0].betCents, 100 * UNITS);
});

test('commands before joining are refused', () => {
  const session = createRoom();
  const raw = connectRaw(session);
  raw.send(MESSAGE_TYPES.GAME_ACTION, { action: ACTIONS.HIT }, 1);
  const error = raw.received.find((m) => m.t === MESSAGE_TYPES.ERROR);
  assertEqual(error.p.code, ERROR_CODES.NOT_JOINED);
});

test('frames from an incompatible protocol version are answered with an error', () => {
  const session = createRoom();
  const raw = connectRaw(session);
  raw.sendFrame(JSON.stringify({ v: 99, t: 'JOIN_REQUEST', id: 'x', seq: 1, p: { name: 'A' } }));
  const error = raw.received.find((m) => m.t === MESSAGE_TYPES.ERROR);
  assertEqual(error.p.code, ERROR_CODES.INCOMPATIBLE_PROTOCOL);
});

// ------------------------------------------------------------- disconnects

test('a dropped connection refunds a pending bet and flags the player', () => {
  const session = createRoom();
  const a = connectClient(session, 'Ana');
  session.startGame();
  a.client.placeBet(100 * UNITS);
  const seat = () => session.table.getSeat(a.client.playerId);
  assertEqual(seat().betCents, 100 * UNITS);
  a.clientEnd.close();
  assertEqual(seat().betCents, 0);
  assertEqual(seat().bankrollCents, 1000 * UNITS);
  assert(!seat().connected, 'seat flagged disconnected');
});

test('a player who drops mid-turn is stood and play continues', () => {
  const session = createRoom({
    sequence: [
      C('10'), C('10', 'HEARTS'), C('9', 'CLUBS'),
      C('9'), C('8', 'HEARTS'),
      C('8', 'DIAMONDS'), // dealer -> 17
    ],
  });
  const a = connectClient(session, 'Ana');
  session.startGame();
  session.localCommand(MESSAGE_TYPES.PLACE_BET, { betCents: 50 * UNITS });
  a.client.placeBet(50 * UNITS);
  session.startRound();
  // Host stands; Ana is now active and vanishes.
  session.localCommand(MESSAGE_TYPES.GAME_ACTION, { action: ACTIONS.STAND });
  a.clientEnd.close();
  assertEqual(session.table.state, TABLE_STATES.ROUND_COMPLETE);
  assertEqual(session.table.getSeat(a.client.playerId).hands[0].result, 'WIN'); // 18 v 17
});

test('a reconnect token restores the same seat and bankroll', () => {
  const session = createRoom({
    sequence: [
      C('10'), C('10', 'HEARTS'), C('9', 'CLUBS'),
      C('9'), C('8', 'HEARTS'), C('8', 'DIAMONDS'),
    ],
  });
  const a = connectClient(session, 'Ana');
  session.startGame();
  session.localCommand(MESSAGE_TYPES.PLACE_BET, { betCents: 50 * UNITS });
  a.client.placeBet(50 * UNITS);
  session.startRound();
  session.localCommand(MESSAGE_TYPES.GAME_ACTION, { action: ACTIONS.STAND });
  a.client.act(ACTIONS.STAND);
  assertEqual(session.table.state, TABLE_STATES.ROUND_COMPLETE);

  const identity = { playerId: a.client.playerId, token: a.client.reconnectToken };
  a.clientEnd.close();
  assert(!session.table.getSeat(identity.playerId).connected, 'disconnected');

  const back = connectClient(session, 'Ana', identity);
  assert(back.client.joined, 'resumed');
  assertEqual(back.client.playerId, identity.playerId);
  const seat = session.table.getSeat(identity.playerId);
  assert(seat.connected, 'reconnected seat');
  assertEqual(seat.bankrollCents, 1050 * UNITS); // won the round while away
});

test('a bad reconnect token is rejected', () => {
  const session = createRoom();
  const a = connectClient(session, 'Ana');
  const identity = { playerId: a.client.playerId, token: 'forged-token' };
  a.clientEnd.close();
  const back = connectClient(session, 'Ana', identity);
  assertEqual(back.events.rejected[0].code, ERROR_CODES.BAD_TOKEN);
});

test('leaving the room releases the seat', () => {
  const session = createRoom();
  const a = connectClient(session, 'Ana');
  session.startGame();
  const playerId = a.client.playerId;
  a.client.leave();
  assertEqual(session.players.get(playerId), undefined);
  assertEqual(session.table.getSeat(playerId), undefined);
});

// ------------------------------------------------------------ host controls

test('pausing rejects gameplay commands until resumed', () => {
  const session = createRoom();
  const a = connectClient(session, 'Ana');
  session.startGame();
  session.setPaused(true);
  a.client.placeBet(50 * UNITS);
  assertEqual(a.events.errors[0].code, ERROR_CODES.WRONG_STATE);
  assertThrows(() => session.localCommand(MESSAGE_TYPES.PLACE_BET, { betCents: 5000 }), 'paused');
  session.setPaused(false);
  a.client.placeBet(50 * UNITS);
  assertEqual(session.table.getSeat(a.client.playerId).betCents, 50 * UNITS);
});

test('ending the session notifies every client and closes the room', () => {
  const session = createRoom();
  const a = connectClient(session, 'Ana');
  const b = connectClient(session, 'Bob');
  session.endSession('HOST_ENDED');
  assertEqual(a.events.ended[0].reason, 'HOST_ENDED');
  assertEqual(b.events.ended[0].reason, 'HOST_ENDED');
  assertEqual(session.phase, ROOM_PHASES.ENDED);
});

test('players joining after the game started are seated for the next round', () => {
  const session = createRoom({
    sequence: [
      C('10'), C('9', 'CLUBS'), C('9'), C('8', 'DIAMONDS'),
    ],
  });
  session.startGame();
  session.localCommand(MESSAGE_TYPES.PLACE_BET, { betCents: 50 * UNITS });
  session.startRound();
  const late = connectClient(session, 'Late');
  const seat = session.table.getSeat(late.client.playerId);
  assert(seat, 'late joiner has a seat');
  assert(seat.sittingOut, 'late joiner sits out the running round');
});

// ------------------------------------------------------------- persistence

test('the room persists between rounds and can be restored with bankrolls', () => {
  useFakeStorage();
  const session = createRoom({
    withStorage: storage,
    sequence: [
      C('10'), C('10', 'HEARTS'), C('9', 'CLUBS'),
      C('9'), C('8', 'HEARTS'), C('8', 'DIAMONDS'),
    ],
  });
  const a = connectClient(session, 'Ana');
  session.startGame();
  session.localCommand(MESSAGE_TYPES.PLACE_BET, { betCents: 50 * UNITS });
  a.client.placeBet(50 * UNITS);
  session.startRound();
  session.localCommand(MESSAGE_TYPES.GAME_ACTION, { action: ACTIONS.STAND });
  a.client.act(ACTIONS.STAND);

  const record = HostSession.readPersisted(storage);
  assert(record, 'record saved');
  assertEqual(record.roomName, 'Test Room');
  const savedAna = record.players.find((p) => p.name === 'Ana');
  assertEqual(savedAna.bankrollCents, 1050 * UNITS);

  // A fresh page load restores the room; the client re-pairs with its token.
  const restored = new HostSession({
    config: {
      roomName: record.roomName,
      maxPlayers: record.maxPlayers,
      hostPlays: record.hostPlays,
      hostName: record.hostName,
      profile: PROFILES[record.profileId],
    },
    storage,
    restore: record,
  });
  assertEqual(restored.sessionId, session.sessionId);
  const back = connectClient(restored, 'Ana', {
    playerId: savedAna.playerId,
    token: savedAna.token,
  });
  assert(back.client.joined, 'token still valid after restore');
  restored.startGame();
  assertEqual(
    restored.table.getSeat(savedAna.playerId).bankrollCents,
    1050 * UNITS,
    'restored bankroll',
  );
});

test('corrupted persistence records are discarded safely', () => {
  const data = useFakeStorage();
  data.set(`bjlab.${HOST_ROOM_STORAGE_KEY}`, '{not json');
  assertEqual(HostSession.readPersisted(storage), null);
  data.set(`bjlab.${HOST_ROOM_STORAGE_KEY}`, JSON.stringify({ sessionId: 42 }));
  assertEqual(HostSession.readPersisted(storage), null);
});
