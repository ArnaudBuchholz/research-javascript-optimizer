export function run(arr) {
  const result = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    result[i] = `${i}:${arr[i]}`;
  }
  return result;
}
