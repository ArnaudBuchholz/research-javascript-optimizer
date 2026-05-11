// Returns the first item greater than the threshold, or undefined.
export function run(arr, threshold) {
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (item > threshold) return item;
  }
  return undefined;
}
