import {
  ACTIONS,
  DEAL_MODES,
  DEALER_BJ_LOSS_MODES,
  DOUBLE_RESTRICTIONS,
  HAND_STATUS,
  RESULTS,
  ROUND_STATES,
  SURRENDER_MODES,
} from './constants.js';
import { isAce, isTenValue } from './card.js';
import { evaluateCards, isSplittablePair } from './handEval.js';
import { assertAmount, exactHalf, exactProfit, unitsToCents } from './money.js';
import { compareHands, payoutForResult } from './settlement.js';
import { Shoe } from './shoe.js';
import { validateProfile } from '../config/profiles.js';

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

/** Pending player decisions that block normal actions. */
export const PENDING_DECISIONS = Object.freeze({
  EARLY_SURRENDER: 'EARLY_SURRENDER',
  INSURANCE: 'INSURANCE',
});

let nextHandId = 1;

function createHand(betCents, { fromSplit = false, splitAces = false } = {}) {
  return {
    id: nextHandId++,
    cards: [],
    betCents,
    originalBetCents: betCents,
    isAdditionalWager: fromSplit,
    status: HAND_STATUS.ACTIVE,
    doubled: false,
    fromSplit,
    splitAces,
    settled: false,
    result: null,
    payoutCents: null,
  };
}

/**
 * The authoritative blackjack round state machine.
 *
 * The engine never reads or writes the DOM. The UI drives it through
 * public methods and renders `getSnapshot()`. Illegal calls throw
 * without corrupting the round.
 */
export class BlackjackGame {
  /**
   * @param {object} options
   * @param {object} options.profile - validated rule profile
   * @param {Shoe} [options.shoe] - injected shoe (deterministic tests)
   * @param {number} [options.bankrollCents] - starting bankroll override
   * @param {() => number} [options.random] - RNG for the internal shoe
   */
  constructor({ profile, shoe = null, bankrollCents = null, random = undefined }) {
    validateProfile(profile);
    this.profile = profile;
    this.shoe = shoe ?? new Shoe({
      deckCount: profile.decks,
      removedRanks: profile.removedRanks,
      penetration: profile.penetration,
      ...(random ? { random } : {}),
    });
    this.bankrollCents = bankrollCents ?? unitsToCents(profile.startingBankrollUnits);
    assertAmount(this.bankrollCents, 'bankroll');
    this.lastBetCents = unitsToCents(profile.defaultBetUnits);
    this.roundState = ROUND_STATES.WAITING_FOR_BET;
    this.shoeJustShuffled = false;
    this.#clearRound();
  }

