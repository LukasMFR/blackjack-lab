import { test, assert, assertEqual, assertThrows } from './runner.js';
import { PREFIX, useFakeStorage, useFullStorage, withoutStorage } from './fakeStorage.js';
import {
  HISTORY_LIMIT,
  SESSIONS_KEY,
  SESSIONS_SCHEMA_VERSION,
  clearSession,
  emptySession,
  isPersistableRoundState,
  loadSessions,
  readSession,
  resetSession,
  saveSession,
} from '../src/js/ui/sessionStore.js';
import { loadStartingBankrollCents, saveStartingBankrollCents } from '../src/js/ui/bankrollSettings.js';
import { BlackjackGame } from '../src/js/game/engine.js';
import { PROFILES, PROFILE_IDS } from '../src/js/config/profiles.js';
import { RESULTS, ROUND_STATES } from '../src/js/game/constants.js';
import { unitsToCents } from '../src/js/game/money.js';

const STORAGE_KEY = PREFIX + SESSIONS_KEY;

/** The raw JSON currently in storage, as the next page load would find it. */
function storedBlob(data) {
  const raw = data.get(STORAGE_KEY);
  return raw === undefined ? null : JSON.parse(raw);
}

/** Build a stored blob by hand, to stand in for data written by an old build. */
function seed(profiles, version = SESSIONS_SCHEMA_VERSION) {
  return { [STORAGE_KEY]: JSON.stringify({ version, profiles }) };
}

const round = (n, netCents, results = [RESULTS.WIN], insurance = false) => ({
  n, netCents, results, insurance,
});

/** A session as it looks after a few played rounds. */
function playedSession(overrides = {}) {
  return {
    ...emptySession(),
    startingBankrollCents: 100000,
    bankrollCents: 112500,
    roundCount: 3,
    netCents: 12500,
    history: [round(1, 5000), round(2, -2500, [RESULTS.LOSS]), round(3, 10000)],
    ...overrides,
  };
}

/* ------------------------------------------------------- reload persistence */

test('a played session is restored intact after a reload', () => {
  const data = useFakeStorage();
  saveSession('FRENCH_STANDARD', playedSession());

  // A reload re-reads storage from scratch; nothing is kept in memory.
  const restored = readSession('FRENCH_STANDARD');
  assertEqual(restored.bankrollCents, 112500);
  assertEqual(restored.startingBankrollCents, 100000);
  assertEqual(restored.roundCount, 3);
  assertEqual(restored.netCents, 12500);
  assertEqual(restored.history.length, 3);
  assertEqual(restored.history[1].netCents, -2500);
  assertEqual(restored.history[1].results[0], RESULTS.LOSS);
  assertEqual(storedBlob(data).version, SESSIONS_SCHEMA_VERSION);
  withoutStorage();
});

test('a never-played profile reads back as a blank session', () => {
  useFakeStorage();
  const session = readSession('ATLANTIC_CITY');
  assertEqual(session.bankrollCents, null);
  assertEqual(session.startingBankrollCents, null);
  assertEqual(session.roundCount, 0);
  assertEqual(session.netCents, 0);
  assertEqual(session.history.length, 0);
  withoutStorage();
});

test('a partial update leaves the other fields of the session alone', () => {
  useFakeStorage();
  saveSession('FRENCH_STANDARD', playedSession());
  saveSession('FRENCH_STANDARD', { bankrollCents: 90000 });

  const restored = readSession('FRENCH_STANDARD');
  assertEqual(restored.bankrollCents, 90000);
  assertEqual(restored.roundCount, 3, 'round count should survive a bankroll-only write');
  assertEqual(restored.history.length, 3);
  withoutStorage();
});

test('the history keeps only the most recent rounds', () => {
  useFakeStorage();
  const many = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => round(i + 1, 100));
  saveSession('FRENCH_STANDARD', { roundCount: many.length, history: many });

  const restored = readSession('FRENCH_STANDARD');
  assertEqual(restored.history.length, HISTORY_LIMIT);
  assertEqual(restored.history[0].n, 11, 'the oldest rounds are dropped first');
  assertEqual(restored.history.at(-1).n, many.length);
  assertEqual(restored.roundCount, many.length, 'the counter still spans the whole session');
  withoutStorage();
});

test('a session net loss is stored as a negative amount', () => {
  useFakeStorage();
  saveSession('FRENCH_STANDARD', { netCents: -37500, bankrollCents: 62500 });
  assertEqual(readSession('FRENCH_STANDARD').netCents, -37500);
  withoutStorage();
});

