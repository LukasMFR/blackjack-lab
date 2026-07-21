import { ACTIONS, ROUND_STATES } from '../src/js/game/constants.js';
import { PENDING_DECISIONS } from '../src/js/game/engine.js';
import {
  handleGameplayShortcut, isEditableShortcutTarget, SHORTCUT_KEYS,
} from '../src/js/ui/keyboardShortcuts.js';
import { setLanguage, t } from '../src/js/i18n/index.js';
import { assert, assertEqual, test } from './runner.js';

function keyEvent(key, init = {}) {
  return {
    key,
    target: { closest: () => null, isContentEditable: false },
    defaultPrevented: false,
    propagationStopped: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...init,
  };
}

function focusButton(name) {
  return {
    name,
    focusCount: 0,
    clickCount: 0,
    focusOptions: null,
    focus(options) {
      this.focusCount += 1;
      this.focusOptions = options;
    },
    click() { this.clickCount += 1; },
  };
}

function createHarness(snapshotPatch = {}) {
  const calls = {
    decisions: [], actions: [], deals: 0, nextRounds: 0, rejections: 0,
  };
  const decline = focusButton('decline');
  const accept = focusButton('accept');
  const snapshot = {
    pendingDecision: PENDING_DECISIONS.INSURANCE,
    roundState: ROUND_STATES.PLAYER_TURN,
    actionAvailability: Object.fromEntries(
      Object.values(ACTIONS).map((action) => [action, { legal: true }]),
    ),
    ...snapshotPatch,
  };
  const context = {
    snapshot,
    hasOpenDialog: false,
    activeElement: decline,
    decisionButtons: { accept, decline },
    deal: () => { calls.deals += 1; },
    nextRound: () => { calls.nextRounds += 1; },
    performAction: (action) => calls.actions.push(action),
    decideInsurance: (accepted) => calls.decisions.push(accepted),
    rejectAction: () => { calls.rejections += 1; },
  };
  return { accept, calls, context, decline };
}

test('keyboard: A accepts Insurance and C declines it', () => {
  const { calls, context } = createHarness();
  const acceptEvent = keyEvent('A');
  handleGameplayShortcut(acceptEvent, context);
  assertEqual(calls.decisions[0], true);
  assert(acceptEvent.defaultPrevented, 'A should be consumed');

  const declineEvent = keyEvent('c');
  handleGameplayShortcut(declineEvent, context);
  assertEqual(calls.decisions[1], false);
  assert(declineEvent.defaultPrevented, 'C should be consumed');
});

test('keyboard: Insurance shortcuts are inactive outside the Insurance decision', () => {
  const { calls, context } = createHarness({ pendingDecision: null });
  handleGameplayShortcut(keyEvent('a'), context);
  handleGameplayShortcut(keyEvent('c'), context);
  assertEqual(calls.decisions.length, 0);
  assertEqual(calls.actions.length, 0);
});

test('keyboard: gameplay shortcuts cannot fire behind Insurance', () => {
  const { calls, context } = createHarness();
  for (const key of ['h', 's', 'd', 'p', 'r', 'n']) {
    handleGameplayShortcut(keyEvent(key), context);
  }
  assertEqual(calls.actions.length, 0);
  assertEqual(calls.deals, 0);
  assertEqual(calls.nextRounds, 0);
  assertEqual(calls.rejections, 0);
});

test('keyboard: held Insurance keys do not activate twice', () => {
  const { calls, context } = createHarness();
  handleGameplayShortcut(keyEvent('a'), context);
  handleGameplayShortcut(keyEvent('a', { repeat: true }), context);
  assertEqual(calls.decisions.length, 1);
});

test('keyboard: Tab and Shift+Tab stay within the Insurance actions', () => {
  const { accept, context, decline } = createHarness();
  const forward = keyEvent('Tab');
  handleGameplayShortcut(forward, context);
  assert(forward.defaultPrevented, 'Tab should be trapped');
  assertEqual(accept.focusCount, 1, 'Tab from Decline should focus Accept');

  context.activeElement = accept;
  const backward = keyEvent('Tab', { shiftKey: true });
  handleGameplayShortcut(backward, context);
  assert(backward.defaultPrevented, 'Shift+Tab should be trapped');
  assertEqual(decline.focusCount, 1, 'Shift+Tab from Accept should focus Decline');
});

test('keyboard: focus entering the Insurance boundary follows button order', () => {
  const { accept, context, decline } = createHarness();
  context.activeElement = null;
  handleGameplayShortcut(keyEvent('Tab'), context);
  assertEqual(decline.focusCount, 1, 'Tab enters on Decline');
  handleGameplayShortcut(keyEvent('Tab', { shiftKey: true }), context);
  assertEqual(accept.focusCount, 1, 'Shift+Tab enters on Accept');
});

test('keyboard: Escape cannot dismiss the Insurance decision', () => {
  const { calls, context } = createHarness();
  const event = keyEvent('Escape');
  handleGameplayShortcut(event, context);
  assert(event.defaultPrevented, 'Escape should be prevented');
  assert(event.propagationStopped, 'Escape should not reach another dismiss handler');
  assertEqual(calls.decisions.length, 0, 'Escape must not make an implicit choice');
});

