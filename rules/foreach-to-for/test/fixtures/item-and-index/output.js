export function run(arr) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const index = i;
    result.push(`${index}:${item}`);
  }
  return result;
}
