import { test, assert, assertEqual, assertThrows } from './runner.js';
import { evaluateCards, isSplittablePair } from '../src/js/game/handEval.js';
import { buildShoeCards } from '../src/js/game/deck.js';
import { Shoe } from '../src/js/game/shoe.js';
import { fisherYatesShuffle } from '../src/js/game/shuffle.js';
import { seededRandom } from '../src/js/game/rng.js';
import { exactHalf, exactProfit } from '../src/js/game/money.js';
import { SPLIT_PAIRING } from '../src/js/game/constants.js';
import { buildCustomProfile, getProfile, validateProfile, PROFILES, PROFILE_IDS } from '../src/js/config/profiles.js';

const C = (rank, suit = 'SPADES') => ({ rank, suit });

// ------------------------------------------------------------ hand evaluation

test('hard totals add up', () => {
  const e = evaluateCards([C('10'), C('7')]);
  assertEqual(e.total, 17);
  assert(e.isHard && !e.isSoft && !e.isBust);
});

test('single Ace counts as 11 while legal (soft hand)', () => {
  const e = evaluateCards([C('A'), C('6')]);
  assertEqual(e.total, 17);
  assert(e.isSoft && !e.isHard);
});

test('Ace drops to 1 when 11 would bust (hard hand)', () => {
  const e = evaluateCards([C('A'), C('6'), C('9')]);
  assertEqual(e.total, 16);
  assert(e.isHard);
});

test('multiple Aces reduce as needed', () => {
  const e = evaluateCards([C('A'), C('A', 'HEARTS'), C('9')]);
  assertEqual(e.total, 21);
  assert(e.isSoft, 'one Ace still counts as 11');
  const f = evaluateCards([C('A'), C('A', 'HEARTS'), C('K'), C('9')]);
  assertEqual(f.total, 21);
  assert(f.isHard, 'all Aces reduced to 1');
});

test('Ace + ten-value two cards is a natural candidate', () => {
  assert(evaluateCards([C('A'), C('K')]).isNaturalCandidate);
  assert(evaluateCards([C('A'), C('10')]).isNaturalCandidate);
});

test('three-card 21 is not a natural', () => {
  const e = evaluateCards([C('7'), C('7', 'HEARTS'), C('7', 'CLUBS')]);
  assertEqual(e.total, 21);
  assert(!e.isNaturalCandidate);
});

test('bust detection', () => {
  assert(evaluateCards([C('K'), C('9'), C('5')]).isBust);
  assert(!evaluateCards([C('K'), C('9'), C('2')]).isBust);
});

test('EQUAL_VALUE pairing accepts King + Queen; IDENTICAL_RANK rejects it', () => {
  const cards = [C('K'), C('Q', 'HEARTS')];
  assert(isSplittablePair(cards, SPLIT_PAIRING.EQUAL_VALUE));
  assert(!isSplittablePair(cards, SPLIT_PAIRING.IDENTICAL_RANK));
  assert(isSplittablePair([C('8'), C('8', 'HEARTS')], SPLIT_PAIRING.IDENTICAL_RANK));
  assert(!isSplittablePair([C('K'), C('9', 'HEARTS')], SPLIT_PAIRING.EQUAL_VALUE));
});

// -------------------------------------------------------------------- shoe

test('six decks contain exactly 312 unique physical cards', () => {
  const cards = buildShoeCards(6);
  assertEqual(cards.length, 312);
  assertEqual(new Set(cards.map((c) => c.id)).size, 312);
});

test('Spanish-style removal produces 48-card decks (architecture hook)', () => {
  const cards = buildShoeCards(1, ['10']);
  assertEqual(cards.length, 48);
  assert(!cards.some((c) => c.rank === '10'));
  assert(cards.some((c) => c.rank === 'J'));
});

test('Fisher-Yates keeps the multiset and does not mutate input', () => {
  const input = buildShoeCards(1);
  const copy = input.slice();
  const shuffled = fisherYatesShuffle(input, seededRandom(42));
  assertEqual(input.length, copy.length);
  assert(input.every((c, i) => c === copy[i]), 'input mutated');
  assertEqual(new Set(shuffled.map((c) => c.id)).size, 52);
});

