import { bench, describe } from 'vitest';

const SIZE = 100_000;
const array = Array.from({ length: SIZE }, (_, i) => i + 1);

describe('map-to-for', () => {
  bench('map (original)', () => {
    const result = array.map((item) => item * 2);
    // prevent dead-code elimination
    if (result[0] === 0) throw new Error('unreachable');
  });

  bench('for loop with pre-allocated array (optimized)', () => {
    const result = new Array(array.length);
    for (let i = 0; i < array.length; i++) {
      result[i] = array[i] * 2;
    }
    if (result[0] === 0) throw new Error('unreachable');
  });
});
