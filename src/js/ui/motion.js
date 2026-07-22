import { formatMoney } from './format.js';

/**
 * Shared motion primitives for the enhanced animation mode: fx-layer chip
 * ghosts, card ghosts, FLIP moves, deal-flight staggering and money
 * count-ups. Used by both motion directors — ui/animations.js (solo table)
 * and multiplayer/ui/mpAnimations.js — which decide *when* to animate;
 * this module only knows *how*. Transform/opacity only, GPU-friendly.
 */

const $ = (id) => document.getElementById(id);

export const waapiSupported = typeof Element.prototype.animate === 'function';

const MAX_GHOSTS = 24;

const ghosts = new Set(); // live fx-layer elements
const counters = new Map(); // element -> requestAnimationFrame handle

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
export function clearGhosts() {
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
export function flyChip({ from, to, color = null, delayMs = 0, durationMs = 520 }) {
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
export function flyChips({ from, to, count, delayMs = 0, color = null }) {
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

/**
 * Ghost the given card elements sliding off toward the table's discard
 * side: the real cards vanish instantly with the next render, so their
 * ghosts finish the story.
 * @param {HTMLElement} tableEl - the felt whose left edge is the discard
 * @param {Element[]} cards - the rendered card elements to ghost
 */
export function ghostCardsToDiscard(tableEl, cards) {
  clearGhosts();
  const tableRect = tableEl.getBoundingClientRect();
  cards.slice(0, 14).forEach((card, index) => {
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

/* -------------------------------------------------------- money displays */

export function cancelCounters() {
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
export function animateMoney(el, fromCents, toCents, delayMs = 0) {
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

/* ------------------------------------------------------------ card moves */

/**
 * Capture the current rect of every card that carries a data-card-id.
 * @param {Iterable<Element>} cardEls
 * @returns {Map<string, DOMRect>} card id -> rect
 */
export function captureCardRects(cardEls) {
  const rects = new Map();
  for (const el of cardEls) {
    rects.set(el.dataset.cardId, el.getBoundingClientRect());
  }
  return rects;
}

/**
 * FLIP: cards that existed before the render and moved (a split spreading
 * a pair into two hands, a re-layout) glide from their old spot to the
 * new one instead of teleporting.
 * @param {Iterable<Element>} cardEls - the freshly rendered cards
 * @param {Map<string, DOMRect>|null} prevRects - from captureCardRects
 */
export function flipMovedCards(cardEls, prevRects) {
  if (!prevRects || prevRects.size === 0 || !waapiSupported) return;
  const moves = [];
  for (const el of cardEls) {
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
 * a stagger matching the card sounds, then release it (.card--fly).
 * @param {{tableEl: HTMLElement, freshEls: Element[],
 *   revealedEl?: Element|null, baseMs?: number, staggerMs: number}} options
 * @returns {number} the delay cursor after the last card, in ms
 */
export function staggerDealtCards({ tableEl, freshEls, revealedEl = null, baseMs = 0, staggerMs }) {
  let cursorMs = baseMs;

  if (revealedEl) {
    revealedEl.style.setProperty('--deal-delay', `${cursorMs}ms`);
    cursorMs += staggerMs;
  }
  if (freshEls.length === 0) return cursorMs;

  const tableRect = tableEl.getBoundingClientRect();
  const originX = tableRect.right - tableRect.width * 0.08;
  const originY = tableRect.top + Math.min(56, tableRect.height * 0.12);

  // Batch the reads, then the writes, so layout is computed once.
  const rects = freshEls.map((el) => el.getBoundingClientRect());
  freshEls.forEach((el, index) => {
    const rect = rects[index];
    el.style.setProperty('--deal-x', `${Math.round(originX - rect.left - rect.width / 2)}px`);
    el.style.setProperty('--deal-y', `${Math.round(originY - rect.top - rect.height / 2)}px`);
    el.style.setProperty('--deal-rot', `${index % 2 === 0 ? -7 : 6}deg`);
    el.style.setProperty('--deal-delay', `${cursorMs}ms`);
    el.classList.add(el.classList.contains('card--back') ? 'card--fly-flat' : 'card--fly');
    cursorMs += staggerMs;
  });
  return cursorMs;
}
