import { test, expect } from 'vitest';
import { run as inputSingle } from './fixtures/single-stmt/input.js';
import { run as outputSingle } from './fixtures/single-stmt/output.js';
import { run as inputMulti } from './fixtures/multi-stmt/input.js';
import { run as outputMulti } from './fixtures/multi-stmt/output.js';
import { run as inputNested } from './fixtures/nested-call/input.js';
import { run as outputNested } from './fixtures/nested-call/output.js';
import { run as inputScoping } from './fixtures/let-const-scoping/input.js';
import { run as outputScoping } from './fixtures/let-const-scoping/output.js';

// single-stmt: counter incremented once per iteration
test('single-stmt: inlined counter matches original', () => {
  expect(outputSingle(10)).toBe(inputSingle(10));
});

test('single-stmt: zero iterations', () => {
  expect(outputSingle(0)).toBe(0);
  expect(outputSingle(0)).toBe(inputSingle(0));
});

test('single-stmt: counter equals iteration count', () => {
  expect(outputSingle(100)).toBe(100);
});

// multi-stmt: each element sees a fresh set of counters
test('multi-stmt: snapshots match original for positive data', () => {
  const data = [1, 2, 3, -1, 5];
  expect(outputMulti(data)).toEqual(inputMulti(data));
});

test('multi-stmt: reset happens before each element', () => {
  const data = [1, -1, 1];
  const result = outputMulti(data);
  // every snapshot should show exactly one hit or miss (reset between each)
  for (const snap of result) {
    expect(snap.hits + snap.misses).toBe(1);
    expect(snap.total).toBe(1);
  }
});

test('multi-stmt: empty array yields no snapshots', () => {
  expect(outputMulti([])).toEqual([]);
  expect(outputMulti([])).toEqual(inputMulti([]));
});

test('multi-stmt: all-negative data', () => {
  const data = [-1, -2, -3];
  expect(outputMulti(data)).toEqual(inputMulti(data));
});

// nested-call: function inlined inside forEach callback
test('nested-call: per-item results match original', () => {
  expect(outputNested([1, 5, 8])).toEqual(inputNested([1, 5, 8]));
});

test('nested-call: done flag triggers at threshold', () => {
  const result = outputNested([1, 5, 8]);
  // 1 → count=1 (not done), 5 → count=5 (not done), 8 → count=8 (not done)
  expect(result[0].done).toBe(false);
  expect(result[1].done).toBe(false);
  expect(result[2].done).toBe(false);
});

test('nested-call: done flag triggers when count exceeds 10', () => {
  const result = outputNested([11]);
  expect(result[0].done).toBe(true);
  expect(result[0]).toEqual(inputNested([11])[0]);
});

test('nested-call: empty items array', () => {
  expect(outputNested([])).toEqual([]);
  expect(outputNested([])).toEqual(inputNested([]));
});

// let-const-scoping: local let/const declarations are block-scoped, do not leak
test('let-const-scoping: accumulator matches original for 10 iterations', () => {
  expect(outputScoping(10)).toBe(inputScoping(10));
});

test('let-const-scoping: accumulator equals iterations * 20', () => {
  // batch=10, bonus=20 per call; 5 iterations → 100
  expect(outputScoping(5)).toBe(100);
});

test('let-const-scoping: zero iterations yield 0', () => {
  expect(outputScoping(0)).toBe(0);
  expect(outputScoping(0)).toBe(inputScoping(0));
});
