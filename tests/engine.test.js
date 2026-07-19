import { test, assert, assertEqual, assertThrows } from './runner.js';
import { BlackjackGame, PENDING_DECISIONS, UNAVAILABLE_REASONS } from '../src/js/game/engine.js';
import { Shoe } from '../src/js/game/shoe.js';
import { ACTIONS, RESULTS, ROUND_STATES } from '../src/js/game/constants.js';
import { PROFILES, buildCustomProfile } from '../src/js/config/profiles.js';

const C = (rank, suit = 'SPADES') => ({ rank, suit });
const UNITS = 100; // cents per unit

/**
 * Start a game on a predefined shoe. Sequence order is exactly the deal
 * order: player, dealer upcard, player, [dealer hole card], then every
 * subsequent draw (hits, doubles, splits, dealer cards) in order.
 */
function play(profile, sequence, { bankrollUnits = 1000, betUnits = 50 } = {}) {
  const game = new BlackjackGame({
    profile,
    shoe: Shoe.fromSequence(sequence),
    bankrollCents: bankrollUnits * UNITS,
  });
  game.placeBet(betUnits * UNITS);
  return game;
}

function bankrollUnitsOf(game) {
  return game.bankrollCents / UNITS;
}

/** Round-summary net must always match the actual bankroll movement. */
function assertNetMatches(game, startUnits, betUnits) {
  const summary = game.roundSummary;
  assert(summary, 'round summary missing');
  assertEqual(
    game.bankrollCents - startUnits * UNITS,
    summary.netCents,
    'bankroll delta must equal summary net',
  );
}

// --------------------------------------------------------------- naturals

test('player natural pays 3:2 immediately under ENHC with a low upcard', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [C('A'), C('5', 'HEARTS'), C('K', 'DIAMONDS')]);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.BLACKJACK_WIN);
  assertEqual(bankrollUnitsOf(game), 1075); // 1000 - 50 + 125
  assertNetMatches(game, 1000, 50);
});

test('three-card 21 wins 1:1, never 3:2', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('7'), C('10', 'HEARTS'), C('7', 'CLUBS'), // deal
    C('7', 'DIAMONDS'), // player hit -> 21, auto-stand
    C('10', 'CLUBS'),   // dealer second card -> 20
  ]);
  game.act(ACTIONS.HIT);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.WIN);
  assertEqual(bankrollUnitsOf(game), 1050);
});

test('ENHC natural against a ten upcard waits for the dealer card, then pushes on dealer blackjack', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('A'), C('10', 'HEARTS'), C('K', 'DIAMONDS'),
    C('A', 'HEARTS'), // dealer second card -> dealer blackjack
  ]);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.PUSH);
  assertEqual(bankrollUnitsOf(game), 1000);
});

// ------------------------------------------------------------ basic results

test('player bust loses immediately without a dealer draw', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('9', 'HEARTS'), C('6', 'DIAMONDS'),
    C('10', 'HEARTS'), // hit -> 26 bust
  ]);
  game.act(ACTIONS.HIT);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.LOSS);
  assertEqual(game.dealerCards.length, 1, 'dealer must not draw');
  assertEqual(bankrollUnitsOf(game), 950);
  assertNetMatches(game, 1000, 50);
});

test('dealer bust pays every standing hand', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('6', 'HEARTS'), C('10', 'DIAMONDS'),
    C('10', 'CLUBS'), C('10', 'HEARTS'), // dealer 6+10 -> 16, hit -> 26 bust
  ]);
  game.act(ACTIONS.STAND);
  assertEqual(game.hands[0].result, RESULTS.WIN);
  assertEqual(bankrollUnitsOf(game), 1050);
});

test('equal totals push and return the stake exactly', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('10', 'HEARTS'), C('9', 'DIAMONDS'),
    C('9', 'CLUBS'), // dealer -> 19
  ]);
  game.act(ACTIONS.STAND);
  assertEqual(game.hands[0].result, RESULTS.PUSH);
  assertEqual(bankrollUnitsOf(game), 1000);
  assertNetMatches(game, 1000, 50);
});

