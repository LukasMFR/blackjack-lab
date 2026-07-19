/**
 * Safe localStorage wrapper. Malformed or impossible values are discarded
 * instead of corrupting the game.
 */

const PREFIX = 'bjlab.';

function read(key) {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable (private mode, quota): preferences just do not persist */
  }
}

function remove(key) {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/**
 * Read a stored string constrained to an allowed set.
 * @param {string} key
 * @param {string[]} allowed
 * @param {string|null} fallback
 * @returns {string|null}
 */
export function getChoice(key, allowed, fallback = null) {
  const value = read(key);
  return value !== null && allowed.includes(value) ? value : fallback;
}

/** @param {string} key @param {string} value */
export function setChoice(key, value) {
  write(key, value);
}

/**
 * Read a stored non-negative safe integer (e.g. a bankroll in cents).
 * @param {string} key
 * @returns {number|null}
 */
export function getAmount(key) {
  const raw = read(key);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    remove(key);
    return null;
  }
  return value;
}

/** @param {string} key @param {number} value */
export function setAmount(key, value) {
  if (Number.isSafeInteger(value) && value >= 0) write(key, String(value));
}

/**
 * Read a stored JSON object (custom-profile settings). Returns null on
 * any parse problem and clears the bad entry.
 * @param {string} key
 * @returns {object|null}
 */
export function getObject(key) {
  const raw = read(key);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    remove(key);
    return null;
  }
}

/** @param {string} key @param {object} value */
export function setObject(key, value) {
  try {
    write(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** @param {string} key */
export function clear(key) {
  remove(key);
}

/** @returns {boolean} true when no preference has ever been stored */
export function isFirstVisit() {
  return read('language') === null;
}
