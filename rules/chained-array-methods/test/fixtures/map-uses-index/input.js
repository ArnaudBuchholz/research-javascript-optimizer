/**
 * Original: map callback uses its `index` parameter.
 * The index here is relative to the *filtered* intermediate array, not the source array.
 * @param {Array<{active: boolean, name: string}>} array
 * @returns {string[]}
 */
export function run(array) {
  return array
    .filter((item) => item.active)
    .map((item, index) => `${index}: ${item.name}`);
}
