import { t } from '../i18n/index.js';
import { formatMoney } from './format.js';
import { createCardElement } from './cardView.js';
import { ACTIONS, HAND_STATUS, RESULTS, ROUND_STATES, SURRENDER_MODES } from '../game/constants.js';
import { PENDING_DECISIONS } from '../game/engine.js';
import { exactHalf } from '../game/money.js';

/**
 * Pure DOM rendering from engine snapshots. All game decisions live in
 * the engine; this module only draws them.
 */

const $ = (id) => document.getElementById(id);

const RESULT_BADGE_CLASS = {
  [RESULTS.WIN]: 'win',
  [RESULTS.BLACKJACK_WIN]: 'blackjack',
  [RESULTS.LOSS]: 'loss',
  [RESULTS.PUSH]: 'push',
  [RESULTS.SURRENDER]: 'push',
};

/** Render every static label (called on load and on language change). */
export function renderStaticLabels() {
  $('skip-link').textContent = t('a11y.skipToTable');
  $('fictional-badge').textContent = t('app.fictionalBadge');
  $('fictional-note').textContent = t('app.fictionalNote');
  // First half of the button's name ("Language, French") and the listbox's,
  // both via aria-labelledby.
  $('language-label').textContent = t('a11y.chooseLanguage');
  // Icon-only entries: the accessible name and tooltip carry the label, so
  // none of these may be given textContent — it would replace the inline SVG.
  $('btn-multiplayer').setAttribute('aria-label', t('nav.multiplayer'));
  $('btn-multiplayer').title = t('nav.multiplayer');
  $('btn-help').setAttribute('aria-label', t('a11y.openHelp'));
  $('btn-help').title = t('nav.help');
  $('btn-settings').setAttribute('aria-label', t('a11y.openSettings'));
  $('btn-settings').title = t('nav.settings');
  $('dealer-label').textContent = t('hand.dealer');
  $('player-label').textContent = t('a11y.playerHands');
  $('controls-label').textContent = t('a11y.controls');
  $('bankroll-label').textContent = t('bet.bankroll');
  $('bet-label').textContent = t('bet.currentBet');
  $('bet-prompt').textContent = t('bet.placeYourBet');
  $('btn-clear').textContent = t('bet.clear');
  $('btn-rebet').textContent = t('bet.rebet');
  $('btn-deal').textContent = t('bet.deal');
  $('btn-next').textContent = t('round.newRound');
  $('profile-title').textContent = t('nav.profile');
  $('session-title').textContent = t('session.title');
  $('session-rounds-label').textContent = t('session.rounds');
  $('session-net-label').textContent = t('session.net');
  $('history-title').textContent = t('history.title');
  $('history-empty').textContent = t('history.empty');
  $('live-region').setAttribute('aria-label', t('a11y.announcements'));
  for (const button of document.querySelectorAll('[data-action]')) {
    // Icon-bearing buttons keep their SVG: only the label span is rewritten.
    const label = button.querySelector('.btn__label');
    (label ?? button).textContent = t(`actions.${button.dataset.action}`);
  }
  for (const button of document.querySelectorAll('[data-close-dialog]')) {
    button.textContent = t('settings.close');
    button.setAttribute('aria-label', t('a11y.closeDialog'));
  }
}

/**
 * Render the dealer area and every player hand.
 * @param {object} snapshot - engine snapshot
 * @param {{seenCardIds: Set<string>, prevHoleHidden: boolean}} ctx - render
 *   memory used to animate only newly dealt or newly revealed cards
 */
