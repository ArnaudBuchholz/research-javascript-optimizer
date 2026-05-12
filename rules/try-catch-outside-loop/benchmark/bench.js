import { bench, describe } from 'vitest';

const SIZE = 100_000;
// Dense array of numbers — no element will throw, so we measure only
// the structural cost of having try/catch inside vs outside the loop.
const array = Array.from({ length: SIZE }, (_, i) => i + 1);

describe('try-catch-outside-loop', () => {
  bench('try/catch inside loop (original)', () => {
    let sum = 0;
    for (let i = 0; i < array.length; i++) {
      try {
        sum += array[i];
      } catch (e) {
        // never reached — cost is purely structural
      }
    }
    // prevent dead-code elimination
    if (sum === 0) throw new Error('unreachable');
  });

  bench('try/catch outside loop (optimized)', () => {
    let sum = 0;
    try {
      for (let i = 0; i < array.length; i++) {
        sum += array[i];
      }
    } catch (e) {
      // never reached
    }
    if (sum === 0) throw new Error('unreachable');
  });
});