/* -------------------------------------------------------- profile switching */

test('each profile keeps an independent session', () => {
  useFakeStorage();
  saveSession('FRENCH_STANDARD', playedSession());
  saveSession('ATLANTIC_CITY', {
    startingBankrollCents: 500000,
    bankrollCents: 480000,
    roundCount: 7,
    netCents: -20000,
    history: [round(7, -5000, [RESULTS.LOSS])],
  });

  const french = readSession('FRENCH_STANDARD');
  const atlantic = readSession('ATLANTIC_CITY');
  assertEqual(french.bankrollCents, 112500);
  assertEqual(atlantic.bankrollCents, 480000);
  assertEqual(french.roundCount, 3);
  assertEqual(atlantic.roundCount, 7);
  assertEqual(french.netCents, 12500);
  assertEqual(atlantic.netCents, -20000);
  assertEqual(french.history.length, 3);
  assertEqual(atlantic.history.length, 1);
  withoutStorage();
});

test('switching back and forth never mixes two profiles', () => {
  useFakeStorage();
  // Play on one profile, switch, play on the other, switch back.
  saveSession('FRENCH_STANDARD', { bankrollCents: 100000, roundCount: 1, netCents: 0 });
  saveSession('SINGLE_DECK_3_2', { bankrollCents: 20000, roundCount: 40, netCents: -80000 });
  saveSession('FRENCH_STANDARD', { bankrollCents: 105000, roundCount: 2, netCents: 5000 });

  assertEqual(readSession('SINGLE_DECK_3_2').bankrollCents, 20000);
  assertEqual(readSession('SINGLE_DECK_3_2').roundCount, 40);
  assertEqual(readSession('FRENCH_STANDARD').bankrollCents, 105000);
  assertEqual(readSession('FRENCH_STANDARD').roundCount, 2);
  withoutStorage();
});

test('every shipped profile can hold its own session at once', () => {
  useFakeStorage();
  PROFILE_IDS.forEach((profileId, index) => {
    saveSession(profileId, { bankrollCents: 100000 + index, roundCount: index });
  });
  const sessions = loadSessions();
  assertEqual(Object.keys(sessions).length, PROFILE_IDS.length);
  PROFILE_IDS.forEach((profileId, index) => {
    assertEqual(sessions[profileId].bankrollCents, 100000 + index, profileId);
  });
  withoutStorage();
});

test('clearing one profile leaves the others untouched', () => {
  useFakeStorage();
  saveSession('FRENCH_STANDARD', playedSession());
  saveSession('ATLANTIC_CITY', { bankrollCents: 480000, roundCount: 7 });

  clearSession('FRENCH_STANDARD');
  assertEqual(readSession('FRENCH_STANDARD').bankrollCents, null);
  assertEqual(readSession('ATLANTIC_CITY').bankrollCents, 480000, 'unrelated profile preserved');
  withoutStorage();
});

/* -------------------------------------------------------- bankroll set/reset */

test('a reset restarts the profile from the new starting bankroll', () => {
  useFakeStorage();
  saveSession('FRENCH_STANDARD', playedSession());

  resetSession('FRENCH_STANDARD', 250000);

  const after = readSession('FRENCH_STANDARD');
  assertEqual(after.startingBankrollCents, 250000);
  assertEqual(after.bankrollCents, 250000, 'the live bankroll starts at the new amount');
  assertEqual(after.roundCount, 0);
  assertEqual(after.netCents, 0);
  assertEqual(after.history.length, 0);
  withoutStorage();
});

test('a reset is durable immediately, without waiting for a round to finish', () => {
  const data = useFakeStorage();
  saveSession('FRENCH_STANDARD', playedSession());
  resetSession('FRENCH_STANDARD', 250000);

  // Read the raw bytes: this is exactly what a refresh one instant later sees.
  const blob = storedBlob(data);
  assertEqual(blob.profiles.FRENCH_STANDARD.bankrollCents, 250000);
  assertEqual(blob.profiles.FRENCH_STANDARD.roundCount, 0);
  assertEqual(blob.profiles.FRENCH_STANDARD.history.length, 0);
  withoutStorage();
});

