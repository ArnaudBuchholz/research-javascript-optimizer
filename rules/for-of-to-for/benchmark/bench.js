import { bench, describe } from 'vitest';

const SIZE = 100_000;
const array = Array.from({ length: SIZE }, (_, i) => i + 1);

describe('for-of-to-for: simple value iteration', () => {
  bench('for...of (original)', () => {
    let sum = 0;
    for (const item of array) {
      sum += item;
    }
    // prevent dead-code elimination
    if (sum === 0) throw new Error('unreachable');
  });

  bench('for loop (optimized)', () => {
    let sum = 0;
    for (let i = 0; i < array.length; i++) {
      sum += array[i];
    }
    if (sum === 0) throw new Error('unreachable');
  });
});

describe('for-of-to-for: entries() iteration', () => {
  bench('for...of with entries() (original)', () => {
    let sum = 0;
    for (const [index, item] of array.entries()) {
      sum += item + index;
    }
    if (sum === 0) throw new Error('unreachable');
  });

  bench('for loop replacing entries() (optimized)', () => {
    let sum = 0;
    for (let i = 0; i < array.length; i++) {
      sum += array[i] + i;
    }
    if (sum === 0) throw new Error('unreachable');
  });
});
