export function run(arr) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(`${i}:${arr[i]}`);
  }
  return result;
}