test('a reset is one atomic write, never a half-reset profile', () => {
  const data = useFakeStorage();
  saveSession('FRENCH_STANDARD', playedSession());

  let writes = 0;
  const setItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (key, value) => {
    writes += 1;
    return setItem(key, value);
  };
  resetSession('FRENCH_STANDARD', 250000);
  assertEqual(writes, 1, 'the whole reset lands in a single storage write');
  assertEqual(storedBlob(data).profiles.FRENCH_STANDARD.netCents, 0);
  withoutStorage();
});

test('a reset touches only the active profile', () => {
  useFakeStorage();
  saveSession('FRENCH_STANDARD', playedSession());
  saveSession('ATLANTIC_CITY', playedSession({ bankrollCents: 480000, roundCount: 7 }));

  resetSession('FRENCH_STANDARD', 250000);

  const other = readSession('ATLANTIC_CITY');
  assertEqual(other.bankrollCents, 480000, 'other bankroll preserved');
  assertEqual(other.roundCount, 7, 'other round count preserved');
  assertEqual(other.history.length, 3, 'other history preserved');
  withoutStorage();
});

test('a reset refuses an impossible amount instead of storing it', () => {
  useFakeStorage();
  saveSession('FRENCH_STANDARD', playedSession());
  for (const bad of [-100, 1.5, Number.NaN, '250000', null]) {
    assertThrows(() => resetSession('FRENCH_STANDARD', bad), 'Invalid starting bankroll');
  }
  // The previous session is still intact after every refusal.
  assertEqual(readSession('FRENCH_STANDARD').bankrollCents, 112500);
  withoutStorage();
});

test('the chosen starting bankroll survives a reload and seeds the next session', () => {
  useFakeStorage();
  saveStartingBankrollCents('FRENCH_STANDARD', 75000);

  const profileDefault = unitsToCents(PROFILES.FRENCH_STANDARD.startingBankrollUnits);
  const startingCents = loadStartingBankrollCents('FRENCH_STANDARD', profileDefault);
  assertEqual(startingCents, 75000);
  // And it is what a fresh session is actually funded with.
  const game = new BlackjackGame({ profile: PROFILES.FRENCH_STANDARD, bankrollCents: startingCents });
  assertEqual(game.bankrollCents, 75000);
  withoutStorage();
});

test('a starting bankroll and a live bankroll are stored side by side', () => {
  useFakeStorage();
  saveStartingBankrollCents('FRENCH_STANDARD', 250000);
  saveSession('FRENCH_STANDARD', { bankrollCents: 187500, roundCount: 5 });

  assertEqual(loadStartingBankrollCents('FRENCH_STANDARD', 100000), 250000,
    'the preference is not overwritten by play');
  assertEqual(readSession('FRENCH_STANDARD').bankrollCents, 187500);
  withoutStorage();
});

/* ------------------------------------------------------------ corrupt data */

test('unparseable storage is discarded rather than thrown from', () => {
  const data = useFakeStorage({ [STORAGE_KEY]: '{not json' });
  const session = readSession('FRENCH_STANDARD');
  assertEqual(session.bankrollCents, null);
  assert(!data.has(STORAGE_KEY), 'the unreadable entry is cleared');
  withoutStorage();
});

test('a blob of the wrong shape is discarded', () => {
  for (const raw of ['[]', '"text"', '42', 'null', '{}', '{"version":2}', '{"version":2,"profiles":[]}']) {
    useFakeStorage({ [STORAGE_KEY]: raw });
    assertEqual(readSession('FRENCH_STANDARD').bankrollCents, null, raw);
    assertEqual(readSession('FRENCH_STANDARD').roundCount, 0, raw);
    withoutStorage();
  }
});

test('a session written by a future version is not trusted', () => {
  useFakeStorage(seed({ FRENCH_STANDARD: playedSession() }, SESSIONS_SCHEMA_VERSION + 1));
  assertEqual(readSession('FRENCH_STANDARD').bankrollCents, null);
  withoutStorage();
});

test('a tampered field falls back to its default without losing the session', () => {
  useFakeStorage(seed({
    FRENCH_STANDARD: {
      startingBankrollCents: -1,
      bankrollCents: 112500,
      roundCount: 'many',
      netCents: Number.MAX_VALUE,
      history: [round(1, 5000)],
    },
  }));

  const session = readSession('FRENCH_STANDARD');
  assertEqual(session.bankrollCents, 112500, 'the usable field is kept');
  assertEqual(session.startingBankrollCents, null, 'a negative amount is refused');
  assertEqual(session.netCents, 0, 'a non-integer amount is refused');
  assertEqual(session.history.length, 1);
  // The counter was unreadable, so it is rebuilt from the rounds on record.
  assertEqual(session.roundCount, 1);
  withoutStorage();
});