  #clearRound() {
    this.hands = [];
    this.activeHandIndex = -1;
    this.dealerCards = [];
    this.holeCardHidden = false;
    this.dealerBlackjackKnown = null; // null = unknown, true/false once determined
    this.pendingDecision = null;
    this.earlySurrenderDeclined = false;
    this.insurance = { offered: false, betCents: 0, taken: false, settled: false, result: null };
    this.roundSummary = null;
  }

  // ---------------------------------------------------------------- bankroll

  #debit(cents) {
    assertAmount(cents, 'debit');
    if (cents > this.bankrollCents) throw new Error('Insufficient bankroll');
    this.bankrollCents -= cents;
  }

  #credit(cents) {
    assertAmount(cents, 'credit');
    this.bankrollCents += cents;
    assertAmount(this.bankrollCents, 'bankroll');
  }

  // ---------------------------------------------------------------- betting

  /**
   * Largest legal bet right now (bankroll capped by the table maximum).
   * @returns {number} cents
   */
  maxBetCents() {
    return Math.min(this.bankrollCents, unitsToCents(this.profile.maxBetUnits));
  }

  /** @returns {number} minimum table bet in cents */
  minBetCents() {
    return unitsToCents(this.profile.minBetUnits);
  }

  /**
   * Commit the main bet and run the initial deal.
   * @param {number} betCents - whole-unit bet in cents
   */
  placeBet(betCents) {
    this.#expectState(ROUND_STATES.WAITING_FOR_BET);
    assertAmount(betCents, 'bet');
    if (betCents % 100 !== 0) throw new Error('Bets must be whole units');
    if (betCents < this.minBetCents()) throw new Error('Bet below table minimum');
    if (betCents > unitsToCents(this.profile.maxBetUnits)) throw new Error('Bet above table maximum');
    if (betCents > this.bankrollCents) throw new Error('Insufficient bankroll');

    this.shoeJustShuffled = false;
    if (this.shoe.needsShuffle()) {
      this.shoe.shuffle();
      this.shoeJustShuffled = true;
    }

    this.#clearRound();
    this.roundState = ROUND_STATES.INITIAL_DEAL;
    this.#debit(betCents);
    this.lastBetCents = betCents;

    const hand = createHand(betCents);
    this.hands = [hand];
    this.activeHandIndex = 0;

    // Dealing order per rules §7: player, dealer up, player, then the
    // dealer hole card only under American rules.
    hand.cards.push(this.shoe.draw());
    this.dealerCards.push(this.shoe.draw());
    hand.cards.push(this.shoe.draw());
    if (this.profile.dealMode === DEAL_MODES.AMERICAN_HOLE_CARD) {
      this.dealerCards.push(this.shoe.draw());
      this.holeCardHidden = true;
    }

    if (evaluateCards(hand.cards).isNaturalCandidate) {
      hand.status = HAND_STATUS.BLACKJACK;
    }

    this.roundState = ROUND_STATES.PLAYER_TURN;
    this.#openPrePlayDecisions();
  }

  // ------------------------------------------------- pre-play decision phase

  get #upcard() {
    return this.dealerCards[0];
  }

  #dealerCouldHaveBlackjack() {
    return isAce(this.#upcard) || isTenValue(this.#upcard);
  }

  #openPrePlayDecisions() {
    const { profile } = this;
    // Early surrender is decided before insurance and before any peek.
    if (
      profile.surrender === SURRENDER_MODES.EARLY_SURRENDER
      && this.#surrenderUpcardAllowed()
      && this.#dealerCouldHaveBlackjack()
      && this.hands[0].status === HAND_STATUS.ACTIVE
    ) {
      this.pendingDecision = PENDING_DECISIONS.EARLY_SURRENDER;
      return;
    }
    this.#openInsuranceOrPeek();
  }

  #openInsuranceOrPeek() {
    const { profile } = this;
    const insuranceCost = exactHalf(this.hands[0].originalBetCents);
    if (
      profile.insuranceEnabled
      && isAce(this.#upcard)
      && this.bankrollCents >= insuranceCost
    ) {
      this.pendingDecision = PENDING_DECISIONS.INSURANCE;
      return;
    }
    this.pendingDecision = null;
    this.#afterPrePlayDecisions();
  }

  /**
   * Answer a pending early-surrender offer.
   * @param {boolean} accept
   */
  decideEarlySurrender(accept) {
    this.#expectPending(PENDING_DECISIONS.EARLY_SURRENDER);
    this.pendingDecision = null;
    if (accept) {
      this.#surrenderHand(this.hands[0]);
      this.#finishRound();
      return;
    }
    this.earlySurrenderDeclined = true;
    this.#openInsuranceOrPeek();
  }

  /**
   * Answer a pending insurance offer.
   * @param {boolean} accept
   */
  decideInsurance(accept) {
    this.#expectPending(PENDING_DECISIONS.INSURANCE);
    this.pendingDecision = null;
    if (accept) {
      const cost = exactHalf(this.hands[0].originalBetCents);
      this.#debit(cost);
      this.insurance = { offered: true, betCents: cost, taken: true, settled: false, result: null };
    } else {
      this.insurance.offered = true;
    }
    this.#afterPrePlayDecisions();
  }

  #afterPrePlayDecisions() {
    const { profile } = this;
    if (
      profile.dealMode === DEAL_MODES.AMERICAN_HOLE_CARD
      && profile.dealerPeek
      && this.#dealerCouldHaveBlackjack()
    ) {
      const dealerNatural = evaluateCards(this.dealerCards).isNaturalCandidate;
      this.dealerBlackjackKnown = dealerNatural;
      if (dealerNatural) {
        this.holeCardHidden = false;
        this.#resolveInsurance(true);
        this.#settleAgainstDealerBlackjack();
        this.#finishRound();
        return;
      }
      this.#resolveInsurance(false);
    } else if (!this.#dealerCouldHaveBlackjack()) {
      this.dealerBlackjackKnown = false;
    }

    // A natural player hand with no possible dealer blackjack is paid at
    // once; otherwise it waits for the dealer's blackjack check or second
    // card.
    if (this.hands[0].status === HAND_STATUS.BLACKJACK && this.dealerBlackjackKnown === false) {
      this.#settleHand(this.hands[0], RESULTS.BLACKJACK_WIN);
      this.#finishRound();
      return;
    }
    if (this.hands[0].status === HAND_STATUS.BLACKJACK) {
      // ENHC with a ten/Ace upcard: wait for the dealer's second card.
      this.#advanceToDealerIfDone();
      return;
    }
    this.#advanceTurn();
  }

  // ---------------------------------------------------------- legal actions

  /**
   * Availability of every player action for the active hand, with reasons.
   * @returns {Record<string, {legal: boolean, reason: string|null}>}
   */
  actionAvailability() {
    const out = {};
    for (const action of Object.values(ACTIONS)) {
      out[action] = { legal: false, reason: UNAVAILABLE_REASONS.NOT_PLAYER_TURN };
    }
    if (this.roundState !== ROUND_STATES.PLAYER_TURN || this.pendingDecision !== null) {
      return out;
    }
    const hand = this.hands[this.activeHandIndex];
    if (!hand || hand.status !== HAND_STATUS.ACTIVE) return out;

    const { profile } = this;
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
    } else if (!this.#doubleTotalAllowed(hand)) {
      set(ACTIONS.DOUBLE, false, UNAVAILABLE_REASONS.DOUBLE_TOTAL_RESTRICTED);
    } else if (this.bankrollCents < hand.betCents) {
      set(ACTIONS.DOUBLE, false, UNAVAILABLE_REASONS.INSUFFICIENT_FUNDS);
    } else {
      set(ACTIONS.DOUBLE, true);
    }

    // Split
    if (!twoCards) {
      set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.NOT_TWO_CARDS);
    } else if (!isSplittablePair(hand.cards, profile.splitPairing)) {
      set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.NOT_A_PAIR);
    } else if (this.hands.length >= profile.maxSplitHands) {
      set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.MAX_SPLITS_REACHED);
    } else if (hand.splitAces && !profile.resplitAces) {
      set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.RULE_FORBIDS);
    } else if (this.bankrollCents < hand.betCents) {
      set(ACTIONS.SPLIT, false, UNAVAILABLE_REASONS.INSUFFICIENT_FUNDS);
    } else {
      set(ACTIONS.SPLIT, true);
    }

    // Surrender (in-turn late/early forms; the early pre-peek prompt is
    // handled separately as a pending decision)
    if (profile.surrender === SURRENDER_MODES.NONE) {
      set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.RULE_FORBIDS);
    } else if (hand.fromSplit || this.hands.length > 1) {
      set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.NOT_ORIGINAL_HAND);
    } else if (!twoCards) {
      set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.SURRENDER_WINDOW_CLOSED);
    } else if (!this.#surrenderUpcardAllowed()) {
      set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.SURRENDER_VS_ACE);
    } else if (
      profile.surrender === SURRENDER_MODES.EARLY_SURRENDER
      && this.earlySurrenderDeclined
    ) {
      set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.SURRENDER_WINDOW_CLOSED);
    } else if (
      profile.surrender === SURRENDER_MODES.LATE_SURRENDER
      && this.dealerBlackjackKnown !== false
    ) {
      // Late surrender only exists once dealer blackjack is ruled out.
      set(ACTIONS.SURRENDER, false, UNAVAILABLE_REASONS.SURRENDER_WINDOW_CLOSED);
    } else {
      set(ACTIONS.SURRENDER, true);
    }

    return out;
  }

  /** @returns {string[]} legal actions for the active hand */
  legalActions() {
    const availability = this.actionAvailability();
    return Object.keys(availability).filter((a) => availability[a].legal);
  }

  #doubleTotalAllowed(hand) {
    const { doubleRestriction } = this.profile;
    if (doubleRestriction === DOUBLE_RESTRICTIONS.ANY_TWO) return true;
    const { total, isSoft } = evaluateCards(hand.cards);
    if (isSoft) return false;
    if (doubleRestriction === DOUBLE_RESTRICTIONS.NINE_TO_ELEVEN) return total >= 9 && total <= 11;
    if (doubleRestriction === DOUBLE_RESTRICTIONS.TEN_ELEVEN) return total === 10 || total === 11;
    return false;
  }

  #surrenderUpcardAllowed() {
    if (this.profile.surrenderVsAce) return true;
    return !isAce(this.#upcard);
  }

  // ---------------------------------------------------------- player actions

  /**
   * Perform a player action on the active hand.
   * @param {string} action - an ACTIONS value
   */
  act(action) {
    this.#expectState(ROUND_STATES.PLAYER_TURN);
    if (this.pendingDecision !== null) {
      throw new Error(`Decision pending: ${this.pendingDecision}`);
    }
    const availability = this.actionAvailability()[action];
    if (!availability) throw new Error(`Unknown action: ${action}`);
    if (!availability.legal) {
      throw new Error(`Illegal action ${action}: ${availability.reason}`);
    }
    const hand = this.hands[this.activeHandIndex];
    switch (action) {
      case ACTIONS.HIT: this.#hit(hand); break;
      case ACTIONS.STAND: this.#stand(hand); break;
      case ACTIONS.DOUBLE: this.#double(hand); break;
      case ACTIONS.SPLIT: this.#split(hand); break;
      case ACTIONS.SURRENDER: this.#surrenderAction(hand); break;
      default: throw new Error(`Unknown action: ${action}`);
    }
  }

  #hit(hand) {
    hand.cards.push(this.shoe.draw());
    const evaluation = evaluateCards(hand.cards);
    if (evaluation.isBust) {
      hand.status = HAND_STATUS.BUST;
      this.#settleHand(hand, RESULTS.LOSS);
    } else if (evaluation.total === 21) {
      // Nothing further can improve a 21; the hand stands automatically.
      hand.status = HAND_STATUS.STOOD;
    }
    this.#advanceTurn();
  }

  #stand(hand) {
    hand.status = HAND_STATUS.STOOD;
    this.#advanceTurn();
  }

  #double(hand) {
    this.#debit(hand.betCents);
    hand.betCents += hand.originalBetCents;
    hand.doubled = true;
    hand.cards.push(this.shoe.draw());
    const evaluation = evaluateCards(hand.cards);
    if (evaluation.isBust) {
      hand.status = HAND_STATUS.BUST;
      this.#settleHand(hand, RESULTS.LOSS);
    } else {
      hand.status = HAND_STATUS.STOOD;
    }
    this.#advanceTurn();
  }

  #split(hand) {
    const splittingAces = hand.cards.every(isAce);
    this.#debit(hand.originalBetCents);

    const second = createHand(hand.originalBetCents, {
      fromSplit: true,
      splitAces: splittingAces,
    });
    second.cards.push(hand.cards.pop());
    hand.fromSplit = true;
    hand.splitAces = splittingAces;

    this.hands.splice(this.activeHandIndex + 1, 0, second);

    // One card to each new hand, in play order.
    hand.cards.push(this.shoe.draw());
    second.cards.push(this.shoe.draw());

    for (const h of [hand, second]) {
      const evaluation = evaluateCards(h.cards);
      if (h.splitAces && this.profile.splitAcesOneCardOnly && !this.#canResplit(h)) {
        // Split Aces receive exactly one card and are then locked.
        h.status = HAND_STATUS.STOOD;
      } else if (evaluation.total === 21) {
        h.status = this.#isSplitBlackjack(h, evaluation)
          ? HAND_STATUS.BLACKJACK
          : HAND_STATUS.STOOD;
      }
    }
    this.#advanceTurn();
  }

  #canResplit(hand) {
    return (
      hand.splitAces
      && this.profile.resplitAces
      && this.hands.length < this.profile.maxSplitHands
      && isSplittablePair(hand.cards, this.profile.splitPairing)
      && this.bankrollCents >= hand.betCents
    );
  }

  #isSplitBlackjack(hand, evaluation) {
    return this.profile.splitTwentyOneIsBlackjack && evaluation.isNaturalCandidate;
  }

  #surrenderAction(hand) {
    this.#surrenderHand(hand);
    this.#advanceTurn();
  }

  #surrenderHand(hand) {
    hand.status = HAND_STATUS.SURRENDERED;
    this.#settleHand(hand, RESULTS.SURRENDER);
  }

  // ------------------------------------------------------------- turn order

  #advanceTurn() {
    const next = this.hands.findIndex((h) => h.status === HAND_STATUS.ACTIVE);
    if (next !== -1) {
      this.activeHandIndex = next;
      return;
    }
    this.activeHandIndex = -1;
    this.#advanceToDealerIfDone();
  }

  #advanceToDealerIfDone() {
    // Hands that still matter for the dealer: stood/doubled hands need a
    // dealer total; blackjack hands may still push against a dealer
    // natural; a pending insurance bet needs resolving either way.
    const contested = this.hands.some(
      (h) => !h.settled && (h.status === HAND_STATUS.STOOD || h.status === HAND_STATUS.BLACKJACK),
    );
    if (!contested && !(this.insurance.taken && !this.insurance.settled)) {
      this.#finishRound();
      return;
    }
    this.roundState = ROUND_STATES.DEALER_TURN;
    this.#playDealer();
  }

  // ------------------------------------------------------------ dealer turn

  #playDealer() {
    const { profile } = this;

    if (profile.dealMode === DEAL_MODES.ENHC) {
      this.dealerCards.push(this.shoe.draw());
    }
    this.holeCardHidden = false;

    const dealerNatural = evaluateCards(this.dealerCards).isNaturalCandidate;
    this.dealerBlackjackKnown = dealerNatural;
    this.#resolveInsurance(dealerNatural);

    if (dealerNatural) {
      this.#settleAgainstDealerBlackjack();
      this.#finishRound();
      return;
    }

    // Draw only while a live non-blackjack hand contests the outcome.
    const liveHands = this.hands.some((h) => !h.settled && h.status === HAND_STATUS.STOOD);
    if (liveHands) {
      let evaluation = evaluateCards(this.dealerCards);
      while (this.#dealerMustDraw(evaluation)) {
        this.dealerCards.push(this.shoe.draw());
        evaluation = evaluateCards(this.dealerCards);
      }
    }
    this.#settleRemainingHands();
    this.#finishRound();
  }

  #dealerMustDraw(evaluation) {
    if (evaluation.total < 17) return true;
    if (evaluation.total === 17 && evaluation.isSoft && this.profile.dealerHitsSoft17) return true;
    return false;
  }

  // ------------------------------------------------------------- settlement

  #settleHand(hand, result) {
    if (hand.settled) throw new Error(`Hand ${hand.id} already settled`);
    const payout = payoutForResult(result, hand.betCents, this.profile);
    hand.settled = true;
    hand.result = result;
    hand.payoutCents = payout;
    if (payout > 0) this.#credit(payout);
  }

  /** Settle a hand for a dealer blackjack under ORIGINAL_BETS_ONLY. */
  #settleOriginalBetOnly(hand) {
    if (hand.settled) throw new Error(`Hand ${hand.id} already settled`);
    const doubleAddition = hand.betCents - hand.originalBetCents;
    // Additional wagers (split hands, double additions) are returned;
    // only the round's original bet is lost.
    const refund = doubleAddition + (hand.isAdditionalWager ? hand.originalBetCents : 0);
    hand.settled = true;
    hand.result = RESULTS.LOSS;
    hand.payoutCents = refund;
    if (refund > 0) this.#credit(refund);
  }

  #settleAgainstDealerBlackjack() {
    const mode = this.profile.dealerBlackjackLossMode;
    for (const hand of this.hands) {
      if (hand.settled) continue; // busts and surrenders are already final
      if (hand.status === HAND_STATUS.BLACKJACK) {
        this.#settleHand(hand, RESULTS.PUSH);
      } else if (mode === DEALER_BJ_LOSS_MODES.ORIGINAL_BETS_ONLY) {
        this.#settleOriginalBetOnly(hand);
      } else {
        // PEEK_PROTECTED (no extra wagers exist yet) and ALL_BETS_LOST
        // both lose every committed bet on the hand.
        this.#settleHand(hand, RESULTS.LOSS);
      }
    }
  }

  #settleRemainingHands() {
    const dealerEval = evaluateCards(this.dealerCards);
    const dealer = {
      total: dealerEval.total,
      isBust: dealerEval.isBust,
      isBlackjack: false,
    };
    for (const hand of this.hands) {
      if (hand.settled) continue;
      const evaluation = evaluateCards(hand.cards);
      const player = {
        total: evaluation.total,
        isBlackjack: hand.status === HAND_STATUS.BLACKJACK,
      };
      this.#settleHand(hand, compareHands(player, dealer));
    }
  }

  #resolveInsurance(dealerHasBlackjack) {
    if (!this.insurance.taken || this.insurance.settled) return;
    this.insurance.settled = true;
    if (dealerHasBlackjack) {
      this.insurance.result = RESULTS.WIN;
      const profit = exactProfit(this.insurance.betCents, this.profile.insurancePayout);
      this.#credit(this.insurance.betCents + profit);
    } else {
      this.insurance.result = RESULTS.LOSS;
    }
  }

  #finishRound() {
    const unsettled = this.hands.filter((h) => !h.settled);
    if (unsettled.length > 0) {
      throw new Error('Cannot finish round with unsettled hands');
    }
    this.roundState = ROUND_STATES.SETTLEMENT;
    this.activeHandIndex = -1;
    this.roundSummary = {
      hands: this.hands.map((h) => ({
        result: h.result,
        betCents: h.betCents,
        payoutCents: h.payoutCents,
      })),
      insurance: this.insurance.taken
        ? { betCents: this.insurance.betCents, result: this.insurance.result }
        : null,
      netCents: this.hands.reduce((sum, h) => sum + h.payoutCents - h.betCents, 0)
        + (this.insurance.taken
          ? (this.insurance.result === RESULTS.WIN
            ? exactProfit(this.insurance.betCents, this.profile.insurancePayout)
            : -this.insurance.betCents)
          : 0),
    };
    this.roundState = ROUND_STATES.ROUND_COMPLETE;
  }

  /** Return to the betting state after a completed round. */
  nextRound() {
    this.#expectState(ROUND_STATES.ROUND_COMPLETE);
    this.#clearRound();
    this.roundState = ROUND_STATES.WAITING_FOR_BET;
  }

  // --------------------------------------------------------------- helpers

  #expectState(state) {
    if (this.roundState !== state) {
      throw new Error(`Expected state ${state}, current state is ${this.roundState}`);
    }
  }

  #expectPending(decision) {
    this.#expectState(ROUND_STATES.PLAYER_TURN);
    if (this.pendingDecision !== decision) {
      throw new Error(`No pending ${decision} decision`);
    }
  }

  /**
   * Immutable view of the game for rendering. The dealer hole card is
   * masked while hidden, so the UI never sees it early.
   * @returns {object}
   */
  getSnapshot() {
    const dealerVisibleCards = this.dealerCards.map((card, index) => (
      this.holeCardHidden && index === 1 ? { hidden: true } : { ...card }
    ));
    const visibleDealerEval = this.dealerCards.length > 0
      ? evaluateCards(this.holeCardHidden ? [this.dealerCards[0]] : this.dealerCards)
      : null;
    return {
      roundState: this.roundState,
      profileId: this.profile.id,
      profileSurrender: this.profile.surrender,
      bankrollCents: this.bankrollCents,
      lastBetCents: this.lastBetCents,
      pendingDecision: this.pendingDecision,
      insurance: { ...this.insurance },
      dealer: {
        cards: dealerVisibleCards,
        evaluation: visibleDealerEval,
        holeCardHidden: this.holeCardHidden,
        isBlackjack: this.dealerBlackjackKnown === true,
      },
      hands: this.hands.map((hand, index) => ({
        id: hand.id,
        cards: hand.cards.map((c) => ({ ...c })),
        evaluation: evaluateCards(hand.cards),
        betCents: hand.betCents,
        status: hand.status,
        doubled: hand.doubled,
        fromSplit: hand.fromSplit,
        splitAces: hand.splitAces,
        settled: hand.settled,
        result: hand.result,
        payoutCents: hand.payoutCents,
        isActive: index === this.activeHandIndex
          && this.roundState === ROUND_STATES.PLAYER_TURN,
        isBlackjack: hand.status === HAND_STATUS.BLACKJACK,
      })),
      activeHandIndex: this.activeHandIndex,
      actionAvailability: this.actionAvailability(),
      roundSummary: this.roundSummary,
      shoe: {
        remaining: this.shoe.remaining,
        justShuffled: this.shoeJustShuffled,
      },
    };
  }
}
