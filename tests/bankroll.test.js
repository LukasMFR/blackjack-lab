import { test, assert, assertEqual, assertThrows } from './runner.js';
import {
  BANKROLL_ERRORS,
  MAX_BANKROLL_UNITS,
  MIN_BANKROLL_UNITS,
  isBankrollInRange,
  loadStartingBankrollCents,
  parseStartingBankroll,
  saveStartingBankrollCents,
  startingBankrollKey,
} from '../src/js/ui/bankrollSettings.js';
import { BlackjackGame } from '../src/js/game/engine.js';
import { PROFILES } from '../src/js/config/profiles.js';
import { unitsToCents } from '../src/js/game/money.js';

/**
 * A minimal in-memory localStorage so the persistence path is exercised for
 * real (storage.js reads globalThis.localStorage on every call).
 */
function useFakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  return data;
}

function withoutStorage() {
  delete globalThis.localStorage;
}

const PREFIXED = (profileId) => `bjlab.${startingBankrollKey(profileId)}`;

// ------------------------------------------------------------- validation

test('a plain whole amount is accepted and converted to cents', () => {
  const result = parseStartingBankroll('2500');
  assert(result.ok, 'expected 2500 to be accepted');
  assertEqual(result.units, 2500);
  assertEqual(result.cents, 250000);
});

test('surrounding whitespace and thousands grouping are tolerated', () => {
  for (const raw of ['  2500  ', '2 500', '2 500', '2,500', '1,000,000']) {
    const result = parseStartingBankroll(raw);
    assert(result.ok, `expected "${raw}" to be accepted`);
  }
  assertEqual(parseStartingBankroll('2,500').units, 2500);
  assertEqual(parseStartingBankroll('1,000,000').units, 1000000);
});

test('an empty input asks for an amount', () => {
  for (const raw of ['', '   ', null, undefined]) {
    assertEqual(parseStartingBankroll(raw).errorKey, BANKROLL_ERRORS.REQUIRED);
  }
});

test('non-numeric input is rejected', () => {
  for (const raw of ['abc', '1000x', '$1000', '1e5', '--5', '1.2.3']) {
    const result = parseStartingBankroll(raw);
    assert(!result.ok, `expected "${raw}" to be rejected`);
    assertEqual(result.errorKey, BANKROLL_ERRORS.NOT_A_NUMBER, raw);
  }
});

test('fractional amounts are rejected, trailing zeros are not', () => {
  assertEqual(parseStartingBankroll('500.5').errorKey, BANKROLL_ERRORS.NOT_WHOLE);
  assertEqual(parseStartingBankroll('500,75').errorKey, BANKROLL_ERRORS.NOT_WHOLE);
  const exact = parseStartingBankroll('500.00');
  assert(exact.ok, '500.00 is a whole number of units');
  assertEqual(exact.cents, 50000);
});

test('zero and negative amounts fall under the minimum', () => {
  for (const raw of ['0', '-1', '-1000', '99']) {
    const result = parseStartingBankroll(raw);
    assert(!result.ok, `expected "${raw}" to be rejected`);
    assertEqual(result.errorKey, BANKROLL_ERRORS.TOO_LOW, raw);
  }
});

test('the limits themselves are inclusive', () => {
  assert(parseStartingBankroll(String(MIN_BANKROLL_UNITS)).ok, 'minimum is allowed');
  assert(parseStartingBankroll(String(MAX_BANKROLL_UNITS)).ok, 'maximum is allowed');
  assertEqual(
    parseStartingBankroll(String(MAX_BANKROLL_UNITS + 1)).errorKey,
    BANKROLL_ERRORS.TOO_HIGH,
  );
  assertEqual(
    parseStartingBankroll('99999999999999999999').errorKey,
    BANKROLL_ERRORS.TOO_HIGH,
  );
});

test('the parsed amount is always exact integer cents', () => {
  for (const raw of ['100', '1000', '123456', '1000000']) {
    const { cents } = parseStartingBankroll(raw);
    assert(Number.isSafeInteger(cents), `${raw} produced a non-integer`);
    assertEqual(cents % 100, 0, `${raw} is not a whole unit`);
  }
});

