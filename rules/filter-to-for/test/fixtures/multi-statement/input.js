export function run(arr, threshold) {
  return arr.filter((item) => {
    const value = item * 2;
    return value > threshold;
  });
}
