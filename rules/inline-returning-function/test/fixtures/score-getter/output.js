// Single-expression getter: the function body is one return statement.
// Used inside Array.reduce so the return value flows into the accumulator.

export function run(items) {
  return items.reduce((acc, item) => {
    const entry = item;
    let _result;
    {
      _result = entry.hits * 10 - entry.misses * 3;
    }
    return Math.max(acc, _result);
  }, 0);
}
