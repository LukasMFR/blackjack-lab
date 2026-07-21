import { test, assert, assertEqual } from './runner.js';
import { PREFIX, useFakeStorage } from './fakeStorage.js';
import {
  getBasicStrategyHint, HINT_ACTIONS, HINT_DECISIONS, HINT_STATUS,
} from '../src/js/strategy/basicStrategy.js';
import { selectStrategyTable } from '../src/js/strategy/strategyTables.js';
import { buildCustomProfile, PROFILES } from '../src/js/config/profiles.js';
import { ACTIONS, ROUND_STATES, VARIANT_FAMILIES } from '../src/js/game/constants.js';
import { BlackjackGame } from '../src/js/game/engine.js';
import { Shoe } from '../src/js/game/shoe.js';
import {
  loadStrategyHintsPreference, saveStrategyHintsPreference, STRATEGY_HINTS_STORAGE_KEY,
} from '../src/js/ui/strategyHintSettings.js';

const C = (rank, suit = 'SPADES') => ({ rank, suit });
const { HIT, STAND, DOUBLE, SPLIT, SURRENDER } = ACTIONS;

/** Legal actions of a fresh two-card hand; extend per test as needed. */
const FIRST_TWO = [HIT, STAND, DOUBLE];
const WITH_SPLIT = [...FIRST_TWO, SPLIT];
const WITH_SURRENDER = [...FIRST_TWO, SURRENDER];
const ALL_ACTIONS = [...WITH_SPLIT, SURRENDER];

/** Resolve a hand hint; `ranks` are player card ranks, `up` the upcard rank. */
function advise(rules, ranks, up, legalActions, extras = {}) {
  return getBasicStrategyHint({
    rules,
    hand: {
      cards: ranks.map((rank, i) => C(rank, i % 2 ? 'HEARTS' : 'SPADES')),
      ...extras,
    },
    dealerUpcard: C(up, 'CLUBS'),
    legalActions,
  });
}

function assertAdvice(hint, action, message) {
  assertEqual(hint.status, HINT_STATUS.SUPPORTED, `${message} (status)`);
  assertEqual(hint.primaryAction, action, message);
}

/* --------------------------------------------------- profiles under test */

const FRENCH = PROFILES.FRENCH_STANDARD;                       // Table A
const STRIP = PROFILES.LAS_VEGAS_STRIP;                        // Table B
const AC = PROFILES.ATLANTIC_CITY;                             // Table B + LS
const H17_65 = PROFILES.BLACKJACK_6_5;                         // Table C, 6:5
const DOWNTOWN = PROFILES.VEGAS_DOWNTOWN;                      // Table E
const SINGLE_H17 = PROFILES.SINGLE_DECK_3_2;                   // Table G, no DAS

const american = (overrides) => buildCustomProfile({
  dealMode: 'AMERICAN_HOLE_CARD', ...overrides,
});
const TWO_DECK_S17 = american({ decks: 2, dealerHitsSoft17: false }); // Table D
const TWO_DECK_S17_LS = american({
  decks: 2, dealerHitsSoft17: false, surrender: 'LATE_SURRENDER', surrenderVsAce: true,
});
const TWO_DECK_H17_LS = american({
  decks: 2, dealerHitsSoft17: true, surrender: 'LATE_SURRENDER', surrenderVsAce: true,
});
const TWO_DECK_H17_LS_NDAS = american({
  decks: 2, dealerHitsSoft17: true, surrender: 'LATE_SURRENDER', surrenderVsAce: true,
  doubleAfterSplit: false,
});
const SIX_DECK_H17_LS = american({
  decks: 6, dealerHitsSoft17: true, surrender: 'LATE_SURRENDER', surrenderVsAce: true,
});
const SIX_DECK_S17_LS = american({
  decks: 6, dealerHitsSoft17: false, surrender: 'LATE_SURRENDER', surrenderVsAce: true,
});
const SINGLE_S17 = american({ decks: 1, dealerHitsSoft17: false }); // Table F
const ENHC_H17 = buildCustomProfile({ dealMode: 'ENHC', dealerHitsSoft17: true });
const ENHC_OBO = buildCustomProfile({
  dealMode: 'ENHC', dealerBlackjackLossMode: 'ORIGINAL_BETS_ONLY',
});
const THREE_DECK = american({ decks: 3 });
const EARLY_SURRENDER_ENHC = buildCustomProfile({
  dealMode: 'ENHC', surrender: 'EARLY_SURRENDER',
});

