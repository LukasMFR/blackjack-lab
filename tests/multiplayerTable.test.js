import { test, assert, assertEqual, assertThrows } from './runner.js';
import { MultiplayerTable, TABLE_STATES, SEAT_DECISIONS } from '../src/js/multiplayer/tableEngine.js';
import { Shoe } from '../src/js/game/shoe.js';
import { ACTIONS, HAND_STATUS, RESULTS } from '../src/js/game/constants.js';
import { PROFILES, buildCustomProfile } from '../src/js/config/profiles.js';

const C = (rank, suit = 'SPADES') => ({ rank, suit });
const UNITS = 100;

/**
 * Build a table on a predefined shoe with two default players (p1, p2).
 * Sequence order is the multiplayer deal order: first card to each
 * betting seat in seat order, dealer upcard, second card to each seat,
 * [dealer hole card under American rules], then every subsequent draw.
 */
function makeTable(profile, sequence, { players = ['p1', 'p2'], bankrollUnits = 1000 } = {}) {
  const table = new MultiplayerTable({
    profile,
    shoe: Shoe.fromSequence(sequence),
    startingBankrollCents: bankrollUnits * UNITS,
  });
  for (const id of players) {
    table.addPlayer({ playerId: id, name: id.toUpperCase() });
  }
  return table;
}

function startRound(table, bets) {
  for (const [playerId, units] of Object.entries(bets)) {
    table.placeBet(playerId, units * UNITS);
  }
  table.startRound();
  return table;
}

function bankrollUnits(table, playerId) {
  return table.getSeat(playerId).bankrollCents / UNITS;
}

// ------------------------------------------------------------ basic rounds

test('two players play a complete ENHC round with independent settlement', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('6', 'HEARTS'),          // first card each
    C('9', 'DIAMONDS'),                 // dealer upcard
    C('9', 'CLUBS'), C('6', 'DIAMONDS'), // second card each
    C('5', 'HEARTS'),                   // p2 hit -> 17
    C('8', 'HEARTS'),                   // dealer second card -> 17
  ]);
  startRound(table, { p1: 50, p2: 50 });

  assertEqual(table.state, TABLE_STATES.PLAYER_TURN);
  assertEqual(table.getSnapshot().activePlayerId, 'p1');
  table.act('p1', ACTIONS.STAND);       // 19
  assertEqual(table.getSnapshot().activePlayerId, 'p2');
  table.act('p2', ACTIONS.HIT);         // 12 -> 17
  table.act('p2', ACTIONS.STAND);

  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  assertEqual(table.getSeat('p1').hands[0].result, RESULTS.WIN);   // 19 v 17
  assertEqual(table.getSeat('p2').hands[0].result, RESULTS.PUSH);  // 17 v 17
  assertEqual(bankrollUnits(table, 'p1'), 1050);
  assertEqual(bankrollUnits(table, 'p2'), 1000);
  assertEqual(table.roundSummaries.p1.netCents, 50 * UNITS);
  assertEqual(table.roundSummaries.p2.netCents, 0);
});

test('a seat without a bet sits the round out untouched', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('9', 'DIAMONDS'), C('9', 'CLUBS'), // p1 only + dealer
    C('8', 'HEARTS'),
  ]);
  startRound(table, { p1: 50 });
  assertEqual(table.getSeat('p2').hands.length, 0);
  assert(table.getSeat('p2').sittingOut, 'p2 should sit out');
  table.act('p1', ACTIONS.STAND);
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  assertEqual(bankrollUnits(table, 'p2'), 1000);
  assertEqual(table.roundSummaries.p2, undefined);
});

test('turn enforcement: only the active seat may act', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('6', 'HEARTS'), C('9', 'DIAMONDS'), C('9', 'CLUBS'), C('6', 'DIAMONDS'),
  ]);
  startRound(table, { p1: 50, p2: 50 });
  assertThrows(() => table.act('p2', ACTIONS.HIT), 'turn');
  const p2Availability = table.getSnapshot().seats
    .find((s) => s.playerId === 'p2').actionAvailability;
  assert(Object.values(p2Availability).every((a) => !a.legal), 'p2 has no legal action');
});

test('actions outside the matching table state are rejected', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('6', 'HEARTS'), C('9', 'DIAMONDS'), C('9', 'CLUBS'), C('6', 'DIAMONDS'),
  ]);
  assertThrows(() => table.act('p1', ACTIONS.HIT), 'Expected table state');
  assertThrows(() => table.startRound(), 'No bets placed');
  startRound(table, { p1: 50, p2: 50 });
  assertThrows(() => table.placeBet('p1', 50 * UNITS), 'Expected table state');
  assertThrows(() => table.startRound(), 'Expected table state');
  assertThrows(() => table.nextRound(), 'Expected table state');
});