test('an impossible bankroll is refused', () => {
  for (const bad of [-1, 1.5, '112500', null, Number.NaN, Number.POSITIVE_INFINITY]) {
    useFakeStorage(seed({ FRENCH_STANDARD: { ...emptySession(), bankrollCents: bad } }));
    assertEqual(readSession('FRENCH_STANDARD').bankrollCents, null, String(bad));
    withoutStorage();
  }
});

test('corrupt history entries are dropped one by one', () => {
  useFakeStorage(seed({
    FRENCH_STANDARD: {
      ...emptySession(),
      roundCount: 4,
      history: [
        round(1, 5000),
        { n: 2, netCents: 1000, results: ['NOT_A_RESULT'] },
        { n: 3, netCents: 'lots', results: [RESULTS.WIN] },
        round(4, -2500, [RESULTS.LOSS]),
        'garbage',
        null,
        { n: 0, netCents: 0, results: [] },
      ],
    },
  }));

  const { history } = readSession('FRENCH_STANDARD');
  assertEqual(history.length, 2, 'only the two intact rounds survive');
  assertEqual(history[0].n, 1);
  assertEqual(history[1].n, 4);
  assertEqual(history[1].results[0], RESULTS.LOSS);
  withoutStorage();
});

test('a stored history longer than the limit is trimmed on read', () => {
  const many = Array.from({ length: HISTORY_LIMIT * 3 }, (_, i) => round(i + 1, 100));
  useFakeStorage(seed({ FRENCH_STANDARD: { ...emptySession(), history: many } }));
  assertEqual(readSession('FRENCH_STANDARD').history.length, HISTORY_LIMIT);
  withoutStorage();
});

test('an out-of-range starting bankroll is repaired to the profile default', () => {
  for (const bad of [99 * 100, 100050, 999999999999]) {
    useFakeStorage(seed({ FRENCH_STANDARD: { ...emptySession(), startingBankrollCents: bad } }));
    assertEqual(loadStartingBankrollCents('FRENCH_STANDARD', 100000), 100000, String(bad));
    // The bad value is not left behind to be re-read next time.
    assertEqual(readSession('FRENCH_STANDARD').startingBankrollCents, null, String(bad));
    withoutStorage();
  }
});

test('an unknown profile in storage is ignored', () => {
  useFakeStorage(seed({
    FRENCH_STANDARD: playedSession(),
    MADE_UP_PROFILE: playedSession({ bankrollCents: 999999 }),
  }));
  const sessions = loadSessions();
  assert(!('MADE_UP_PROFILE' in sessions), 'unknown profiles are not restored');
  assertEqual(sessions.FRENCH_STANDARD.bankrollCents, 112500, 'the valid profile still loads');
  withoutStorage();
});

test('persistence degrades quietly when storage is unavailable', () => {
  withoutStorage();
  saveSession('FRENCH_STANDARD', playedSession());
  assertEqual(readSession('FRENCH_STANDARD').bankrollCents, null);
  assertEqual(loadStartingBankrollCents('FRENCH_STANDARD', 100000), 100000);
});

test('a full storage quota does not break the game', () => {
  useFullStorage();
  saveSession('FRENCH_STANDARD', playedSession());
  resetSession('FRENCH_STANDARD', 250000);
  assertEqual(readSession('FRENCH_STANDARD').bankrollCents, null, 'nothing was stored');
  withoutStorage();
});

/* --------------------------------------------------------------- migration */

test('a pre-v2 bankroll is migrated into the session store', () => {
  const data = useFakeStorage({
    [`${PREFIX}bankroll.FRENCH_STANDARD`]: '112500',
    [`${PREFIX}startingBankroll.FRENCH_STANDARD`]: '100000',
  });

  const session = readSession('FRENCH_STANDARD');
  assertEqual(session.bankrollCents, 112500);
  assertEqual(session.startingBankrollCents, 100000);
  // History and totals did not exist before v2, so they legitimately start over.
  assertEqual(session.roundCount, 0);
  assertEqual(session.history.length, 0);

  assertEqual(storedBlob(data).version, SESSIONS_SCHEMA_VERSION, 'the new shape is written out');
  assert(!data.has(`${PREFIX}bankroll.FRENCH_STANDARD`), 'the old key is cleaned up');
  assert(!data.has(`${PREFIX}startingBankroll.FRENCH_STANDARD`), 'the old key is cleaned up');
  withoutStorage();
});

