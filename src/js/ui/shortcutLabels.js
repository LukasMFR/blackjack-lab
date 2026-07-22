import * as storage from './storage.js';

/** Local preference and layout guard for optional shortcut suffixes. */

export const SHORTCUT_LABELS_STORAGE_KEY = 'shortcutLabels';
// A hovering, fine pointer is the closest available proxy for "this device has
// a keyboard". Viewport width is deliberately not part of it: the shortcuts
// work at every width, so gating on one would make the setting look broken in
// a narrow window.
export const SHORTCUT_LABELS_DESKTOP_QUERY = '(hover: hover) and (pointer: fine)';

/** @returns {boolean} whether the saved preference is enabled */
export function loadShortcutLabelsPreference() {
  return storage.getChoice(SHORTCUT_LABELS_STORAGE_KEY, ['true', 'false'], 'false') === 'true';
}

/** @param {boolean} enabled */
export function saveShortcutLabelsPreference(enabled) {
  storage.setChoice(SHORTCUT_LABELS_STORAGE_KEY, String(enabled === true));
}

/**
 * The preference can affect labels only in the desktop pointer layout.
 * @param {boolean} enabled
 * @param {boolean} desktopLayoutMatches
 */
export function shouldShowShortcutLabels(enabled, desktopLayoutMatches) {
  return enabled === true && desktopLayoutMatches === true;
}

/**
 * The visible suffix for a shortcut key, or '' when none should appear.
 * Kept apart from the translated label so callers can render it as decorative
 * text: assistive technology already announces the key from aria-keyshortcuts,
 * and folding it into the accessible name would say it twice.
 * @param {string} shortcutKey
 * @param {boolean} visible
 * @returns {string}
 */
export function shortcutSuffix(shortcutKey, visible) {
  if (!visible || !shortcutKey) return '';
  return ` (${shortcutKey.toUpperCase()})`;
}

/**
 * Write a translated label, appending the shortcut key as decorative text.
 * The suffix is aria-hidden so it stays visible without entering the
 * accessible name: aria-keyshortcuts already carries the key for assistive
 * technology, and having both announces it twice.
 * @param {HTMLElement} element
 * @param {string} label
 * @param {string} shortcutKey
 * @param {boolean} visible
 */
export function applyShortcutLabel(element, label, shortcutKey, visible) {
  // Assigning textContent first also clears any suffix left by a prior render.
  element.textContent = label;
  const suffix = shortcutSuffix(shortcutKey, visible);
  if (!suffix) return;
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.textContent = suffix;
  element.append(span);
}
