import { t } from '../i18n/index.js';
import * as storage from './storage.js';

/**
 * How a hand's value is written on the table, and the local preference that
 * chooses between the two notations:
 *
 * - `slash` (default): both totals of a soft hand, e.g. `5/15`.
 * - `strategy`: the basic-strategy row the hand belongs to, e.g. `A,4`.
 *   Multi-card soft hands collapse to the same row: A+2+2 and A+4 are both
 *   `A,4`, A+A+8 is `A,9`.
 *
 * Hard hands are a plain total in both notations, so the preference only
 * changes what a soft hand looks like. The spoken form is deliberately
 * notation-independent: a screen reader always hears the totals in words.
 *
 * This module is presentation only; nothing here feeds back into the engine.
 */

export const HAND_TOTAL_FORMATS = {
  SLASH: 'slash',
  STRATEGY: 'strategy',
};

/** Slash stays the default: an absent or malformed entry never migrates. */
export const DEFAULT_HAND_TOTAL_FORMAT = HAND_TOTAL_FORMATS.SLASH;

export const HAND_TOTAL_FORMAT_VALUES = Object.values(HAND_TOTAL_FORMATS);

export const HAND_TOTAL_FORMAT_STORAGE_KEY = 'handTotalFormat';

/**
 * @param {string} format
 * @returns {string} the format itself when supported, else the slash default
 */
export function normalizeHandTotalFormat(format) {
  return HAND_TOTAL_FORMAT_VALUES.includes(format) ? format : DEFAULT_HAND_TOTAL_FORMAT;
}

/** @returns {string} the stored notation, or the slash default */
export function loadHandTotalFormat() {
  return storage.getChoice(
    HAND_TOTAL_FORMAT_STORAGE_KEY,
    HAND_TOTAL_FORMAT_VALUES,
    DEFAULT_HAND_TOTAL_FORMAT,
  );
}

/** @param {string} format - a HAND_TOTAL_FORMATS value */
export function saveHandTotalFormat(format) {
  storage.setChoice(HAND_TOTAL_FORMAT_STORAGE_KEY, normalizeHandTotalFormat(format));
}

/**
 * The visible hand value.
 * @param {{total: number, isSoft: boolean, isBust: boolean, cardCount?: number}} evaluation
 * @param {string} [format] - a HAND_TOTAL_FORMATS value
 * @returns {string} e.g. "16", "5/15", "A,4"
 */
export function formatHandTotal(evaluation, format = DEFAULT_HAND_TOTAL_FORMAT) {
  const { total, isSoft, isBust } = evaluation;
  // A bust hand has no Ace left counted as 11, so it is a plain total in
  // both notations; the guard also covers hand-made evaluation objects.
  if (!isSoft || isBust) return String(total);
  if (format !== HAND_TOTAL_FORMATS.STRATEGY) return `${total - 10}/${total}`;
  // Two cards on a soft 12 can only be a pair of Aces, and its strategy row
  // is written A,A everywhere. No table writes A,1.
  if (evaluation.cardCount === 2 && total === 12) return 'A,A';
  return `A,${total - 11}`;
}

/**
 * The spoken hand value, identical in both notations: "A,4" and "5/15" are
 * ambiguous read aloud, so a screen reader hears the totals as words.
 * @param {{total: number, isSoft: boolean, isBust: boolean}} evaluation
 * @returns {string}
 */
export function handTotalSpeech(evaluation) {
  const { total, isSoft, isBust } = evaluation;
  return isSoft && !isBust
    ? t('a11y.handTotalSoft', { low: total - 10, high: total })
    : t('a11y.handTotal', { total });
}

/**
 * Build the hand-value badge shared by the solo table and the multiplayer
 * room: the chosen notation on screen, the spoken totals for assistive
 * technology.
 * @param {{total: number, isSoft: boolean, isBust: boolean, cardCount?: number}} evaluation
 * @param {string} [format] - a HAND_TOTAL_FORMATS value
 * @returns {HTMLElement}
 */
export function createHandTotalElement(evaluation, format = DEFAULT_HAND_TOTAL_FORMAT) {
  const el = document.createElement('span');
  el.className = 'hand-total';
  // aria-hidden on a generic span is honoured everywhere; an aria-label on
  // one is not, hence the visually hidden twin rather than a label.
  const visible = document.createElement('span');
  visible.setAttribute('aria-hidden', 'true');
  visible.textContent = formatHandTotal(evaluation, format);
  const spoken = document.createElement('span');
  spoken.className = 'sr-only';
  spoken.textContent = handTotalSpeech(evaluation);
  el.append(visible, spoken);
  return el;
}
