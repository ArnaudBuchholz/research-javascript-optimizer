export function run(arr) {
  let acc = 0;
  for (let i = 0; i < arr.length; i++) {
    acc = acc + arr[i] * i;
  }
  return acc;
}