export function renderTable(snapshot, ctx) {
  const dealerCardsEl = $('dealer-cards');
  dealerCardsEl.textContent = '';
  dealerCardsEl.setAttribute('role', 'group');
  dealerCardsEl.setAttribute('aria-label', t('a11y.dealerHand'));
  snapshot.dealer.cards.forEach((card, index) => {
    const el = createCardElement(card);
    if (!card.hidden) {
      if (index === 1 && ctx.prevHoleHidden && !snapshot.dealer.holeCardHidden) {
        el.classList.add('is-revealed');
      } else if (!ctx.seenCardIds.has(card.id)) {
        el.classList.add('is-dealt');
      }
      ctx.seenCardIds.add(card.id);
    }
    dealerCardsEl.append(el);
  });
  ctx.prevHoleHidden = snapshot.dealer.holeCardHidden;

  const dealerTotal = $('dealer-total');
  if (snapshot.dealer.cards.length > 0 && snapshot.dealer.evaluation) {
    dealerTotal.hidden = false;
    dealerTotal.textContent = snapshot.dealer.isBlackjack
      ? t('hand.blackjack')
      : String(snapshot.dealer.evaluation.total);
  } else {
    dealerTotal.hidden = true;
  }

  const handsEl = $('player-hands');
  handsEl.textContent = '';
  handsEl.classList.toggle('hands--single', snapshot.hands.length <= 1);
  snapshot.hands.forEach((hand, index) => {
    handsEl.append(buildHandElement(hand, index, snapshot, ctx));
  });
}

function buildHandElement(hand, index, snapshot, ctx) {
  const el = document.createElement('div');
  el.className = 'hand';
  if (hand.isActive) el.classList.add('hand--active');
  // State classes for styling and animation hooks; the badges below carry
  // the same information as text.
  if (hand.status === HAND_STATUS.BUST) el.classList.add('hand--bust');
  if (hand.result) el.classList.add(`hand--result-${RESULT_BADGE_CLASS[hand.result]}`);

  const label = snapshot.hands.length > 1
    ? t('hand.handN', { n: index + 1 })
    : t('hand.you');
  const meta = document.createElement('div');
  meta.className = 'hand__meta';

  const labelEl = document.createElement('span');
  labelEl.className = 'hand__label';
  labelEl.textContent = label;

  const totalEl = document.createElement('span');
  totalEl.className = 'hand-total';
  totalEl.textContent = hand.evaluation.isSoft && !hand.evaluation.isBust
    ? `${hand.evaluation.total - 10}/${hand.evaluation.total}`
    : String(hand.evaluation.total);

  const betEl = document.createElement('span');
  betEl.className = 'hand__bet';
  betEl.textContent = t('hand.bet', { amount: formatMoney(hand.betCents) });

  meta.append(labelEl, totalEl, betEl);

  const statusEl = buildHandStatus(hand);
  if (statusEl) meta.append(statusEl);

  const cardsEl = document.createElement('div');
  cardsEl.className = 'cards cards--roomy';
  cardsEl.setAttribute('role', 'group');
  cardsEl.setAttribute('aria-label', hand.isActive
    ? t('a11y.activeHand', { n: index + 1 })
    : label);
  for (const card of hand.cards) {
    const cardEl = createCardElement(card);
    if (!ctx.seenCardIds.has(card.id)) cardEl.classList.add('is-dealt');
    ctx.seenCardIds.add(card.id);
    cardsEl.append(cardEl);
  }

  el.append(cardsEl, meta);
  return el;
}

function buildHandStatus(hand) {
  const el = document.createElement('span');
  el.className = 'hand__status';
  if (hand.result) {
    el.classList.add(`hand__status--${RESULT_BADGE_CLASS[hand.result]}`);
    el.textContent = t(`results.${hand.result}`);
    return el;
  }
  if (hand.isBlackjack) {
    el.classList.add('hand__status--blackjack');
    el.textContent = t('hand.blackjack');
    return el;
  }
  if (hand.status === HAND_STATUS.BUST) {
    el.classList.add('hand__status--loss');
    el.textContent = t('hand.bust');
    return el;
  }
  if (hand.status === HAND_STATUS.SURRENDERED) {
    el.textContent = t('hand.surrendered');
    return el;
  }
  if (hand.doubled) {
    el.textContent = t('hand.doubled');
    return el;
  }
  if (hand.isActive) {
    el.textContent = t('hand.active');
    return el;
  }
  return null;
}

/**
 * Show the panel matching the round state and refresh its contents.
 * @param {object} snapshot
 * @param {{betCents: number, canRebet: boolean, chipValues: number[],
 *   minBetCents: number, maxBetCents: number}} betState
 */
