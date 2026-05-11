import { test, expect } from 'vitest';
import { run as inputSum } from './fixtures/sum-numbers/input.js';
import { run as outputSum } from './fixtures/sum-numbers/output.js';
import { run as inputBlock } from './fixtures/block-body/input.js';
import { run as outputBlock } from './fixtures/block-body/output.js';
import { run as inputIndex } from './fixtures/index-parameter/input.js';
import { run as outputIndex } from './fixtures/index-parameter/output.js';
import { run as inputObj } from './fixtures/object-accumulator/input.js';
import { run as outputObj } from './fixtures/object-accumulator/output.js';

const NUMBERS = [3, 1, 4, 1, 5, 9, 2, 6];
const ITEMS = [
  { price: 10, qty: 2 },
  { price: 5, qty: 4 },
  { price: 8, qty: 1 },
];
const KV_PAIRS = [
  { key: 'a', value: 1 },
  { key: 'b', value: 2 },
  { key: 'c', value: 3 },
];

// sum-numbers fixtures

test('sum-numbers: for loop produces the same sum as reduce', () => {
  expect(outputSum(NUMBERS)).toBe(inputSum(NUMBERS));
});

test('sum-numbers: empty array returns the initial value 0', () => {
  expect(outputSum([])).toBe(0);
  expect(outputSum([])).toBe(inputSum([]));
});

test('sum-numbers: single element returns that element', () => {
  expect(outputSum([42])).toBe(42);
  expect(outputSum([42])).toBe(inputSum([42]));
});

test('sum-numbers: negative numbers', () => {
  const arr = [-1, -2, -3];
  expect(outputSum(arr)).toBe(inputSum(arr));
});

// block-body fixtures

test('block-body: for loop produces the same total as reduce', () => {
  expect(outputBlock(ITEMS)).toBe(inputBlock(ITEMS));
});

test('block-body: empty array returns 0', () => {
  expect(outputBlock([])).toBe(0);
  expect(outputBlock([])).toBe(inputBlock([]));
});

test('block-body: single item', () => {
  const arr = [{ price: 7, qty: 3 }];
  expect(outputBlock(arr)).toBe(inputBlock(arr));
});

// index-parameter fixtures

test('index-parameter: for loop produces the same weighted sum as reduce', () => {
  expect(outputIndex(NUMBERS)).toBe(inputIndex(NUMBERS));
});

test('index-parameter: index 0 contributes 0 regardless of value', () => {
  // first element * index 0 = 0, so removing it changes the sum by nothing
  const arr = [99, 1, 1];
  expect(outputIndex(arr)).toBe(inputIndex(arr));
});

test('index-parameter: empty array returns 0', () => {
  expect(outputIndex([])).toBe(0);
  expect(outputIndex([])).toBe(inputIndex([]));
});

// object-accumulator fixtures

test('object-accumulator: for loop produces the same grouped object as reduce', () => {
  expect(outputObj(KV_PAIRS)).toEqual(inputObj(KV_PAIRS));
});

test('object-accumulator: empty array returns empty object', () => {
  expect(outputObj([])).toEqual({});
  expect(outputObj([])).toEqual(inputObj([]));
});

test('object-accumulator: later duplicate key wins (same as reduce)', () => {
  // reduce and for loop both process left-to-right so last writer wins
  const arr = [
    { key: 'x', value: 1 },
    { key: 'x', value: 2 },
  ];
  expect(outputObj(arr)).toEqual({ x: 2 });
  expect(outputObj(arr)).toEqual(inputObj(arr));
});

test('object-accumulator: accumulated object identity is independent per call', () => {
  // each call must return a fresh object, not a shared accumulator
  const result1 = outputObj(KV_PAIRS);
  const result2 = outputObj(KV_PAIRS);
  expect(result1).not.toBe(result2);
});