// ------------------------------------------------------------- dealer rules

test('S17: dealer stands on soft 17', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('A', 'HEARTS'), C('8', 'DIAMONDS'),
    C('6', 'CLUBS'), // dealer A+6 soft 17 -> stands
  ]);
  game.decideInsurance(false);
  game.act(ACTIONS.STAND);
  assertEqual(game.dealerCards.length, 2, 'S17 dealer must not hit soft 17');
  assertEqual(game.hands[0].result, RESULTS.WIN); // 18 beats 17
  assertEqual(bankrollUnitsOf(game), 1050);
});

test('H17: dealer hits soft 17', () => {
  const profile = buildCustomProfile({ dealerHitsSoft17: true });
  const game = play(profile, [
    C('10'), C('A', 'HEARTS'), C('8', 'DIAMONDS'),
    C('6', 'CLUBS'), // dealer A+6 soft 17 -> must hit
    C('4', 'CLUBS'), // -> 21
  ]);
  game.decideInsurance(false);
  game.act(ACTIONS.STAND);
  assertEqual(game.dealerCards.length, 3, 'H17 dealer must hit soft 17');
  assertEqual(game.hands[0].result, RESULTS.LOSS);
  assertEqual(bankrollUnitsOf(game), 950);
});

// --------------------------------------------------------------- insurance

test('insurance pays 2:1 when the dealer has blackjack (ENHC)', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('A', 'HEARTS'), C('9', 'DIAMONDS'),
    C('K', 'CLUBS'), // dealer second card -> blackjack
  ]);
  assertEqual(game.pendingDecision, PENDING_DECISIONS.INSURANCE);
  game.decideInsurance(true); // costs 25
  game.act(ACTIONS.STAND);
  assertEqual(game.insurance.result, RESULTS.WIN);
  assertEqual(game.hands[0].result, RESULTS.LOSS);
  // -50 (hand) - 25 (insurance) + 75 (insurance stake + 2:1) = 1000
  assertEqual(bankrollUnitsOf(game), 1000);
  assertNetMatches(game, 1000, 50);
});

test('insurance is lost when the dealer has no blackjack', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('A', 'HEARTS'), C('10', 'DIAMONDS'),
    C('9', 'CLUBS'), // dealer A+9 -> 20
  ]);
  game.decideInsurance(true);
  game.act(ACTIONS.STAND);
  assertEqual(game.insurance.result, RESULTS.LOSS);
  assertEqual(game.hands[0].result, RESULTS.PUSH); // 20 vs 20
  assertEqual(bankrollUnitsOf(game), 975);
  assertNetMatches(game, 1000, 50);
});

test('insurance is not offered without sufficient bankroll', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('A', 'HEARTS'), C('9', 'DIAMONDS'), C('K', 'CLUBS'),
  ], { bankrollUnits: 50 });
  assertEqual(game.pendingDecision, null, 'no insurance offer with an empty bankroll');
});

// ------------------------------------------------------------------ double

test('double adds the bet, draws exactly one card, and wins 1:1', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('5'), C('9', 'HEARTS'), C('6', 'DIAMONDS'),
    C('10', 'HEARTS'), // double card -> 21
    C('9', 'DIAMONDS'), // dealer -> 18
  ]);
  game.act(ACTIONS.DOUBLE);
  assertEqual(game.hands[0].cards.length, 3);
  assertEqual(game.hands[0].betCents, 100 * UNITS);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE, 'double must end the hand');
  assertEqual(game.hands[0].result, RESULTS.WIN);
  assertEqual(bankrollUnitsOf(game), 1100); // 1000 - 100 + 200
  assertNetMatches(game, 1000, 50);
});

