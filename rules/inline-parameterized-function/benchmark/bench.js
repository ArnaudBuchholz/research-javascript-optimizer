import { bench, describe } from 'vitest';

const N = 100_000;

// ─── shared inputs ────────────────────────────────────────────────────────────
const data = new Float64Array(N);
for (let i = 0; i < N; i++) {
  data[i] = (i % 256) * 0.39 + 1;
}
const SCALE = 1.5;
const THRESHOLD = 50.0;

// Shared output sink — same layout for both variants.
let out = new Float64Array(N);

// ─── original: three-parameter normalise-and-store helper ────────────────────
//
// This body is intentionally multi-statement so that its bytecode size is large
// enough to challenge TurboFan's auto-inlining heuristic when the surrounding
// loop is itself non-trivial.

function normalizeAndStore(value, scale, threshold) {
  const scaled = value * scale;
  const floored = Math.floor(scaled);
  const diff = scaled - floored;
  let result;
  if (diff < 0.25) {
    result = floored;
  } else if (diff < 0.75) {
    result = floored + 0.5;
  } else {
    result = floored + 1;
  }
  if (result > threshold) {
    result = threshold;
  }
  out[out.length] = result;
}

describe('inline-parameterized-function', () => {
  bench('function call (original)', () => {
    out = new Float64Array(N);
    let len = 0;
    for (let i = 0; i < N; i++) {
      normalizeAndStore(data[i], SCALE, THRESHOLD);
      len++;
    }
    if (len !== N) throw new Error('unreachable');
  });

  // ─── optimized: const bindings + inlined block ──────────────────────────────
  bench('inlined const bindings (optimized)', () => {
    out = new Float64Array(N);
    let len = 0;
    for (let i = 0; i < N; i++) {
      const value = data[i];
      const scale = SCALE;
      const threshold = THRESHOLD;
      {
        const scaled = value * scale;
        const floored = Math.floor(scaled);
        const diff = scaled - floored;
        let result;
        if (diff < 0.25) {
          result = floored;
        } else if (diff < 0.75) {
          result = floored + 0.5;
        } else {
          result = floored + 1;
        }
        if (result > threshold) {
          result = threshold;
        }
        out[len] = result;
      }
      len++;
    }
    if (len !== N) throw new Error('unreachable');
  });
});
