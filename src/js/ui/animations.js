import { HAND_STATUS, RESULTS, ROUND_STATES } from '../game/constants.js';
import { formatMoney } from './format.js';
import * as storage from './storage.js';

/**
 * Motion director for the table. Reads engine snapshots and the rendered
 * DOM, never game internals: rule decisions stay in the engine, drawing
 * stays in render.js, and this module only decorates the rendered result
 * with GPU-friendly motion (transforms and opacity).
 *
 * Modes (persisted under "animations", resolved onto <html data-anim>):
 *   enhanced: full casino motion, card flights and flips, chip payouts,
 *              money count-ups, result glows;
 *   classic: the original light CSS animations, untouched;
 *   off: non-essential motion neutralized (see animations.css).
 *
 * Users who ask their system for reduced motion default to classic, which
 * the global reduced-motion rule keeps instant; an explicit non-off choice
 * sets data-motion-ok on <html>, which re-enables motion for them.
 *
 * Card and result delays mirror audio/gameAudio.js so every flight lands
 * on its sound. Nothing here ever blocks or delays a legal action: the
 * engine state and the controls always update immediately.
 */

const $ = (id) => document.getElementById(id);

export const ANIMATION_MODES = ['enhanced', 'classic', 'off'];

const STORAGE_KEY = 'animations';

/* Keep in sync with CARD_STAGGER_SEC / RESULT_EXTRA_DELAY_SEC and the
   dealer-bust pause in audio/gameAudio.js. */
const CARD_STAGGER_MS = 140;
const RESULT_EXTRA_DELAY_MS = 450;
const DEALER_BUST_EXTRA_MS = 250;
/* Matches the baseDelay app.js passes to roundTransition on the deal. */
const DEAL_BASE_DELAY_MS = 250;

const MAX_GHOSTS = 24;

const FX_BY_RESULT = {
  [RESULTS.WIN]: 'hand--fx-win',
  [RESULTS.BLACKJACK_WIN]: 'hand--fx-blackjack',
  [RESULTS.PUSH]: 'hand--fx-push',
  [RESULTS.SURRENDER]: 'hand--fx-push',
  [RESULTS.LOSS]: 'hand--fx-loss',
};

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const waapiSupported = typeof Element.prototype.animate === 'function';

let chosenMode = null; // the user's explicit choice, or null for the default
let prevSnapshot = null;
let prevRects = null; // card id -> DOMRect, captured just before a render
let pendingDealBaseMs = 0;
let shownBankrollCents = null;
let shownBetCents = null;
const counters = new Map(); // element -> requestAnimationFrame handle
const ghosts = new Set(); // live fx-layer elements

/* ----------------------------------------------------------------- mode */

function defaultMode() {
  return reduceQuery.matches ? 'classic' : 'enhanced';
}

/** @returns {'enhanced'|'classic'|'off'} the mode currently in force */
export function getAnimationMode() {
  const mode = chosenMode ?? defaultMode();
  // Without the Web Animations API the enhanced mode cannot run its
  // JS-driven flights, so it degrades to classic as a whole.
  return mode === 'enhanced' && !waapiSupported ? 'classic' : mode;
}

/** @returns {boolean} */
export function isReducedMotionPreferred() {
  return reduceQuery.matches;
}

function applyRootAttributes() {
  const root = document.documentElement;
  root.dataset.anim = getAnimationMode();
  // An explicit animated choice overrides the reduced-motion neutralizer
  // in base.css; the automatic default always respects it.
  root.toggleAttribute('data-motion-ok', chosenMode !== null && chosenMode !== 'off');
}

/** Resolve the stored preference onto <html>. Call once at boot. */
export function initAnimations() {
  chosenMode = storage.getChoice(STORAGE_KEY, ANIMATION_MODES, null);
  applyRootAttributes();
  reduceQuery.addEventListener('change', applyRootAttributes);
}