test('keyboard: Enter and Space activate the focused Insurance button once', () => {
  const { accept, context, decline } = createHarness();
  for (const [key, button] of [['Enter', decline], [' ', accept]]) {
    context.activeElement = button;
    const event = keyEvent(key);
    handleGameplayShortcut(event, context);
    assert(event.defaultPrevented, `${JSON.stringify(key)} should be handled once`);
    assertEqual(button.clickCount, 1, `${button.name} receives one click`);
  }

  context.activeElement = decline;
  handleGameplayShortcut(keyEvent('Enter', { repeat: true }), context);
  assertEqual(decline.clickCount, 1, 'key repeat must not add another click');
});

test('keyboard: early surrender gets the same focus trap as Insurance', () => {
  const { accept, context, decline } = createHarness({
    pendingDecision: PENDING_DECISIONS.EARLY_SURRENDER,
  });
  const forward = keyEvent('Tab');
  handleGameplayShortcut(forward, context);
  assert(forward.defaultPrevented, 'Tab is trapped during early surrender too');
  assertEqual(accept.focusCount, 1, 'Tab from Decline focuses Accept');

  const escape = keyEvent('Escape');
  handleGameplayShortcut(escape, context);
  assert(escape.defaultPrevented, 'Escape cannot dismiss early surrender');
  assert(escape.propagationStopped, 'Escape does not reach another dismiss handler');

  context.activeElement = decline;
  handleGameplayShortcut(keyEvent('Enter'), context);
  assertEqual(decline.clickCount, 1, 'Enter activates the focused choice');
});

test('keyboard: A and C do not answer early surrender', () => {
  const { calls, context } = createHarness({
    pendingDecision: PENDING_DECISIONS.EARLY_SURRENDER,
  });
  handleGameplayShortcut(keyEvent('a'), context);
  handleGameplayShortcut(keyEvent('c'), context);
  assertEqual(calls.decisions.length, 0, 'no letter key forfeits half the bet');
  assertEqual(calls.actions.length, 0);
});

test('keyboard: gameplay shortcuts cannot fire behind early surrender', () => {
  const { calls, context } = createHarness({
    pendingDecision: PENDING_DECISIONS.EARLY_SURRENDER,
  });
  for (const key of ['h', 's', 'd', 'p', 'r', 'n']) {
    handleGameplayShortcut(keyEvent(key), context);
  }
  assertEqual(calls.actions.length, 0);
  assertEqual(calls.deals, 0);
  assertEqual(calls.nextRounds, 0);
});

test('keyboard: shortcuts are ignored in native and editable controls', () => {
  for (const selector of ['input', 'select', '[role="combobox"]']) {
    const { calls, context } = createHarness();
    const target = {
      isContentEditable: false,
      closest: (query) => (query.includes(selector) ? {} : null),
    };
    handleGameplayShortcut(keyEvent('a', { target }), context);
    assertEqual(calls.decisions.length, 0, `ignored inside ${selector}`);
  }
  assert(isEditableShortcutTarget({ isContentEditable: true }), 'editable content is detected');
});

test('keyboard: shortcuts are ignored while another dialog is open', () => {
  const { calls, context } = createHarness();
  context.hasOpenDialog = true;
  handleGameplayShortcut(keyEvent('a'), context);
  assertEqual(calls.decisions.length, 0);
});

test('keyboard: existing H/S/D/P/R and N mappings remain unchanged', () => {
  const expectedActions = {
    h: ACTIONS.HIT,
    s: ACTIONS.STAND,
    d: ACTIONS.DOUBLE,
    p: ACTIONS.SPLIT,
    r: ACTIONS.SURRENDER,
  };
  for (const [key, action] of Object.entries(expectedActions)) {
    const { calls, context } = createHarness({ pendingDecision: null });
    handleGameplayShortcut(keyEvent(key), context);
    assertEqual(calls.actions[0], action, `${key} still maps to ${action}`);
  }

  const betting = createHarness({
    pendingDecision: null,
    roundState: ROUND_STATES.WAITING_FOR_BET,
  });
  handleGameplayShortcut(keyEvent('n'), betting.context);
  assertEqual(betting.calls.deals, 1);

  const complete = createHarness({
    pendingDecision: null,
    roundState: ROUND_STATES.ROUND_COMPLETE,
  });
  handleGameplayShortcut(keyEvent('n'), complete.context);
  assertEqual(complete.calls.nextRounds, 1);
});

test('keyboard: A/C help labels are complete in English and French', () => {
  assertEqual(SHORTCUT_KEYS.INSURANCE_ACCEPT, 'a');
  assertEqual(SHORTCUT_KEYS.INSURANCE_DECLINE, 'c');

  setLanguage('en');
  assertEqual(t('help.shortcutInsuranceAccept'), 'Accept insurance');
  assertEqual(t('help.shortcutInsuranceDecline'), 'Continue without insurance');
  setLanguage('fr');
  assertEqual(t('help.shortcutInsuranceAccept'), 'Accepter l’assurance');
  assertEqual(t('help.shortcutInsuranceDecline'), 'Continuer sans assurance');
  setLanguage('en');
});
