export function run(arr) {
  let acc = 0;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const value = item.price * item.qty;
    acc = acc + value;
  }
  return acc;
}
