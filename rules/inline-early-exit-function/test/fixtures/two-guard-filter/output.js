// Canonical two-guard early-exit pattern from the README.
// The function exits early if the item is inactive or below the score threshold;
// otherwise it appends the scaled value to the results array.

const THRESHOLD = 50;
const MULTIPLIER = 2.5;

let results = [];

export function run(data) {
  results = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    do {
      if (!item.active) break;
      if (item.score < THRESHOLD) break;
      results[results.length] = item.value * MULTIPLIER;
    } while (0);
  }
  return results.slice();
}