test('a doubled hand can bust and loses the doubled bet', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('9'), C('9', 'HEARTS'), C('7', 'DIAMONDS'),
    C('10', 'HEARTS'), // double card -> 26 bust
  ]);
  game.act(ACTIONS.DOUBLE);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.dealerCards.length, 1, 'dealer must not draw');
  assertEqual(bankrollUnitsOf(game), 900);
});

test('double is refused without funds, with a reason', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('5'), C('9', 'HEARTS'), C('6', 'DIAMONDS'), C('10', 'HEARTS'), C('9', 'DIAMONDS'),
  ], { bankrollUnits: 75 });
  const availability = game.actionAvailability();
  assertEqual(availability[ACTIONS.DOUBLE].legal, false);
  assertEqual(availability[ACTIONS.DOUBLE].reason, UNAVAILABLE_REASONS.INSUFFICIENT_FUNDS);
  assertEqual(availability[ACTIONS.SPLIT].legal, false);
  assertThrows(() => game.act(ACTIONS.DOUBLE), 'Illegal action');
});

// ------------------------------------------------------------------- split

test('split plays two hands with double after split (French rules)', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('8'), C('7', 'HEARTS'), C('8', 'DIAMONDS'),
    C('10', 'HEARTS'),  // first split hand -> 18
    C('2', 'HEARTS'),   // second split hand -> 10
    C('9', 'CLUBS'),    // double card on second hand -> 19
    C('10', 'DIAMONDS'), // dealer -> 17
  ]);
  game.act(ACTIONS.SPLIT);
  assertEqual(game.hands.length, 2);
  game.act(ACTIONS.STAND);   // first hand, 18
  game.act(ACTIONS.DOUBLE);  // second hand, 10 -> 19 (DAS allowed)
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.WIN);
  assertEqual(game.hands[1].result, RESULTS.WIN);
  // 1000 - 50 - 50 (split) - 50 (double) + 100 + 200 = 1150
  assertEqual(bankrollUnitsOf(game), 1150);
  assertNetMatches(game, 1000, 50);
});

test('EQUAL_VALUE allows splitting King + Queen; IDENTICAL_RANK forbids it', () => {
  const sequence = [
    C('K'), C('7', 'HEARTS'), C('Q', 'DIAMONDS'),
    C('5', 'HEARTS'), C('5', 'CLUBS'), C('10', 'DIAMONDS'),
  ];
  const french = play(PROFILES.FRENCH_STANDARD, sequence);
  assert(french.actionAvailability()[ACTIONS.SPLIT].legal, 'French EQUAL_VALUE must allow K+Q');
  const european = play(PROFILES.EUROPEAN_ENHC, sequence);
  assertEqual(european.actionAvailability()[ACTIONS.SPLIT].legal, false);
  assertEqual(european.actionAvailability()[ACTIONS.SPLIT].reason, UNAVAILABLE_REASONS.NOT_A_PAIR);
});

test('re-splitting up to four hands, then split becomes unavailable', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('8', 'SPADES'), C('7', 'HEARTS'), C('8', 'DIAMONDS'),
    C('8', 'CLUBS'), C('8', 'HEARTS'),       // first split draws
    C('10', 'SPADES'), C('10', 'HEARTS'),    // second split draws
    C('10', 'DIAMONDS'), { rank: '8', suit: 'SPADES', id: 'extra8' }, // third split draws
    C('10', 'CLUBS'),                        // dealer -> 17
  ]);
  game.act(ACTIONS.SPLIT); // hands: [8,8c] [8d,8h]
  game.act(ACTIONS.SPLIT); // active pair splits again -> 3 hands
  game.act(ACTIONS.STAND); // 18
  game.act(ACTIONS.STAND); // 18
  game.act(ACTIONS.SPLIT); // last pair -> 4 hands
  game.act(ACTIONS.STAND); // 18
  const availability = game.actionAvailability();
  assertEqual(availability[ACTIONS.SPLIT].legal, false, 'fifth hand must be refused');
  assertEqual(availability[ACTIONS.SPLIT].reason, UNAVAILABLE_REASONS.MAX_SPLITS_REACHED);
  game.act(ACTIONS.STAND); // 16
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands.length, 4);
  const results = game.hands.map((h) => h.result);
  assertEqual(results.filter((r) => r === RESULTS.WIN).length, 3);
  assertEqual(results.filter((r) => r === RESULTS.LOSS).length, 1);
  // 1000 - 200 (four bets) + 300 (three 1:1 wins) = 1100
  assertEqual(bankrollUnitsOf(game), 1100);
  const ids = [
    ...game.hands.flatMap((h) => h.cards.map((c) => c.id)),
    ...game.dealerCards.map((c) => c.id),
  ];
  assertEqual(new Set(ids).size, ids.length, 'no duplicate physical card on the table');
});

