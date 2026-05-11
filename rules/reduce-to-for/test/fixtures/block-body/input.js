export function run(arr) {
  return arr.reduce((acc, item) => {
    const value = item.price * item.qty;
    return acc + value;
  }, 0);
}
