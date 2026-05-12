// Zero-parameter function that returns a computed value.
// The return value is captured as an element of the output array.

let counter = 0;

function nextId() {
  return ++counter;
}

export function run(n) {
  counter = 0;
  const ids = [];
  for (let i = 0; i < n; i++) {
    ids.push(nextId());
  }
  return ids;
}
