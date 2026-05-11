export function run(arr) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    result.push(item * 2);
  }
  return result;
}