/* ------------------------------------------------- fingerprint selection */

test('strategy: profile fingerprints map to the documented tables', () => {
  assertEqual(selectStrategyTable(FRENCH), 'A', 'FRENCH_STANDARD');
  assertEqual(selectStrategyTable(PROFILES.EUROPEAN_ENHC), 'A', 'EUROPEAN_ENHC');
  assertEqual(selectStrategyTable(STRIP), 'B', 'LAS_VEGAS_STRIP');
  assertEqual(selectStrategyTable(AC), 'B', 'ATLANTIC_CITY');
  assertEqual(selectStrategyTable(H17_65), 'C', 'BLACKJACK_6_5');
  assertEqual(selectStrategyTable(SIX_DECK_H17_LS), 'C', 'custom 6-deck H17');
  assertEqual(selectStrategyTable(TWO_DECK_S17), 'D', 'custom 2-deck S17');
  assertEqual(selectStrategyTable(DOWNTOWN), 'E', 'VEGAS_DOWNTOWN');
  assertEqual(selectStrategyTable(SINGLE_S17), 'F', 'custom 1-deck S17');
  assertEqual(selectStrategyTable(SINGLE_H17), 'G', 'SINGLE_DECK_3_2');
});

test('strategy: ENHC original-bets-only maps to the peek-family table', () => {
  assertEqual(selectStrategyTable(ENHC_OBO), 'B', 'six decks S17 OBO');
});

test('strategy: unsupported fingerprints select no table', () => {
  assertEqual(selectStrategyTable(ENHC_H17), null, 'ENHC H17');
  assertEqual(selectStrategyTable(THREE_DECK), null, 'three decks');
  assertEqual(selectStrategyTable(EARLY_SURRENDER_ENHC), null, 'early surrender');
  assertEqual(
    selectStrategyTable({ ...FRENCH, family: VARIANT_FAMILIES.SPANISH_21 }),
    null, 'dedicated variant family',
  );
  assertEqual(
    selectStrategyTable({ ...FRENCH, removedRanks: ['10'] }),
    null, 'nonstandard deck composition',
  );
  assertEqual(
    selectStrategyTable({ ...STRIP, blackjackPayout: { numerator: 2, denominator: 1 } }),
    null, 'unverified blackjack payout',
  );
  assertEqual(
    selectStrategyTable({ ...STRIP, splitTwentyOneIsBlackjack: true }),
    null, 'split 21 counted as blackjack',
  );
});

test('strategy: unsupported fingerprint yields no hint, never an approximation', () => {
  const hint = advise(ENHC_H17, ['10', '6'], '10', FIRST_TWO);
  assertEqual(hint.status, HINT_STATUS.UNSUPPORTED_STRATEGY, 'status');
  assertEqual(hint.primaryAction, null, 'no action');
  assertEqual(hint.tableId, null, 'no table');
});

/* ------------------------------------------------------ French / ENHC S17 */

test('French ENHC: hard 11 vs 10 and vs Ace is Hit, even when double is legal', () => {
  assertAdvice(advise(FRENCH, ['6', '5'], '10', FIRST_TWO), HIT, '11 vs 10');
  assertAdvice(advise(FRENCH, ['6', '5'], 'A', FIRST_TWO), HIT, '11 vs A');
});

test('French ENHC: 8,8 vs 10 and vs Ace is Hit, not split', () => {
  assertAdvice(advise(FRENCH, ['8', '8'], '10', WITH_SPLIT), HIT, '8,8 vs 10');
  assertAdvice(advise(FRENCH, ['8', '8'], 'A', WITH_SPLIT), HIT, '8,8 vs A');
});

test('French ENHC: A,A splits vs 10 but hits vs Ace', () => {
  assertAdvice(advise(FRENCH, ['A', 'A'], '10', WITH_SPLIT), SPLIT, 'A,A vs 10');
  assertAdvice(advise(FRENCH, ['A', 'A'], 'A', WITH_SPLIT), HIT, 'A,A vs A');
});

test('French ENHC: soft A,7 vs 3 doubles when legal, otherwise stands', () => {
  assertAdvice(advise(FRENCH, ['A', '7'], '3', FIRST_TWO), DOUBLE, 'A,7 vs 3 double');
  assertAdvice(advise(FRENCH, ['A', '7'], '3', [HIT, STAND]), STAND, 'A,7 vs 3 fallback');
});

