export function run(arr) {
  return arr.map((item) => {
    const normalized = item.trim().toLowerCase();
    return normalized + '_suffix';
  });
}
