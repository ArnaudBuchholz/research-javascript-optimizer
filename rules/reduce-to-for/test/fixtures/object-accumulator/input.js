export function run(arr) {
  return arr.reduce((acc, item) => {
    acc[item.key] = item.value;
    return acc;
  }, {});
}
