// Single-expression getter: the function body is one return statement.
// Used inside Array.reduce so the return value flows into the accumulator.

function score(entry) {
  return entry.hits * 10 - entry.misses * 3;
}

export function run(items) {
  return items.reduce((acc, item) => Math.max(acc, score(item)), 0);
}
