import {
  ACTIONS,
  DEAL_MODES,
  DEALER_BJ_LOSS_MODES,
  HAND_STATUS,
  RESULTS,
  SURRENDER_MODES,
} from '../game/constants.js';
import { isAce, isTenValue } from '../game/card.js';
import { evaluateCards } from '../game/handEval.js';
import { assertAmount, exactHalf, exactProfit, unitsToCents } from '../game/money.js';
import { compareHands, payoutForResult } from '../game/settlement.js';
import {
  allUnavailable,
  availabilityForHand,
  dealerBlackjackRefundCents,
  surrenderUpcardAllowed,
} from '../game/actionRules.js';
import {
  applyDouble, applyHit, applySplit, applyStand, applySurrender, drawDealerHand,
} from '../game/handPlay.js';
import { Shoe } from '../game/shoe.js';
import { validateProfile } from '../config/profiles.js';

/**
 * The authoritative multiplayer blackjack table, run exclusively on the
 * host device. Several seated players share one shoe and one dealer hand;
 * every seat has its own independent fictional bankroll, bets, hands and
 * settlement.
 *
 * All blackjack *rules* are the same authoritative implementations the solo
 * engine uses (actionRules.js, handPlay.js, handEval.js, settlement.js,
 * money.js); this class only orchestrates seats, turn order and the shared
 * dealer. It never touches the DOM or the network: the host session drives
 * it with validated commands and broadcasts `getSnapshot()`.
 *
 * Table states:
 *   BETTING → PRE_PLAY (insurance / early-surrender decisions, optional)
 *   → PLAYER_TURN → DEALER_TURN → ROUND_COMPLETE → BETTING …
 */

export const TABLE_STATES = Object.freeze({
  BETTING: 'BETTING',
  PRE_PLAY: 'PRE_PLAY',
  PLAYER_TURN: 'PLAYER_TURN',
  DEALER_TURN: 'DEALER_TURN',
  ROUND_COMPLETE: 'ROUND_COMPLETE',
});

/** Pending pre-play decisions a seat may owe. */
export const SEAT_DECISIONS = Object.freeze({
  EARLY_SURRENDER: 'EARLY_SURRENDER',
  INSURANCE: 'INSURANCE',
});

/** Hard cap on seats at one table (host config may choose fewer). */
export const MAX_SEATS = 7;

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

function freshInsurance() {
  return { offered: false, betCents: 0, taken: false, settled: false, result: null };
}

export class MultiplayerTable {
  /**
   * @param {object} options
   * @param {object} options.profile - validated rule profile
   * @param {Shoe} [options.shoe] - injected shoe (deterministic tests)
   * @param {number} [options.maxSeats] - seats the host allows (≤ MAX_SEATS)
   * @param {number} [options.startingBankrollCents] - bankroll for new seats
   * @param {number} [options.minBetCents] - table minimum override
   * @param {number} [options.maxBetCents] - table maximum override
   * @param {() => number} [options.random] - RNG for the internal shoe
   */
  constructor({
    profile,
    shoe = null,
    maxSeats = MAX_SEATS,
    startingBankrollCents = null,
    minBetCents = null,
    maxBetCents = null,
    random = undefined,
  }) {
    validateProfile(profile);
    this.profile = profile;
    this.shoe = shoe ?? new Shoe({
      deckCount: profile.decks,
      removedRanks: profile.removedRanks,
      penetration: profile.penetration,
      ...(random ? { random } : {}),
    });
    if (!Number.isInteger(maxSeats) || maxSeats < 1 || maxSeats > MAX_SEATS) {
      throw new Error(`Invalid seat count: ${maxSeats}`);
    }
    this.maxSeats = maxSeats;
    this.startingBankrollCents = startingBankrollCents
      ?? unitsToCents(profile.startingBankrollUnits);
    assertAmount(this.startingBankrollCents, 'starting bankroll');
    this.minBetCents = minBetCents ?? unitsToCents(profile.minBetUnits);
    this.maxBetCents = maxBetCents ?? unitsToCents(profile.maxBetUnits);
    if (this.minBetCents % 100 !== 0 || this.maxBetCents % 100 !== 0
      || this.minBetCents <= 0 || this.maxBetCents < this.minBetCents) {
      throw new Error('Invalid table bet limits');
    }

    this.state = TABLE_STATES.BETTING;
    this.seats = [];
    this.roundCounter = 0;
    this.shoeJustShuffled = false;
    this.#clearRoundState();
  }

