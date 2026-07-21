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
 * Append a visible key without changing the translated base label.
 * @param {string} label
 * @param {string} shortcutKey
 * @param {boolean} visible
 */
export function formatShortcutLabel(label, shortcutKey, visible) {
  if (!visible || !shortcutKey) return label;
  return `${label} (${shortcutKey.toUpperCase()})`;
}
