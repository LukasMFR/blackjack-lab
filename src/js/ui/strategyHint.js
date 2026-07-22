import { t } from '../i18n/index.js';
import { ROUND_STATES } from '../game/constants.js';
import { PENDING_DECISIONS } from '../game/engine.js';
import {
  getBasicStrategyHint, HINT_DECISIONS, HINT_STATUS,
} from '../strategy/basicStrategy.js';

/**
 * Rendering for the optional basic-strategy hint. Reads engine snapshots
 * and the active profile, asks the pure resolver, and draws the result:
 * one short line near the action buttons (or inside the decision panel)
 * plus a subtle marker on the recommended button. It never plays an
 * action, never changes focus, and never mutates game state.
 */

const $ = (id) => document.getElementById(id);

/**
 * Update a hint line only when its text actually changes, so the polite
 * live region announces new recommendations without repeating itself on
 * every re-render. Only the text span is written: the decorative bulb
 * icon lives in the static markup and must survive every update.
 */
function setHintLine(el, text, { muted = false } = {}) {
  const textEl = el.querySelector('.strategy-hint__text');
  if (textEl.textContent !== text) textEl.textContent = text;
  el.classList.toggle('strategy-hint--muted', muted);
  el.hidden = text === '';
}

function setHighlightedButton(target = null) {
  for (const button of document.querySelectorAll('.is-hinted')) {
    if (button !== target) button.classList.remove('is-hinted');
  }
  if (target) target.classList.add('is-hinted');
}

function hintText(action) {
  return t('strategy.hint', { action: t(`strategy.actions.${action}`) });
}

/**
 * Render the strategy hint for the current snapshot.
 * @param {object} snapshot - engine snapshot
 * @param {object} profile - resolved active rule profile
 * @param {boolean} enabled - the player's hint preference
 */
export function renderStrategyHint(snapshot, profile, enabled) {
  const actionHintEl = $('strategy-hint');
  const decisionHintEl = $('decision-hint');

  if (!enabled) {
    setHighlightedButton();
    setHintLine(actionHintEl, '');
    setHintLine(decisionHintEl, '');
    return;
  }

  // Insurance prompt: advise inside the decision panel. The engine offers
  // plain half-bet insurance only (never a distinct Even Money
  // settlement), so the advice is the document's insurance rule.
  if (snapshot.pendingDecision === PENDING_DECISIONS.INSURANCE) {
    setHintLine(actionHintEl, '');
    const hint = getBasicStrategyHint({
      rules: profile,
      decision: HINT_DECISIONS.INSURANCE,
    });
    if (hint.status === HINT_STATUS.SUPPORTED) {
      setHintLine(decisionHintEl, hintText(hint.primaryAction));
      setHighlightedButton($('btn-decision-no'));
    } else {
      setHighlightedButton();
      setHintLine(decisionHintEl, t('strategy.unsupported'), { muted: true });
    }
    return;
  }

  setHintLine(decisionHintEl, '');

  const activeHand = snapshot.hands.find((hand) => hand.isActive);
  const upcard = snapshot.dealer.cards[0];
  if (
    snapshot.roundState !== ROUND_STATES.PLAYER_TURN
    || snapshot.pendingDecision !== null
    || !activeHand
    || !upcard
    || upcard.hidden
  ) {
    setHighlightedButton();
    setHintLine(actionHintEl, '');
    return;
  }

  const availability = snapshot.actionAvailability;
  const hint = getBasicStrategyHint({
    rules: profile,
    hand: { cards: activeHand.cards, fromSplit: activeHand.fromSplit },
    dealerUpcard: upcard,
    legalActions: Object.keys(availability).filter((a) => availability[a].legal),
  });

  if (hint.status === HINT_STATUS.SUPPORTED) {
    setHintLine(actionHintEl, hintText(hint.primaryAction));
    const button = document.querySelector(`[data-action="${hint.primaryAction}"]`);
    setHighlightedButton(button && !button.hidden ? button : null);
  } else if (hint.status === HINT_STATUS.UNSUPPORTED_STRATEGY) {
    // Discreet by design: one muted line, no highlighted button.
    setHighlightedButton();
    setHintLine(actionHintEl, t('strategy.unsupported'), { muted: true });
  } else {
    setHighlightedButton();
    setHintLine(actionHintEl, '');
  }
}
