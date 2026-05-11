export function run(arr) {
  const seenArrays = [];
  arr.forEach((item, index, srcArray) => {
    seenArrays.push(srcArray === arr);
  });
  return seenArrays;
}
