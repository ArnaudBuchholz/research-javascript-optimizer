// Body declares `let`/`const` locals — they are block-scoped and do not escape the inlined block
let accumulator = 0;

function addBatch() {
  const batch = 10;
  let bonus = batch * 2;
  accumulator += bonus;
}

export function run(iterations) {
  accumulator = 0;
  for (let i = 0; i < iterations; i++) {
    addBatch();
  }
  return accumulator;
}
