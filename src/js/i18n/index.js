import en from './en.js';
import fr from './fr.js';

/**
 * Tiny translation module. English is the product default; the browser
 * language is only a first-visit hint and the choice is persisted by the
 * caller (see ui/storage.js).
 */

const DICTIONARIES = { en, fr };

export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'fr']);
export const DEFAULT_LANGUAGE = 'en';

let current = DEFAULT_LANGUAGE;
const listeners = new Set();

function lookup(dictionary, path) {
  return path.split('.').reduce(
    (node, key) => (node && typeof node === 'object' ? node[key] : undefined),
    dictionary,
  );
}

/**
 * Translate a dot-separated key with {placeholder} interpolation.
 * Falls back to English, then to the key itself.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params = {}) {
  let value = lookup(DICTIONARIES[current], key);
  if (value === undefined) value = lookup(DICTIONARIES[DEFAULT_LANGUAGE], key);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (match, name) => (
    name in params ? String(params[name]) : match
  ));
}

/** @returns {string} active language code */
export function getLanguage() {
  return current;
}

/**
 * @param {string} language - a SUPPORTED_LANGUAGES code
 */
export function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) return;
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener(language);
}

/**
 * Suggest a language for a first visit: browser hint, else English.
 * @returns {string}
 */
export function detectLanguage() {
  const hint = (globalThis.navigator?.language ?? '').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGUAGES.includes(hint) ? hint : DEFAULT_LANGUAGE;
}

/**
 * @param {(language: string) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
