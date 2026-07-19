import { t } from '../i18n/index.js';

/**
 * Playing-card rendering. Self-contained HTML/CSS cards: corner indices,
 * true pip layouts for number cards, framed letters for court cards.
 * Rank letters are localized (A J Q K / A V D R); suits use standard
 * symbols in every language.
 */

const SUIT_SYMBOLS = {
  SPADES: '♠',
  HEARTS: '♥',
  DIAMONDS: '♦',
  CLUBS: '♣',
};

const RED_SUITS = new Set(['HEARTS', 'DIAMONDS']);

/**
 * Pip positions per rank: [x%, y%, inverted]. Lower-half pips are
 * rotated 180 degrees like a printed card.
 */
const PIP_LAYOUTS = {
  A: [[50, 50, false]],
  2: [[50, 22, false], [50, 78, true]],
  3: [[50, 20, false], [50, 50, false], [50, 80, true]],
  4: [[31, 24, false], [69, 24, false], [31, 76, true], [69, 76, true]],
  5: [[31, 24, false], [69, 24, false], [50, 50, false], [31, 76, true], [69, 76, true]],
  6: [[31, 24, false], [69, 24, false], [31, 50, false], [69, 50, false], [31, 76, true], [69, 76, true]],
  7: [[31, 22, false], [69, 22, false], [50, 36, false], [31, 50, false], [69, 50, false], [31, 78, true], [69, 78, true]],
  8: [[31, 22, false], [69, 22, false], [50, 36, false], [31, 50, false], [69, 50, false], [50, 64, true], [31, 78, true], [69, 78, true]],
  9: [[31, 20, false], [69, 20, false], [31, 41, false], [69, 41, false], [50, 50, false], [31, 59, true], [69, 59, true], [31, 80, true], [69, 80, true]],
  10: [[31, 19, false], [69, 19, false], [50, 30, false], [31, 42, false], [69, 42, false], [31, 58, true], [69, 58, true], [50, 70, true], [31, 81, true], [69, 81, true]],
};

const COURT_RANKS = new Set(['J', 'Q', 'K']);

/**
 * Accessible name for a card, e.g. "Queen of hearts" / "Dame de cœur".
 * @param {{rank: string, suit: string}} card
 * @returns {string}
 */
export function cardLabel(card) {
  return t('a11y.card', {
    rank: t(`rankNames.${card.rank}`),
    suit: t(`suits.${card.suit}`),
  });
}

/**
 * Build a DOM element for a card (or a face-down card).
 * @param {{rank?: string, suit?: string, id?: string, hidden?: boolean}} card
 * @returns {HTMLElement}
 */
export function createCardElement(card) {
  const el = document.createElement('div');
  if (card.hidden) {
    el.className = 'card card--back';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', t('a11y.hiddenCard'));
    return el;
  }

  const color = RED_SUITS.has(card.suit) ? 'red' : 'black';
  el.className = `card card--${color}`;
  el.dataset.cardId = card.id ?? `${card.rank}:${card.suit}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', cardLabel(card));

  const rankText = t(`ranks.${card.rank}`) === `ranks.${card.rank}`
    ? card.rank
    : t(`ranks.${card.rank}`);
  const suitSymbol = SUIT_SYMBOLS[card.suit];

  for (const corner of ['tl', 'br']) {
    const cornerEl = document.createElement('span');
    cornerEl.className = `card__corner card__corner--${corner}`;
    cornerEl.setAttribute('aria-hidden', 'true');
    const rankEl = document.createElement('span');
    rankEl.className = 'card__corner-rank';
    rankEl.textContent = rankText;
    const suitEl = document.createElement('span');
    suitEl.className = 'card__corner-suit';
    suitEl.textContent = suitSymbol;
    cornerEl.append(rankEl, suitEl);
    el.append(cornerEl);
  }

  const body = document.createElement('span');
  body.className = 'card__body';
  body.setAttribute('aria-hidden', 'true');

  if (COURT_RANKS.has(card.rank)) {
    body.classList.add('card__body--court');
    const frame = document.createElement('span');
    frame.className = 'card__court-frame';
    const letter = document.createElement('span');
    letter.className = 'card__court-letter';
    letter.textContent = rankText;
    const suitEl = document.createElement('span');
    suitEl.className = 'card__court-suit';
    suitEl.textContent = suitSymbol;
    frame.append(letter, suitEl);
    body.append(frame);
  } else {
    const layout = PIP_LAYOUTS[card.rank] ?? [];
    for (const [x, y, inverted] of layout) {
      const pip = document.createElement('span');
      pip.className = `card__pip${inverted ? ' card__pip--inverted' : ''}`;
      if (card.rank === 'A') pip.classList.add('card__pip--ace');
      pip.style.left = `${x}%`;
      pip.style.top = `${y}%`;
      pip.textContent = suitSymbol;
      body.append(pip);
    }
  }

  el.append(body);
  return el;
}
