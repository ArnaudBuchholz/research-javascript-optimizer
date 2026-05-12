import { bench, describe } from 'vitest';

// Enough calls to amortise JIT warm-up and expose per-call overhead reliably.
const ITERATIONS = 10_000;

// --- Pattern 1: indexed arguments[i] loop vs rest parameter loop ---

function sumWithArguments() {
  let total = 0;
  for (let i = 0; i < arguments.length; i++) {
    total += arguments[i];
  }
  return total;
}

function sumWithRest(...args) {
  let total = 0;
  for (let i = 0; i < args.length; i++) {
    total += args[i];
  }
  return total;
}

describe('arguments-to-rest: indexed loop', () => {
  bench('arguments[i] loop (original)', () => {
    let result = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      result = sumWithArguments(i, i + 1, i + 2, i + 3, i + 4);
    }
    // prevent dead-code elimination
    if (result === 0) throw new Error('unreachable');
  });

  bench('rest[i] loop (optimized)', () => {
    let result = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      result = sumWithRest(i, i + 1, i + 2, i + 3, i + 4);
    }
    if (result === 0) throw new Error('unreachable');
  });
});

// --- Pattern 2: fn.apply(ctx, arguments) vs fn(...args) ---
// Both functions accept the same variadic numbers; the only difference is
// how they forward them — apply+arguments vs spread+rest.

function forwardWithApply() {
  return Math.max.apply(Math, arguments);
}

function forwardWithSpread(...args) {
  return Math.max(...args);
}

describe('arguments-to-rest: apply vs spread', () => {
  bench('apply(ctx, arguments) (original)', () => {
    let result = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      result = forwardWithApply(i, i + 1, i + 2, i + 3, i + 4);
    }
    if (result === 0) throw new Error('unreachable');
  });

  bench('spread ...args (optimized)', () => {
    let result = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      result = forwardWithSpread(i, i + 1, i + 2, i + 3, i + 4);
    }
    if (result === 0) throw new Error('unreachable');
  });
});

// --- Pattern 3: Array.prototype.slice.call(arguments, 1) vs args.slice(1) ---

function tailWithSliceCall() {
  return Array.prototype.slice.call(arguments, 1);
}

function tailWithRestSlice(...args) {
  return args.slice(1);
}

describe('arguments-to-rest: slice', () => {
  bench('Array.prototype.slice.call(arguments, 1) (original)', () => {
    let result;
    for (let i = 0; i < ITERATIONS; i++) {
      result = tailWithSliceCall(i, i + 1, i + 2, i + 3, i + 4);
    }
    // prevent dead-code elimination
    if (result === undefined) throw new Error('unreachable');
  });

  bench('args.slice(1) (optimized)', () => {
    let result;
    for (let i = 0; i < ITERATIONS; i++) {
      result = tailWithRestSlice(i, i + 1, i + 2, i + 3, i + 4);
    }
    if (result === undefined) throw new Error('unreachable');
  });
});
