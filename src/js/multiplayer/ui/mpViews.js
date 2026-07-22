import { t } from '../../i18n/index.js';
import { formatMoney } from '../../ui/format.js';
import { createCardElement } from '../../ui/cardView.js';
import { HAND_STATUS, RESULTS } from '../../game/constants.js';

/**
 * DOM rendering for the multiplayer room. Renders only confirmed host
 * snapshots (payloads built by hostSession.buildSnapshot); no game
 * decision is ever made here.
 */

const $ = (id) => document.getElementById(id);

const RESULT_BADGE_CLASS = {
  [RESULTS.WIN]: 'win',
  [RESULTS.BLACKJACK_WIN]: 'blackjack',
  [RESULTS.LOSS]: 'loss',
  [RESULTS.PUSH]: 'push',
  [RESULTS.SURRENDER]: 'push',
};

/**
 * Lobby / sidebar player list: one avatar row per player with role tags
 * (host, you) and a textual connection/ready state.
 * @param {object[]} players
 * @param {string|null} localPlayerId
 */
export function renderPlayerList(players, localPlayerId) {
  const list = $('mp-player-list');
  list.textContent = '';
  for (const player of players) {
    const item = document.createElement('li');
    item.className = 'mp-player';
    if (player.playerId === localPlayerId) item.classList.add('mp-player--me');
    if (!player.connected) item.classList.add('mp-player--disconnected');

    const avatar = document.createElement('span');
    avatar.className = 'mp-player__avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = Array.from(player.name.trim())[0]?.toLocaleUpperCase() ?? '?';
    const dot = document.createElement('span');
    dot.className = `mp-player__dot${player.connected ? ' mp-player__dot--connected' : ''}`;
    avatar.append(dot);

    const body = document.createElement('span');
    body.className = 'mp-player__body';
    const name = document.createElement('span');
    name.className = 'mp-player__name';
    name.textContent = player.name;
    body.append(name);
    const tags = [];
    if (player.isHost) tags.push(tag(t('mp.status.host'), 'mp-player__tag--host'));
    if (player.playerId === localPlayerId) tags.push(tag(t('mp.status.you')));
    if (tags.length > 0) {
      const tagRow = document.createElement('span');
      tagRow.className = 'mp-player__tags';
      tagRow.append(...tags);
      body.append(tagRow);
    }
    item.append(avatar, body);

    // The state pill restates the dot in words, so color never works alone.
    if (!player.connected) {
      item.append(statePill(t('mp.status.disconnected'), 'mp-player__state--off'));
    } else if (player.ready) {
      item.append(statePill(t('mp.status.ready'), 'mp-player__state--ready'));
    } else {
      const srState = document.createElement('span');
      srState.className = 'sr-only';
      srState.textContent = t('mp.status.connected');
      item.append(srState);
    }
    list.append(item);
  }
}

function tag(text, modifier = '') {
  const el = document.createElement('span');
  el.className = `mp-player__tag${modifier ? ` ${modifier}` : ''}`;
  el.textContent = text;
  return el;
}

function statePill(text, modifier) {
  const el = document.createElement('span');
  el.className = `mp-player__state ${modifier}`;
  el.textContent = text;
  return el;
}

/**
 * Render the dealer area and every seat from a table snapshot.
 * @param {object} table - MultiplayerTable snapshot
 * @param {{localPlayerId: string|null, seenCardIds: Set<string>,
 *   prevHoleHidden: {value: boolean}}} ctx
 */
export function renderMpTable(table, ctx) {
  const dealerCardsEl = $('mp-dealer-cards');
  dealerCardsEl.textContent = '';
  dealerCardsEl.setAttribute('role', 'group');
  dealerCardsEl.setAttribute('aria-label', t('a11y.dealerHand'));
  table.dealer.cards.forEach((card, index) => {
    const el = createCardElement(card);
    if (!card.hidden) {
      if (index === 1 && ctx.prevHoleHidden.value && !table.dealer.holeCardHidden) {
        el.classList.add('is-revealed');
      } else if (!ctx.seenCardIds.has(card.id)) {
        el.classList.add('is-dealt');
      }
      ctx.seenCardIds.add(card.id);
    }
    dealerCardsEl.append(el);
  });
  ctx.prevHoleHidden.value = table.dealer.holeCardHidden;

  const dealerTotal = $('mp-dealer-total');
  if (table.dealer.cards.length > 0 && table.dealer.evaluation) {
    dealerTotal.hidden = false;
    dealerTotal.textContent = table.dealer.isBlackjack
      ? t('hand.blackjack')
      : String(table.dealer.evaluation.total);
  } else {
    dealerTotal.hidden = true;
  }

  const seatsEl = $('mp-seats');
  seatsEl.textContent = '';
  for (const seat of table.seats) {
    seatsEl.append(buildSeatElement(seat, table, ctx));
  }
}