test('French ENHC: insurance is declined', () => {
  const hint = getBasicStrategyHint({ rules: FRENCH, decision: HINT_DECISIONS.INSURANCE });
  assertAdvice(hint, HINT_ACTIONS.DECLINE_INSURANCE, 'insurance');
  assertEqual(hint.tableId, 'A', 'table id');
});

/* ------------------------------------------------- multi-deck American S17 */

test('American S17: hard 11 vs 10 doubles when legal, otherwise hits', () => {
  assertAdvice(advise(STRIP, ['6', '5'], '10', FIRST_TWO), DOUBLE, '11 vs 10');
  assertAdvice(advise(STRIP, ['6', '5'], '10', [HIT, STAND]), HIT, '11 vs 10 fallback');
});

test('American S17: hard 11 vs Ace is Hit (doubling 11 vs A is an H17 play)', () => {
  assertAdvice(advise(STRIP, ['6', '5'], 'A', FIRST_TWO), HIT, '11 vs A');
});

test('American S17: 8,8 vs Ace splits and 9,9 vs Ace stands', () => {
  assertAdvice(advise(STRIP, ['8', '8'], 'A', WITH_SPLIT), SPLIT, '8,8 vs A');
  assertAdvice(advise(STRIP, ['9', '9'], 'A', WITH_SPLIT), STAND, '9,9 vs A');
});

test('American S17: 16 vs 10 surrenders when available, otherwise hits', () => {
  assertAdvice(advise(AC, ['10', '6'], '10', WITH_SURRENDER), SURRENDER, 'with LS');
  assertAdvice(advise(STRIP, ['10', '6'], '10', FIRST_TWO), HIT, 'without LS');
});

test('American S17: soft A,7 vs 2 stands', () => {
  assertAdvice(advise(STRIP, ['A', '7'], '2', FIRST_TWO), STAND, 'A,7 vs 2');
});

/* ------------------------------------------------- multi-deck American H17 */

test('American H17: hard 11 vs Ace doubles when legal', () => {
  assertAdvice(advise(H17_65, ['6', '5'], 'A', FIRST_TWO), DOUBLE, '11 vs A');
  assertAdvice(advise(H17_65, ['6', '5'], 'A', [HIT, STAND]), HIT, '11 vs A fallback');
});

test('American H17: hard 17 vs Ace surrenders when available, otherwise stands', () => {
  assertAdvice(advise(SIX_DECK_H17_LS, ['10', '7'], 'A', [HIT, STAND, SURRENDER]),
    SURRENDER, 'with LS');
  assertAdvice(advise(H17_65, ['10', '7'], 'A', [HIT, STAND]), STAND, 'without LS');
});

test('American H17: 8,8 vs Ace surrenders when available, otherwise splits', () => {
  assertAdvice(advise(SIX_DECK_H17_LS, ['8', '8'], 'A', ALL_ACTIONS), SURRENDER, 'with LS');
  assertAdvice(advise(H17_65, ['8', '8'], 'A', WITH_SPLIT), SPLIT, 'without LS');
});

test('American H17: soft A,7 vs 2 and A,8 vs 6 double when legal, otherwise stand', () => {
  assertAdvice(advise(H17_65, ['A', '7'], '2', FIRST_TWO), DOUBLE, 'A,7 vs 2');
  assertAdvice(advise(H17_65, ['A', '7'], '2', [HIT, STAND]), STAND, 'A,7 vs 2 fallback');
  assertAdvice(advise(H17_65, ['A', '8'], '6', FIRST_TWO), DOUBLE, 'A,8 vs 6');
  assertAdvice(advise(H17_65, ['A', '8'], '6', [HIT, STAND]), STAND, 'A,8 vs 6 fallback');
});

/* ---------------------------------------------------- deck-count separation */

test('deck separation: hard 9 vs 2 doubles in two decks, hits in multi-deck', () => {
  assertAdvice(advise(TWO_DECK_S17, ['5', '4'], '2', FIRST_TWO), DOUBLE, 'two decks');
  assertAdvice(advise(STRIP, ['5', '4'], '2', FIRST_TWO), HIT, 'six decks');
});

