import { ACTIONS } from '../game/constants.js';
import { isAce, isTenValue } from '../game/card.js';
import { evaluateCards, isSplittablePair } from '../game/handEval.js';
import { CELL_CODES, selectStrategyTable, STRATEGY_TABLES } from './strategyTables.js';

/**
 * Pure basic-strategy resolver (see BLACKJACK_STRATEGY_HINTS.md §8).
 *
 * Reads one cell from one authoritative table for the exact active rule
 * fingerprint, then resolves its conditional code against the actions the
 * engine actually allows right now. It never touches game state, never
 * uses shoe history, and never recommends an action the player cannot
 * perform. When the rules match no verified table it says so instead of
 * approximating.
 */

export const HINT_STATUS = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  UNSUPPORTED_STRATEGY: 'UNSUPPORTED_STRATEGY',
  NO_DECISION: 'NO_DECISION',
});

/** Pre-play decisions the resolver can advise on, beside the table actions. */
export const HINT_DECISIONS = Object.freeze({
  INSURANCE: 'INSURANCE',
  EVEN_MONEY: 'EVEN_MONEY',
});

export const HINT_ACTIONS = Object.freeze({
  ...ACTIONS,
  DECLINE_INSURANCE: 'DECLINE_INSURANCE',
  DECLINE_EVEN_MONEY: 'DECLINE_EVEN_MONEY',
  ACCEPT_EVEN_MONEY: 'ACCEPT_EVEN_MONEY',
});

const NO_DECISION = Object.freeze({
  status: HINT_STATUS.NO_DECISION, primaryAction: null, tableId: null, cellCode: null,
});
const UNSUPPORTED = Object.freeze({
  status: HINT_STATUS.UNSUPPORTED_STRATEGY, primaryAction: null, tableId: null, cellCode: null,
});

function supported(primaryAction, tableId, cellCode) {
  return { status: HINT_STATUS.SUPPORTED, primaryAction, tableId, cellCode };
}

function ratioIs(ratio, numerator, denominator) {
  return Boolean(ratio)
    && ratio.numerator === numerator
    && ratio.denominator === denominator;
}

/** Column index for a dealer upcard: 2..9 → 0..7, ten-values → 8, Ace → 9. */
function upcardIndex(upcard) {
  if (isAce(upcard)) return 9;
  if (isTenValue(upcard)) return 8;
  return Number(upcard.rank) - 2;
}

/**
 * The table cell for these cards played as a non-pair hand. Soft totals
 * below 13 (an unsplittable A,A) have no chart row anywhere; hitting is
 * the only sound play, so the resolver hardcodes H for them.
 */
function nonPairCell(table, evaluation, column) {
  if (evaluation.isSoft) {
    if (evaluation.total < 13) return CELL_CODES.H;
    return table.soft[evaluation.total][column];
  }
  return table.hard[evaluation.total][column];
}

/**
 * Resolve one conditional cell code to a legal action, following the code
 * definitions in BLACKJACK_STRATEGY_HINTS.md §3. `resolveNonPair` re-reads
 * the same cards as a normal hard/soft hand for the pair fallbacks.
 */
function resolveCode(code, { legal, dasEnabled, resolveNonPair }) {
  switch (code) {
    case CELL_CODES.H: return ACTIONS.HIT;
    case CELL_CODES.S: return ACTIONS.STAND;
    case CELL_CODES.DH: return legal.has(ACTIONS.DOUBLE) ? ACTIONS.DOUBLE : ACTIONS.HIT;
    case CELL_CODES.DS: return legal.has(ACTIONS.DOUBLE) ? ACTIONS.DOUBLE : ACTIONS.STAND;
    case CELL_CODES.P:
      return legal.has(ACTIONS.SPLIT) ? ACTIONS.SPLIT : resolveNonPair();
    case CELL_CODES.PH:
      return dasEnabled && legal.has(ACTIONS.SPLIT) ? ACTIONS.SPLIT : ACTIONS.HIT;
    case CELL_CODES.PD:
      if (dasEnabled && legal.has(ACTIONS.SPLIT)) return ACTIONS.SPLIT;
      return legal.has(ACTIONS.DOUBLE) ? ACTIONS.DOUBLE : ACTIONS.HIT;
    case CELL_CODES.PS:
      return dasEnabled && legal.has(ACTIONS.SPLIT) ? ACTIONS.SPLIT : ACTIONS.STAND;
    case CELL_CODES.RH:
      return legal.has(ACTIONS.SURRENDER) ? ACTIONS.SURRENDER : ACTIONS.HIT;
    case CELL_CODES.RS:
      return legal.has(ACTIONS.SURRENDER) ? ACTIONS.SURRENDER : ACTIONS.STAND;
    case CELL_CODES.RP:
      if (legal.has(ACTIONS.SURRENDER)) return ACTIONS.SURRENDER;
      return legal.has(ACTIONS.SPLIT) ? ACTIONS.SPLIT : resolveNonPair();
    case CELL_CODES.RNP:
      if (legal.has(ACTIONS.SURRENDER) && !dasEnabled) return ACTIONS.SURRENDER;
      return legal.has(ACTIONS.SPLIT) ? ACTIONS.SPLIT : resolveNonPair();
    default:
      throw new Error(`Unknown strategy cell code: ${code}`);
  }
}

