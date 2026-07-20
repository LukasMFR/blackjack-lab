import { test, assert, assertEqual, assertThrows } from './runner.js';
import {
  CLIENT_MESSAGE_TYPES,
  createMessage,
  ERROR_CODES,
  HOST_MESSAGE_TYPES,
  MAX_FRAME_LENGTH,
  MESSAGE_TYPES,
  parseMessage,
  PROTOCOL_VERSION,
  sanitizeName,
  SequenceGuard,
  serializeMessage,
} from '../src/js/multiplayer/protocol.js';
import {
  decodeSignal, encodeSignal, SIGNAL_ERRORS, SIGNAL_KINDS, SIGNAL_TTL_MS,
} from '../src/js/multiplayer/signalling.js';
import { SnapshotStore } from '../src/js/multiplayer/stateSync.js';

// ---------------------------------------------------------------- protocol

test('a valid client message round-trips through serialize and parse', () => {
  const message = createMessage(MESSAGE_TYPES.PLACE_BET, { betCents: 5000 }, 1);
  const parsed = parseMessage(serializeMessage(message), {
    allowedTypes: CLIENT_MESSAGE_TYPES,
  });
  assert(parsed.ok, 'message should parse');
  assertEqual(parsed.message.t, MESSAGE_TYPES.PLACE_BET);
  assertEqual(parsed.message.p.betCents, 5000);
  assertEqual(parsed.message.v, PROTOCOL_VERSION);
});

test('non-JSON, non-string and oversized frames are rejected as malformed', () => {
  assertEqual(parseMessage('not json').code, ERROR_CODES.MALFORMED);
  assertEqual(parseMessage(42).code, ERROR_CODES.MALFORMED);
  assertEqual(parseMessage(null).code, ERROR_CODES.MALFORMED);
  assertEqual(parseMessage(`"${'x'.repeat(MAX_FRAME_LENGTH + 1)}"`).code, ERROR_CODES.MALFORMED);
});

test('incompatible protocol versions are refused with a dedicated code', () => {
  const message = createMessage(MESSAGE_TYPES.CLEAR_BET, {}, 1);
  message.v = 99;
  const parsed = parseMessage(serializeMessage(message));
  assertEqual(parsed.code, ERROR_CODES.INCOMPATIBLE_PROTOCOL);
});

test('unknown and contextually unexpected types are refused', () => {
  const raw = serializeMessage({ v: 1, t: 'HACK', id: 'x1', seq: 1, p: {} });
  assertEqual(parseMessage(raw).code, ERROR_CODES.UNKNOWN_TYPE);
  // A host-only message arriving at the host is unexpected.
  const snapshot = createMessage(MESSAGE_TYPES.STATE_SNAPSHOT, {
    revision: 1, phase: 'LOBBY', table: {},
  }, 2);
  const parsed = parseMessage(serializeMessage(snapshot), {
    allowedTypes: CLIENT_MESSAGE_TYPES,
  });
  assertEqual(parsed.code, ERROR_CODES.UNEXPECTED_TYPE);
});

test('payload validators reject impossible values', () => {
  const bad = (type, payload) => {
    const message = createMessage(type, payload, 1);
    return parseMessage(serializeMessage(message), { allowedTypes: CLIENT_MESSAGE_TYPES });
  };
  assertEqual(bad(MESSAGE_TYPES.PLACE_BET, { betCents: -5 }).code, ERROR_CODES.MALFORMED);
  assertEqual(bad(MESSAGE_TYPES.PLACE_BET, { betCents: 10.5 }).code, ERROR_CODES.MALFORMED);
  assertEqual(bad(MESSAGE_TYPES.PLACE_BET, {}).code, ERROR_CODES.MALFORMED);
  assertEqual(bad(MESSAGE_TYPES.GAME_ACTION, { action: 'CHEAT' }).code, ERROR_CODES.MALFORMED);
  assertEqual(bad(MESSAGE_TYPES.PLAYER_READY, { ready: 'yes' }).code, ERROR_CODES.MALFORMED);
  assertEqual(bad(MESSAGE_TYPES.DECISION, { decision: 'INSURANCE', accept: 1 }).code,
    ERROR_CODES.MALFORMED);
  // A blank name is structurally valid; the host answers JOIN_REJECTED
  // (BAD_NAME) — covered by the session tests.
  assertEqual(bad(MESSAGE_TYPES.JOIN_REQUEST, { name: 42 }).code, ERROR_CODES.MALFORMED);
  assertEqual(
    bad(MESSAGE_TYPES.JOIN_REQUEST, { name: 'ok', resume: { playerId: 'p' } }).code,
    ERROR_CODES.MALFORMED,
  );
});

test('envelope fields are validated', () => {
  const base = createMessage(MESSAGE_TYPES.CLEAR_BET, {}, 3);
  const noId = { ...base, id: '' };
  assertEqual(parseMessage(serializeMessage(noId)).code, ERROR_CODES.MALFORMED);
  const badSeq = { ...base, seq: -1 };
  assertEqual(parseMessage(serializeMessage(badSeq)).code, ERROR_CODES.MALFORMED);
  const badPayload = { ...base, p: [] };
  assertEqual(parseMessage(serializeMessage(badPayload)).code, ERROR_CODES.MALFORMED);
  assertThrows(() => createMessage('NOPE', {}, 1), 'Unknown message type');
  assertThrows(() => createMessage(MESSAGE_TYPES.CLEAR_BET, {}, -1), 'Invalid seq');
});

