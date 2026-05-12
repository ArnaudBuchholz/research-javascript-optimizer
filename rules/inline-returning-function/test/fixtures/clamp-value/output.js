// Canonical three-parameter function with multiple return branches.
// The return value is captured at each call site.

export function run(data, lo, hi) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    const min = lo;
    const max = hi;
    let _result;
    {
      if (value < min) {
        _result = min;
      } else if (value > max) {
        _result = max;
      } else {
        _result = value;
      }
    }
    result.push(_result);
  }
  return result;
}