test('every pre-v2 profile is migrated independently', () => {
  useFakeStorage({
    [`${PREFIX}bankroll.FRENCH_STANDARD`]: '112500',
    [`${PREFIX}bankroll.ATLANTIC_CITY`]: '480000',
    [`${PREFIX}startingBankroll.ATLANTIC_CITY`]: '500000',
  });

  const sessions = loadSessions();
  assertEqual(sessions.FRENCH_STANDARD.bankrollCents, 112500);
  assertEqual(sessions.FRENCH_STANDARD.startingBankrollCents, null);
  assertEqual(sessions.ATLANTIC_CITY.bankrollCents, 480000);
  assertEqual(sessions.ATLANTIC_CITY.startingBankrollCents, 500000);
  withoutStorage();
});

test('a corrupt pre-v2 value is dropped rather than migrated', () => {
  useFakeStorage({
    [`${PREFIX}bankroll.FRENCH_STANDARD`]: '-500',
    [`${PREFIX}startingBankroll.FRENCH_STANDARD`]: '100000',
  });
  const session = readSession('FRENCH_STANDARD');
  assertEqual(session.bankrollCents, null, 'the impossible bankroll is not carried over');
  assertEqual(session.startingBankrollCents, 100000, 'the usable value still migrates');
  withoutStorage();
});

test('migration leaves unrelated preferences alone', () => {
  const data = useFakeStorage({
    [`${PREFIX}bankroll.FRENCH_STANDARD`]: '112500',
    [`${PREFIX}language`]: 'fr',
    [`${PREFIX}theme`]: 'salon',
  });
  readSession('FRENCH_STANDARD');
  assertEqual(data.get(`${PREFIX}language`), 'fr');
  assertEqual(data.get(`${PREFIX}theme`), 'salon');
  withoutStorage();
});

test('nothing to migrate leaves storage empty', () => {
  const data = useFakeStorage();
  assertEqual(readSession('FRENCH_STANDARD').bankrollCents, null);
  assertEqual(data.size, 0, 'a first visit does not write a placeholder');
  withoutStorage();
});

/* ----------------------------------------------------- interrupted sessions */

test('a bankroll is only persistable once the round is settled', () => {
  assert(isPersistableRoundState(ROUND_STATES.WAITING_FOR_BET));
  assert(isPersistableRoundState(ROUND_STATES.ROUND_COMPLETE));
  assert(!isPersistableRoundState(ROUND_STATES.INITIAL_DEAL));
  assert(!isPersistableRoundState(ROUND_STATES.PLAYER_TURN));
  assert(!isPersistableRoundState(ROUND_STATES.DEALER_TURN));
  assert(!isPersistableRoundState(ROUND_STATES.SETTLEMENT));
});

test('a round interrupted by a reload returns the committed stake', () => {
  useFakeStorage();
  const game = new BlackjackGame({ profile: PROFILES.FRENCH_STANDARD, bankrollCents: 100000 });
  saveSession('FRENCH_STANDARD', { bankrollCents: game.bankrollCents });

  game.placeBet(unitsToCents(50));
  assert(!isPersistableRoundState(game.roundState), 'the round is in progress');
  assert(game.bankrollCents < 100000, 'the stake is committed and out of the bankroll');

  // The reload happens here: whatever the live bankroll is, it was never saved.
  const restored = readSession('FRENCH_STANDARD');
  assertEqual(restored.bankrollCents, 100000, 'play resumes from the last settled bankroll');
  assertEqual(restored.roundCount, 0, 'the unfinished round was never counted');
  withoutStorage();
});

test('an interrupted round is not double-counted when play resumes', () => {
  useFakeStorage();
  saveSession('FRENCH_STANDARD', { bankrollCents: 100000, roundCount: 4, netCents: 0 });

  // Resume: the abandoned round left no trace, so the next finished round is 5.
  const resumed = readSession('FRENCH_STANDARD');
  const next = resumed.roundCount + 1;
  saveSession('FRENCH_STANDARD', {
    bankrollCents: 105000,
    roundCount: next,
    netCents: 5000,
    history: [...resumed.history, round(next, 5000)],
  });

  const after = readSession('FRENCH_STANDARD');
  assertEqual(after.roundCount, 5);
  assertEqual(after.history.length, 1);
  assertEqual(after.history[0].n, 5);
  withoutStorage();
});