test('deck separation: soft A,6 vs 2 hits in two decks S17, doubles in one deck', () => {
  assertAdvice(advise(TWO_DECK_S17, ['A', '6'], '2', FIRST_TWO), HIT, 'two decks');
  assertAdvice(advise(SINGLE_S17, ['A', '6'], '2', FIRST_TWO), DOUBLE, 'one deck');
  assertAdvice(advise(SINGLE_S17, ['A', '6'], '2', [HIT, STAND]), HIT, 'one deck fallback');
});

test('deck separation: 16 vs 9 with late surrender hits in two decks, surrenders in multi-deck', () => {
  assertAdvice(advise(TWO_DECK_S17_LS, ['10', '6'], '9', WITH_SURRENDER), HIT, 'two decks');
  assertAdvice(advise(SIX_DECK_S17_LS, ['10', '6'], '9', WITH_SURRENDER),
    SURRENDER, 'six decks');
});

test('deck separation: double-deck H17 8,8 vs Ace surrenders only without DAS', () => {
  assertAdvice(advise(TWO_DECK_H17_LS_NDAS, ['8', '8'], 'A', ALL_ACTIONS),
    SURRENDER, 'DAS disabled');
  assertAdvice(advise(TWO_DECK_H17_LS, ['8', '8'], 'A', ALL_ACTIONS),
    SPLIT, 'DAS enabled');
  assertAdvice(advise(TWO_DECK_H17_LS_NDAS, ['8', '8'], 'A', WITH_SPLIT),
    SPLIT, 'DAS disabled but surrender not offered on this hand');
});

test('deck separation: hard 8 vs 5 doubles in one deck, hits in two decks', () => {
  assertAdvice(advise(SINGLE_S17, ['5', '3'], '5', FIRST_TWO), DOUBLE, 'one deck');
  assertAdvice(advise(TWO_DECK_S17, ['5', '3'], '5', FIRST_TWO), HIT, 'two decks');
});

test('deck separation: soft A,7 vs Ace stands in one deck S17, hits otherwise', () => {
  assertAdvice(advise(SINGLE_S17, ['A', '7'], 'A', FIRST_TWO), STAND, 'one deck S17');
  assertAdvice(advise(STRIP, ['A', '7'], 'A', FIRST_TWO), HIT, 'six decks S17');
  assertAdvice(advise(SINGLE_H17, ['A', '7'], 'A', FIRST_TWO), HIT, 'one deck H17');
});

/* -------------------------------------------------- insurance / even money */

test('insurance: declined at a 6:5 table exactly as at 3:2', () => {
  const hint = getBasicStrategyHint({ rules: H17_65, decision: HINT_DECISIONS.INSURANCE });
  assertAdvice(hint, HINT_ACTIONS.DECLINE_INSURANCE, '6:5 insurance');
});

test('even money: declined at 3:2, accepted at 6:5, unsupported otherwise', () => {
  assertAdvice(
    getBasicStrategyHint({ rules: FRENCH, decision: HINT_DECISIONS.EVEN_MONEY }),
    HINT_ACTIONS.DECLINE_EVEN_MONEY, '3:2',
  );
  assertAdvice(
    getBasicStrategyHint({ rules: H17_65, decision: HINT_DECISIONS.EVEN_MONEY }),
    HINT_ACTIONS.ACCEPT_EVEN_MONEY, '6:5',
  );
  const odd = { ...STRIP, blackjackPayout: { numerator: 2, denominator: 1 } };
  assertEqual(
    getBasicStrategyHint({ rules: odd, decision: HINT_DECISIONS.EVEN_MONEY }).status,
    HINT_STATUS.UNSUPPORTED_STRATEGY, '2:1',
  );
});

test('insurance: no advice under an unsupported fingerprint', () => {
  assertEqual(
    getBasicStrategyHint({ rules: ENHC_H17, decision: HINT_DECISIONS.INSURANCE }).status,
    HINT_STATUS.UNSUPPORTED_STRATEGY, 'ENHC H17 insurance',
  );
});

/* -------------------------------------- conditional and bankroll fallbacks */

test('fallback: D/H resolves to Hit when doubling is unaffordable', () => {
  assertAdvice(advise(FRENCH, ['6', '4'], '5', [HIT, STAND]), HIT, 'hard 10 vs 5');
});

