/**
 * Random-number sources for shuffling.
 * Normal play uses the browser/runtime cryptographic source.
 * Tests may inject any deterministic function returning [0, 1).
 */

/**
 * Cryptographically strong uniform float in [0, 1).
 * Falls back to Math.random only if no crypto source exists at all
 * (never the case in supported browsers or Node).
 * @returns {number}
 */
export function cryptoRandom() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    cryptoObj.getRandomValues(buf);
    return buf[0] / 4294967296; // 2^32
  }
  return Math.random();
}

/**
 * Deterministic RNG (mulberry32) for reproducible debug shuffles.
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
