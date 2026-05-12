/**
 * Original: both callbacks have multi-statement bodies.
 * @param {Array<{score: number, name: string}>} array
 * @param {number} threshold
 * @returns {string[]}
 */
export function run(array, threshold) {
  return array
    .filter((item) => {
      const adjusted = item.score - threshold;
      return adjusted > 0;
    })
    .map((item) => {
      const label = item.name.trim().toLowerCase();
      return `${label}:${item.score}`;
    });
}