/**
 * Compute the basic-strategy hint for the current decision.
 *
 * @param {object} input
 * @param {object} input.rules - the resolved active rule profile
 * @param {{cards: Array<{rank: string}>}} [input.hand] - the acting hand
 * @param {{rank: string}} [input.dealerUpcard] - the dealer's visible card
 * @param {string[]} [input.legalActions] - ACTIONS the engine allows right
 *   now. Authoritative for affordability and rule gates: conditional codes
 *   resolve against it, so bankroll never needs re-checking here.
 * @param {string|null} [input.decision] - a HINT_DECISIONS value when the
 *   pending choice is Insurance or a genuine Even Money settlement.
 * @returns {{status: string, primaryAction: string|null,
 *   tableId: string|null, cellCode: string|null}}
 */
export function getBasicStrategyHint({
  rules,
  hand = null,
  dealerUpcard = null,
  legalActions = [],
  decision = null,
}) {
  const tableId = selectStrategyTable(rules);
  if (!tableId) return UNSUPPORTED;

  // Insurance and Even Money are decided separately from the tables
  // (document §5). Without count information insurance is always declined;
  // a genuine 1:1 Even Money settlement is declined at 3:2 and accepted
  // at 6:5. A half-bet insurance wager is never treated as Even Money.
  if (decision === HINT_DECISIONS.INSURANCE) {
    return supported(HINT_ACTIONS.DECLINE_INSURANCE, tableId, null);
  }
  if (decision === HINT_DECISIONS.EVEN_MONEY) {
    if (ratioIs(rules.blackjackPayout, 3, 2)) {
      return supported(HINT_ACTIONS.DECLINE_EVEN_MONEY, tableId, null);
    }
    if (ratioIs(rules.blackjackPayout, 6, 5)) {
      return supported(HINT_ACTIONS.ACCEPT_EVEN_MONEY, tableId, null);
    }
    return UNSUPPORTED;
  }
  if (decision !== null) return NO_DECISION;

  if (!hand || !Array.isArray(hand.cards) || hand.cards.length < 2 || !dealerUpcard) {
    return NO_DECISION;
  }
  const legal = new Set(legalActions);
  // A hand that may not hit is not making a strategy decision: it is
  // complete, bust, a natural, or a locked split-Ace hand.
  if (!legal.has(ACTIONS.HIT)) return NO_DECISION;

  const evaluation = evaluateCards(hand.cards);
  if (evaluation.isBust) return NO_DECISION;
  // A natural blackjack gets no hint. A two-card 21 made after a split is
  // not a natural: it still plays (as 21, so the tables say stand).
  if (evaluation.isNaturalCandidate && hand.fromSplit !== true) return NO_DECISION;

  const table = STRATEGY_TABLES[tableId];
  const column = upcardIndex(dealerUpcard);
  const context = {
    legal,
    dasEnabled: rules.doubleAfterSplit === true,
    resolveNonPair: () => resolveCode(nonPairCell(table, evaluation, column), context),
  };

  // Classification order (document §4): eligible pair, then soft, then
  // hard. 5,5 plays as hard 10 and ten-value pairs as hard 20, so both
  // skip the pair rows entirely.
  const cards = hand.cards;
  if (cards.length === 2 && isSplittablePair(cards, rules.splitPairing)) {
    const rank = isAce(cards[0]) ? 'A' : cards[0].rank;
    if (!isTenValue(cards[0]) && rank !== '5') {
      const cellCode = table.pairs[rank][column];
      return supported(resolveCode(cellCode, context), tableId, cellCode);
    }
  }
  const cellCode = nonPairCell(table, evaluation, column);
  return supported(resolveCode(cellCode, context), tableId, cellCode);
}
