import { HAND_STATUS, RESULTS } from './constants.js';
import { isAce } from './card.js';
import { evaluateCards } from './handEval.js';
import { canResplitAces, dealerMustDraw } from './actionRules.js';

/**
 * Authoritative application of player actions to a hand, shared by every
 * game engine (solo `BlackjackGame` and the multiplayer `MultiplayerTable`).
 *
 * These functions mutate the hand (and, for a split, the player's hands
 * array) but never own a shoe or a bankroll: the calling engine supplies
 * `draw`, `debit`, `bankroll` and `settle` callbacks so drawing, money
 * movement and settlement stay in exactly one place per engine while the
 * *rules* stay in exactly one place overall.
 */

/**
 * Hit: draw exactly one card. A bust settles as an immediate loss; a 21
 * stands automatically because nothing further can improve it.
 * @param {object} hand
 * @param {{draw: () => object, settle: (hand: object, result: string) => void}} ctx
 */
export function applyHit(hand, { draw, settle }) {
  hand.cards.push(draw());
  const evaluation = evaluateCards(hand.cards);
  if (evaluation.isBust) {
    hand.status = HAND_STATUS.BUST;
    settle(hand, RESULTS.LOSS);
  } else if (evaluation.total === 21) {
    // Nothing further can improve a 21; the hand stands automatically.
    hand.status = HAND_STATUS.STOOD;
  }
}

/**
 * Stand: no card, the hand is complete.
 * @param {object} hand
 */
export function applyStand(hand) {
  hand.status = HAND_STATUS.STOOD;
}

/**
 * Double: match the original bet, draw exactly one card, end the hand.
 * @param {object} hand
 * @param {{draw: () => object, debit: (cents: number) => void,
 *   settle: (hand: object, result: string) => void}} ctx
 */
export function applyDouble(hand, { draw, debit, settle }) {
  debit(hand.betCents);
  hand.betCents += hand.originalBetCents;
  hand.doubled = true;
  hand.cards.push(draw());
  const evaluation = evaluateCards(hand.cards);
  if (evaluation.isBust) {
    hand.status = HAND_STATUS.BUST;
    settle(hand, RESULTS.LOSS);
  } else {
    hand.status = HAND_STATUS.STOOD;
  }
}

/**
 * Split: move one card of the pair to a new hand inserted right after the
 * original, place an equal bet on it, deal one card to each hand in play
 * order, and apply the split-Aces and post-split-21 rules.
 *
 * @param {object} hand - the pair being split (must be in `hands`)
 * @param {object} ctx
 * @param {object[]} ctx.hands - the owning player's hands array (mutated)
 * @param {object} ctx.profile
 * @param {() => object} ctx.draw
 * @param {(cents: number) => void} ctx.debit
 * @param {() => number} ctx.bankroll - available bankroll after the debit
 * @param {(betCents: number, flags: object) => object} ctx.createHand
 * @returns {object} the newly created second hand
 */
export function applySplit(hand, { hands, profile, draw, debit, bankroll, createHand }) {
  const splittingAces = hand.cards.every(isAce);
  debit(hand.originalBetCents);

  const second = createHand(hand.originalBetCents, {
    fromSplit: true,
    splitAces: splittingAces,
  });
  second.cards.push(hand.cards.pop());
  hand.fromSplit = true;
  hand.splitAces = splittingAces;

  hands.splice(hands.indexOf(hand) + 1, 0, second);

  // One card to each new hand, in play order.
  hand.cards.push(draw());
  second.cards.push(draw());

  for (const h of [hand, second]) {
    const evaluation = evaluateCards(h.cards);
    if (h.splitAces && profile.splitAcesOneCardOnly && !canResplitAces({
      hand: h,
      profile,
      handCount: hands.length,
      bankrollCents: bankroll(),
    })) {
      // Split Aces receive exactly one card and are then locked.
      h.status = HAND_STATUS.STOOD;
    } else if (evaluation.total === 21) {
      h.status = profile.splitTwentyOneIsBlackjack && evaluation.isNaturalCandidate
        ? HAND_STATUS.BLACKJACK
        : HAND_STATUS.STOOD;
    }
  }
  return second;
}

/**
 * Surrender: give up the hand for half the bet.
 * @param {object} hand
 * @param {{settle: (hand: object, result: string) => void}} ctx
 */
export function applySurrender(hand, { settle }) {
  hand.status = HAND_STATUS.SURRENDERED;
  settle(hand, RESULTS.SURRENDER);
}

/**
 * Draw dealer cards until the profile's stopping rule is met or the
 * dealer busts.
 * @param {object[]} dealerCards - mutated in place
 * @param {{draw: () => object, profile: object}} ctx
 * @returns {object} the final dealer evaluation
 */
export function drawDealerHand(dealerCards, { draw, profile }) {
  let evaluation = evaluateCards(dealerCards);
  while (dealerMustDraw(evaluation, profile)) {
    dealerCards.push(draw());
    evaluation = evaluateCards(dealerCards);
  }
  return evaluation;
}
