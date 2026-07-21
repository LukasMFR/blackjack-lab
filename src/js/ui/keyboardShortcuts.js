import { ACTIONS, ROUND_STATES } from '../game/constants.js';
import { PENDING_DECISIONS } from '../game/engine.js';

/**
 * One source of truth for gameplay keys and the help panel that documents
 * them. Insurance uses A for Accept/Accepter and C for Continue/Continuer
 * without insurance, keeping both choices mnemonic in English and French.
 */
export const SHORTCUT_KEYS = Object.freeze({
  HIT: 'h',
  STAND: 's',
  DOUBLE: 'd',
  SPLIT: 'p',
  SURRENDER: 'r',
  DEAL: 'n',
  INSURANCE_ACCEPT: 'a',
  INSURANCE_DECLINE: 'c',
});

const ACTION_SHORTCUTS = Object.freeze({
  [SHORTCUT_KEYS.HIT]: ACTIONS.HIT,
  [SHORTCUT_KEYS.STAND]: ACTIONS.STAND,
  [SHORTCUT_KEYS.DOUBLE]: ACTIONS.DOUBLE,
  [SHORTCUT_KEYS.SPLIT]: ACTIONS.SPLIT,
  [SHORTCUT_KEYS.SURRENDER]: ACTIONS.SURRENDER,
});

const EDITABLE_SELECTOR = [
  'input',
  'select',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="spinbutton"]',
].join(', ');

/** @param {EventTarget|null} target */
export function isEditableShortcutTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;
  return typeof target.closest === 'function' && Boolean(target.closest(EDITABLE_SELECTOR));
}

function stopMandatoryDecisionDismissal(event) {
  event.preventDefault();
  event.stopPropagation();
}

function cycleDecisionFocus(event, decisionButtons, activeElement) {
  const decline = decisionButtons?.decline;
  const accept = decisionButtons?.accept;
  if (!decline || !accept) return;

  event.preventDefault();
  const next = event.shiftKey
    ? (activeElement === accept ? decline : accept)
    : (activeElement === decline ? accept : decline);
  next.focus({ preventScroll: true });
}

/**
 * Central keyboard dispatcher for the table. Enter/Space presses inside a
 * pending decision are forwarded to the focused button's existing click path.
 *
 * @param {KeyboardEvent} event
 * @param {object} context
 * @param {object} context.snapshot
 * @param {boolean} context.hasOpenDialog
 * @param {Element|null} context.activeElement
 * @param {{accept: HTMLElement, decline: HTMLElement}} context.decisionButtons
 * @param {() => void} context.deal
 * @param {() => void} context.nextRound
 * @param {(action: string) => void} context.performAction
 * @param {(accept: boolean) => void} context.decideInsurance
 * @param {() => void} context.rejectAction
 */
export function handleGameplayShortcut(event, context) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (context.hasOpenDialog || isEditableShortcutTarget(event.target)) return;

  const key = String(event.key ?? '').toLowerCase();
  const { snapshot } = context;

  // Insurance and early surrender are both mandatory two-choice interactions
  // rendered in the same modal panel. Whichever is pending owns keyboard input
  // until answered, so no table action can fire behind it.
  if (snapshot.pendingDecision !== null) {
    if (key === 'tab') {
      cycleDecisionFocus(event, context.decisionButtons, context.activeElement);
      return;
    }
    if (key === 'escape') {
      stopMandatoryDecisionDismissal(event);
      return;
    }
    if (event.repeat) return;
    if (key === 'enter' || key === ' ') {
      const focusedButton = context.activeElement;
      if (focusedButton === context.decisionButtons?.accept
        || focusedButton === context.decisionButtons?.decline) {
        // Forward to the established click path. Preventing the browser's
        // default avoids a second synthetic click in browsers that emit one.
        event.preventDefault();
        focusedButton.click();
      }
      return;
    }
    // A/C are documented for insurance only; early surrender is answered with
    // the trapped buttons so no letter key silently forfeits half the bet.
    if (snapshot.pendingDecision !== PENDING_DECISIONS.INSURANCE) return;
    if (key === SHORTCUT_KEYS.INSURANCE_ACCEPT) {
      event.preventDefault();
      context.decideInsurance(true);
    } else if (key === SHORTCUT_KEYS.INSURANCE_DECLINE) {
      event.preventDefault();
      context.decideInsurance(false);
    }
    return;
  }

  if (event.repeat) return;

  if (key === SHORTCUT_KEYS.DEAL) {
    if (snapshot.roundState === ROUND_STATES.WAITING_FOR_BET) context.deal();
    else if (snapshot.roundState === ROUND_STATES.ROUND_COMPLETE) context.nextRound();
    return;
  }

  const action = ACTION_SHORTCUTS[key];
  if (!action || snapshot.roundState !== ROUND_STATES.PLAYER_TURN) return;
  if (!snapshot.actionAvailability[action]?.legal) {
    context.rejectAction();
    return;
  }
  context.performAction(action);
}
