import {
  DEAL_MODES,
  DEALER_BJ_LOSS_MODES,
  SURRENDER_MODES,
  VARIANT_FAMILIES,
} from '../game/constants.js';

/**
 * Total-dependent basic-strategy tables, transcribed from
 * BLACKJACK_STRATEGY_HINTS.md (revision 1.2). That file is the single
 * authoritative source: every cell below mirrors one cell of its tables
 * A–G, verified against the Wizard of Odds charts and the UK-21 ENHC
 * table cited there. Do not edit a cell without updating the document.
 *
 * Columns are dealer upcards in the fixed order 2,3,4,5,6,7,8,9,10,A.
 * Cell codes are the document's conditional codes (H, S, D/H, D/S, P,
 * P/H, P/D, P/S, R/H, R/S, R/P, R[NDAS]/P); the resolver in
 * basicStrategy.js turns them into a single legal action.
 */

const H = 'H';
const S = 'S';
const DH = 'D/H';
const DS = 'D/S';
const P = 'P';
const PH = 'P/H';
const PD = 'P/D';
const PS = 'P/S';
const RH = 'R/H';
const RS = 'R/S';
const RP = 'R/P';
const RNP = 'R[NDAS]/P';

export const CELL_CODES = Object.freeze({
  H, S, DH, DS, P, PH, PD, PS, RH, RS, RP, RNP,
});

const allH = Object.freeze([H, H, H, H, H, H, H, H, H, H]);
const allS = Object.freeze([S, S, S, S, S, S, S, S, S, S]);

/**
 * Expand `{ '13-16': row, 17: row }` into a per-total map.
 * @param {Record<string, string[]>} spec
 * @returns {Record<number, string[]>}
 */
function expandRows(spec) {
  const out = {};
  for (const [key, row] of Object.entries(spec)) {
    const [from, to] = key.split('-').map(Number);
    for (let total = from; total <= (to ?? from); total += 1) {
      out[total] = Object.freeze(row);
    }
  }
  return Object.freeze(out);
}

function defineTable({ id, hard, soft, pairs }) {
  return Object.freeze({
    id,
    hard: expandRows(hard),
    soft: expandRows(soft),
    // Pair rows are keyed by rank; 5,5 and ten-value pairs are handled as
    // hard 10 / hard 20 by the resolver, exactly as the document states.
    pairs: Object.freeze(Object.fromEntries(
      Object.entries(pairs).map(([rank, row]) => [rank, Object.freeze(row)]),
    )),
  });
}

/** Table A — European No-Hole-Card, S17, 4–8 decks. */
const TABLE_A = defineTable({
  id: 'A',
  hard: {
    '4-8': allH,
    9: [H, DH, DH, DH, DH, H, H, H, H, H],
    10: [DH, DH, DH, DH, DH, DH, DH, DH, H, H],
    11: [DH, DH, DH, DH, DH, DH, DH, DH, H, H],
    12: [H, H, S, S, S, H, H, H, H, H],
    '13-16': [S, S, S, S, S, H, H, H, H, H],
    '17-21': allS,
  },
  soft: {
    '13-14': [H, H, H, DH, DH, H, H, H, H, H],
    '15-16': [H, H, DH, DH, DH, H, H, H, H, H],
    17: [H, DH, DH, DH, DH, H, H, H, H, H],
    18: [S, DS, DS, DS, DS, S, S, H, H, H],
    '19-21': allS,
  },
  pairs: {
    2: [PH, PH, P, P, P, P, H, H, H, H],
    3: [PH, PH, P, P, P, P, H, H, H, H],
    4: [H, H, H, PH, PH, H, H, H, H, H],
    6: [PH, P, P, P, P, H, H, H, H, H],
    7: [P, P, P, P, P, P, H, H, H, H],
    8: [P, P, P, P, P, P, P, P, H, H],
    9: [P, P, P, P, P, S, P, P, S, S],
    A: [P, P, P, P, P, P, P, P, P, H],
  },
});

