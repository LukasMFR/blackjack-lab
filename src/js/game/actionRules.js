import {
  ACTIONS,
  DOUBLE_RESTRICTIONS,
  SURRENDER_MODES,
} from './constants.js';
import { isAce } from './card.js';
import { evaluateCards, isSplittablePair } from './handEval.js';

/**
 * Authoritative per-hand rule decisions, shared by every game engine
 * (solo `BlackjackGame` and the multiplayer `MultiplayerTable`). These are
 * pure functions of a rule profile and a hand context: they never touch a
 * shoe, a bankroll, or the DOM. There is no other implementation of these
 * rules anywhere in the project.
 */

/** Reasons an action can be unavailable (translated by the UI). */
export const UNAVAILABLE_REASONS = Object.freeze({
  NOT_PLAYER_TURN: 'NOT_PLAYER_TURN',
  NOT_TWO_CARDS: 'NOT_TWO_CARDS',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  RULE_FORBIDS: 'RULE_FORBIDS',
  NOT_A_PAIR: 'NOT_A_PAIR',
  MAX_SPLITS_REACHED: 'MAX_SPLITS_REACHED',
  SPLIT_ACES_NO_HIT: 'SPLIT_ACES_NO_HIT',
  NOT_ORIGINAL_HAND: 'NOT_ORIGINAL_HAND',
  SURRENDER_VS_ACE: 'SURRENDER_VS_ACE',
  DOUBLE_TOTAL_RESTRICTED: 'DOUBLE_TOTAL_RESTRICTED',
  NO_DOUBLE_AFTER_SPLIT: 'NO_DOUBLE_AFTER_SPLIT',
  SURRENDER_WINDOW_CLOSED: 'SURRENDER_WINDOW_CLOSED',
});

/**
 * Availability map where every action is illegal for the same reason.
 * Used by engines when the hand is not playable at all.
 * @param {string} reason - an UNAVAILABLE_REASONS value
 * @returns {Record<string, {legal: boolean, reason: string}>}
 */
export function allUnavailable(reason = UNAVAILABLE_REASONS.NOT_PLAYER_TURN) {
  const out = {};
  for (const action of Object.values(ACTIONS)) {
    out[action] = { legal: false, reason };
  }
  return out;
}

/**
 * Whether the profile allows doubling this hand's current total.
 * @param {{cards: Array}} hand
 * @param {object} profile
 * @returns {boolean}
 */
export function doubleTotalAllowed(hand, profile) {
  const { doubleRestriction } = profile;
  if (doubleRestriction === DOUBLE_RESTRICTIONS.ANY_TWO) return true;
  const { total, isSoft } = evaluateCards(hand.cards);
  if (isSoft) return false;
  if (doubleRestriction === DOUBLE_RESTRICTIONS.NINE_TO_ELEVEN) return total >= 9 && total <= 11;
  if (doubleRestriction === DOUBLE_RESTRICTIONS.TEN_ELEVEN) return total === 10 || total === 11;
  return false;
}

/**
 * Whether the profile allows surrendering against the given upcard.
 * @param {{rank: string}} upcard
 * @param {object} profile
 * @returns {boolean}
 */
export function surrenderUpcardAllowed(upcard, profile) {
  if (profile.surrenderVsAce) return true;
  return !isAce(upcard);
}

/**
 * Whether a just-split pair of Aces may be split again right now.
 * @param {object} context
 * @param {object} context.hand
 * @param {object} context.profile
 * @param {number} context.handCount - hands this player already has
 * @param {number} context.bankrollCents - the player's available bankroll
 * @returns {boolean}
 */
export function canResplitAces({ hand, profile, handCount, bankrollCents }) {
  return (
    hand.splitAces
    && profile.resplitAces
    && handCount < profile.maxSplitHands
    && isSplittablePair(hand.cards, profile.splitPairing)
    && bankrollCents >= hand.betCents
  );
}

/**
 * Availability of every player action for one ACTIVE hand whose turn it
 * is. Engine-level gates (round state, pending decisions, whose turn it
 * is) are the caller's responsibility.
 *
 * @param {object} context
 * @param {object} context.profile - active rule profile
 * @param {object} context.hand - the active hand
 * @param {number} context.handCount - hands this player currently has
 * @param {number} context.bankrollCents - the player's available bankroll
 * @param {{rank: string}} context.upcard - dealer upcard
 * @param {boolean|null} context.dealerBlackjackKnown - null while unknown
 * @param {boolean} context.earlySurrenderDeclined
 * @returns {Record<string, {legal: boolean, reason: string|null}>}
 */
