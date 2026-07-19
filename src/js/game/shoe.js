import { buildShoeCards } from './deck.js';
import { fisherYatesShuffle } from './shuffle.js';
import { cryptoRandom } from './rng.js';

/**
 * A shoe of cards. Cards are drawn from the end of the internal array.
 * Physical-card integrity is enforced: every drawn card id is tracked and
 * a card can never be drawn or re-inserted twice within the same shoe.
 */
export class Shoe {
  /**
   * @param {object} options
   * @param {number} [options.deckCount=6]
   * @param {string[]} [options.removedRanks=[]]
   * @param {() => number} [options.random=cryptoRandom]
   * @param {number} [options.penetration=0.75] - fraction of the shoe dealt
   *   before a reshuffle is required between rounds
   */
  constructor({ deckCount = 6, removedRanks = [], random = cryptoRandom, penetration = 0.75 } = {}) {
    this.deckCount = deckCount;
    this.removedRanks = removedRanks;
    this.random = random;
    this.penetration = penetration;
    this.totalCards = buildShoeCards(deckCount, removedRanks).length;
    this.shuffle();
  }

  /**
   * Build a shoe that deals a predefined card sequence, for debugging and
   * deterministic tests. Cards are dealt in the order given.
   * @param {Array<{rank: string, suit: string, id?: string}>} sequence
   * @returns {Shoe}
   */
  static fromSequence(sequence) {
    const shoe = Object.create(Shoe.prototype);
    shoe.deckCount = 0;
    shoe.removedRanks = [];
    shoe.random = cryptoRandom;
    shoe.penetration = 1;
    const ids = new Set();
    const cards = sequence.map((card, index) => {
      const id = card.id ?? `seq${index}:${card.rank}:${card.suit}`;
      if (ids.has(id)) throw new Error(`Duplicate card id in sequence: ${id}`);
      ids.add(id);
      return Object.freeze({ rank: card.rank, suit: card.suit, id });
    });
    shoe.totalCards = cards.length;
    // Drawing pops from the end, so store the sequence reversed.
    shoe.cards = cards.slice().reverse();
    shoe.drawnIds = new Set();
    shoe.deterministic = true;
    return shoe;
  }

  /** Rebuild and reshuffle the full shoe. */
  shuffle() {
    if (this.deterministic) throw new Error('Cannot reshuffle a deterministic shoe');
    this.cards = fisherYatesShuffle(buildShoeCards(this.deckCount, this.removedRanks), this.random);
    this.drawnIds = new Set();
  }

  /**
   * Draw one card.
   * @returns {{rank: string, suit: string, id: string}}
   */
  draw() {
    if (this.cards.length === 0) throw new Error('Shoe is empty');
    const card = this.cards.pop();
    if (this.drawnIds.has(card.id)) {
      throw new Error(`Card integrity violation: ${card.id} drawn twice`);
    }
    this.drawnIds.add(card.id);
    return card;
  }

  /** @returns {number} cards left in the shoe */
  get remaining() {
    return this.cards.length;
  }

  /**
   * Whether the cut card has been passed and the shoe should be reshuffled
   * before the next round begins.
   * @returns {boolean}
   */
  needsShuffle() {
    if (this.deterministic) return false;
    return this.drawnIds.size >= Math.floor(this.totalCards * this.penetration);
  }
}