/** Table B — American/peek (or ENHC original-bets-only), S17, 4–8 decks. */
const TABLE_B = defineTable({
  id: 'B',
  hard: {
    '4-8': allH,
    9: [H, DH, DH, DH, DH, H, H, H, H, H],
    10: [DH, DH, DH, DH, DH, DH, DH, DH, H, H],
    11: [DH, DH, DH, DH, DH, DH, DH, DH, DH, H],
    12: [H, H, S, S, S, H, H, H, H, H],
    '13-14': [S, S, S, S, S, H, H, H, H, H],
    15: [S, S, S, S, S, H, H, H, RH, H],
    16: [S, S, S, S, S, H, H, RH, RH, RH],
    '17-21': allS,
  },
  soft: {
    '13-14': [H, H, H, DH, DH, H, H, H, H, H],
    '15-16': [H, H, DH, DH, DH, H, H, H, H, H],
    17: [H, DH, DH, DH, DH, H, H, H, H, H],
    18: [S, DS, DS, DS, DS, S, S, H, H, H],
    '19-21': allS,
  },
  pairs: {
    2: [PH, PH, P, P, P, P, H, H, H, H],
    3: [PH, PH, P, P, P, P, H, H, H, H],
    4: [H, H, H, PH, PH, H, H, H, H, H],
    6: [PH, P, P, P, P, H, H, H, H, H],
    7: [P, P, P, P, P, P, H, H, H, H],
    8: [P, P, P, P, P, P, P, P, P, P],
    9: [P, P, P, P, P, S, P, P, S, S],
    A: [P, P, P, P, P, P, P, P, P, P],
  },
});

/** Table C — American/peek (or ENHC original-bets-only), H17, 4–8 decks. */
const TABLE_C = defineTable({
  id: 'C',
  hard: {
    '4-8': allH,
    9: [H, DH, DH, DH, DH, H, H, H, H, H],
    10: [DH, DH, DH, DH, DH, DH, DH, DH, H, H],
    11: [DH, DH, DH, DH, DH, DH, DH, DH, DH, DH],
    12: [H, H, S, S, S, H, H, H, H, H],
    '13-14': [S, S, S, S, S, H, H, H, H, H],
    15: [S, S, S, S, S, H, H, H, RH, RH],
    16: [S, S, S, S, S, H, H, RH, RH, RH],
    17: [S, S, S, S, S, S, S, S, S, RS],
    '18-21': allS,
  },
  soft: {
    '13-14': [H, H, H, DH, DH, H, H, H, H, H],
    '15-16': [H, H, DH, DH, DH, H, H, H, H, H],
    17: [H, DH, DH, DH, DH, H, H, H, H, H],
    18: [DS, DS, DS, DS, DS, S, S, H, H, H],
    19: [S, S, S, S, DS, S, S, S, S, S],
    '20-21': allS,
  },
  pairs: {
    2: [PH, PH, P, P, P, P, H, H, H, H],
    3: [PH, PH, P, P, P, P, H, H, H, H],
    4: [H, H, H, PH, PH, H, H, H, H, H],
    6: [PH, P, P, P, P, H, H, H, H, H],
    7: [P, P, P, P, P, P, H, H, H, H],
    8: [P, P, P, P, P, P, P, P, P, RP],
    9: [P, P, P, P, P, S, P, P, S, S],
    A: [P, P, P, P, P, P, P, P, P, P],
  },
});

/** Table D — American/peek (or ENHC original-bets-only), S17, double deck. */
const TABLE_D = defineTable({
  id: 'D',
  hard: {
    '4-8': allH,
    9: [DH, DH, DH, DH, DH, H, H, H, H, H],
    10: [DH, DH, DH, DH, DH, DH, DH, DH, H, H],
    11: [DH, DH, DH, DH, DH, DH, DH, DH, DH, DH],
    12: [H, H, S, S, S, H, H, H, H, H],
    '13-14': [S, S, S, S, S, H, H, H, H, H],
    15: [S, S, S, S, S, H, H, H, RH, H],
    16: [S, S, S, S, S, H, H, H, RH, RH],
    '17-21': allS,
  },
  soft: {
    '13-14': [H, H, H, DH, DH, H, H, H, H, H],
    '15-16': [H, H, DH, DH, DH, H, H, H, H, H],
    17: [H, DH, DH, DH, DH, H, H, H, H, H],
    18: [S, DS, DS, DS, DS, S, S, H, H, H],
    '19-21': allS,
  },
  pairs: {
    2: [PH, PH, P, P, P, P, H, H, H, H],
    3: [PH, PH, P, P, P, P, H, H, H, H],
    4: [H, H, H, PH, PH, H, H, H, H, H],
    6: [P, P, P, P, P, PH, H, H, H, H],
    7: [P, P, P, P, P, P, PH, H, H, H],
    8: [P, P, P, P, P, P, P, P, P, P],
    9: [P, P, P, P, P, S, P, P, S, S],
    A: [P, P, P, P, P, P, P, P, P, P],
  },
});

