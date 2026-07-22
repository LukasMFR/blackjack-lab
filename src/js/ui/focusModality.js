/**
 * Input-modality tracking for focus rings.
 *
 * Browsers match `:focus-visible` on text fields however they were focused, and
 * on buttons whenever script moves focus — a dialog opening, focus returning to
 * the control that opened it. A click therefore draws the same ring a keyboard
 * user needs. Pointing at a control is already unambiguous feedback, so the
 * ring is noise there — but removing it outright would strand keyboard users.
 *
 * This module records how the user last interacted and exposes it as
 * `data-input-modality` on the root element. CSS collapses `--focus-ring-width`
 * to zero while the modality is `pointer`, retracting every ring in the app at
 * once; the very first focus-moving key press flips it back to `keyboard` and
 * the rings return.
 */

/**
 * Keys that move focus or activate a control. Printable characters are
 * deliberately excluded: typing inside a field the user just clicked must
 * not summon a ring around it.
 */
const FOCUS_KEYS = new Set([
  'Tab', 'Enter', 'Escape', ' ',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
]);

const MODALITY_ATTR = 'data-input-modality';

/**
 * Start tracking pointer versus keyboard interaction on the document.
 * Safe to call once per page; listeners are passive and capture-phase so
 * they observe every interaction regardless of stopPropagation upstream.
 * @param {Document} [doc] - injectable document for tests
 * @returns {void}
 */
export function initFocusModality(doc = document) {
  const set = (modality) => {
    doc.documentElement.setAttribute(MODALITY_ATTR, modality);
  };
  // Assume pointer until proven otherwise: a page nobody has touched yet
  // has no focus ring to hide.
  set('pointer');
  doc.addEventListener('pointerdown', () => set('pointer'), { capture: true, passive: true });
  doc.addEventListener('keydown', (event) => {
    if (FOCUS_KEYS.has(event.key)) set('keyboard');
  }, { capture: true, passive: true });
}
