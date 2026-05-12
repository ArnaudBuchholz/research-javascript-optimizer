import { bench, describe } from 'vitest';

const SIZE = 10_000;
// Build a plain object with SIZE own enumerable string keys
const obj = {};
for (let i = 0; i < SIZE; i++) {
  obj[`key${i}`] = i;
}

describe('object-keys-foreach', () => {
  bench('Object.keys().forEach (original)', () => {
    let sum = 0;
    Object.keys(obj).forEach((key) => {
      sum += obj[key];
    });
    // prevent dead-code elimination
    if (sum === 0) throw new Error('unreachable');
  });

  bench('for...in with hasOwnProperty guard (optimized)', () => {
    let sum = 0;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        sum += obj[key];
      }
    }
    if (sum === 0) throw new Error('unreachable');
  });
});
