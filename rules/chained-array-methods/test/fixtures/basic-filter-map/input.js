/**
 * Original: .filter().map() chain with simple arrow expressions.
 * @param {Array<{active: boolean, value: number}>} array
 * @returns {number[]}
 */
export function run(array) {
  return array.filter((item) => item.active).map((item) => item.value * 10);
}