// ---------------------------------------------------------------- betting

test('bets validate range, whole units and bankroll, and replace atomically', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [C('2')]);
  assertThrows(() => table.placeBet('p1', 2 * UNITS), 'minimum');
  assertThrows(() => table.placeBet('p1', 2000 * UNITS), 'maximum');
  assertThrows(() => table.placeBet('p1', 50.5 * UNITS), 'whole units');
  table.placeBet('p1', 800 * UNITS);
  assertEqual(bankrollUnits(table, 'p1'), 200);
  // Replacing an 800 bet with 900 must succeed via the refund.
  table.placeBet('p1', 900 * UNITS);
  assertEqual(bankrollUnits(table, 'p1'), 100);
  assertThrows(() => table.placeBet('p1', 1000 * UNITS + 100 * UNITS), 'maximum');
  table.clearBet('p1');
  assertEqual(bankrollUnits(table, 'p1'), 1000);
  assertThrows(() => table.placeBet('unknown', 50 * UNITS), 'Unknown player');
});

test('ready flags gate the round start signal', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [C('2')]);
  assert(!table.canStartRound(), 'no bets yet');
  table.placeBet('p1', 50 * UNITS);
  assert(table.canStartRound(), 'one bet suffices');
  assert(!table.allBettersReady(), 'p1 not ready yet');
  table.setReady('p1', true);
  assert(table.allBettersReady(), 'p1 ready');
});

// ------------------------------------------------------- split and double

test('split and double work per seat without touching other seats', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('8'), C('5', 'CLUBS'),
    C('7', 'DIAMONDS'),
    C('8', 'HEARTS'), C('6', 'CLUBS'),
    C('10'),            // p1 split, first hand -> 18
    C('3', 'DIAMONDS'), // p1 split, second hand -> 11
    C('8', 'DIAMONDS'), // p1 double on 11 -> 19
    C('10', 'CLUBS'),   // p2 hit -> 21
    C('10', 'HEARTS'),  // dealer -> 17
  ]);
  startRound(table, { p1: 50, p2: 50 });

  table.act('p1', ACTIONS.SPLIT);
  assertEqual(table.getSeat('p1').hands.length, 2);
  table.act('p1', ACTIONS.STAND);   // 18
  table.act('p1', ACTIONS.DOUBLE);  // 11 -> 19
  table.act('p2', ACTIONS.HIT);     // 11 -> 21 auto-stands
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);

  const p1 = table.getSeat('p1');
  assertEqual(p1.hands[0].result, RESULTS.WIN);
  assertEqual(p1.hands[1].result, RESULTS.WIN);
  assert(p1.hands[1].doubled, 'second hand doubled');
  // 1000 - 50 - 50 (split) - 50 (double) + 100 + 200 = 1150
  assertEqual(bankrollUnits(table, 'p1'), 1150);
  assertEqual(table.roundSummaries.p1.netCents, 150 * UNITS);
  assertEqual(bankrollUnits(table, 'p2'), 1050);
});

// -------------------------------------------------------------- insurance

test('insurance is offered per seat and settles independently under ENHC', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('10', 'HEARTS'),
    C('A', 'DIAMONDS'),
    C('10', 'DIAMONDS'), C('9', 'CLUBS'),
    C('K', 'DIAMONDS'), // dealer second card -> blackjack
  ]);
  startRound(table, { p1: 50, p2: 50 });

  assertEqual(table.state, TABLE_STATES.PRE_PLAY);
  assertEqual(table.getSeat('p1').pendingDecision, SEAT_DECISIONS.INSURANCE);
  assertThrows(() => table.act('p1', ACTIONS.STAND), 'Expected table state');
  table.decideInsurance('p1', true);
  table.decideInsurance('p2', false);

  assertEqual(table.state, TABLE_STATES.PLAYER_TURN);
  table.act('p1', ACTIONS.STAND);
  table.act('p2', ACTIONS.STAND);

  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  assert(table.getSnapshot().dealer.isBlackjack, 'dealer has blackjack');
  // p1: loses 50, insurance returns 25 + 50 profit -> net 0.
  assertEqual(bankrollUnits(table, 'p1'), 1000);
  assertEqual(table.roundSummaries.p1.netCents, 0);
  // p2: plain loss.
  assertEqual(bankrollUnits(table, 'p2'), 950);
  assertEqual(table.getSeat('p1').insurance.result, RESULTS.WIN);
});

