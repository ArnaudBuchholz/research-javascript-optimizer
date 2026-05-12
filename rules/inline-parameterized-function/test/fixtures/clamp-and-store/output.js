// Three-parameter helper with a multi-statement body and a local variable.
// This is the canonical case targeted by the rule.

let results = [];

export function run(data, lo, hi) {
  results = [];
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    const min = lo;
    const max = hi;
    {
      let clamped;
      if (value < min) {
        clamped = min;
      } else if (value > max) {
        clamped = max;
      } else {
        clamped = value;
      }
      results[results.length] = clamped;
    }
  }
  return results.slice();
}
