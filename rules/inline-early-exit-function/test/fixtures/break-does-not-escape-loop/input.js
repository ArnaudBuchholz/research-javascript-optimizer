// Verifies that a `break` inside the inlined `do {} while (0)` exits only that
// block and does not break out of the enclosing `for` loop. This is the key
// semantic invariant: the outer loop must continue iterating after the early exit.

const THRESHOLD = 0;

function maybeAppend(item, out) {
  if (item < THRESHOLD) return;
  out[out.length] = item;
}

export function run(data) {
  const out = [];
  for (let i = 0; i < data.length; i++) {
    maybeAppend(data[i], out);
  }
  // The element *after* a negative item must still be processed.
  return out;
}
