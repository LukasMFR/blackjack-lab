import { RANKS, SUITS } from './constants.js';
import { createCard } from './card.js';

/**
 * Build the ordered (unshuffled) contents of a shoe.
 * @param {number} deckCount - number of 52-card decks
 * @param {string[]} [removedRanks] - ranks omitted from every deck
 *   (e.g. ['10'] for a 48-card Spanish deck; architecture hook)
 * @returns {ReturnType<typeof createCard>[]}
 */
export function buildShoeCards(deckCount, removedRanks = []) {
  if (!Number.isInteger(deckCount) || deckCount < 1 || deckCount > 12) {
    throw new Error(`Invalid deck count: ${deckCount}`);
  }
  const removed = new Set(removedRanks);
  const cards = [];
  for (let d = 0; d < deckCount; d += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        if (!removed.has(rank)) cards.push(createCard(rank, suit, d));
      }
    }
  }
  return cards;
}