test('early surrender is offered per seat before insurance', () => {
  const profile = buildCustomProfile({ surrender: 'EARLY_SURRENDER' });
  const table = makeTable(profile, [
    C('10'), C('10', 'HEARTS'),
    C('10', 'DIAMONDS'),
    C('6', 'DIAMONDS'), C('9', 'CLUBS'),
    C('K', 'HEARTS'), // dealer second card -> 20
  ]);
  startRound(table, { p1: 50, p2: 50 });

  assertEqual(table.state, TABLE_STATES.PRE_PLAY);
  table.decideEarlySurrender('p1', true);   // keeps 25
  table.decideEarlySurrender('p2', false);
  assertEqual(table.state, TABLE_STATES.PLAYER_TURN);
  table.act('p2', ACTIONS.STAND);           // 19 v 20 -> loss

  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  assertEqual(bankrollUnits(table, 'p1'), 975);
  assertEqual(table.getSeat('p1').hands[0].result, RESULTS.SURRENDER);
  assertEqual(bankrollUnits(table, 'p2'), 950);
});

// ------------------------------------------------------ dealer blackjack

test('American peek ends the round for every seat before actions', () => {
  const table = makeTable(PROFILES.LAS_VEGAS_STRIP, [
    C('A'), C('10', 'CLUBS'),
    C('A', 'DIAMONDS'),
    C('K'), C('9', 'HEARTS'),
    C('K', 'HEARTS'), // hole card -> dealer blackjack
  ]);
  startRound(table, { p1: 50, p2: 50 });

  // Insurance decisions first (both can afford it).
  table.decideInsurance('p1', false);
  table.decideInsurance('p2', false);

  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  assertEqual(table.getSeat('p1').hands[0].result, RESULTS.PUSH); // natural v natural
  assertEqual(table.getSeat('p2').hands[0].result, RESULTS.LOSS);
  assertEqual(bankrollUnits(table, 'p1'), 1000);
  assertEqual(bankrollUnits(table, 'p2'), 950);
});

test('a natural is paid immediately when the dealer cannot have blackjack', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('A'), C('10', 'HEARTS'),
    C('5', 'DIAMONDS'),
    C('K'), C('9', 'CLUBS'),
    C('10', 'CLUBS'), C('2', 'CLUBS'), // dealer 5 + 10 + 2 -> 17
  ]);
  startRound(table, { p1: 50, p2: 50 });
  const p1Hand = table.getSeat('p1').hands[0];
  assertEqual(p1Hand.status, HAND_STATUS.BLACKJACK);
  assert(p1Hand.settled, 'natural settled before player turns');
  assertEqual(p1Hand.result, RESULTS.BLACKJACK_WIN);
  assertEqual(bankrollUnits(table, 'p1'), 1075);
  // p2 still plays normally.
  assertEqual(table.getSnapshot().activePlayerId, 'p2');
  table.act('p2', ACTIONS.STAND);
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
});

// ------------------------------------------------------------ disconnects

test('disconnecting during betting refunds the pending bet', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('9', 'DIAMONDS'), C('9', 'CLUBS'), C('8', 'HEARTS'),
  ]);
  table.placeBet('p1', 50 * UNITS);
  table.placeBet('p2', 100 * UNITS);
  table.setConnected('p2', false);
  assertEqual(bankrollUnits(table, 'p2'), 1000);
  table.startRound(); // p2 sits out
  assertEqual(table.getSeat('p2').hands.length, 0);
  table.act('p1', ACTIONS.STAND);
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
});

test('disconnecting on your turn stands your hands and play continues', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('6', 'HEARTS'),
    C('9', 'DIAMONDS'),
    C('9', 'CLUBS'), C('6', 'DIAMONDS'),
    C('5', 'HEARTS'),  // p2 hit
    C('8', 'HEARTS'),  // dealer
  ]);
  startRound(table, { p1: 50, p2: 50 });
  assertEqual(table.getSnapshot().activePlayerId, 'p1');
  table.setConnected('p1', false);
  assertEqual(table.getSeat('p1').hands[0].status, HAND_STATUS.STOOD);
  assertEqual(table.getSnapshot().activePlayerId, 'p2');
  table.act('p2', ACTIONS.HIT);
  table.act('p2', ACTIONS.STAND);
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  // The disconnected seat still settles: 19 beats 17.
  assertEqual(bankrollUnits(table, 'p1'), 1050);
});

test('a seat disconnected before its turn auto-stands when reached', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('6', 'HEARTS'),
    C('9', 'DIAMONDS'),
    C('9', 'CLUBS'), C('6', 'DIAMONDS'),
    C('8', 'HEARTS'), // dealer
  ]);
  startRound(table, { p1: 50, p2: 50 });
  table.setConnected('p2', false); // not their turn yet
  table.act('p1', ACTIONS.STAND);
  // p2's turn is skipped by standing automatically.
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  assertEqual(table.getSeat('p2').hands[0].status, HAND_STATUS.STOOD);
});

