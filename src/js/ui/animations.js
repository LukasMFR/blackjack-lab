import { HAND_STATUS, RESULTS, ROUND_STATES } from '../game/constants.js';
import * as storage from './storage.js';
import {
  animateMoney, cancelCounters, captureCardRects, clearGhosts, flipMovedCards,
  flyChip, flyChips, ghostCardsToDiscard, staggerDealtCards, waapiSupported,
} from './motion.js';

/**
 * Motion director for the solo table. Reads engine snapshots and the
 * rendered DOM, never game internals: rule decisions stay in the engine,
 * drawing stays in render.js, and this module only decorates the rendered
 * result with GPU-friendly motion (the primitives live in motion.js).
 *
 * It also owns the animation-mode preference shared by every page
 * (persisted under "animations", resolved onto <html data-anim>):
 *   enhanced: full casino motion, card flights and flips, chip payouts,
 *              money count-ups, result glows — the default;
 *   classic: the original light CSS animations, untouched;
 *   off: non-essential motion neutralized (see animations.css).
 * The multiplayer room uses the same modes through its own director,
 * multiplayer/ui/mpAnimations.js.
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

const FX_BY_RESULT = {
  [RESULTS.WIN]: 'hand--fx-win',
  [RESULTS.BLACKJACK_WIN]: 'hand--fx-blackjack',
  [RESULTS.PUSH]: 'hand--fx-push',
  [RESULTS.SURRENDER]: 'hand--fx-push',
  [RESULTS.LOSS]: 'hand--fx-loss',
};

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let chosenMode = null; // the user's explicit choice, or null for the default
let prevSnapshot = null;
let prevRects = null; // card id -> DOMRect, captured just before a render
let pendingDealBaseMs = 0;
let shownBankrollCents = null;
let shownBetCents = null;

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

/**
 * Whether non-essential motion must be instant: animations are off, or the
 * system asks for reduced motion and the user never overrode it here. Mirrors
 * the data-motion-ok rule below, for motion that CSS cannot neutralize on its
 * own (a smooth window scroll, for instance).
 * @returns {boolean}
 */
export function isMotionSuppressed() {
  return getAnimationMode() === 'off' || (reduceQuery.matches && chosenMode === null);
}

function applyRootAttributes() {
  const root = document.documentElement;
  root.dataset.anim = getAnimationMode();
  // An explicit animated choice overrides the reduced-motion neutralizer
  // in base.css; the automatic default always respects it.
  root.toggleAttribute('data-motion-ok', chosenMode !== null && chosenMode !== 'off');
}

/**
 * Re-read the stored preference and resolve it onto <html>. Used by the
 * multiplayer page when another tab changes the preference.
 */
export function reloadAnimationPreference() {
  chosenMode = storage.getChoice(STORAGE_KEY, ANIMATION_MODES, null);
  applyRootAttributes();
}

/** Resolve the stored preference onto <html>. Call once at boot. */
export function initAnimations() {
  reloadAnimationPreference();
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

/* ----------------------------------------------------------- app hooks */

/** The Deal button was accepted: flights start after the chip-stack cue. */
export function dealStarted() {
  clearGhosts();
  pendingDealBaseMs = DEAL_BASE_DELAY_MS;
}

/**
 * Called before the engine clears the table for the next round: ghosts of
 * the rendered cards slide off toward the discard side.
 */
export function roundClearing() {
  if (getAnimationMode() !== 'enhanced') return;
  ghostCardsToDiscard($('table'), [...document.querySelectorAll('#table .card')]);
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

function cardEls() {
  return document.querySelectorAll('#dealer-cards [data-card-id], #player-hands [data-card-id]');
}

/**
 * Capture the pre-render world: card positions for FLIP moves, and any
 * running counters are settled so the render can write final values.
 * Call at the top of every full render.
 */
export function beforeRender() {
  cancelCounters();
  prevRects = null;
  if (getAnimationMode() !== 'enhanced') return;
  prevRects = captureCardRects(cardEls());
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
    flipMovedCards(cardEls(), prevRects);
    const cursorMs = staggerFreshCards();
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
 * Stagger the newly dealt cards in the same order as the card sounds:
 * player hands first, dealer after. The dealer's fresh hole card (no id,
 * face down) joins the initial deal.
 * @returns {number} the delay cursor after the last card, in ms
 */
function staggerFreshCards() {
  const fresh = [
    ...document.querySelectorAll('#player-hands .card.is-dealt'),
    ...document.querySelectorAll('#dealer-cards .card.is-dealt'),
  ];
  const holeCard = pendingDealBaseMs > 0
    ? document.querySelector('#dealer-cards .card--back')
    : null;
  if (holeCard) fresh.push(holeCard);
  return staggerDealtCards({
    tableEl: $('table'),
    freshEls: fresh,
    revealedEl: document.querySelector('#dealer-cards .card.is-revealed'),
    baseMs: pendingDealBaseMs,
    staggerMs: CARD_STAGGER_MS,
  });
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
