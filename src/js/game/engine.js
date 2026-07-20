import {
  ACTIONS,
  DEAL_MODES,
  DEALER_BJ_LOSS_MODES,
  HAND_STATUS,
  RESULTS,
  ROUND_STATES,
  SURRENDER_MODES,
} from './constants.js';
import { isAce, isTenValue } from './card.js';
import { evaluateCards } from './handEval.js';
import { assertAmount, exactHalf, exactProfit, unitsToCents } from './money.js';
import { compareHands, payoutForResult } from './settlement.js';
import {
  allUnavailable,
  availabilityForHand,
  dealerBlackjackRefundCents,
  surrenderUpcardAllowed,
  UNAVAILABLE_REASONS,
} from './actionRules.js';
import {
  applyDouble, applyHit, applySplit, applyStand, applySurrender, drawDealerHand,
} from './handPlay.js';
import { Shoe } from './shoe.js';
import { validateProfile } from '../config/profiles.js';

// Re-exported for the UI and tests; the authoritative definition lives in
// actionRules.js, shared with the multiplayer table engine.
export { UNAVAILABLE_REASONS };

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
    if (this.roundState !== ROUND_STATES.PLAYER_TURN || this.pendingDecision !== null) {
      return allUnavailable();
    }
    const hand = this.hands[this.activeHandIndex];
    if (!hand || hand.status !== HAND_STATUS.ACTIVE) return allUnavailable();
    return availabilityForHand({
      profile: this.profile,
      hand,
      handCount: this.hands.length,
      bankrollCents: this.bankrollCents,
      upcard: this.#upcard,
      dealerBlackjackKnown: this.dealerBlackjackKnown,
      earlySurrenderDeclined: this.earlySurrenderDeclined,
    });
  }

  /** @returns {string[]} legal actions for the active hand */
  legalActions() {
    const availability = this.actionAvailability();
    return Object.keys(availability).filter((a) => availability[a].legal);
  }

  #surrenderUpcardAllowed() {
    return surrenderUpcardAllowed(this.#upcard, this.profile);
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

  get #playCtx() {
    return {
      draw: () => this.shoe.draw(),
      debit: (cents) => this.#debit(cents),
      bankroll: () => this.bankrollCents,
      settle: (hand, result) => this.#settleHand(hand, result),
      hands: this.hands,
      profile: this.profile,
      createHand,
    };
  }

  #hit(hand) {
    applyHit(hand, this.#playCtx);
    this.#advanceTurn();
  }

  #stand(hand) {
    applyStand(hand);
    this.#advanceTurn();
  }

  #double(hand) {
    applyDouble(hand, this.#playCtx);
    this.#advanceTurn();
  }

  #split(hand) {
    applySplit(hand, this.#playCtx);
    this.#advanceTurn();
  }

  #surrenderAction(hand) {
    this.#surrenderHand(hand);
    this.#advanceTurn();
  }

  #surrenderHand(hand) {
    applySurrender(hand, this.#playCtx);
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
      drawDealerHand(this.dealerCards, {
        draw: () => this.shoe.draw(),
        profile: this.profile,
      });
    }
    this.#settleRemainingHands();
    this.#finishRound();
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
    // Additional wagers (split hands, double additions) are returned;
    // only the round's original bet is lost.
    const refund = dealerBlackjackRefundCents(hand);
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
