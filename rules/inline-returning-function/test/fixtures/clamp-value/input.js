// Canonical three-parameter function with multiple return branches.
// The return value is captured at each call site.

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function run(data, lo, hi) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    result.push(clamp(data[i], lo, hi));
  }
  return result;
}