export function renderPanels(snapshot, betState) {
  const isBetting = snapshot.roundState === ROUND_STATES.WAITING_FOR_BET;
  const isDeciding = snapshot.pendingDecision !== null;
  const isActing = snapshot.roundState === ROUND_STATES.PLAYER_TURN && !isDeciding;
  const isComplete = snapshot.roundState === ROUND_STATES.ROUND_COMPLETE;

  $('panel-bet').hidden = !isBetting;
  $('panel-decision').hidden = !isDeciding;
  $('panel-actions').hidden = !isActing;
  $('panel-complete').hidden = !isComplete;

  renderStatusStrip(snapshot, betState);
  if (isBetting) renderBetPanel(snapshot, betState);
  if (isDeciding) renderDecisionPanel(snapshot);
  if (isActing) renderActionPanel(snapshot);
  if (isComplete) renderCompletePanel(snapshot);
  renderMessage(snapshot);
}

function renderStatusStrip(snapshot, betState) {
  $('bankroll-value').textContent = formatMoney(snapshot.bankrollCents);
  const committed = snapshot.hands.reduce((sum, hand) => sum + hand.betCents, 0)
    + (snapshot.insurance.taken ? snapshot.insurance.betCents : 0);
  const displayBet = snapshot.roundState === ROUND_STATES.WAITING_FOR_BET
    ? betState.betCents
    : committed;
  $('bet-value').textContent = formatMoney(displayBet);
  $('shoe-count').textContent = t('round.cardsLeft', { count: snapshot.shoe.remaining });
}

function renderBetPanel(snapshot, betState) {
  const chipRow = $('chip-row');
  chipRow.textContent = '';
  chipRow.setAttribute('aria-label', t('a11y.betControls'));
  const budget = Math.min(snapshot.bankrollCents, betState.maxBetCents);
  for (const value of betState.chipValues) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.value = String(value);
    chip.textContent = String(value);
    chip.setAttribute('aria-label', t('bet.addChip', { value }));
    if (betState.betCents + value * 100 > budget) chip.disabled = true;
    chipRow.append(chip);
  }

  const bankrupt = snapshot.bankrollCents < betState.minBetCents;
  $('bet-prompt').textContent = bankrupt ? t('bet.bankrupt') : t('bet.placeYourBet');
  $('btn-deal').disabled = bankrupt
    || betState.betCents < betState.minBetCents
    || betState.betCents > budget;
  $('btn-clear').disabled = betState.betCents === 0;
  $('btn-rebet').disabled = !betState.canRebet;
  $('table-range').textContent = t('bet.tableRange', {
    min: formatMoney(betState.minBetCents),
    max: formatMoney(betState.maxBetCents),
  });
}

function renderDecisionPanel(snapshot) {
  const half = formatMoney(exactHalf(snapshot.hands[0].betCents));
  if (snapshot.pendingDecision === PENDING_DECISIONS.INSURANCE) {
    $('decision-question').textContent = t('insurance.question', { cost: half });
    $('btn-decision-yes').textContent = t('insurance.yes');
    $('btn-decision-no').textContent = t('insurance.no');
  } else {
    $('decision-question').textContent = t('earlySurrender.question', { half });
    $('btn-decision-yes').textContent = t('earlySurrender.yes');
    $('btn-decision-no').textContent = t('earlySurrender.no');
  }
}

function renderActionPanel(snapshot) {
  const availability = snapshot.actionAvailability;
  const surrenderSupported = snapshot.profileSurrender !== SURRENDER_MODES.NONE;
  for (const button of document.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    if (action === ACTIONS.SURRENDER && !surrenderSupported) {
      button.hidden = true;
      continue;
    }
    button.hidden = false;
    const { legal, reason } = availability[action];
    if (legal) {
      button.removeAttribute('aria-disabled');
      button.classList.remove('is-disabled');
      button.removeAttribute('title');
      button.removeAttribute('aria-description');
    } else {
      // aria-disabled keeps the button focusable so the reason is
      // discoverable by keyboard and screen-reader users.
      button.setAttribute('aria-disabled', 'true');
      button.classList.add('is-disabled');
      const reasonText = t(`reasons.${reason}`);
      button.title = reasonText;
      button.setAttribute('aria-description', reasonText);
    }
  }
}

