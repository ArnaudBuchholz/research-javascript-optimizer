export function run(arr) {
  const result = [];
  for (const [index, item] of arr.entries()) {
    result.push(`${index}:${item}`);
  }
  return result;
}