test('disconnecting during a pending decision declines it', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('10', 'HEARTS'),
    C('A', 'DIAMONDS'),
    C('10', 'DIAMONDS'), C('9', 'CLUBS'),
    C('5', 'DIAMONDS'), C('2', 'DIAMONDS'), // dealer 16 -> 18
  ]);
  startRound(table, { p1: 50, p2: 50 });
  assertEqual(table.state, TABLE_STATES.PRE_PLAY);
  table.setConnected('p1', false);
  assert(!table.getSeat('p1').insurance.taken, 'no automatic insurance');
  table.decideInsurance('p2', false);
  // p1 auto-stands, p2 plays.
  assertEqual(table.getSnapshot().activePlayerId, 'p2');
  table.act('p2', ACTIONS.STAND);
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
});

test('removing a player mid-round finishes the hand and frees the seat afterwards', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('6', 'HEARTS'),
    C('9', 'DIAMONDS'),
    C('9', 'CLUBS'), C('6', 'DIAMONDS'),
    C('5', 'HEARTS'),
    C('8', 'HEARTS'),
  ]);
  startRound(table, { p1: 50, p2: 50 });
  table.removePlayer('p1');
  assertEqual(table.seats.length, 2, 'seat stays until the round ends');
  table.act('p2', ACTIONS.HIT);
  table.act('p2', ACTIONS.STAND);
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  assertEqual(table.seats.length, 1);
  assertEqual(table.getSeat('p1'), undefined);
});

test('removing a player during betting frees the seat immediately', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [C('2')]);
  table.placeBet('p1', 50 * UNITS);
  table.removePlayer('p1');
  assertEqual(table.getSeat('p1'), undefined);
  assertEqual(table.seats.length, 1);
});

// ------------------------------------------------------------- next round

test('players joining mid-round play from the next round', () => {
  const table = makeTable(PROFILES.FRENCH_STANDARD, [
    C('10'), C('9', 'DIAMONDS'), C('9', 'CLUBS'),
    C('8', 'HEARTS'),
    // round 2: p1, p3, dealer, p1, p3, dealer second card
    C('10', 'HEARTS'), C('10', 'CLUBS'), C('7', 'DIAMONDS'),
    C('9', 'HEARTS'), C('8', 'CLUBS'), C('10', 'DIAMONDS'),
  ], { players: ['p1'] });
  startRound(table, { p1: 50 });
  const seat = table.addPlayer({ playerId: 'p3', name: 'P3' });
  assert(seat.sittingOut, 'mid-round joiner sits out');
  table.act('p1', ACTIONS.STAND);
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);

  table.nextRound();
  startRound(table, { p1: 50, p3: 50 });
  assertEqual(table.getSeat('p3').hands.length, 1);
  table.act('p1', ACTIONS.STAND); // 19
  table.act('p3', ACTIONS.STAND); // 18
  assertEqual(table.state, TABLE_STATES.ROUND_COMPLETE);
  assertEqual(bankrollUnits(table, 'p1'), 1100); // won both rounds
  assertEqual(bankrollUnits(table, 'p3'), 1050);
});

test('seat capacity is enforced', () => {
  const table = new MultiplayerTable({
    profile: PROFILES.FRENCH_STANDARD,
    shoe: Shoe.fromSequence([C('2')]),
    maxSeats: 2,
  });
  table.addPlayer({ playerId: 'a', name: 'A' });
  table.addPlayer({ playerId: 'b', name: 'B' });
  assertThrows(() => table.addPlayer({ playerId: 'c', name: 'C' }), 'full');
  assertThrows(() => table.addPlayer({ playerId: 'a', name: 'A2' }), 'already seated');
});

test('snapshots mask the dealer hole card until it is revealed', () => {
  const table = makeTable(PROFILES.LAS_VEGAS_STRIP, [
    C('10'), C('9', 'HEARTS'),
    C('7', 'DIAMONDS'),
    C('9', 'CLUBS'), C('8', 'CLUBS'),
    C('K', 'HEARTS'), // hole card
  ], { players: ['p1', 'p2'] });
  startRound(table, { p1: 50, p2: 50 });
  const masked = table.getSnapshot();
  assertEqual(masked.dealer.cards.length, 2);
  assert(masked.dealer.cards[1].hidden, 'hole card must be masked');
  assertEqual(masked.dealer.cards[1].rank, undefined);
  table.act('p1', ACTIONS.STAND);
  table.act('p2', ACTIONS.STAND);
  const revealed = table.getSnapshot();
  assertEqual(revealed.dealer.cards[1].rank, 'K');
});