  #clearRoundState() {
    this.dealerCards = [];
    this.holeCardHidden = false;
    this.dealerBlackjackKnown = null;
    this.activeSeatIndex = -1;
    this.activeHandIndex = -1;
    this.roundSummaries = null;
  }

  // ------------------------------------------------------------------ seats

  /**
   * Seat a new player. During a round the seat joins as a spectator and
   * plays from the next betting phase.
   * @param {object} options
   * @param {string} options.playerId - stable unique player id
   * @param {string} options.name - display name
   * @param {number} [options.bankrollCents] - restored bankroll (reconnect)
   * @returns {object} the created seat
   */
  addPlayer({ playerId, name, bankrollCents = null }) {
    if (this.seats.some((s) => s.playerId === playerId)) {
      throw new Error(`Player already seated: ${playerId}`);
    }
    if (this.seats.length >= this.maxSeats) throw new Error('Table is full');
    const seat = {
      seatId: `seat-${this.seats.length + 1}-${playerId.slice(0, 8)}`,
      playerId,
      name,
      bankrollCents: bankrollCents ?? this.startingBankrollCents,
      connected: true,
      leaving: false,
      betCents: 0,
      ready: false,
      sittingOut: this.state !== TABLE_STATES.BETTING,
      hands: [],
      insurance: freshInsurance(),
      pendingDecision: null,
      earlySurrenderDeclined: false,
      roundNetCents: null,
    };
    assertAmount(seat.bankrollCents, 'bankroll');
    this.seats.push(seat);
    return seat;
  }

  /** @returns {object|undefined} */
  getSeat(playerId) {
    return this.seats.find((s) => s.playerId === playerId);
  }

  #requireSeat(playerId) {
    const seat = this.getSeat(playerId);
    if (!seat) throw new Error(`Unknown player: ${playerId}`);
    return seat;
  }

  /**
   * Mark a seat connected or disconnected. Disconnecting refunds an
   * uncommitted bet during betting, auto-declines pending pre-play
   * decisions, and auto-stands the seat's hands if it was their turn.
   * @param {string} playerId
   * @param {boolean} connected
   */
  setConnected(playerId, connected) {
    const seat = this.#requireSeat(playerId);
    if (seat.connected === connected) return;
    seat.connected = connected;
    if (connected) return;

    if (this.state === TABLE_STATES.BETTING && seat.betCents > 0) {
      this.#creditSeat(seat, seat.betCents);
      seat.betCents = 0;
      seat.ready = false;
      return;
    }
    if (this.state === TABLE_STATES.PRE_PLAY && seat.pendingDecision !== null) {
      // Absent players never buy insurance or surrender automatically.
      this.#resolveSeatDecision(seat, false);
      return;
    }
    if (this.state === TABLE_STATES.PLAYER_TURN
      && this.seats[this.activeSeatIndex] === seat) {
      this.#standAllActiveHands(seat);
      this.#advanceTurn();
    }
  }

  /**
   * Remove a player. Mid-round the seat is only marked as leaving: its
   * hands finish (standing) and the seat disappears when the round ends.
   * @param {string} playerId
   */
  removePlayer(playerId) {
    const seat = this.#requireSeat(playerId);
    seat.leaving = true;
    this.setConnected(playerId, false);
    if (this.state === TABLE_STATES.BETTING || this.state === TABLE_STATES.ROUND_COMPLETE
      || seat.hands.length === 0) {
      this.seats = this.seats.filter((s) => s !== seat);
      if (this.state === TABLE_STATES.PRE_PLAY) this.#proceedWhenDecisionsDone();
    }
  }

  #standAllActiveHands(seat) {
    for (const hand of seat.hands) {
      if (hand.status === HAND_STATUS.ACTIVE) applyStand(hand);
    }
  }

  // --------------------------------------------------------------- bankroll

  #debitSeat(seat, cents) {
    assertAmount(cents, 'debit');
    if (cents > seat.bankrollCents) throw new Error('Insufficient bankroll');
    seat.bankrollCents -= cents;
  }

  #creditSeat(seat, cents) {
    assertAmount(cents, 'credit');
    seat.bankrollCents += cents;
    assertAmount(seat.bankrollCents, 'bankroll');
  }

  // ---------------------------------------------------------------- betting

  #expectState(state) {
    if (this.state !== state) {
      throw new Error(`Expected table state ${state}, current state is ${this.state}`);
    }
  }

  /**
   * Commit (or replace) a seat's main bet for the coming round.
   * @param {string} playerId
   * @param {number} betCents
   */
  placeBet(playerId, betCents) {
    this.#expectState(TABLE_STATES.BETTING);
    const seat = this.#requireSeat(playerId);
    if (!seat.connected) throw new Error('Player is disconnected');
    assertAmount(betCents, 'bet');
    if (betCents % 100 !== 0) throw new Error('Bets must be whole units');
    if (betCents < this.minBetCents) throw new Error('Bet below table minimum');
    if (betCents > this.maxBetCents) throw new Error('Bet above table maximum');
    if (betCents > seat.bankrollCents + seat.betCents) throw new Error('Insufficient bankroll');
    // Replace any previous bet atomically.
    this.#creditSeat(seat, seat.betCents);
    seat.betCents = 0;
    this.#debitSeat(seat, betCents);
    seat.betCents = betCents;
  }

  /**
   * Return a seat's pending bet to its bankroll.
   * @param {string} playerId
   */
  clearBet(playerId) {
    this.#expectState(TABLE_STATES.BETTING);
    const seat = this.#requireSeat(playerId);
    this.#creditSeat(seat, seat.betCents);
    seat.betCents = 0;
    seat.ready = false;
  }

  /**
   * A player signals they are ready (with a bet) or intentionally sitting
   * this round out (without one).
   * @param {string} playerId
   * @param {boolean} ready
   */
  setReady(playerId, ready) {
    this.#expectState(TABLE_STATES.BETTING);
    const seat = this.#requireSeat(playerId);
    seat.ready = Boolean(ready);
  }

  /** Seats that will be dealt into the next round. */
  #participants() {
    return this.seats.filter((s) => s.connected && s.betCents > 0);
  }

  /** @returns {boolean} whether the host may start the round right now */
  canStartRound() {
    return this.state === TABLE_STATES.BETTING && this.#participants().length > 0;
  }

  /** @returns {boolean} every connected seat is either ready or bet-less */
  allBettersReady() {
    return this.#participants().every((s) => s.ready);
  }

  // ------------------------------------------------------------ round start

  /**
   * Deal the initial round to every connected seat with a committed bet.
   * Seats without bets sit the round out.
   */
  startRound() {
    this.#expectState(TABLE_STATES.BETTING);
    const participants = this.#participants();
    if (participants.length === 0) throw new Error('No bets placed');

    this.shoeJustShuffled = false;
    if (this.shoe.needsShuffle()) {
      this.shoe.shuffle();
      this.shoeJustShuffled = true;
    }

    this.#clearRoundState();
    this.roundCounter += 1;
    for (const seat of this.seats) {
      seat.hands = [];
      seat.insurance = freshInsurance();
      seat.pendingDecision = null;
      seat.earlySurrenderDeclined = false;
      seat.roundNetCents = null;
      seat.sittingOut = !participants.includes(seat);
      seat.ready = false;
    }

    // Casino dealing order: first card to each seat in order, dealer
    // upcard, second card to each seat, then the hole card under American
    // rules (rules §7 generalised to several players).
    for (const seat of participants) {
      const hand = createHand(seat.betCents);
      seat.hands = [hand];
      hand.cards.push(this.shoe.draw());
    }
    this.dealerCards.push(this.shoe.draw());
    for (const seat of participants) {
      seat.hands[0].cards.push(this.shoe.draw());
      if (evaluateCards(seat.hands[0].cards).isNaturalCandidate) {
        seat.hands[0].status = HAND_STATUS.BLACKJACK;
      }
    }
    if (this.profile.dealMode === DEAL_MODES.AMERICAN_HOLE_CARD) {
      this.dealerCards.push(this.shoe.draw());
      this.holeCardHidden = true;
    }

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
    for (const seat of this.#playingSeats()) {
      const hand = seat.hands[0];
      if (
        profile.surrender === SURRENDER_MODES.EARLY_SURRENDER
        && surrenderUpcardAllowed(this.#upcard, profile)
        && this.#dealerCouldHaveBlackjack()
        && hand.status === HAND_STATUS.ACTIVE
        && seat.connected
      ) {
        seat.pendingDecision = SEAT_DECISIONS.EARLY_SURRENDER;
      } else {
        this.#offerInsurance(seat);
      }
    }
    this.state = TABLE_STATES.PRE_PLAY;
    this.#proceedWhenDecisionsDone();
  }

  #offerInsurance(seat) {
    const insuranceCost = exactHalf(seat.hands[0].originalBetCents);
    if (
      this.profile.insuranceEnabled
      && isAce(this.#upcard)
      && seat.bankrollCents >= insuranceCost
      && seat.connected
    ) {
      seat.pendingDecision = SEAT_DECISIONS.INSURANCE;
    } else {
      seat.pendingDecision = null;
    }
  }

  /** Seats dealt into the current round. */
  #playingSeats() {
    return this.seats.filter((s) => !s.sittingOut && s.hands.length > 0);
  }

  /**
   * Answer a seat's pending early-surrender offer.
   * @param {string} playerId
   * @param {boolean} accept
   */
  decideEarlySurrender(playerId, accept) {
    this.#expectState(TABLE_STATES.PRE_PLAY);
    const seat = this.#requireSeat(playerId);
    if (seat.pendingDecision !== SEAT_DECISIONS.EARLY_SURRENDER) {
      throw new Error('No pending EARLY_SURRENDER decision');
    }
    this.#resolveSeatDecision(seat, accept, SEAT_DECISIONS.EARLY_SURRENDER);
  }

  /**
   * Answer a seat's pending insurance offer.
   * @param {string} playerId
   * @param {boolean} accept
   */
  decideInsurance(playerId, accept) {
    this.#expectState(TABLE_STATES.PRE_PLAY);
    const seat = this.#requireSeat(playerId);
    if (seat.pendingDecision !== SEAT_DECISIONS.INSURANCE) {
      throw new Error('No pending INSURANCE decision');
    }
    this.#resolveSeatDecision(seat, accept, SEAT_DECISIONS.INSURANCE);
  }

  /**
   * Apply a seat's answer to its current pending decision (or decline
   * everything when the seat disconnects).
   */
  #resolveSeatDecision(seat, accept, expected = seat.pendingDecision) {
    if (seat.pendingDecision !== expected || expected === null) return;
    if (expected === SEAT_DECISIONS.EARLY_SURRENDER) {
      seat.pendingDecision = null;
      if (accept) {
        applySurrender(seat.hands[0], {
          settle: (hand, result) => this.#settleSeatHand(seat, hand, result),
        });
      } else {
        seat.earlySurrenderDeclined = true;
        this.#offerInsurance(seat);
      }
    } else if (expected === SEAT_DECISIONS.INSURANCE) {
      seat.pendingDecision = null;
      if (accept) {
        const cost = exactHalf(seat.hands[0].originalBetCents);
        this.#debitSeat(seat, cost);
        seat.insurance = {
          offered: true, betCents: cost, taken: true, settled: false, result: null,
        };
      } else {
        seat.insurance.offered = true;
      }
    }
    // A disconnect may have auto-declined the surrender: decline the
    // follow-up insurance offer in the same pass.
    if (!seat.connected && seat.pendingDecision !== null) {
      this.#resolveSeatDecision(seat, false);
      return;
    }
    this.#proceedWhenDecisionsDone();
  }

  #proceedWhenDecisionsDone() {
    if (this.state !== TABLE_STATES.PRE_PLAY) return;
    if (this.seats.some((s) => s.pendingDecision !== null)) return;
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
        for (const seat of this.#playingSeats()) {
          this.#resolveSeatInsurance(seat, true);
        }
        this.#settleAgainstDealerBlackjack();
        this.#finishRound();
        return;
      }
      for (const seat of this.#playingSeats()) {
        this.#resolveSeatInsurance(seat, false);
      }
    } else if (!this.#dealerCouldHaveBlackjack()) {
      this.dealerBlackjackKnown = false;
    }

    // Naturals with no possible dealer blackjack are paid at once; under
    // ENHC with a ten/Ace upcard they wait for the dealer's second card.
    if (this.dealerBlackjackKnown === false) {
      for (const seat of this.#playingSeats()) {
        const hand = seat.hands[0];
        if (hand.status === HAND_STATUS.BLACKJACK && !hand.settled) {
          this.#settleSeatHand(seat, hand, RESULTS.BLACKJACK_WIN);
        }
      }
    }

    this.state = TABLE_STATES.PLAYER_TURN;
    this.activeSeatIndex = -1;
    this.activeHandIndex = -1;
    this.#advanceTurn();
  }

  // ---------------------------------------------------------- player actions

  /**
   * Availability of every action for the seat whose turn it is.
   * @param {string} playerId
   * @returns {Record<string, {legal: boolean, reason: string|null}>}
   */
  actionAvailability(playerId) {
    const seat = this.getSeat(playerId);
    if (
      !seat
      || this.state !== TABLE_STATES.PLAYER_TURN
      || this.seats[this.activeSeatIndex] !== seat
    ) {
      return allUnavailable();
    }
    const hand = seat.hands[this.activeHandIndex];
    if (!hand || hand.status !== HAND_STATUS.ACTIVE) return allUnavailable();
    return availabilityForHand({
      profile: this.profile,
      hand,
      handCount: seat.hands.length,
      bankrollCents: seat.bankrollCents,
      upcard: this.#upcard,
      dealerBlackjackKnown: this.dealerBlackjackKnown,
      earlySurrenderDeclined: seat.earlySurrenderDeclined,
    });
  }

  /**
   * Perform a player action on the acting seat's active hand.
   * @param {string} playerId
   * @param {string} action - an ACTIONS value
   */
  act(playerId, action) {
    this.#expectState(TABLE_STATES.PLAYER_TURN);
    const seat = this.#requireSeat(playerId);
    if (this.seats[this.activeSeatIndex] !== seat) {
      throw new Error('Not this player\'s turn');
    }
    const availability = this.actionAvailability(playerId)[action];
    if (!availability) throw new Error(`Unknown action: ${action}`);
    if (!availability.legal) {
      throw new Error(`Illegal action ${action}: ${availability.reason}`);
    }
    const hand = seat.hands[this.activeHandIndex];
    const ctx = {
      draw: () => this.shoe.draw(),
      debit: (cents) => this.#debitSeat(seat, cents),
      bankroll: () => seat.bankrollCents,
      settle: (h, result) => this.#settleSeatHand(seat, h, result),
      hands: seat.hands,
      profile: this.profile,
      createHand,
    };
    switch (action) {
      case ACTIONS.HIT: applyHit(hand, ctx); break;
      case ACTIONS.STAND: applyStand(hand); break;
      case ACTIONS.DOUBLE: applyDouble(hand, ctx); break;
      case ACTIONS.SPLIT: applySplit(hand, ctx); break;
      case ACTIONS.SURRENDER: applySurrender(hand, ctx); break;
      default: throw new Error(`Unknown action: ${action}`);
    }
    this.#advanceTurn();
  }

  // ------------------------------------------------------------- turn order

  #advanceTurn() {
    for (let s = Math.max(this.activeSeatIndex, 0); s < this.seats.length; s += 1) {
      const seat = this.seats[s];
      if (seat.sittingOut || seat.hands.length === 0) continue;
      // A seat that disconnected before its turn plays nothing: its
      // remaining active hands stand.
      if (!seat.connected) this.#standAllActiveHands(seat);
      const handIndex = seat.hands.findIndex((h) => h.status === HAND_STATUS.ACTIVE);
      if (handIndex !== -1) {
        this.activeSeatIndex = s;
        this.activeHandIndex = handIndex;
        this.state = TABLE_STATES.PLAYER_TURN;
        return;
      }
    }
    this.activeSeatIndex = -1;
    this.activeHandIndex = -1;
    this.#advanceToDealerIfDone();
  }

  #advanceToDealerIfDone() {
    const contested = this.seats.some((seat) => seat.hands.some(
      (h) => !h.settled && (h.status === HAND_STATUS.STOOD || h.status === HAND_STATUS.BLACKJACK),
    ));
    const insurancePending = this.seats.some(
      (seat) => seat.insurance.taken && !seat.insurance.settled,
    );
    if (!contested && !insurancePending) {
      this.#finishRound();
      return;
    }
    this.state = TABLE_STATES.DEALER_TURN;
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
    for (const seat of this.#playingSeats()) {
      this.#resolveSeatInsurance(seat, dealerNatural);
    }

    if (dealerNatural) {
      this.#settleAgainstDealerBlackjack();
      this.#finishRound();
      return;
    }

    const liveHands = this.seats.some((seat) => seat.hands.some(
      (h) => !h.settled && h.status === HAND_STATUS.STOOD,
    ));
    if (liveHands) {
      drawDealerHand(this.dealerCards, {
        draw: () => this.shoe.draw(),
        profile,
      });
    }
    this.#settleRemainingHands();
    this.#finishRound();
  }

  // ------------------------------------------------------------- settlement

  #settleSeatHand(seat, hand, result) {
    if (hand.settled) throw new Error(`Hand ${hand.id} already settled`);
    const payout = payoutForResult(result, hand.betCents, this.profile);
    hand.settled = true;
    hand.result = result;
    hand.payoutCents = payout;
    if (payout > 0) this.#creditSeat(seat, payout);
  }

  #settleSeatOriginalBetOnly(seat, hand) {
    if (hand.settled) throw new Error(`Hand ${hand.id} already settled`);
    const refund = dealerBlackjackRefundCents(hand);
    hand.settled = true;
    hand.result = RESULTS.LOSS;
    hand.payoutCents = refund;
    if (refund > 0) this.#creditSeat(seat, refund);
  }

  #settleAgainstDealerBlackjack() {
    const mode = this.profile.dealerBlackjackLossMode;
    for (const seat of this.#playingSeats()) {
      for (const hand of seat.hands) {
        if (hand.settled) continue;
        if (hand.status === HAND_STATUS.BLACKJACK) {
          this.#settleSeatHand(seat, hand, RESULTS.PUSH);
        } else if (mode === DEALER_BJ_LOSS_MODES.ORIGINAL_BETS_ONLY) {
          this.#settleSeatOriginalBetOnly(seat, hand);
        } else {
          this.#settleSeatHand(seat, hand, RESULTS.LOSS);
        }
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
    for (const seat of this.#playingSeats()) {
      for (const hand of seat.hands) {
        if (hand.settled) continue;
        const evaluation = evaluateCards(hand.cards);
        this.#settleSeatHand(seat, hand, compareHands({
          total: evaluation.total,
          isBlackjack: hand.status === HAND_STATUS.BLACKJACK,
        }, dealer));
      }
    }
  }

  #resolveSeatInsurance(seat, dealerHasBlackjack) {
    if (!seat.insurance.taken || seat.insurance.settled) return;
    seat.insurance.settled = true;
    if (dealerHasBlackjack) {
      seat.insurance.result = RESULTS.WIN;
      const profit = exactProfit(seat.insurance.betCents, this.profile.insurancePayout);
      this.#creditSeat(seat, seat.insurance.betCents + profit);
    } else {
      seat.insurance.result = RESULTS.LOSS;
    }
  }

  #finishRound() {
    this.roundSummaries = {};
    for (const seat of this.#playingSeats()) {
      const unsettled = seat.hands.filter((h) => !h.settled);
      if (unsettled.length > 0) {
        throw new Error(`Cannot finish round with unsettled hands (${seat.playerId})`);
      }
      const insuranceNet = seat.insurance.taken
        ? (seat.insurance.result === RESULTS.WIN
          ? exactProfit(seat.insurance.betCents, this.profile.insurancePayout)
          : -seat.insurance.betCents)
        : 0;
      seat.roundNetCents = seat.hands.reduce(
        (sum, h) => sum + h.payoutCents - h.betCents, 0,
      ) + insuranceNet;
      this.roundSummaries[seat.playerId] = {
        round: this.roundCounter,
        netCents: seat.roundNetCents,
        results: seat.hands.map((h) => h.result),
        insurance: seat.insurance.taken,
      };
    }
    this.state = TABLE_STATES.ROUND_COMPLETE;
    this.activeSeatIndex = -1;
    this.activeHandIndex = -1;
    // Bets are consumed by the round that just ended.
    for (const seat of this.seats) seat.betCents = 0;
    // Seats whose player left mid-round disappear now.
    this.seats = this.seats.filter((s) => !s.leaving);
  }

  /** Return to the betting state after a completed round. */
  nextRound() {
    this.#expectState(TABLE_STATES.ROUND_COMPLETE);
    this.#clearRoundState();
    for (const seat of this.seats) {
      seat.hands = [];
      seat.insurance = freshInsurance();
      seat.pendingDecision = null;
      seat.earlySurrenderDeclined = false;
      seat.roundNetCents = null;
      seat.sittingOut = false;
      seat.ready = false;
    }
    this.state = TABLE_STATES.BETTING;
  }

  // ---------------------------------------------------------------- snapshot

  /**
   * JSON-serializable authoritative view of the table. The dealer hole
   * card is masked while hidden, so clients never receive it early.
   * @returns {object}
   */
  getSnapshot() {
    const dealerVisibleCards = this.dealerCards.map((card, index) => (
      this.holeCardHidden && index === 1 ? { hidden: true } : { ...card }
    ));
    const visibleDealerEval = this.dealerCards.length > 0
      ? evaluateCards(this.holeCardHidden ? [this.dealerCards[0]] : this.dealerCards)
      : null;
    const activeSeat = this.seats[this.activeSeatIndex] ?? null;
    return {
      state: this.state,
      profileId: this.profile.id,
      profileSurrender: this.profile.surrender,
      roundCounter: this.roundCounter,
      minBetCents: this.minBetCents,
      maxBetCents: this.maxBetCents,
      maxSeats: this.maxSeats,
      dealer: {
        cards: dealerVisibleCards,
        evaluation: visibleDealerEval,
        holeCardHidden: this.holeCardHidden,
        isBlackjack: this.dealerBlackjackKnown === true,
      },
      activePlayerId: activeSeat?.playerId ?? null,
      activeHandIndex: this.activeHandIndex,
      seats: this.seats.map((seat) => ({
        seatId: seat.seatId,
        playerId: seat.playerId,
        name: seat.name,
        bankrollCents: seat.bankrollCents,
        connected: seat.connected,
        betCents: seat.betCents,
        ready: seat.ready,
        sittingOut: seat.sittingOut,
        pendingDecision: seat.pendingDecision,
        insurance: { ...seat.insurance },
        roundNetCents: seat.roundNetCents,
        isActive: seat === activeSeat && this.state === TABLE_STATES.PLAYER_TURN,
        hands: seat.hands.map((hand, index) => ({
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
          isActive: seat === activeSeat
            && index === this.activeHandIndex
            && this.state === TABLE_STATES.PLAYER_TURN,
          isBlackjack: hand.status === HAND_STATUS.BLACKJACK,
        })),
        actionAvailability: this.actionAvailability(seat.playerId),
      })),
      roundSummaries: this.roundSummaries,
      shoe: {
        remaining: this.shoe.remaining,
        justShuffled: this.shoeJustShuffled,
      },
    };
  }

  /**
   * Serializable between-round persistence record (host page reload
   * protection). Mid-round card state is deliberately not persisted, like
   * the solo session store.
   * @returns {object}
   */
  toPersistable() {
    return {
      roundCounter: this.roundCounter,
      seats: this.seats.map((seat) => ({
        playerId: seat.playerId,
        name: seat.name,
        bankrollCents: seat.bankrollCents,
      })),
    };
  }
}
