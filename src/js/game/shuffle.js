/**
 * Fisher–Yates shuffle. Pure with respect to the injected RNG:
 * returns a new array, never mutates the input.
 * @template T
 * @param {T[]} items
 * @param {() => number} random - function returning uniform floats in [0, 1)
 * @returns {T[]} a new shuffled array
 */
export function fisherYatesShuffle(items, random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