/** Table E — American/peek (or ENHC original-bets-only), H17, double deck. */
const TABLE_E = defineTable({
  id: 'E',
  hard: {
    '4-8': allH,
    9: [DH, DH, DH, DH, DH, H, H, H, H, H],
    10: [DH, DH, DH, DH, DH, DH, DH, DH, H, H],
    11: [DH, DH, DH, DH, DH, DH, DH, DH, DH, DH],
    12: [H, H, S, S, S, H, H, H, H, H],
    '13-14': [S, S, S, S, S, H, H, H, H, H],
    15: [S, S, S, S, S, H, H, H, RH, RH],
    16: [S, S, S, S, S, H, H, H, RH, RH],
    17: [S, S, S, S, S, S, S, S, S, RS],
    '18-21': allS,
  },
  soft: {
    13: [H, H, H, DH, DH, H, H, H, H, H],
    '14-16': [H, H, DH, DH, DH, H, H, H, H, H],
    17: [H, DH, DH, DH, DH, H, H, H, H, H],
    18: [DS, DS, DS, DS, DS, S, S, H, H, H],
    19: [S, S, S, S, DS, S, S, S, S, S],
    '20-21': allS,
  },
  pairs: {
    2: [PH, PH, P, P, P, P, H, H, H, H],
    3: [PH, PH, P, P, P, P, H, H, H, H],
    4: [H, H, H, PH, PH, H, H, H, H, H],
    6: [P, P, P, P, P, PH, H, H, H, H],
    7: [P, P, P, P, P, P, PH, H, H, H],
    8: [P, P, P, P, P, P, P, P, P, RNP],
    9: [P, P, P, P, P, S, P, P, S, S],
    A: [P, P, P, P, P, P, P, P, P, P],
  },
});

/** Table F — American/peek (or ENHC original-bets-only), S17, single deck. */
const TABLE_F = defineTable({
  id: 'F',
  hard: {
    '4-7': allH,
    8: [H, H, H, DH, DH, H, H, H, H, H],
    9: [DH, DH, DH, DH, DH, H, H, H, H, H],
    10: [DH, DH, DH, DH, DH, DH, DH, DH, H, H],
    11: [DH, DH, DH, DH, DH, DH, DH, DH, DH, DH],
    12: [H, H, S, S, S, H, H, H, H, H],
    '13-15': [S, S, S, S, S, H, H, H, H, H],
    16: [S, S, S, S, S, H, H, H, RH, RH],
    '17-21': allS,
  },
  soft: {
    '13-16': [H, H, DH, DH, DH, H, H, H, H, H],
    17: [DH, DH, DH, DH, DH, H, H, H, H, H],
    18: [S, DS, DS, DS, DS, S, S, H, H, S],
    19: [S, S, S, S, DS, S, S, S, S, S],
    '20-21': allS,
  },
  pairs: {
    2: [PH, P, P, P, P, P, H, H, H, H],
    3: [PH, PH, P, P, P, P, PH, H, H, H],
    4: [H, H, PH, PD, PD, H, H, H, H, H],
    6: [P, P, P, P, P, PH, H, H, H, H],
    7: [P, P, P, P, P, P, PH, H, RS, H],
    8: [P, P, P, P, P, P, P, P, P, P],
    9: [P, P, P, P, P, S, P, P, S, S],
    A: [P, P, P, P, P, P, P, P, P, P],
  },
});

