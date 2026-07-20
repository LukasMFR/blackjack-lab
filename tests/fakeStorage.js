/**
 * A minimal in-memory localStorage so the persistence path is exercised for
 * real (storage.js reads globalThis.localStorage on every call).
 */

export const PREFIX = 'bjlab.';

/**
 * Install a fresh fake localStorage.
 * @param {Record<string, string>} initial - raw entries, keys already prefixed
 * @returns {Map<string, string>} the live backing store
 */
export function useFakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  return data;
}

/** Simulate a browser with storage disabled (private mode, blocked cookies). */
export function withoutStorage() {
  delete globalThis.localStorage;
}

/**
 * Install storage whose writes always fail, as when the quota is exhausted.
 * @returns {Map<string, string>}
 */
export function useFullStorage(initial = {}) {
  const data = useFakeStorage(initial);
  globalThis.localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  return data;
}
