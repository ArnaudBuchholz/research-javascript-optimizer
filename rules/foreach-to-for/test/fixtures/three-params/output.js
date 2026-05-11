export function run(arr) {
  const seenArrays = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const index = i;
    const srcArray = arr;
    seenArrays.push(srcArray === arr);
  }
  return seenArrays;
}
