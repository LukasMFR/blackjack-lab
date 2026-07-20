/**
 * Exact money arithmetic. All amounts are integer cents; one table unit
 * (a "chip unit") is 100 cents. No floating point ever touches a bankroll.
 */

export const CENTS_PER_UNIT = 100;

/**
 * @param {number} value
 * @returns {boolean} true when the value is a safe non-negative integer
 */
export function isValidAmount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Assert an amount is a safe non-negative integer number of cents.
 * @param {number} cents
 * @param {string} label
 * @returns {number} the validated amount
 */
export function assertAmount(cents, label = 'amount') {
  if (!isValidAmount(cents)) {
    throw new Error(`Invalid ${label}: ${cents}`);
  }
  return cents;
}

/**
 * Multiply a bet by a payout ratio, exactly. Throws when the result is not
 * a whole number of cents because payouts must never be silently rounded.
 * @param {number} betCents
 * @param {{numerator: number, denominator: number}} ratio
 * @returns {number} profit in cents
 */
export function exactProfit(betCents, ratio) {
  assertAmount(betCents, 'bet');
  const raw = betCents * ratio.numerator;
  if (raw % ratio.denominator !== 0) {
    throw new Error(
      `Payout ${ratio.numerator}:${ratio.denominator} of ${betCents} cents is not exact`,
    );
  }
  return raw / ratio.denominator;
}

/**
 * Exact half of a bet (used for insurance stakes and surrender refunds).
 * Whole-unit bets always divide exactly.
 * @param {number} betCents
 * @returns {number}
 */
export function exactHalf(betCents) {
  assertAmount(betCents, 'bet');
  if (betCents % 2 !== 0) {
    throw new Error(`Half of ${betCents} cents is not exact`);
  }
  return betCents / 2;
}

/**
 * @param {number} units - whole table units
 * @returns {number} cents
 */
export function unitsToCents(units) {
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new Error(`Invalid unit amount: ${units}`);
  }
  return units * CENTS_PER_UNIT;
}
