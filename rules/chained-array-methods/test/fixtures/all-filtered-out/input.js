/**
 * Original: filter predicate rejects all elements.
 * @param {Array<{active: boolean, value: number}>} array
 * @returns {number[]}
 */
export function run(array) {
  return array.filter((item) => item.active).map((item) => item.value);
}
