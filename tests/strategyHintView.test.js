import { test, assert, assertEqual } from './runner.js';
import { installFakeDom } from './fakeDom.js';
import { renderStrategyHint } from '../src/js/ui/strategyHint.js';
import { PROFILES, buildCustomProfile } from '../src/js/config/profiles.js';
import { ACTIONS, ROUND_STATES } from '../src/js/game/constants.js';

const FRENCH = PROFILES.FRENCH_STANDARD;
const UNSUPPORTED = buildCustomProfile({ dealMode: 'ENHC', dealerHitsSoft17: true });
const ALL = Object.values(ACTIONS);

/**
 * Build the exact hint markup from index.html: a hint line with a decorative
 * icon and a text span, the action buttons, and the decision buttons.
 */
function buildDom() {
  const document = installFakeDom();

  const chip = (id) => {
    const p = document.createElement('p');
    p.id = id;
    p.hidden = true;
    const icon = document.createElement('svg');
    icon.className = 'strategy-hint__icon';
    const text = document.createElement('span');
    text.className = 'strategy-hint__text';
    p.append(icon, text);
    document.append(p);
    return p;
  };

  const buttons = {};
  for (const action of ALL) {
    const button = document.createElement('button');
    button.setAttribute('data-action', action);
    button.dataset.action = action;
    document.append(button);
    buttons[action] = button;
  }
  const decisionNo = document.createElement('button');
  decisionNo.id = 'btn-decision-no';
  const decisionYes = document.createElement('button');
  decisionYes.id = 'btn-decision-yes';
  document.append(decisionNo, decisionYes);

  return {
    document,
    hint: chip('strategy-hint'),
    decisionHint: chip('decision-hint'),
    buttons,
    decisionNo,
    decisionYes,
  };
}

const C = (rank, suit = 'SPADES') => ({ rank, suit });

function availability(legal) {
  return Object.fromEntries(ALL.map((a) => [a, { legal: legal.includes(a) }]));
}

function playingSnapshot({ cards, up = '6', legal = [ACTIONS.HIT, ACTIONS.STAND, ACTIONS.DOUBLE, ACTIONS.SPLIT] } = {}) {
  return {
    roundState: ROUND_STATES.PLAYER_TURN,
    pendingDecision: null,
    hands: [{ cards, fromSplit: false, isActive: true }],
    dealer: { cards: [C(up, 'CLUBS')] },
    actionAvailability: availability(legal),
  };
}

function completeSnapshot() {
  return {
    roundState: ROUND_STATES.ROUND_COMPLETE,
    pendingDecision: null,
    hands: [{ cards: [C('8'), C('8', 'HEARTS')], fromSplit: false, isActive: false }],
    dealer: { cards: [C('6', 'CLUBS')] },
    actionAvailability: availability([]),
  };
}

function textOf(chip) {
  return chip.querySelector('.strategy-hint__text').textContent;
}

const hinted = (dom) => ALL.filter((a) => dom.buttons[a].classList.contains('is-hinted'));

test('hint view: names the action and marks exactly the recommended button', () => {
  const dom = buildDom();
  renderStrategyHint(playingSnapshot({ cards: [C('8'), C('8', 'HEARTS')] }), FRENCH, true);
  assertEqual(textOf(dom.hint), 'Basic strategy: Split', 'chip text');
  assertEqual(dom.hint.hidden, false, 'chip visible');
  assertEqual(hinted(dom).join(','), ACTIONS.SPLIT, 'only split marked');
  assert(dom.hint.querySelector('.strategy-hint__icon'), 'icon preserved');
});

test('hint view: renders nothing while the setting is disabled', () => {
  const dom = buildDom();
  renderStrategyHint(playingSnapshot({ cards: [C('8'), C('8', 'HEARTS')] }), FRENCH, false);
  assertEqual(dom.hint.hidden, true, 'chip hidden');
  assertEqual(textOf(dom.hint), '', 'chip empty');
  assertEqual(hinted(dom).length, 0, 'no marker');
});

test('hint view: insurance prompt advises decline inside the dialog', () => {
  const dom = buildDom();
  const snapshot = {
    ...playingSnapshot({ cards: [C('5'), C('6', 'HEARTS')], up: 'A', legal: [] }),
    pendingDecision: 'INSURANCE',
  };
  renderStrategyHint(snapshot, FRENCH, true);
  assertEqual(textOf(dom.decisionHint), 'Basic strategy: Decline insurance', 'dialog text');
  assertEqual(dom.decisionHint.hidden, false, 'dialog chip visible');
  assertEqual(dom.hint.hidden, true, 'table chip hidden');
  assert(dom.decisionNo.classList.contains('is-hinted'), 'decline marked');
  assert(!dom.decisionYes.classList.contains('is-hinted'), 'accept unmarked');
});

test('hint view: unsupported rules show the muted note without a marker', () => {
  const dom = buildDom();
  renderStrategyHint(playingSnapshot({ cards: [C('10'), C('6', 'HEARTS')] }), UNSUPPORTED, true);
  assertEqual(textOf(dom.hint), 'No verified strategy hint for these rules.', 'note text');
  assert(dom.hint.classList.contains('strategy-hint--muted'), 'muted styling');
  assertEqual(hinted(dom).length, 0, 'no marker');
});

test('hint view: clears the chip and marker once no decision is active', () => {
  const dom = buildDom();
  renderStrategyHint(playingSnapshot({ cards: [C('8'), C('8', 'HEARTS')] }), FRENCH, true);
  assertEqual(hinted(dom).length, 1, 'marker while playing');
  renderStrategyHint(completeSnapshot(), FRENCH, true);
  assertEqual(dom.hint.hidden, true, 'chip hidden');
  assertEqual(textOf(dom.hint), '', 'chip cleared for a fresh announcement');
  assertEqual(hinted(dom).length, 0, 'marker cleared');
});

test('hint view: hides while the upcard is unknown or face down', () => {
  const dom = buildDom();
  const snapshot = playingSnapshot({ cards: [C('8'), C('8', 'HEARTS')] });
  snapshot.dealer.cards = [{ hidden: true }];
  renderStrategyHint(snapshot, FRENCH, true);
  assertEqual(dom.hint.hidden, true, 'chip hidden');
  assertEqual(hinted(dom).length, 0, 'no marker');
});

test('hint view: updates text in place, keeps the icon, and never moves focus', () => {
  const dom = buildDom();
  const icon = dom.hint.querySelector('.strategy-hint__icon');
  renderStrategyHint(playingSnapshot({ cards: [C('8'), C('8', 'HEARTS')] }), FRENCH, true);
  renderStrategyHint(playingSnapshot({ cards: [C('10'), C('6', 'HEARTS')], up: '10' }), FRENCH, true);
  assertEqual(textOf(dom.hint), 'Basic strategy: Hit', 'text follows the hand');
  assertEqual(dom.hint.querySelector('.strategy-hint__icon'), icon, 'same icon element');
  assertEqual(hinted(dom).join(','), ACTIONS.HIT, 'marker follows the hand');
  const focusCounts = [...ALL.map((a) => dom.buttons[a]), dom.decisionNo, dom.decisionYes]
    .reduce((sum, b) => sum + b.focusCount, 0);
  assertEqual(focusCounts, 0, 'focus never stolen');
  assertEqual(dom.document.activeElement, null, 'no programmatic focus');
});
