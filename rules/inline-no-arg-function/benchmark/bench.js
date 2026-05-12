import { bench, describe } from 'vitest';

const ITERATIONS = 100_000;

// shared state mutated by both variants — same layout, same values
let hits = 0;
let misses = 0;
let total = 0;

function initCounters() {
  hits = 0;
  misses = 0;
  total = 0;
}

describe('inline-no-arg-function', () => {
  bench('function call (original)', () => {
    for (let i = 0; i < ITERATIONS; i++) {
      initCounters();
      // simulate work so the loop body is non-trivial and is not elided
      if (i % 2 === 0) {
        hits++;
      } else {
        misses++;
      }
      total++;
    }
    // prevent dead-code elimination
    if (total === 0) throw new Error('unreachable');
  });

  bench('inlined block (optimized)', () => {
    for (let i = 0; i < ITERATIONS; i++) {
      {
        hits = 0;
        misses = 0;
        total = 0;
      }
      // same simulated work
      if (i % 2 === 0) {
        hits++;
      } else {
        misses++;
      }
      total++;
    }
    if (total === 0) throw new Error('unreachable');
  });
});
