/**
 * Original: filter predicate rejects all elements.
 * @param {Array<{active: boolean, value: number}>} array
 * @returns {number[]}
 */
export function run(array) {
  const result = [];
  for (let i = 0; i < array.length; i++) {
    if (array[i].active) {
      result.push(array[i].value);
    }
  }
  return result;
}