function renderCompletePanel(snapshot) {
  const net = snapshot.roundSummary?.netCents ?? 0;
  let text;
  if (net > 0) text = t('results.netWin', { amount: formatMoney(net) });
  else if (net < 0) text = t('results.netLoss', { amount: `-${formatMoney(-net)}` });
  else text = t('results.netEven');
  $('round-net').textContent = text;
}

function renderMessage(snapshot) {
  const messageEl = $('table-message');
  switch (snapshot.roundState) {
    case ROUND_STATES.WAITING_FOR_BET:
      messageEl.textContent = t('bet.placeYourBet');
      break;
    case ROUND_STATES.PLAYER_TURN:
      messageEl.textContent = t('round.yourTurn');
      break;
    case ROUND_STATES.ROUND_COMPLETE:
      messageEl.textContent = buildResultHeadline(snapshot);
      break;
    default:
      messageEl.textContent = '';
  }
}

function buildResultHeadline(snapshot) {
  if (snapshot.dealer.isBlackjack) return t('results.dealerBlackjack');
  if (snapshot.hands.length === 1) {
    const hand = snapshot.hands[0];
    switch (hand.result) {
      case RESULTS.BLACKJACK_WIN:
        return t('results.blackjackPays', { amount: formatMoney(hand.payoutCents - hand.betCents) });
      case RESULTS.WIN:
        return snapshot.dealer.evaluation?.isBust
          ? `${t('results.dealerBusts')} ${t('results.youWin', { amount: formatMoney(hand.payoutCents - hand.betCents) })}`
          : t('results.youWin', { amount: formatMoney(hand.payoutCents - hand.betCents) });
      case RESULTS.LOSS:
        return t('results.youLose', { amount: formatMoney(hand.betCents) });
      case RESULTS.PUSH:
        return t('results.push');
      case RESULTS.SURRENDER:
        return t('results.surrenderKept', { amount: formatMoney(hand.payoutCents) });
      default:
        return '';
    }
  }
  const net = snapshot.roundSummary?.netCents ?? 0;
  if (net > 0) return t('results.netWin', { amount: formatMoney(net) });
  if (net < 0) return t('results.netLoss', { amount: `-${formatMoney(-net)}` });
  return t('results.netEven');
}

/**
 * @param {Array<{n: number, netCents: number, labels: string[]}>} entries
 */
export function renderHistory(entries) {
  const list = $('history-list');
  list.textContent = '';
  $('history-empty').hidden = entries.length > 0;
  for (const entry of [...entries].reverse()) {
    const item = document.createElement('li');
    item.className = 'history__item';
    const desc = document.createElement('span');
    desc.className = 'history__desc';
    desc.textContent = `${t('history.round', { n: entry.n })} · ${entry.labels.join(', ')}`;
    const net = document.createElement('span');
    net.className = 'history__net';
    if (entry.netCents > 0) {
      net.classList.add('history__net--win');
      net.textContent = `+${formatMoney(entry.netCents)}`;
    } else if (entry.netCents < 0) {
      net.classList.add('history__net--loss');
      net.textContent = `-${formatMoney(-entry.netCents)}`;
    } else {
      net.classList.add('history__net--even');
      net.textContent = '0';
    }
    item.append(desc, net);
    list.append(item);
  }
}

/**
 * Sidebar session summary.
 * @param {{rounds: number, netCents: number}} sessionState
 */
export function renderSession({ rounds, netCents }) {
  $('session-rounds').textContent = String(rounds);
  const netEl = $('session-net');
  netEl.classList.remove('session__net--win', 'session__net--loss');
  if (netCents > 0) {
    netEl.classList.add('session__net--win');
    netEl.textContent = `+${formatMoney(netCents)}`;
  } else if (netCents < 0) {
    netEl.classList.add('session__net--loss');
    netEl.textContent = `-${formatMoney(-netCents)}`;
  } else {
    netEl.textContent = formatMoney(0);
  }
}

let toastTimer = null;

/** @param {string} message */
export function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

/** @param {string} message - polite screen-reader announcement */
export function announce(message) {
  const region = $('live-region');
  // Clearing first guarantees repeated identical messages are re-read.
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = message; });
}
