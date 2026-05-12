import { bench, describe } from 'vitest';

const SIZE = 100_000;

// Dense array of objects: roughly half will pass the filter (even values)
const array = Array.from({ length: SIZE }, (_, i) => ({ id: i, value: i * 2, active: i % 2 === 0 }));

describe('chained-array-methods', () => {
  bench('filter().map() chain (original)', () => {
    const result = array.filter((item) => item.active).map((item) => item.value);
    // prevent dead-code elimination
    if (result.length === 0) throw new Error('unreachable');
  });

  bench('fused for loop (optimized)', () => {
    const result = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i].active) {
        result.push(array[i].value);
      }
    }
    if (result.length === 0) throw new Error('unreachable');
  });

  // Second scenario: high filter ratio (most elements pass) to exercise the map allocation path
  bench('filter().map() high-pass chain (original)', () => {
    const result = array.filter((item) => item.id >= 0).map((item) => item.value * 3);
    if (result.length === 0) throw new Error('unreachable');
  });

  bench('fused for loop high-pass (optimized)', () => {
    const result = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i].id >= 0) {
        result.push(array[i].value * 3);
      }
    }
    if (result.length === 0) throw new Error('unreachable');
  });
});
