import { test, assert, assertEqual } from './runner.js';
import { useFakeStorage, withoutStorage } from './fakeStorage.js';
import { installFakeDom } from './fakeDom.js';
import { setLanguage } from '../src/js/i18n/index.js';
import { evaluateCards } from '../src/js/game/handEval.js';
import {
  createHandTotalElement,
  DEFAULT_HAND_TOTAL_FORMAT,
  HAND_TOTAL_FORMATS,
  HAND_TOTAL_FORMAT_STORAGE_KEY,
  formatHandTotal,
  handTotalSpeech,
  loadHandTotalFormat,
  normalizeHandTotalFormat,
  saveHandTotalFormat,
} from '../src/js/ui/handTotalFormat.js';

const C = (rank, suit = 'SPADES') => ({ rank, suit });
const KEY = `bjlab.${HAND_TOTAL_FORMAT_STORAGE_KEY}`;

const slash = (cards) => formatHandTotal(evaluateCards(cards), HAND_TOTAL_FORMATS.SLASH);
const strategy = (cards) => formatHandTotal(evaluateCards(cards), HAND_TOTAL_FORMATS.STRATEGY);

// ------------------------------------------------------------- notation

test('slash is the default notation', () => {
  assertEqual(DEFAULT_HAND_TOTAL_FORMAT, HAND_TOTAL_FORMATS.SLASH);
  assertEqual(formatHandTotal(evaluateCards([C('A'), C('4')])), '5/15');
});

test('a soft hand shows both totals in slash notation', () => {
  assertEqual(slash([C('A'), C('4')]), '5/15');
  assertEqual(slash([C('A'), C('2'), C('2')]), '5/15');
  assertEqual(slash([C('A'), C('A'), C('8')]), '10/20');
});

test('a soft hand shows its strategy row in strategy notation', () => {
  assertEqual(strategy([C('A'), C('4')]), 'A,4');
  assertEqual(strategy([C('A'), C('9')]), 'A,9');
});

test('multi-card soft hands collapse to the same strategy row', () => {
  // A+2+2 plays exactly like A+4, and A+A+8 exactly like A+9.
  assertEqual(strategy([C('A'), C('2'), C('2')]), 'A,4');
  assertEqual(strategy([C('A'), C('A'), C('8')]), 'A,9');
  assertEqual(strategy([C('A'), C('2'), C('3'), C('2')]), 'A,7');
});

test('two Aces are the A,A row, never A,1', () => {
  assertEqual(strategy([C('A'), C('A')]), 'A,A');
  // A third Ace makes it an ordinary soft 13.
  assertEqual(strategy([C('A'), C('A'), C('A')]), 'A,2');
});

test('a hard hand is a plain total in both notations', () => {
  for (const cards of [[C('10'), C('6')], [C('9'), C('4'), C('3')], [C('K'), C('Q')]]) {
    assertEqual(slash(cards), String(evaluateCards(cards).total));
    assertEqual(strategy(cards), String(evaluateCards(cards).total));
  }
});

test('a hand whose Aces were all reduced is a plain total', () => {
  // 10+8+A: the Ace counts 1, so there is no second total to show.
  assertEqual(slash([C('10'), C('8'), C('A')]), '19');
  assertEqual(strategy([C('10'), C('8'), C('A')]), '19');
});

test('a bust hand is a plain total in both notations', () => {
  assertEqual(slash([C('10'), C('8'), C('7')]), '25');
  assertEqual(strategy([C('10'), C('8'), C('7')]), '25');
});

test('an unknown notation falls back to slash', () => {
  assertEqual(formatHandTotal(evaluateCards([C('A'), C('4')]), 'wobble'), '5/15');
  assertEqual(normalizeHandTotalFormat('wobble'), HAND_TOTAL_FORMATS.SLASH);
  assertEqual(normalizeHandTotalFormat(HAND_TOTAL_FORMATS.STRATEGY), HAND_TOTAL_FORMATS.STRATEGY);
});

// ------------------------------------------------------------ preference

test('an absent preference reads as slash', () => {
  useFakeStorage();
  assertEqual(loadHandTotalFormat(), HAND_TOTAL_FORMATS.SLASH);
});

test('the chosen notation round-trips through storage', () => {
  const data = useFakeStorage();
  saveHandTotalFormat(HAND_TOTAL_FORMATS.STRATEGY);
  assertEqual(data.get(KEY), 'strategy');
  assertEqual(loadHandTotalFormat(), HAND_TOTAL_FORMATS.STRATEGY);
});

test('a malformed stored notation reads as slash', () => {
  useFakeStorage({ [KEY]: 'A,4' });
  assertEqual(loadHandTotalFormat(), HAND_TOTAL_FORMATS.SLASH);
});

test('an unsupported notation is never written', () => {
  const data = useFakeStorage();
  saveHandTotalFormat('wobble');
  assertEqual(data.get(KEY), 'slash');
});

test('the preference degrades to slash without storage', () => {
  withoutStorage();
  saveHandTotalFormat(HAND_TOTAL_FORMATS.STRATEGY);
  assertEqual(loadHandTotalFormat(), HAND_TOTAL_FORMATS.SLASH);
});

// --------------------------------------------------------------- badge

test('the badge speaks the totals whatever the notation', () => {
  setLanguage('en');
  const soft = evaluateCards([C('A'), C('2'), C('2')]);
  assertEqual(handTotalSpeech(soft), 'Total 5 or 15');
  assertEqual(handTotalSpeech(evaluateCards([C('10'), C('6')])), 'Total 16');
  assertEqual(handTotalSpeech(evaluateCards([C('10'), C('8'), C('7')])), 'Total 25');
});

test('the badge is translated', () => {
  setLanguage('fr');
  assertEqual(handTotalSpeech(evaluateCards([C('A'), C('4')])), 'Total 5 ou 15');
  setLanguage('en');
});

test('the badge shows the notation on screen and the totals to a reader', () => {
  installFakeDom();
  setLanguage('en');
  const evaluation = evaluateCards([C('A'), C('2'), C('2')]);

  for (const [format, expected] of [
    [HAND_TOTAL_FORMATS.SLASH, '5/15'],
    [HAND_TOTAL_FORMATS.STRATEGY, 'A,4'],
  ]) {
    const el = createHandTotalElement(evaluation, format);
    assert(el.classList.contains('hand-total'), 'expected the shared badge class');
    const [visible, spoken] = el.children;
    assertEqual(visible.textContent, expected);
    assertEqual(visible.getAttribute('aria-hidden'), 'true');
    // The visible notation is hidden from assistive technology, so the
    // spoken twin is the only thing a screen reader reads.
    assert(spoken.classList.contains('sr-only'), 'expected a visually hidden twin');
    assertEqual(spoken.textContent, 'Total 5 or 15');
  }
});