export function availabilityForHand({
  profile,
  hand,
  handCount,
  bankrollCents,
  upcard,
  dealerBlackjackKnown,
  earlySurrenderDeclined,
}) {
  const out = {};
  const twoCards = hand.cards.length === 2;
  const set = (action, legal, reason = null) => {
    out[action] = { legal, reason: legal ? null : reason };
  };

  // Split Aces locked to one card: the hand can only stay active while a
  // re-split is possible, so hit and double stay unavailable.
  const lockedAces = hand.splitAces && profile.splitAcesOneCardOnly;
  if (lockedAces) {
    set(ACTIONS.HIT, false, UNAVAILABLE_REASONS.SPLIT_ACES_NO_HIT);
  } else {
    set(ACTIONS.HIT, true);
  }
  set(ACTIONS.STAND, true);

  // Double
  if (lockedAces) {
    set(ACTIONS.DOUBLE, false, UNAVAILABLE_REASONS.SPLIT_ACES_NO_HIT);
  } else if (!twoCards) {
    set(ACTIONS.DOUBLE, false, UNAVAILABLE_REASONS.NOT_TWO_CARDS);
  } else if (hand.fromSplit && !profile.doubleAfterSplit) {
    set(ACTIONS.DOUBLE, false, UNAVAILABLE_REASONS.NO_DOUBLE_AFTER_SPLIT);
  } else if (!doubleTotalAllowed(hand, profile)) {
    set(ACTIONS.DOUBLE, false, UNAVAILABLE_REASONS.DOUBLE_TOTAL_RESTRICTED);
  } else if (bankrollCents < hand.betCents) {
    set(ACTIONS.DOUBLE, false, UNAVAILABLE_REASONS.INSUFFICIENT_FUNDS);
  } else {
    set(ACTIONS.DOUBLE, true);
  }

  // Split
  if (!twoCards) {
    set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.NOT_TWO_CARDS);
  } else if (!isSplittablePair(hand.cards, profile.splitPairing)) {
    set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.NOT_A_PAIR);
  } else if (handCount >= profile.maxSplitHands) {
    set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.MAX_SPLITS_REACHED);
  } else if (hand.splitAces && !profile.resplitAces) {
    set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.RULE_FORBIDS);
  } else if (bankrollCents < hand.betCents) {
    set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.INSUFFICIENT_FUNDS);
  } else {
    set(ACTIONS.SPLIT, true);
  }

  // Surrender (in-turn late/early forms; the early pre-peek prompt is
  // handled separately as a pending decision)
  if (profile.surrender === SURRENDER_MODES.NONE) {
    set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.RULE_FORBIDS);
  } else if (hand.fromSplit || handCount > 1) {
    set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.NOT_ORIGINAL_HAND);
  } else if (!twoCards) {
    set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.SURRENDER_WINDOW_CLOSED);
  } else if (!surrenderUpcardAllowed(upcard, profile)) {
    set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.SURRENDER_VS_ACE);
  } else if (
    profile.surrender === SURRENDER_MODES.EARLY_SURRENDER
    && earlySurrenderDeclined
  ) {
    set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.SURRENDER_WINDOW_CLOSED);
  } else if (
    profile.surrender === SURRENDER_MODES.LATE_SURRENDER
    && dealerBlackjackKnown !== false
  ) {
    // Late surrender only exists once dealer blackjack is ruled out.
    set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.SURRENDER_WINDOW_CLOSED);
  } else {
    set(ACTIONS.SURRENDER, true);
  }

  return out;
}

/**
 * Whether the dealer must draw another card.
 * @param {{total: number, isSoft: boolean}} evaluation - dealer hand evaluation
 * @param {object} profile
 * @returns {boolean}
 */
export function dealerMustDraw(evaluation, profile) {
  if (evaluation.total < 17) return true;
  if (evaluation.total === 17 && evaluation.isSoft && profile.dealerHitsSoft17) return true;
  return false;
}

/**
 * Amount returned to a non-blackjack hand losing to a dealer blackjack
 * under ORIGINAL_BETS_ONLY: double additions are refunded, and split hands
 * (additional wagers) get their stake back; only the round's original bet
 * is lost.
 * @param {{betCents: number, originalBetCents: number, isAdditionalWager: boolean}} hand
 * @returns {number} cents refunded
 */
export function dealerBlackjackRefundCents(hand) {
  const doubleAddition = hand.betCents - hand.originalBetCents;
  return doubleAddition + (hand.isAdditionalWager ? hand.originalBetCents : 0);
}
