import { getLanguage } from '../i18n/index.js';
import { CENTS_PER_UNIT } from '../game/money.js';

/**
 * Locale-aware display of fictional chip amounts. Amounts are integer
 * cents; display is in table units (100 cents = 1 unit). Formatting is
 * presentation only and never feeds back into game arithmetic.
 */

const FORMAT_LOCALES = { en: 'en-GB', fr: 'fr-FR' };

/**
 * @param {number} cents
 * @returns {string} e.g. "1,050" / "1 050" or "12.50" / "12,50"
 */
export function formatMoney(cents) {
  const locale = FORMAT_LOCALES[getLanguage()] ?? 'en-GB';
  const units = cents / CENTS_PER_UNIT;
  const hasFraction = cents % CENTS_PER_UNIT !== 0;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(units);
}

/**
 * @param {{numerator: number, denominator: number}} ratio
 * @returns {string} "3:2"
 */
export function formatRatio(ratio) {
  return `${ratio.numerator}:${ratio.denominator}`;
}
