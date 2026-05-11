export function run(arr, threshold) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const value = item * 2;
    if (value > threshold) {
      result.push(item);
    }
  }
  return result;
}
