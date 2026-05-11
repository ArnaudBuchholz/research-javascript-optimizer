export function run(arr) {
  return arr.reduce((acc, item, index) => acc + item * index, 0);
}
