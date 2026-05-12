// Two-parameter helper that mutates a module-level accumulator.
// No local variables — body is a single statement.

let total = 0;

export function run(xs, ys) {
  total = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i];
    const b = ys[i];
    {
      total += a * 0.7 + b * 0.3;
    }
  }
  return total;
}
