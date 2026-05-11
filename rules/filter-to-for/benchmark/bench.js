import { bench, describe } from 'vitest';

const SIZE = 100_000;
// Dense array of integers; roughly half pass the predicate (even numbers)
const array = Array.from({ length: SIZE }, (_, i) => i + 1);

describe('filter-to-for', () => {
  bench('filter (original)', () => {
    const result = array.filter((item) => item % 2 === 0);
    // prevent dead-code elimination
    if (result[0] === 0) throw new Error('unreachable');
  });

  bench('for loop with push (optimized)', () => {
    const result = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i] % 2 === 0) {
        result.push(array[i]);
      }
    }
    // prevent dead-code elimination
    if (result[0] === 0) throw new Error('unreachable');
  });
});
