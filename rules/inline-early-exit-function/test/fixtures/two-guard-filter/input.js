// Canonical two-guard early-exit pattern from the README.
// The function exits early if the item is inactive or below the score threshold;
// otherwise it appends the scaled value to the results array.

const THRESHOLD = 50;
const MULTIPLIER = 2.5;

function processItem(item) {
  if (!item.active) return;
  if (item.score < THRESHOLD) return;
  results[results.length] = item.value * MULTIPLIER;
}

let results = [];

export function run(data) {
  results = [];
  for (let i = 0; i < data.length; i++) {
    processItem(data[i]);
  }
  return results.slice();
}