test('fallback: an unaffordable split is played as the underlying total', () => {
  // 8,8 vs 7 is Split; as hard 16 vs 7 it hits. 9,9 vs 6 is Split; as
  // hard 18 vs 6 it stands.
  assertAdvice(advise(FRENCH, ['8', '8'], '7', [HIT, STAND]), HIT, '8,8 vs 7');
  assertAdvice(advise(FRENCH, ['9', '9'], '6', [HIT, STAND]), STAND, '9,9 vs 6');
});

test('fallback: unsplittable A,A plays as soft 12 and hits', () => {
  assertAdvice(advise(FRENCH, ['A', 'A'], '6', [HIT, STAND]), HIT, 'A,A vs 6');
});

test('fallback: P/H splits only under DAS', () => {
  assertAdvice(advise(FRENCH, ['6', '6'], '2', WITH_SPLIT), SPLIT, 'DAS enabled');
  assertAdvice(advise(FRENCH, ['6', '6'], '2', FIRST_TWO), HIT, 'split unaffordable');
  // SINGLE_DECK_3_2 disables DAS: 4,4 vs 4 is P/H there and must hit.
  assertAdvice(advise(SINGLE_H17, ['4', '4'], '4', WITH_SPLIT), HIT, 'DAS disabled');
});

test('fallback: P/D prefers split under DAS, then double, then hit', () => {
  assertAdvice(advise(SINGLE_S17, ['4', '4'], '5', WITH_SPLIT), SPLIT, 'split legal');
  assertAdvice(advise(SINGLE_S17, ['4', '4'], '5', FIRST_TWO), DOUBLE, 'double fallback');
  assertAdvice(advise(SINGLE_S17, ['4', '4'], '5', [HIT, STAND]), HIT, 'hit fallback');
});

test('fallback: conditional codes resolve after a hit closes double and surrender', () => {
  assertAdvice(advise(AC, ['2', '3', '4'], '3', [HIT, STAND]), HIT, 'hard 9 vs 3');
  assertAdvice(advise(SIX_DECK_S17_LS, ['10', '2', '4'], '10', [HIT, STAND]),
    HIT, 'hard 16 vs 10 after hit');
  assertAdvice(advise(FRENCH, ['A', '3', '3'], '3', [HIT, STAND]), HIT, 'soft 17 vs 3');
});

test('classification: ten-value pairs play as hard 20 and 5,5 as hard 10', () => {
  assertAdvice(advise(FRENCH, ['K', 'Q'], '6', WITH_SPLIT), STAND, 'K,Q vs 6');
  assertAdvice(advise(FRENCH, ['10', 'J'], '2', WITH_SPLIT), STAND, '10,J vs 2');
  assertAdvice(advise(FRENCH, ['5', '5'], '6', WITH_SPLIT), DOUBLE, '5,5 vs 6');
  assertAdvice(advise(FRENCH, ['5', '5'], '10', WITH_SPLIT), HIT, '5,5 vs 10');
});

test('classification: a split two-card 21 is not a natural and stands', () => {
  assertAdvice(advise(FRENCH, ['A', 'K'], '6', [HIT, STAND], { fromSplit: true }),
    STAND, 'split 21');
});

/* ------------------------------------------------------- no-decision cases */

test('no decision: empty legal actions, locked split Aces, naturals, busts', () => {
  assertEqual(advise(FRENCH, ['10', '6'], '10', []).status,
    HINT_STATUS.NO_DECISION, 'no legal actions');
  assertEqual(advise(FRENCH, ['A', '9'], '10', [STAND], { splitAces: true }).status,
    HINT_STATUS.NO_DECISION, 'locked split Ace hand');
  assertEqual(advise(FRENCH, ['A', 'K'], '6', [HIT, STAND]).status,
    HINT_STATUS.NO_DECISION, 'natural blackjack');
  assertEqual(advise(FRENCH, ['10', '9', '5'], '6', [HIT, STAND]).status,
    HINT_STATUS.NO_DECISION, 'bust hand');
  assertEqual(getBasicStrategyHint({ rules: FRENCH }).status,
    HINT_STATUS.NO_DECISION, 'no hand at all');
});

/* --------------------------------------------------- engine integration */

