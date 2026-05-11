import { bench, describe } from 'vitest';

const SIZE = 100_000;
const numbers = Array.from({ length: SIZE }, (_, i) => i + 1);
const objects = Array.from({ length: SIZE }, (_, i) => ({ price: i + 1, qty: 2 }));

describe('reduce-to-for: numeric sum', () => {
  bench('reduce (original)', () => {
    const sum = numbers.reduce((acc, item) => acc + item, 0);
    // prevent dead-code elimination
    if (sum === 0) throw new Error('unreachable');
  });

  bench('for loop (optimized)', () => {
    let sum = 0;
    for (let i = 0; i < numbers.length; i++) {
      sum = sum + numbers[i];
    }
    if (sum === 0) throw new Error('unreachable');
  });
});

describe('reduce-to-for: object accumulation', () => {
  bench('reduce (original)', () => {
    const total = objects.reduce((acc, item) => {
      const value = item.price * item.qty;
      return acc + value;
    }, 0);
    if (total === 0) throw new Error('unreachable');
  });

  bench('for loop (optimized)', () => {
    let total = 0;
    for (let i = 0; i < objects.length; i++) {
      const item = objects[i];
      const value = item.price * item.qty;
      total = total + value;
    }
    if (total === 0) throw new Error('unreachable');
  });
});