/** @param {'enhanced'|'classic'|'off'} mode - explicit user choice */
export function setAnimationMode(mode) {
  if (!ANIMATION_MODES.includes(mode)) return;
  chosenMode = mode;
  storage.setChoice(STORAGE_KEY, mode);
  clearGhosts();
  cancelCounters();
  applyRootAttributes();
}

/* ------------------------------------------------------------- fx layer */

function layer() {
  return $('fx-layer');
}

function track(el, animation) {
  ghosts.add(el);
  const done = () => {
    ghosts.delete(el);
    el.remove();
  };
  animation.onfinish = done;
  animation.oncancel = done;
}

/** Cancel and remove every in-flight ghost (stale-animation guard). */
function clearGhosts() {
  for (const el of [...ghosts]) {
    for (const animation of el.getAnimations()) animation.cancel();
    el.remove();
    ghosts.delete(el);
  }
}

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Fly one chip ghost between two rects. The chip fades in, arcs, then is
 * absorbed at the destination. Transform/opacity only.
 * @param {{from: DOMRect, to: DOMRect, color?: string|null,
 *   delayMs?: number, durationMs?: number}} options
 */
function flyChip({ from, to, color = null, delayMs = 0, durationMs = 520 }) {
  if (!waapiSupported || ghosts.size >= MAX_GHOSTS) return;
  const el = document.createElement('span');
  el.className = 'fx-chip';
  if (color) el.style.setProperty('--chip-color', color);
  layer().append(el);
  const a = center(from);
  const b = center(to);
  const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 36 };
  const at = (p, scale, opacity) => ({
    transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${scale})`,
    opacity,
  });
  const animation = el.animate([
    { ...at(a, 0.85, 0) },
    { ...at(a, 1, 1), offset: 0.12 },
    { ...at(mid, 1.04, 1), offset: 0.55 },
    { ...at(b, 0.7, 1), offset: 0.88 },
    { ...at(b, 0.45, 0) },
  ], {
    duration: durationMs,
    delay: delayMs,
    easing: 'cubic-bezier(0.3, 0.1, 0.25, 1)',
    fill: 'backwards',
  });
  track(el, animation);
}

/** A small staggered stack of chip ghosts. @see flyChip */
function flyChips({ from, to, count, delayMs = 0, color = null }) {
  for (let i = 0; i < count; i += 1) {
    const jitter = (i % 2 === 0 ? 1 : -1) * 5 * i;
    flyChip({
      from,
      to: DOMRect.fromRect({
        x: to.x + jitter, y: to.y, width: to.width, height: to.height,
      }),
      color,
      delayMs: delayMs + i * 70,
    });
  }
}

/* -------------------------------------------------------- money displays */

function cancelCounters() {
  for (const handle of counters.values()) cancelAnimationFrame(handle);
  counters.clear();
}

function bump(el) {
  el.classList.remove('stat__value--bump');
  void el.offsetWidth; // restart the pulse even on rapid repeats
  el.classList.add('stat__value--bump');
}

/**
 * Count a money display from its previous value to the one already
 * rendered. Rounded to whole units mid-flight; exact at the end.
 * @param {HTMLElement} el
 * @param {number|null} fromCents
 * @param {number} toCents
 * @param {number} delayMs
 */
function animateMoney(el, fromCents, toCents, delayMs = 0) {
  if (fromCents === null || fromCents === toCents) return;
  const durationMs = 560;
  const startAt = performance.now() + delayMs;
  el.textContent = formatMoney(fromCents);
  const step = (now) => {
    if (now >= startAt) {
      const p = Math.min(1, (now - startAt) / durationMs);
      const eased = 1 - (1 - p) ** 3;
      if (p >= 1) {
        el.textContent = formatMoney(toCents);
        counters.delete(el);
        bump(el);
        return;
      }
      const value = fromCents + (toCents - fromCents) * eased;
      el.textContent = formatMoney(Math.round(value / 100) * 100);
    }
    counters.set(el, requestAnimationFrame(step));
  };
  counters.set(el, requestAnimationFrame(step));
}

/* ----------------------------------------------------------- app hooks */

/** The Deal button was accepted: flights start after the chip-stack cue. */
export function dealStarted() {
  clearGhosts();
  pendingDealBaseMs = DEAL_BASE_DELAY_MS;
}

/**
 * Called before the engine clears the table for the next round: the real
 * cards vanish instantly with the re-render, so ghosts of them slide off
 * toward the discard side to finish the story.
 */
export function roundClearing() {
  if (getAnimationMode() !== 'enhanced') return;
  clearGhosts();
  const tableRect = $('table').getBoundingClientRect();
  const cards = [...document.querySelectorAll('#table .card')].slice(0, 14);
  cards.forEach((card, index) => {
    if (ghosts.size >= MAX_GHOSTS) return;
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.remove('is-dealt', 'is-revealed', 'card--fly', 'card--fly-flat');
    ghost.removeAttribute('role');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    layer().append(ghost);
    const animation = ghost.animate([
      { transform: `translate(${rect.left}px, ${rect.top}px)`, opacity: 1 },
      {
        transform: `translate(${tableRect.left - rect.width * 1.3}px, ${rect.top - 14}px) rotate(-9deg)`,
        opacity: 0,
      },
    ], {
      duration: 360,
      delay: index * 28,
      easing: 'cubic-bezier(0.45, 0, 0.85, 0.55)',
      fill: 'backwards',
    });
    track(ghost, animation);
  });
}

/** A bet chip was pressed: it flies from the rack to the bet display. */
export function chipAdded(chipEl) {
  if (getAnimationMode() !== 'enhanced') return;
  flyChip({
    from: chipEl.getBoundingClientRect(),
    to: $('bet-value').getBoundingClientRect(),
    color: getComputedStyle(chipEl).getPropertyValue('--chip-color').trim() || null,
    durationMs: 440,
  });
}

/** The composed bet was cleared: chips return to the rack. */
export function betCleared() {
  if (getAnimationMode() !== 'enhanced') return;
  flyChips({
    from: $('bet-value').getBoundingClientRect(),
    to: $('chip-row').getBoundingClientRect(),
    count: 2,
  });
}

/** "Same bet" restores the previous wager in one motion. */
export function rebet(sourceEl) {
  if (getAnimationMode() !== 'enhanced') return;
  flyChip({
    from: sourceEl.getBoundingClientRect(),
    to: $('bet-value').getBoundingClientRect(),
    durationMs: 440,
  });
}

/* ---------------------------------------------------------- render hooks */

/**
 * Capture the pre-render world: card positions for FLIP moves, and any
 * running counters are settled so the render can write final values.
 * Call at the top of every full render.
 */
export function beforeRender() {
  cancelCounters();
  prevRects = null;
  if (getAnimationMode() !== 'enhanced') return;
  prevRects = new Map();
  const cards = document.querySelectorAll('#dealer-cards [data-card-id], #player-hands [data-card-id]');
  for (const el of cards) {
    prevRects.set(el.dataset.cardId, el.getBoundingClientRect());
  }
}

/**
 * Decorate the freshly rendered table: FLIP cards that moved (splits,
 * re-layout), fly new cards in from the shoe, and play the transition
 * effects derived from the snapshot diff. Runs synchronously after the
 * render, before the browser paints, so nothing ever flashes.
 * @param {object} snapshot - engine snapshot just rendered
 * @param {{betCents: number}} betView - bet-panel state used by the render
 */
export function afterRender(snapshot, betView) {
  const before = prevSnapshot;
  prevSnapshot = snapshot;

  // One-shot classes on persistent nodes must reset on every render.
  $('dealer-cards').classList.remove('cards--fx-dealer-bust');

  const betTarget = displayedBetCents(snapshot, betView);
  if (getAnimationMode() === 'enhanced') {
    flipMovedCards();
    const cursorMs = staggerDealtCards();
    playTransitionEffects(snapshot, before, cursorMs, betTarget);
  }

  shownBankrollCents = snapshot.bankrollCents;
  shownBetCents = betTarget;
  prevRects = null;
  pendingDealBaseMs = 0;
}

/** Mirror of renderStatusStrip's display logic for the bet stat. */
function displayedBetCents(snapshot, betView) {
  if (snapshot.roundState === ROUND_STATES.WAITING_FOR_BET) return betView.betCents;
  return snapshot.hands.reduce((sum, hand) => sum + hand.betCents, 0)
    + (snapshot.insurance.taken ? snapshot.insurance.betCents : 0);
}

/**
 * FLIP: cards that existed before the render and moved (a split spreading
 * a pair into two hands, a re-layout) glide from their old spot to the
 * new one instead of teleporting.
 */
function flipMovedCards() {
  if (!prevRects || prevRects.size === 0 || !waapiSupported) return;
  const moves = [];
  const cards = document.querySelectorAll('#dealer-cards [data-card-id], #player-hands [data-card-id]');
  for (const el of cards) {
    const old = prevRects.get(el.dataset.cardId);
    if (!old) continue;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    const scale = now.width > 0 ? old.width / now.width : 1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) continue;
    moves.push({ el, dx, dy, scale });
  }
  for (const { el, dx, dy, scale } of moves) {
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' },
    ], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }
}

/**
 * Give every newly dealt card its flight vector from the shoe corner and
 * a stagger that matches the card sounds, then release it (.card--fly).
 * @returns {number} the delay cursor after the last card, in ms
 */
function staggerDealtCards() {
  let cursorMs = pendingDealBaseMs;

  const revealed = document.querySelector('#dealer-cards .card.is-revealed');
  if (revealed) {
    revealed.style.setProperty('--deal-delay', `${cursorMs}ms`);
    cursorMs += CARD_STAGGER_MS;
  }

  // Same order as the card sounds: player hands first, dealer after. The
  // dealer's fresh hole card (no id, face down) joins the initial deal.
  const fresh = [
    ...document.querySelectorAll('#player-hands .card.is-dealt'),
    ...document.querySelectorAll('#dealer-cards .card.is-dealt'),
  ];
  const holeCard = pendingDealBaseMs > 0
    ? document.querySelector('#dealer-cards .card--back')
    : null;
  if (holeCard) fresh.push(holeCard);
  if (fresh.length === 0) return cursorMs;

  const tableRect = $('table').getBoundingClientRect();
  const originX = tableRect.right - tableRect.width * 0.08;
  const originY = tableRect.top + Math.min(56, tableRect.height * 0.12);

  // Batch the reads, then the writes, so layout is computed once.
  const rects = fresh.map((el) => el.getBoundingClientRect());
  fresh.forEach((el, index) => {
    const rect = rects[index];
    el.style.setProperty('--deal-x', `${Math.round(originX - rect.left - rect.width / 2)}px`);
    el.style.setProperty('--deal-y', `${Math.round(originY - rect.top - rect.height / 2)}px`);
    el.style.setProperty('--deal-rot', `${index % 2 === 0 ? -7 : 6}deg`);
    el.style.setProperty('--deal-delay', `${cursorMs}ms`);
    el.classList.add(el.classList.contains('card--back') ? 'card--fly-flat' : 'card--fly');
    cursorMs += CARD_STAGGER_MS;
  });
  return cursorMs;
}

/**
 * Everything derived from the before/after snapshot diff: committed-wager
 * flights (double, split, insurance), bust dims, result glows, payout and
 * returned-bet flights, and the money count-ups.
 */
function playTransitionEffects(snapshot, before, cursorMs, betTarget) {
  const handEls = [...document.querySelectorAll('#player-hands .hand')];
  const dealerCardsEl = $('dealer-cards');
  const dealerRect = dealerCardsEl.getBoundingClientRect();
  const bankrollEl = $('bankroll-value');
  const bankrollRect = bankrollEl.getBoundingClientRect();

  const completedNow = before !== null
    && snapshot.roundState === ROUND_STATES.ROUND_COMPLETE
    && before.roundState !== ROUND_STATES.ROUND_COMPLETE;
  const dealerBusted = snapshot.dealer.evaluation?.isBust === true;
  const resultDelayMs = completedNow
    ? cursorMs + (dealerBusted ? DEALER_BUST_EXTRA_MS : 0) + RESULT_EXTRA_DELAY_MS
    : null;

  // Wagers committed since the last render: double, split, insurance.
  if (before) {
    snapshot.hands.forEach((hand, index) => {
      const el = handEls[index];
      if (!el) return;
      const prev = before.hands.find((h) => h.id === hand.id);
      if (prev && hand.doubled && !prev.doubled) {
        flyChips({ from: bankrollRect, to: el.getBoundingClientRect(), count: 2 });
      } else if (!prev && hand.fromSplit) {
        flyChips({ from: bankrollRect, to: el.getBoundingClientRect(), count: 2 });
      }
    });
    if (snapshot.insurance.taken && !before.insurance.taken) {
      flyChip({ from: bankrollRect, to: $('bet-value').getBoundingClientRect() });
    }
  }

  // Hands that just busted dim in place and are collected by the dealer.
  snapshot.hands.forEach((hand, index) => {
    const el = handEls[index];
    if (!el) return;
    const prev = before?.hands.find((h) => h.id === hand.id);
    const newlyBusted = hand.status === HAND_STATUS.BUST
      && (!prev || prev.status !== HAND_STATUS.BUST);
    if (!newlyBusted) return;
    const delayMs = resultDelayMs ?? cursorMs;
    el.style.setProperty('--result-delay', `${delayMs}ms`);
    el.classList.add('hand--fx-bust');
    flyChips({
      from: el.getBoundingClientRect(), to: dealerRect, count: 2, delayMs: delayMs + 180,
    });
  });

  if (completedNow) {
    if (dealerBusted) {
      dealerCardsEl.style.setProperty('--result-delay', `${cursorMs}ms`);
      dealerCardsEl.classList.add('cards--fx-dealer-bust');
    }
    snapshot.hands.forEach((hand, index) => {
      const el = handEls[index];
      if (!el) return;
      if (hand.status === HAND_STATUS.BUST) return; // collected when it busted
      el.style.setProperty('--result-delay', `${resultDelayMs}ms`);
      const fx = FX_BY_RESULT[hand.result];
      if (fx) el.classList.add(fx);
      const handRect = el.getBoundingClientRect();
      switch (hand.result) {
        case RESULTS.BLACKJACK_WIN:
          flyChips({ from: handRect, to: bankrollRect, count: 4, delayMs: resultDelayMs });
          break;
        case RESULTS.WIN:
          flyChips({ from: handRect, to: bankrollRect, count: 3, delayMs: resultDelayMs });
          break;
        case RESULTS.PUSH:
          flyChip({ from: handRect, to: bankrollRect, delayMs: resultDelayMs });
          break;
        case RESULTS.SURRENDER:
          flyChip({ from: handRect, to: bankrollRect, delayMs: resultDelayMs });
          flyChip({ from: handRect, to: dealerRect, delayMs: resultDelayMs });
          break;
        case RESULTS.LOSS:
          flyChips({ from: handRect, to: dealerRect, count: 2, delayMs: resultDelayMs });
          break;
        default:
          break;
      }
    });
    if (snapshot.insurance.taken && snapshot.insurance.result === RESULTS.WIN) {
      flyChips({ from: dealerRect, to: bankrollRect, count: 2, delayMs: resultDelayMs });
    }
  }

  // Money displays count toward their rendered values; a payout waits for
  // its chips, a debit reacts immediately.
  const bankrollGain = shownBankrollCents !== null
    && snapshot.bankrollCents > shownBankrollCents;
  animateMoney(bankrollEl, shownBankrollCents, snapshot.bankrollCents,
    completedNow && bankrollGain ? resultDelayMs : 0);
  animateMoney($('bet-value'), shownBetCents, betTarget, 0);
}
