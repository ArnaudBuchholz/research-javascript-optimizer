import { bench, describe } from 'vitest';

const SIZE = 100_000;
const array = Array.from({ length: SIZE }, (_, i) => i + 1);

describe('foreach-to-for', () => {
  bench('forEach (original)', () => {
    let sum = 0;
    array.forEach((item) => {
      sum += item;
    });
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