function buildSeatElement(seat, table, ctx) {
  const el = document.createElement('div');
  el.className = 'mp-seat';
  if (seat.isActive) el.classList.add('mp-seat--active');
  if (seat.playerId === ctx.localPlayerId) el.classList.add('mp-seat--me');
  if (!seat.connected) el.classList.add('mp-seat--disconnected');

  const head = document.createElement('div');
  head.className = 'mp-seat__head';
  const name = document.createElement('span');
  name.className = 'mp-seat__name';
  name.textContent = seat.playerId === ctx.localPlayerId
    ? `${seat.name} (${t('mp.status.you')})`
    : seat.name;
  const meta = document.createElement('span');
  meta.className = 'mp-seat__meta';
  meta.textContent = `${t('bet.bankroll')} ${formatMoney(seat.bankrollCents)}`;
  head.append(name, meta);
  el.append(head);

  const status = document.createElement('span');
  status.className = 'mp-seat__status';
  status.textContent = seatStatusText(seat, table);
  if (status.textContent) el.append(status);

  if (seat.hands.length > 0) {
    const handsEl = document.createElement('div');
    handsEl.className = 'mp-seat__hands';
    seat.hands.forEach((hand, index) => {
      handsEl.append(buildHandElement(hand, index, seat, ctx));
    });
    el.append(handsEl);
  }
  return el;
}

function seatStatusText(seat, table) {
  if (!seat.connected) return t('mp.status.disconnected');
  if (table.state === 'BETTING') {
    if (seat.betCents > 0) {
      const bet = t('hand.bet', { amount: formatMoney(seat.betCents) });
      return seat.ready ? `${bet} · ${t('mp.status.ready')}` : bet;
    }
    return t('mp.table.noBetYet');
  }
  if (seat.sittingOut) return t('mp.table.sittingOut');
  if (seat.pendingDecision) return t('mp.table.deciding');
  if (seat.isActive) return t('mp.table.playing');
  if (seat.roundNetCents !== null && seat.roundNetCents !== undefined) {
    if (seat.roundNetCents > 0) return `+${formatMoney(seat.roundNetCents)}`;
    if (seat.roundNetCents < 0) return `-${formatMoney(-seat.roundNetCents)}`;
    return t('results.PUSH');
  }
  return '';
}

function buildHandElement(hand, index, seat, ctx) {
  const el = document.createElement('div');
  el.className = 'hand';
  if (hand.isActive) el.classList.add('hand--active');
  if (hand.status === HAND_STATUS.BUST) el.classList.add('hand--bust');
  if (hand.result) el.classList.add(`hand--result-${RESULT_BADGE_CLASS[hand.result]}`);

  const cardsEl = document.createElement('div');
  cardsEl.className = 'cards';
  cardsEl.setAttribute('role', 'group');
  cardsEl.setAttribute('aria-label', seat.hands.length > 1
    ? `${seat.name}, ${t('hand.handN', { n: index + 1 })}`
    : seat.name);
  for (const card of hand.cards) {
    const cardEl = createCardElement(card);
    if (!ctx.seenCardIds.has(card.id)) cardEl.classList.add('is-dealt');
    ctx.seenCardIds.add(card.id);
    cardsEl.append(cardEl);
  }

  const meta = document.createElement('div');
  meta.className = 'hand__meta';
  const totalEl = document.createElement('span');
  totalEl.className = 'hand-total';
  totalEl.textContent = hand.evaluation.isSoft && !hand.evaluation.isBust
    ? `${hand.evaluation.total - 10}/${hand.evaluation.total}`
    : String(hand.evaluation.total);
  const betEl = document.createElement('span');
  betEl.className = 'hand__bet';
  betEl.textContent = t('hand.bet', { amount: formatMoney(hand.betCents) });
  meta.append(totalEl, betEl);
  const statusEl = buildHandStatus(hand);
  if (statusEl) meta.append(statusEl);

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
 * The local player's recent results from the synced history.
 * @param {object[]} history - [{round, summaries}]
 * @param {string|null} localPlayerId
 */
export function renderMpHistory(history, localPlayerId) {
  const list = $('mp-history-list');
  list.textContent = '';
  const entries = history
    .filter((entry) => entry.summaries?.[localPlayerId])
    .map((entry) => ({ round: entry.round, ...entry.summaries[localPlayerId] }));
  $('mp-history-empty').hidden = entries.length > 0;
  for (const entry of [...entries].reverse()) {
    const item = document.createElement('li');
    item.className = 'history__item';
    const desc = document.createElement('span');
    desc.className = 'history__desc';
    const labels = entry.results.map((r) => t(`results.${r}`))
      .concat(entry.insurance ? [t('history.insurance')] : []);
    desc.textContent = `${t('history.round', { n: entry.round })} · ${labels.join(', ')}`;
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
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = message; });
}
