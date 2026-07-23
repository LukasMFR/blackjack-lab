/**
 * Bringing the felt back into view when a new round starts.
 *
 * Below the desktop breakpoint the layout is a single column: the table sits
 * at the top of the page and the controls stick to the bottom of the
 * viewport. A player who scrolled down to read the history or the profile
 * card therefore still sees the Deal button, but not the table it deals to.
 * Pressing Deal scrolls the window back up to the felt.
 *
 * The behaviour is gated on geometry rather than on a media query: it acts
 * only when the page is genuinely scrolled past the top of the table, so the
 * desktop shell (a 100dvh column that never scrolls) is left alone without
 * needing to know the breakpoint. Scrolling is upward only — a round never
 * pushes the player further down the page.
 *
 * Motion only. Nothing here moves focus or changes the DOM, so keyboard
 * position, the focus ring and screen-reader context survive the scroll.
 */

/** Breathing room left above the table once it is back in view. */
const TOP_GAP_PX = 12;

/** Shifts smaller than this are not worth moving the viewport for. */
const MIN_SHIFT_PX = 24;

/**
 * Where the window should land so the top edge of the table is visible
 * again. Pure geometry, expressed in the window's own scroll coordinates.
 *
 * @param {{scrollY: number, tableTop: number, maxScrollY: number}} view -
 *   the current vertical scroll offset, the table's top edge in viewport
 *   coordinates, and the furthest the document can be scrolled
 * @returns {number|null} the target offset, or null when no upward move is
 *   wanted: the table's top is already on screen, or the correction would be
 *   too small to be worth animating
 */
export function scrollTargetY({ scrollY, tableTop, maxScrollY }) {
  if (![scrollY, tableTop, maxScrollY].every(Number.isFinite)) return null;
  const limit = Math.max(0, maxScrollY);
  const target = Math.min(Math.max(scrollY + tableTop - TOP_GAP_PX, 0), limit);
  if (scrollY - target < MIN_SHIFT_PX) return null;
  return target;
}

/**
 * Scroll the window up until the given table is in view, if it is not
 * already. The transition is the browser's own smooth scroll — short,
 * native, and interruptible by the player's next touch — unless motion is
 * suppressed, in which case the same correction is applied instantly so the
 * behaviour is preserved without the movement.
 *
 * @param {Element|null} tableEl - the table section to bring into view
 * @param {{instant?: boolean, win?: Window}} [options] - instant skips the
 *   animation (reduced motion); win is injectable for tests
 * @returns {number|null} the offset scrolled to, or null when nothing moved
 */
export function scrollTableIntoView(tableEl, { instant = false, win = window } = {}) {
  if (!tableEl || typeof win?.scrollTo !== 'function') return null;
  const scroller = win.document?.scrollingElement ?? win.document?.documentElement;
  const target = scrollTargetY({
    scrollY: win.scrollY,
    tableTop: tableEl.getBoundingClientRect().top,
    maxScrollY: (scroller?.scrollHeight ?? 0) - win.innerHeight,
  });
  if (target === null) return null;
  win.scrollTo({
    top: target,
    left: win.scrollX,
    behavior: instant ? 'auto' : 'smooth',
  });
  return target;
}
