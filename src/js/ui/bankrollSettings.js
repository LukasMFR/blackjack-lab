import { unitsToCents, CENTS_PER_UNIT } from '../game/money.js';
import * as storage from './storage.js';

/**
 * Starting-bankroll preference: parsing, validation, and persistence.
 *
 * The user types whole table units (the same unit the interface displays);
 * everything downstream is integer cents, exactly as the engine expects.
 * Kept free of the DOM so it can be tested directly.
 */

/** Low enough to still cover the smallest table minimum, high enough to matter. */
export const MIN_BANKROLL_UNITS = 100;
/** Keeps the stored value far inside the safe-integer range once in cents. */
export const MAX_BANKROLL_UNITS = 1_000_000;

export const MIN_BANKROLL_CENTS = MIN_BANKROLL_UNITS * CENTS_PER_UNIT;
export const MAX_BANKROLL_CENTS = MAX_BANKROLL_UNITS * CENTS_PER_UNIT;

/** Translation keys for every way the input can be rejected. */
export const BANKROLL_ERRORS = Object.freeze({
  REQUIRED: 'errors.bankrollRequired',
  NOT_A_NUMBER: 'errors.bankrollNotANumber',
  NOT_WHOLE: 'errors.bankrollNotWhole',
  TOO_LOW: 'errors.bankrollTooLow',
  TOO_HIGH: 'errors.bankrollTooHigh',
});

// Digits, with an optional sign and an optional decimal part. A decimal part
// is matched (rather than rejected outright) so we can say "whole units only"
// instead of the vaguer "not a number".
const NUMERIC = /^([+-]?)(\d+)(?:[.,](\d+))?$/;

// Users paste amounts straight out of the interface, which groups thousands
// with a space in French and a comma in English.
const GROUPING = /[\s  ,](?=\d{3}\b)/g;

/**
 * Parse and validate a typed starting bankroll.
 * @param {string} raw - the raw input value, in table units
 * @returns {{ok: true, units: number, cents: number}
 *          | {ok: false, errorKey: string, params: Record<string, number>}}
 */
export function parseStartingBankroll(raw) {
  const fail = (errorKey, params = {}) => ({ ok: false, errorKey, params });

  const text = String(raw ?? '').trim().replace(GROUPING, '');
  if (text === '') return fail(BANKROLL_ERRORS.REQUIRED);

  const match = NUMERIC.exec(text);
  if (!match) return fail(BANKROLL_ERRORS.NOT_A_NUMBER);

  const [, sign, whole, fraction] = match;
  // "500.00" is a whole number of units written long-hand; "500.50" is not.
  if (fraction && Number(fraction) !== 0) return fail(BANKROLL_ERRORS.NOT_WHOLE);

  const units = Number(whole);
  if (!Number.isSafeInteger(units)) return fail(BANKROLL_ERRORS.TOO_HIGH, { max: MAX_BANKROLL_UNITS });

  const signed = sign === '-' ? -units : units;
  if (signed < MIN_BANKROLL_UNITS) return fail(BANKROLL_ERRORS.TOO_LOW, { min: MIN_BANKROLL_UNITS });
  if (signed > MAX_BANKROLL_UNITS) return fail(BANKROLL_ERRORS.TOO_HIGH, { max: MAX_BANKROLL_UNITS });

  return { ok: true, units: signed, cents: unitsToCents(signed) };
}

/**
 * @param {number} cents
 * @returns {boolean} true when the amount is a whole number of units in range
 */
export function isBankrollInRange(cents) {
  return Number.isSafeInteger(cents)
    && cents % CENTS_PER_UNIT === 0
    && cents >= MIN_BANKROLL_CENTS
    && cents <= MAX_BANKROLL_CENTS;
}

/** Each rule profile keeps its own starting bankroll. */
export function startingBankrollKey(profileId) {
  return `startingBankroll.${profileId}`;
}

/**
 * Read the stored starting bankroll for a profile. A missing, corrupt, or
 * out-of-range entry is discarded in favour of the profile default.
 * @param {string} profileId
 * @param {number} fallbackCents - the profile's own starting bankroll
 * @returns {number} cents
 */
export function loadStartingBankrollCents(profileId, fallbackCents) {
  const key = startingBankrollKey(profileId);
  const stored = storage.getAmount(key);
  if (stored === null) return fallbackCents;
  if (!isBankrollInRange(stored)) {
    storage.clear(key);
    return fallbackCents;
  }
  return stored;
}

/**
 * Persist a starting bankroll. Out-of-range amounts are refused loudly
 * rather than written and silently repaired on the next read.
 * @param {string} profileId
 * @param {number} cents
 */
export function saveStartingBankrollCents(profileId, cents) {
  if (!isBankrollInRange(cents)) {
    throw new Error(`Invalid starting bankroll: ${cents}`);
  }
  storage.setAmount(startingBankrollKey(profileId), cents);
}
