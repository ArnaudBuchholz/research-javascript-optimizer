// Returns the first item greater than the threshold, or undefined.
export function run(arr, threshold) {
  for (const item of arr) {
    if (item > threshold) return item;
  }
  return undefined;
}