test('shoe never deals a duplicate physical card', () => {
  const shoe = new Shoe({ deckCount: 1, random: seededRandom(7) });
  const seen = new Set();
  for (let i = 0; i < 52; i += 1) {
    const card = shoe.draw();
    assert(!seen.has(card.id), `duplicate ${card.id}`);
    seen.add(card.id);
  }
  assertThrows(() => shoe.draw(), 'empty', 'drawing from empty shoe must throw');
});

test('deterministic shoe deals the predefined sequence in order', () => {
  const shoe = Shoe.fromSequence([C('A'), C('K', 'HEARTS'), C('5', 'CLUBS')]);
  assertEqual(shoe.draw().rank, 'A');
  assertEqual(shoe.draw().rank, 'K');
  assertEqual(shoe.draw().rank, '5');
});

test('deterministic shoe rejects duplicate ids', () => {
  assertThrows(
    () => Shoe.fromSequence([{ ...C('A'), id: 'x' }, { ...C('K'), id: 'x' }]),
    'Duplicate',
  );
});

test('shoe requests a reshuffle after the penetration point', () => {
  const shoe = new Shoe({ deckCount: 1, penetration: 0.5, random: seededRandom(1) });
  for (let i = 0; i < 25; i += 1) shoe.draw();
  assert(!shoe.needsShuffle());
  shoe.draw();
  assert(shoe.needsShuffle());
});

// -------------------------------------------------------------------- money

test('3:2 payout of a whole-unit bet is exact', () => {
  assertEqual(exactProfit(5000, { numerator: 3, denominator: 2 }), 7500);
});

test('6:5 payout of a whole-unit bet is exact', () => {
  assertEqual(exactProfit(5000, { numerator: 6, denominator: 5 }), 6000);
});

test('non-exact payouts throw instead of rounding', () => {
  assertThrows(() => exactProfit(101, { numerator: 3, denominator: 2 }), 'not exact');
  assertThrows(() => exactHalf(101), 'not exact');
});

// ------------------------------------------------------------------ profiles

test('all standard profiles validate', () => {
  for (const id of PROFILE_IDS) {
    if (id === 'CUSTOM') continue;
    validateProfile(getProfile(id));
  }
});

test('default profile is FRENCH_STANDARD with the documented defaults', () => {
  const p = PROFILES.FRENCH_STANDARD;
  assertEqual(p.decks, 6);
  assertEqual(p.dealMode, 'ENHC');
  assertEqual(p.dealerHitsSoft17, false);
  assertEqual(p.blackjackPayout.numerator, 3);
  assertEqual(p.blackjackPayout.denominator, 2);
  assertEqual(p.insuranceEnabled, true);
  assertEqual(p.surrender, 'NONE');
  assertEqual(p.doubleAfterSplit, true);
  assertEqual(p.resplitAces, false);
  assertEqual(p.dealerBlackjackLossMode, 'ALL_BETS_LOST');
  assertEqual(p.startingBankrollUnits, 1000);
  assertEqual(p.defaultBetUnits, 50);
});

test('profile coherence rules are enforced', () => {
  assertThrows(
    () => validateProfile({ ...PROFILES.FRENCH_STANDARD, dealerPeek: true }),
    'no hole card',
  );
  assertThrows(
    () => validateProfile({ ...PROFILES.FRENCH_STANDARD, surrender: 'LATE_SURRENDER' }),
    'late surrender requires dealer peek',
  );
  assertThrows(() => getProfile('NOT_A_PROFILE'), 'Unsupported profile');
});

test('custom profile builder coerces contradictory settings', () => {
  const enhcLate = buildCustomProfile({ dealMode: 'ENHC', surrender: 'LATE_SURRENDER' });
  assertEqual(enhcLate.surrender, 'EARLY_SURRENDER');
  assertEqual(enhcLate.dealerPeek, false);
  const american = buildCustomProfile({ dealMode: 'AMERICAN_HOLE_CARD' });
  assertEqual(american.dealerPeek, true);
  assertEqual(american.dealerBlackjackLossMode, 'PEEK_PROTECTED');
});
