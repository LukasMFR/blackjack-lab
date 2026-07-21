import * as storage from './storage.js';

/**
 * Local preference for the optional basic-strategy hints. Disabled by
 * default: an absent or malformed entry always reads as false, so the
 * feature never switches itself on for an existing player.
 */

export const STRATEGY_HINTS_STORAGE_KEY = 'strategyHints';

/** @returns {boolean} whether the saved preference is enabled */
export function loadStrategyHintsPreference() {
  return storage.getChoice(STRATEGY_HINTS_STORAGE_KEY, ['true', 'false'], 'false') === 'true';
}

/** @param {boolean} enabled */
export function saveStrategyHintsPreference(enabled) {
  storage.setChoice(STRATEGY_HINTS_STORAGE_KEY, String(enabled === true));
}