test('split Aces receive one card each, are locked, and a 21 pays 1:1', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('A'), C('9', 'HEARTS'), C('A', 'DIAMONDS'),
    C('K', 'HEARTS'), // first Ace -> 21 (not blackjack)
    C('5', 'CLUBS'),  // second Ace -> 16
    C('10', 'DIAMONDS'), // dealer -> 19
  ]);
  game.act(ACTIONS.SPLIT);
  // Both hands must be auto-completed: no further action is expected.
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.WIN, 'split 21 wins as a normal hand');
  assertEqual(game.hands[1].result, RESULTS.LOSS);
  assertEqual(bankrollUnitsOf(game), 1000); // -100 +100
  assertNetMatches(game, 1000, 50);
});

test('Aces cannot be re-split under the French profile', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('A'), C('9', 'HEARTS'), C('A', 'DIAMONDS'),
    C('A', 'HEARTS'), C('A', 'CLUBS'), // both split hands draw another Ace
    C('10', 'DIAMONDS'),
  ]);
  game.act(ACTIONS.SPLIT);
  // Hands are A+A but split Aces are locked: round runs to completion.
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands.length, 2);
});

// ------------------------------------------- dealer blackjack loss modes

test('ENHC ALL_BETS_LOST: a doubled bet is fully lost to dealer blackjack', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('5'), C('A', 'HEARTS'), C('6', 'DIAMONDS'),
    C('10', 'HEARTS'), // double card -> 21
    C('K', 'CLUBS'),   // dealer second card -> blackjack
  ]);
  game.decideInsurance(false);
  game.act(ACTIONS.DOUBLE);
  assertEqual(game.hands[0].result, RESULTS.LOSS);
  assertEqual(game.hands[0].payoutCents, 0);
  assertEqual(bankrollUnitsOf(game), 900, 'both halves of the doubled bet are lost');
  assertNetMatches(game, 1000, 50);
});

test('ORIGINAL_BETS_ONLY: the double addition is returned on dealer blackjack', () => {
  const profile = buildCustomProfile({ dealerBlackjackLossMode: 'ORIGINAL_BETS_ONLY' });
  const game = play(profile, [
    C('5'), C('A', 'HEARTS'), C('6', 'DIAMONDS'),
    C('10', 'HEARTS'), C('K', 'CLUBS'),
  ]);
  game.decideInsurance(false);
  game.act(ACTIONS.DOUBLE);
  assertEqual(game.hands[0].result, RESULTS.LOSS);
  assertEqual(game.hands[0].payoutCents, 50 * UNITS, 'double addition refunded');
  assertEqual(bankrollUnitsOf(game), 950);
  assertNetMatches(game, 1000, 50);
});

// -------------------------------------------------- American hole card, peek

test('peek ends the round immediately on dealer blackjack (PEEK_PROTECTED)', () => {
  const game = play(PROFILES.LAS_VEGAS_STRIP, [
    C('10'), C('10', 'HEARTS'), C('9', 'DIAMONDS'),
    C('A', 'CLUBS'), // hole card -> dealer blackjack
  ]);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE, 'no player action after peek');
  assertEqual(game.hands[0].result, RESULTS.LOSS);
  assertEqual(bankrollUnitsOf(game), 950, 'only the original bet is lost');
  assertEqual(game.getSnapshot().dealer.holeCardHidden, false, 'blackjack is revealed');
});