test('host message types validate too', () => {
  const ok = createMessage(MESSAGE_TYPES.SESSION_ENDED, { reason: 'HOST_ENDED' }, 1);
  assert(parseMessage(serializeMessage(ok), { allowedTypes: HOST_MESSAGE_TYPES }).ok,
    'session end parses');
  const badRevision = createMessage(MESSAGE_TYPES.STATE_SNAPSHOT, {
    revision: -1, phase: 'LOBBY', table: {},
  }, 2);
  assertEqual(
    parseMessage(serializeMessage(badRevision), { allowedTypes: HOST_MESSAGE_TYPES }).code,
    ERROR_CODES.MALFORMED,
  );
});

test('sequence guard drops duplicates and out-of-order messages', () => {
  const guard = new SequenceGuard();
  const m1 = createMessage(MESSAGE_TYPES.CLEAR_BET, {}, 1);
  const m2 = createMessage(MESSAGE_TYPES.CLEAR_BET, {}, 2);
  const m5 = createMessage(MESSAGE_TYPES.CLEAR_BET, {}, 5);
  const m3 = createMessage(MESSAGE_TYPES.CLEAR_BET, {}, 3);
  assert(guard.accept(m1).ok, 'first');
  assertEqual(guard.accept(m1).code, ERROR_CODES.DUPLICATE_MESSAGE);
  assert(guard.accept(m2).ok, 'second');
  assert(guard.accept(m5).ok, 'gap forward is fine');
  assertEqual(guard.accept(m3).code, ERROR_CODES.OUT_OF_ORDER);
});

test('display names are sanitized', () => {
  assertEqual(sanitizeName('  Ana   Luz  '), 'Ana Luz');
  assertEqual(sanitizeName(''), null);
  assertEqual(sanitizeName('   '), null);
  assertEqual(sanitizeName(42), null);
  assertEqual(sanitizeName('x'.repeat(60)).length, 24);
});

// --------------------------------------------------------------- snapshots

test('snapshot store ignores stale and duplicate revisions', () => {
  const store = new SnapshotStore();
  assert(store.apply({ revision: 3, phase: 'TABLE' }), 'first apply');
  assert(!store.apply({ revision: 3, phase: 'TABLE' }), 'duplicate revision ignored');
  assert(!store.apply({ revision: 2, phase: 'TABLE' }), 'older revision ignored');
  assert(store.apply({ revision: 4, phase: 'TABLE' }), 'newer applies');
  assertEqual(store.revision, 4);
});

// -------------------------------------------------------------- signalling

const DESCRIPTION = {
  type: 'offer',
  sdp: 'v=0\r\no=- 46117317 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=ice-ufrag:abcd\r\na=ice-pwd:efghijklmnopqrstuvwx\r\n',
};

test('signalling payloads round-trip', async () => {
  const encoded = await encodeSignal({
    kind: SIGNAL_KINDS.OFFER,
    sessionId: 'room-1',
    peerId: 'pair-1',
    description: DESCRIPTION,
  });
  assert(encoded.startsWith('BJL1'), 'prefixed payload');
  const decoded = await decodeSignal(encoded, { expectKind: SIGNAL_KINDS.OFFER });
  assert(decoded.ok, `decode failed: ${decoded.detail}`);
  assertEqual(decoded.signal.sessionId, 'room-1');
  assertEqual(decoded.signal.peerId, 'pair-1');
  assertEqual(decoded.signal.description.sdp, DESCRIPTION.sdp);
});

test('answers carry the display name', async () => {
  const encoded = await encodeSignal({
    kind: SIGNAL_KINDS.ANSWER,
    sessionId: 'room-1',
    peerId: 'pair-1',
    description: { ...DESCRIPTION, type: 'answer' },
    name: 'Zoé',
  });
  const decoded = await decodeSignal(encoded, { expectKind: SIGNAL_KINDS.ANSWER });
  assert(decoded.ok, 'decode failed');
  assertEqual(decoded.signal.name, 'Zoé');
});

test('the wrong pairing kind is refused', async () => {
  const encoded = await encodeSignal({
    kind: SIGNAL_KINDS.OFFER,
    sessionId: 'room-1',
    peerId: 'pair-1',
    description: DESCRIPTION,
  });
  const decoded = await decodeSignal(encoded, { expectKind: SIGNAL_KINDS.ANSWER });
  assertEqual(decoded.code, SIGNAL_ERRORS.WRONG_KIND);
});

test('stale pairing payloads are refused', async () => {
  const past = Date.now() - SIGNAL_TTL_MS - 1000;
  const encoded = await encodeSignal({
    kind: SIGNAL_KINDS.OFFER,
    sessionId: 'room-1',
    peerId: 'pair-1',
    description: DESCRIPTION,
  }, { now: past });
  const decoded = await decodeSignal(encoded);
  assertEqual(decoded.code, SIGNAL_ERRORS.STALE);
});

test('garbage, truncated and foreign payloads fail cleanly', async () => {
  assertEqual((await decodeSignal('hello world')).code, SIGNAL_ERRORS.BAD_FORMAT);
  assertEqual((await decodeSignal('')).code, SIGNAL_ERRORS.BAD_FORMAT);
  assertEqual((await decodeSignal(null)).code, SIGNAL_ERRORS.BAD_FORMAT);
  assertEqual((await decodeSignal('BJL1C:!!!!')).code, SIGNAL_ERRORS.BAD_FORMAT);
  const encoded = await encodeSignal({
    kind: SIGNAL_KINDS.OFFER,
    sessionId: 'room-1',
    peerId: 'pair-1',
    description: DESCRIPTION,
  });
  const truncated = encoded.slice(0, Math.floor(encoded.length / 2));
  assertEqual((await decodeSignal(truncated)).code, SIGNAL_ERRORS.BAD_FORMAT);
});

test('payloads from a newer app generation are flagged as incompatible', async () => {
  const decoded = await decodeSignal('BJL2C:abcdef');
  assertEqual(decoded.code, SIGNAL_ERRORS.INCOMPATIBLE_VERSION);
});
