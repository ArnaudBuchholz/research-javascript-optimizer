// Zero-parameter function that returns a computed value.
// The return value is captured as an element of the output array.

let counter = 0;

export function run(n) {
  counter = 0;
  const ids = [];
  for (let i = 0; i < n; i++) {
    let _result;
    {
      _result = ++counter;
    }
    ids.push(_result);
  }
  return ids;
}
