import { bench, describe } from 'vitest';

const SIZE = 50_000;
const a = Array.from({ length: SIZE }, (_, i) => i + 1);
const b = Array.from({ length: SIZE }, (_, i) => i + SIZE + 1);

describe('array-spread-concat (two arrays)', () => {
  bench('spread [...a, ...b] (original)', () => {
    const result = [...a, ...b];
    // prevent dead-code elimination
    if (result[0] === 0) throw new Error('unreachable');
  });

  bench('a.concat(b) (optimized)', () => {
    const result = a.concat(b);
    if (result[0] === 0) throw new Error('unreachable');
  });

  bench('pre-sized loop (optimized-hot-path)', () => {
    const result = new Array(a.length + b.length);
    for (let i = 0; i < a.length; i++) result[i] = a[i];
    for (let i = 0; i < b.length; i++) result[a.length + i] = b[i];
    if (result[0] === 0) throw new Error('unreachable');
  });
});