test('the hole card stays masked in snapshots until the dealer turn', () => {
  const game = play(PROFILES.LAS_VEGAS_STRIP, [
    C('10'), C('10', 'HEARTS'), C('9', 'DIAMONDS'),
    C('9', 'CLUBS'), // hole card -> 19, no blackjack
  ]);
  const during = game.getSnapshot();
  assertEqual(during.dealer.cards[1].hidden, true);
  assertEqual(during.dealer.cards[1].rank, undefined, 'rank must not leak');
  assertEqual(during.dealer.evaluation.total, 10, 'only the upcard is evaluated');
  game.act(ACTIONS.STAND);
  const after = game.getSnapshot();
  assertEqual(after.dealer.cards[1].rank, '9');
  assertEqual(game.hands[0].result, RESULTS.PUSH);
});

test('player blackjack pushes against a peeked dealer blackjack', () => {
  const game = play(PROFILES.LAS_VEGAS_STRIP, [
    C('A'), C('A', 'HEARTS'), C('K', 'DIAMONDS'),
    C('10', 'CLUBS'), // hole -> dealer blackjack
  ]);
  assertEqual(game.pendingDecision, PENDING_DECISIONS.INSURANCE);
  game.decideInsurance(false);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.PUSH);
  assertEqual(bankrollUnitsOf(game), 1000);
});

test('player blackjack is paid immediately once the peek clears', () => {
  const game = play(PROFILES.LAS_VEGAS_STRIP, [
    C('A'), C('10', 'HEARTS'), C('K', 'DIAMONDS'),
    C('9', 'CLUBS'), // hole -> 19, no blackjack
  ]);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.BLACKJACK_WIN);
  assertEqual(bankrollUnitsOf(game), 1075);
});

test('6:5 profile pays a natural exactly 6:5', () => {
  const game = play(PROFILES.BLACKJACK_6_5, [
    C('A'), C('5', 'HEARTS'), C('K', 'DIAMONDS'), C('9', 'CLUBS'),
  ]);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.BLACKJACK_WIN);
  assertEqual(bankrollUnitsOf(game), 1060); // profit 60, not 75
});

// --------------------------------------------------------------- surrender

test('late surrender returns half the bet after the peek clears', () => {
  const game = play(PROFILES.ATLANTIC_CITY, [
    C('10'), C('10', 'HEARTS'), C('6', 'DIAMONDS'),
    C('9', 'CLUBS'), // hole -> no blackjack
  ]);
  assert(game.actionAvailability()[ACTIONS.SURRENDER].legal);
  game.act(ACTIONS.SURRENDER);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.hands[0].result, RESULTS.SURRENDER);
  assertEqual(bankrollUnitsOf(game), 975);
  assertNetMatches(game, 1000, 50);
});

test('surrender is refused after hitting', () => {
  const game = play(PROFILES.ATLANTIC_CITY, [
    C('5'), C('10', 'HEARTS'), C('6', 'DIAMONDS'), C('9', 'CLUBS'),
    C('2', 'CLUBS'), // hit
    C('10', 'DIAMONDS'), C('7', 'CLUBS'),
  ]);
  game.act(ACTIONS.HIT);
  const availability = game.actionAvailability();
  assertEqual(availability[ACTIONS.SURRENDER].legal, false);
  assertEqual(availability[ACTIONS.SURRENDER].reason, UNAVAILABLE_REASONS.SURRENDER_WINDOW_CLOSED);
});

test('surrender is refused in the French profile', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('9', 'HEARTS'), C('6', 'DIAMONDS'), C('10', 'CLUBS'),
  ]);
  const availability = game.actionAvailability();
  assertEqual(availability[ACTIONS.SURRENDER].legal, false);
  assertEqual(availability[ACTIONS.SURRENDER].reason, UNAVAILABLE_REASONS.RULE_FORBIDS);
});

