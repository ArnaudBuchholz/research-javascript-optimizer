export function run(arr) {
  const result = [];
  arr.forEach((item, index) => {
    result.push(`${index}:${item}`);
  });
  return result;
}
