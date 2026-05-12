// Two calls to value-returning functions in the same loop iteration.
// Both return values are consumed in the same expression.

function double(x) {
  return x * 2;
}

function negate(x) {
  return -x;
}

export function run(data) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    result.push(double(data[i]) + negate(data[i]));
  }
  return result;
}