/** Table G — American/peek (or ENHC original-bets-only), H17, single deck. */
const TABLE_G = defineTable({
  id: 'G',
  hard: {
    '4-7': allH,
    8: [H, H, H, DH, DH, H, H, H, H, H],
    9: [DH, DH, DH, DH, DH, H, H, H, H, H],
    10: [DH, DH, DH, DH, DH, DH, DH, DH, H, H],
    11: [DH, DH, DH, DH, DH, DH, DH, DH, DH, DH],
    12: [H, H, S, S, S, H, H, H, H, H],
    '13-14': [S, S, S, S, S, H, H, H, H, H],
    15: [S, S, S, S, S, H, H, H, H, RH],
    16: [S, S, S, S, S, H, H, H, RH, RH],
    17: [S, S, S, S, S, S, S, S, S, RS],
    '18-21': allS,
  },
  soft: {
    '13-16': [H, H, DH, DH, DH, H, H, H, H, H],
    17: [DH, DH, DH, DH, DH, H, H, H, H, H],
    18: [S, DS, DS, DS, DS, S, S, H, H, H],
    19: [S, S, S, S, DS, S, S, S, S, S],
    '20-21': allS,
  },
  pairs: {
    2: [PH, P, P, P, P, P, H, H, H, H],
    3: [PH, PH, P, P, P, P, PH, H, H, H],
    4: [H, H, PH, PD, PD, H, H, H, H, H],
    6: [P, P, P, P, P, PH, H, H, H, H],
    7: [P, P, P, P, P, P, PH, H, RS, RH],
    8: [P, P, P, P, P, P, P, P, P, P],
    9: [P, P, P, P, P, S, P, P, S, PS],
    A: [P, P, P, P, P, P, P, P, P, P],
  },
});

export const STRATEGY_TABLES = Object.freeze({
  A: TABLE_A,
  B: TABLE_B,
  C: TABLE_C,
  D: TABLE_D,
  E: TABLE_E,
  F: TABLE_F,
  G: TABLE_G,
});

function ratioIs(ratio, numerator, denominator) {
  return Boolean(ratio)
    && ratio.numerator === numerator
    && ratio.denominator === denominator;
}

/** The peek-family table for a deck count and soft-17 rule, or null. */
function peekTable(decks, hitsSoft17) {
  if (decks === 1) return hitsSoft17 ? 'G' : 'F';
  if (decks === 2) return hitsSoft17 ? 'E' : 'D';
  // Three-deck games have no verified table (see the document's
  // unsupported-combinations list).
  if (decks >= 4 && decks <= 8) return hitsSoft17 ? 'C' : 'B';
  return null;
}

/**
 * Match a rule profile against the exact strategy fingerprints of
 * tables A–G. Returns the table id, or null when no verified table
 * covers the resolved rules — never the "nearest" table.
 * @param {object} rules - a validated rule profile
 * @returns {string|null}
 */
export function selectStrategyTable(rules) {
  if (!rules || rules.family !== VARIANT_FAMILIES.STANDARD) return null;
  if ((rules.removedRanks?.length ?? 0) > 0) return null;
  if (!ratioIs(rules.normalWinPayout, 1, 1)) return null;
  // The action tables hold for 3:2 and 6:5 natural payouts alike; any other
  // payout has not been verified (see section 5 of the document).
  if (!ratioIs(rules.blackjackPayout, 3, 2) && !ratioIs(rules.blackjackPayout, 6, 5)) {
    return null;
  }
  // Early surrender changes the pre-peek decision structure and has no
  // verified table. The tables' R codes cover late surrender only.
  if (rules.surrender === SURRENDER_MODES.EARLY_SURRENDER) return null;
  if (rules.splitTwentyOneIsBlackjack) return null;

  const hitsSoft17 = rules.dealerHitsSoft17 === true;
  if (rules.dealMode === DEAL_MODES.ENHC) {
    // ENHC with H17 is explicitly unverified.
    if (hitsSoft17) return null;
    if (rules.dealerBlackjackLossMode === DEALER_BJ_LOSS_MODES.ALL_BETS_LOST) {
      return rules.decks >= 4 && rules.decks <= 8 ? 'A' : null;
    }
    if (rules.dealerBlackjackLossMode === DEALER_BJ_LOSS_MODES.ORIGINAL_BETS_ONLY) {
      // OBO returns the optional wagers a peek would have protected, so
      // the peek tables apply (their stated fingerprint includes OBO).
      return peekTable(rules.decks, false);
    }
    return null;
  }
  if (rules.dealMode === DEAL_MODES.AMERICAN_HOLE_CARD) {
    // A hole card without a peek exposes optional wagers in a way the
    // peek tables do not represent.
    if (!rules.dealerPeek) return null;
    if (rules.dealerBlackjackLossMode !== DEALER_BJ_LOSS_MODES.PEEK_PROTECTED) return null;
    return peekTable(rules.decks, hitsSoft17);
  }
  return null;
}
