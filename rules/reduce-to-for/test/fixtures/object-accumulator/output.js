export function run(arr) {
  const acc = {};
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    acc[item.key] = item.value;
  }
  return acc;
}
