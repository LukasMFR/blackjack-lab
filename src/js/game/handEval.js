import { cardValue, isAce, isTenValue } from './card.js';
import { SPLIT_PAIRING } from './constants.js';

/**
 * Evaluate a set of cards.
 *
 * `isNaturalCandidate` only says the cards themselves form an Ace + ten-value
 * two-card 21. Whether that counts as a *natural blackjack* also depends on
 * hand context (original hand, not created by a split) — the engine combines
 * both facts.
 *
 * @param {Array<{rank: string, suit: string}>} cards
 * @returns {{
 *   total: number,
 *   isSoft: boolean,
 *   isHard: boolean,
 *   isBust: boolean,
 *   isNaturalCandidate: boolean,
 *   cardCount: number,
 * }}
 */
export function evaluateCards(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (isAce(card)) aces += 1;
  }
  // Reduce Aces from 11 to 1 while the hand would otherwise bust.
  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }
  const isSoft = softAces > 0;
  return {
    total,
    isSoft,
    isHard: !isSoft,
    isBust: total > 21,
    isNaturalCandidate:
      cards.length === 2 &&
      total === 21 &&
      cards.some(isAce) &&
      cards.some(isTenValue),
    cardCount: cards.length,
  };
}

/**
 * Whether two cards form a splittable pair under the given pairing rule.
 * @param {Array<{rank: string}>} cards - exactly two cards expected
 * @param {string} pairingRule - SPLIT_PAIRING value
 * @returns {boolean}
 */
export function isSplittablePair(cards, pairingRule) {
  if (cards.length !== 2) return false;
  const [a, b] = cards;
  if (pairingRule === SPLIT_PAIRING.IDENTICAL_RANK) return a.rank === b.rank;
  if (pairingRule === SPLIT_PAIRING.EQUAL_VALUE) {
    if (a.rank === b.rank) return true;
    return isTenValue(a) && isTenValue(b);
  }
  throw new Error(`Unknown pairing rule: ${pairingRule}`);
}
