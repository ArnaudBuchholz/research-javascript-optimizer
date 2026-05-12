import { bench, describe } from 'vitest';

const N = 100_000;

// ─── shared inputs ────────────────────────────────────────────────────────────
const data = new Float64Array(N);
const LOWER = 0.0;
const UPPER = 100.0;
for (let i = 0; i < N; i++) {
  // values spread across [-10, 110] so roughly 10% are below LOWER, 10% above UPPER
  data[i] = (i % 120) - 10;
}

// ─── original: three-parameter clamp function that returns a value ────────────
//
// The body has two early-return branches plus a fall-through return, making its
// bytecode large enough that TurboFan may not inline it automatically when the
// enclosing loop is itself non-trivial.

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

describe('inline-returning-function', () => {
  bench('function call (original)', () => {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += clamp(data[i], LOWER, UPPER);
    }
    // prevent dead-code elimination
    if (sum < 0) throw new Error('unreachable');
  });

  // ─── optimized: const bindings for arguments + let _result + inlined block ───
  //
  // Each call is replaced by:
  //   const value = data[i]; const min = LOWER; const max = UPPER;
  //   let _result;
  //   { if (value < min) { _result = min; } else if (value > max) { _result = max; } else { _result = value; } }
  //   sum += _result;
  //
  // No new activation record is pushed; _result lives in the caller's register file.

  bench('inlined _result binding (optimized)', () => {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const value = data[i];
      const min = LOWER;
      const max = UPPER;
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
      sum += _result;
    }
    if (sum < 0) throw new Error('unreachable');
  });
});