test('early surrender is offered before the dealer blackjack check and keeps half', () => {
  const profile = buildCustomProfile({ dealMode: 'ENHC', surrender: 'EARLY_SURRENDER', surrenderVsAce: true });
  const game = play(profile, [
    C('10'), C('10', 'HEARTS'), C('6', 'DIAMONDS'),
  ]);
  assertEqual(game.pendingDecision, PENDING_DECISIONS.EARLY_SURRENDER);
  game.decideEarlySurrender(true);
  assertEqual(game.roundState, ROUND_STATES.ROUND_COMPLETE);
  assertEqual(game.dealerCards.length, 1, 'the dealer never draws');
  assertEqual(bankrollUnitsOf(game), 975);
});

test('declining early surrender closes the window', () => {
  const profile = buildCustomProfile({ dealMode: 'ENHC', surrender: 'EARLY_SURRENDER', surrenderVsAce: true });
  const game = play(profile, [
    C('10'), C('10', 'HEARTS'), C('6', 'DIAMONDS'),
    C('7', 'CLUBS'),
  ]);
  game.decideEarlySurrender(false);
  const availability = game.actionAvailability();
  assertEqual(availability[ACTIONS.SURRENDER].legal, false);
  assertEqual(availability[ACTIONS.SURRENDER].reason, UNAVAILABLE_REASONS.SURRENDER_WINDOW_CLOSED);
});

// ------------------------------------------------------- state machine guards

test('actions are rejected outside the player turn', () => {
  const game = new BlackjackGame({
    profile: PROFILES.FRENCH_STANDARD,
    shoe: Shoe.fromSequence([C('10'), C('9', 'HEARTS'), C('6', 'DIAMONDS'), C('2', 'CLUBS')]),
  });
  assertThrows(() => game.act(ACTIONS.HIT), 'Expected state');
  assertThrows(() => game.nextRound(), 'Expected state');
  assertThrows(() => game.decideInsurance(true), 'Expected state');
});

test('betting is validated: minimum, maximum, whole units, funds', () => {
  const game = new BlackjackGame({
    profile: PROFILES.FRENCH_STANDARD,
    shoe: Shoe.fromSequence([C('10'), C('9', 'HEARTS'), C('6', 'DIAMONDS')]),
    bankrollCents: 100 * UNITS,
  });
  assertThrows(() => game.placeBet(1 * UNITS), 'minimum');
  assertThrows(() => game.placeBet(2000 * UNITS), 'maximum');
  assertThrows(() => game.placeBet(5050), 'whole units');
  assertThrows(() => game.placeBet(500 * UNITS), 'Insufficient');
  assertThrows(() => game.placeBet(Number.NaN), 'Invalid bet');
});

test('a completed round cannot be settled twice and a new bet requires nextRound', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('9', 'HEARTS'), C('6', 'DIAMONDS'), C('10', 'HEARTS'),
  ]);
  game.act(ACTIONS.HIT); // bust, round complete
  assertThrows(() => game.act(ACTIONS.STAND), 'Expected state');
  assertThrows(() => game.placeBet(50 * UNITS), 'Expected state');
  game.nextRound();
  assertEqual(game.roundState, ROUND_STATES.WAITING_FOR_BET);
  assertEqual(game.hands.length, 0);
});

test('bankroll can never go negative through play', () => {
  const game = play(PROFILES.FRENCH_STANDARD, [
    C('10'), C('9', 'HEARTS'), C('6', 'DIAMONDS'), C('10', 'HEARTS'),
  ], { bankrollUnits: 50 });
  assertEqual(game.bankrollCents, 0);
  const availability = game.actionAvailability();
  assertEqual(availability[ACTIONS.DOUBLE].legal, false);
  game.act(ACTIONS.HIT); // bust
  assertEqual(game.bankrollCents, 0);
  game.nextRound();
  assertThrows(() => game.placeBet(50 * UNITS), 'Insufficient');
});
