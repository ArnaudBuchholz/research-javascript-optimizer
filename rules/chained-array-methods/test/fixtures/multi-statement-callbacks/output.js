/**
 * Original: both callbacks have multi-statement bodies.
 * @param {Array<{score: number, name: string}>} array
 * @param {number} threshold
 * @returns {string[]}
 */
export function run(array, threshold) {
  const result = [];
  for (let i = 0; i < array.length; i++) {
    const item = array[i];
    const adjusted = item.score - threshold;
    if (adjusted > 0) {
      const label = item.name.trim().toLowerCase();
      result.push(`${label}:${item.score}`);
    }
  }
  return result;
}