test('range checking mirrors the parser', () => {
  assert(isBankrollInRange(unitsToCents(MIN_BANKROLL_UNITS)));
  assert(isBankrollInRange(unitsToCents(MAX_BANKROLL_UNITS)));
  assert(!isBankrollInRange(unitsToCents(MIN_BANKROLL_UNITS) - 1));
  assert(!isBankrollInRange(unitsToCents(MAX_BANKROLL_UNITS) + 100));
  assert(!isBankrollInRange(100050), 'not a whole unit');
  assert(!isBankrollInRange(Number.NaN));
});

// ------------------------------------------------------------ persistence

test('a saved starting bankroll is read back for the same profile', () => {
  useFakeStorage();
  saveStartingBankrollCents('FRENCH_STANDARD', 250000);
  assertEqual(loadStartingBankrollCents('FRENCH_STANDARD', 100000), 250000);
  withoutStorage();
});

test('each profile keeps its own starting bankroll', () => {
  useFakeStorage();
  saveStartingBankrollCents('FRENCH_STANDARD', 250000);
  saveStartingBankrollCents('ATLANTIC_CITY', 500000);
  assertEqual(loadStartingBankrollCents('FRENCH_STANDARD', 100000), 250000);
  assertEqual(loadStartingBankrollCents('ATLANTIC_CITY', 100000), 500000);
  // An untouched profile still gets the fallback.
  assertEqual(loadStartingBankrollCents('SINGLE_DECK_3_2', 100000), 100000);
  withoutStorage();
});

test('an unset profile falls back to the profile default', () => {
  useFakeStorage();
  const fallback = unitsToCents(PROFILES.FRENCH_STANDARD.startingBankrollUnits);
  assertEqual(loadStartingBankrollCents('FRENCH_STANDARD', fallback), fallback);
  withoutStorage();
});

test('a tampered stored amount is discarded, not trusted', () => {
  for (const bad of ['-500', 'abc', '99', '999999999999', '100050']) {
    const data = useFakeStorage({ [PREFIXED('FRENCH_STANDARD')]: bad });
    assertEqual(loadStartingBankrollCents('FRENCH_STANDARD', 100000), 100000, bad);
    assert(!data.has(PREFIXED('FRENCH_STANDARD')), `"${bad}" should have been cleared`);
    withoutStorage();
  }
});

test('an out-of-range amount is refused instead of being stored', () => {
  const data = useFakeStorage();
  assertThrows(() => saveStartingBankrollCents('FRENCH_STANDARD', 50), 'Invalid starting bankroll');
  assertThrows(() => saveStartingBankrollCents('FRENCH_STANDARD', -100000), 'Invalid starting bankroll');
  assertEqual(data.size, 0);
  withoutStorage();
});

test('persistence degrades quietly when storage is unavailable', () => {
  withoutStorage();
  saveStartingBankrollCents('FRENCH_STANDARD', 250000);
  assertEqual(loadStartingBankrollCents('FRENCH_STANDARD', 100000), 100000);
});

// ------------------------------------------------- session reset behaviour

test('a chosen starting bankroll actually funds a new session', () => {
  const chosen = parseStartingBankroll('2 500');
  const game = new BlackjackGame({
    profile: PROFILES.FRENCH_STANDARD,
    bankrollCents: chosen.cents,
  });
  assertEqual(game.bankrollCents, 250000);
  // And it is spendable exactly, with no rounding drift.
  game.placeBet(unitsToCents(50));
  assertEqual(game.bankrollCents, 250000 - 5000);
});

test('the stored amount survives a reload and seeds the next session', () => {
  useFakeStorage();
  const chosen = parseStartingBankroll('750');
  saveStartingBankrollCents('FRENCH_STANDARD', chosen.cents);

  // Simulates the next boot: no live bankroll saved, so the session starts
  // from the stored preference rather than the profile default.
  const startingCents = loadStartingBankrollCents(
    'FRENCH_STANDARD',
    unitsToCents(PROFILES.FRENCH_STANDARD.startingBankrollUnits),
  );
  const game = new BlackjackGame({
    profile: PROFILES.FRENCH_STANDARD,
    bankrollCents: startingCents,
  });
  assertEqual(game.bankrollCents, 75000);
  withoutStorage();
});
