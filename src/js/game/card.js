import { RANKS, SUITS } from './constants.js';

/**
 * A card is a plain immutable object. `id` identifies the physical card
 * instance inside a shoe (deck index + rank + suit), so the same physical
 * card can never legally appear twice.
 */

const TEN_VALUE_RANKS = new Set(['10', 'J', 'Q', 'K']);

/**
 * Create one physical card.
 * @param {string} rank - one of RANKS
 * @param {string} suit - one of SUITS
 * @param {number} deckIndex - which deck of the shoe this card belongs to
 * @returns {{rank: string, suit: string, id: string}}
 */
export function createCard(rank, suit, deckIndex = 0) {
  if (!RANKS.includes(rank)) throw new Error(`Invalid rank: ${rank}`);
  if (!SUITS.includes(suit)) throw new Error(`Invalid suit: ${suit}`);
  return Object.freeze({ rank, suit, id: `${deckIndex}:${rank}:${suit}` });
}

/**
 * Base value of a card. Aces count as 11 here; hand evaluation reduces
 * them to 1 when needed.
 * @param {{rank: string}} card
 * @returns {number}
 */
export function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (TEN_VALUE_RANKS.has(card.rank)) return 10;
  return Number(card.rank);
}

/**
 * @param {{rank: string}} card
 * @returns {boolean} true for 10, J, Q, K
 */
export function isTenValue(card) {
  return TEN_VALUE_RANKS.has(card.rank);
}

/**
 * @param {{rank: string}} card
 * @returns {boolean}
 */
export function isAce(card) {
  return card.rank === 'A';
}