test('engine integration: hint resolves from real legal actions without mutating the round', () => {
  const game = new BlackjackGame({
    profile: FRENCH,
    shoe: Shoe.fromSequence([C('8'), C('6', 'HEARTS'), C('8', 'DIAMONDS')]),
    bankrollCents: 100000,
  });
  game.placeBet(5000);
  const before = JSON.stringify(game.getSnapshot());

  const snapshot = game.getSnapshot();
  const availability = snapshot.actionAvailability;
  const hand = snapshot.hands[snapshot.activeHandIndex];
  const hint = getBasicStrategyHint({
    rules: FRENCH,
    hand: { cards: hand.cards, fromSplit: hand.fromSplit },
    dealerUpcard: snapshot.dealer.cards[0],
    legalActions: Object.keys(availability).filter((a) => availability[a].legal),
  });
  assertAdvice(hint, SPLIT, '8,8 vs 6');
  assert(availability[hint.primaryAction].legal, 'recommendation must be legal');

  assertEqual(JSON.stringify(game.getSnapshot()), before, 'round state unchanged');
  assertEqual(game.roundState, ROUND_STATES.PLAYER_TURN, 'still player turn');
  assertEqual(game.bankrollCents, 95000, 'bankroll untouched');
});

test('engine integration: pending insurance blocks table actions but advises decline', () => {
  const game = new BlackjackGame({
    profile: FRENCH,
    shoe: Shoe.fromSequence([C('5'), C('A', 'HEARTS'), C('6', 'DIAMONDS')]),
    bankrollCents: 100000,
  });
  game.placeBet(5000);
  assertEqual(game.pendingDecision, 'INSURANCE', 'insurance pending');
  const snapshot = game.getSnapshot();
  const legal = Object.keys(snapshot.actionAvailability)
    .filter((a) => snapshot.actionAvailability[a].legal);
  assertEqual(legal.length, 0, 'no table action during the prompt');
  assertEqual(
    advise(FRENCH, ['5', '6'], 'A', legal).status,
    HINT_STATUS.NO_DECISION, 'no table hint during the prompt',
  );
  const before = JSON.stringify(game.getSnapshot());
  const hint = getBasicStrategyHint({ rules: FRENCH, decision: HINT_DECISIONS.INSURANCE });
  assertAdvice(hint, HINT_ACTIONS.DECLINE_INSURANCE, 'decline insurance');
  assertEqual(JSON.stringify(game.getSnapshot()), before, 'round state unchanged');
});

test('engine integration: insufficient bankroll downgrades a double to hit', () => {
  // Bet the whole bankroll: hard 10 vs 5 would double, but the engine
  // reports DOUBLE as unaffordable, so the hint must fall back to Hit.
  const game = new BlackjackGame({
    profile: FRENCH,
    shoe: Shoe.fromSequence([C('6'), C('5', 'HEARTS'), C('4', 'DIAMONDS')]),
    bankrollCents: 5000,
  });
  game.placeBet(5000);
  const snapshot = game.getSnapshot();
  const availability = snapshot.actionAvailability;
  assert(!availability[DOUBLE].legal, 'double must be unaffordable');
  const hint = getBasicStrategyHint({
    rules: FRENCH,
    hand: { cards: snapshot.hands[0].cards },
    dealerUpcard: snapshot.dealer.cards[0],
    legalActions: Object.keys(availability).filter((a) => availability[a].legal),
  });
  assertAdvice(hint, HIT, 'hard 10 vs 5 without funds');
});

/* -------------------------------------------------- preference persistence */

test('strategy hints preference: disabled by default and never auto-enabled', () => {
  useFakeStorage();
  assertEqual(loadStrategyHintsPreference(), false, 'fresh browser');
  useFakeStorage({ [`${PREFIX}language`]: 'fr', [`${PREFIX}theme`]: 'classic' });
  assertEqual(loadStrategyHintsPreference(), false, 'existing user without the key');
});

test('strategy hints preference: persists and round-trips', () => {
  const data = useFakeStorage();
  saveStrategyHintsPreference(true);
  assertEqual(data.get(`${PREFIX}${STRATEGY_HINTS_STORAGE_KEY}`), 'true', 'stored raw');
  assertEqual(loadStrategyHintsPreference(), true, 'reload enabled');
  saveStrategyHintsPreference(false);
  assertEqual(loadStrategyHintsPreference(), false, 'reload disabled');
});

test('strategy hints preference: malformed values read as disabled', () => {
  useFakeStorage({ [`${PREFIX}${STRATEGY_HINTS_STORAGE_KEY}`]: 'banana' });
  assertEqual(loadStrategyHintsPreference(), false, 'garbage value');
});
