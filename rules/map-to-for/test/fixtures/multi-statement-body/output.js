export function run(arr) {
  const result = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const normalized = item.trim().toLowerCase();
    result[i] = normalized + '_suffix';
  }
  return result;
}
