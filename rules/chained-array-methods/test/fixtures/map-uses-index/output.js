/**
 * Original: map callback uses its `index` parameter.
 * The index here is relative to the *filtered* intermediate array, not the source array.
 * @param {Array<{active: boolean, name: string}>} array
 * @returns {string[]}
 */
export function run(array) {
  const result = [];
  let mappedIndex = 0;
  for (let i = 0; i < array.length; i++) {
    if (array[i].active) {
      result.push(`${mappedIndex}: ${array[i].name}`);
      mappedIndex++;
    }
  }
  return result;
}
