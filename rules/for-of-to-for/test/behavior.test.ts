import { test, expect } from 'vitest';
import { run as inputSimple } from './fixtures/simple-values/input.js';
import { run as outputSimple } from './fixtures/simple-values/output.js';
import { run as inputEntries } from './fixtures/entries-index/input.js';
import { run as outputEntries } from './fixtures/entries-index/output.js';
import { run as inputObjects } from './fixtures/array-of-objects/input.js';
import { run as outputObjects } from './fixtures/array-of-objects/output.js';
import { run as inputBreak } from './fixtures/early-break/input.js';
import { run as outputBreak } from './fixtures/early-break/output.js';

const NUMBERS = [3, 1, 4, 1, 5, 9, 2, 6];

// --- simple-values ---

test('simple values: for loop produces same output as for...of', () => {
  expect(outputSimple(NUMBERS)).toEqual(inputSimple(NUMBERS));
});

test('simple values: empty array', () => {
  expect(outputSimple([])).toEqual(inputSimple([]));
  expect(outputSimple([])).toEqual([]);
});

test('simple values: single element', () => {
  expect(outputSimple([7])).toEqual(inputSimple([7]));
  expect(outputSimple([7])).toEqual([14]);
});

// --- entries-index ---

test('entries: for loop produces same index:value pairs as for...of entries()', () => {
  expect(outputEntries(NUMBERS)).toEqual(inputEntries(NUMBERS));
});

test('entries: indices start at 0 and are sequential', () => {
  const arr = ['a', 'b', 'c'];
  expect(outputEntries(arr)).toEqual(['0:a', '1:b', '2:c']);
  expect(outputEntries(arr)).toEqual(inputEntries(arr));
});

test('entries: empty array', () => {
  expect(outputEntries([])).toEqual(inputEntries([]));
  expect(outputEntries([])).toEqual([]);
});

// --- array-of-objects ---

const USERS = [
  { name: 'alice', active: true },
  { name: 'bob', active: false },
  { name: 'carol', active: true },
];

test('array of objects: filters active users identically', () => {
  expect(outputObjects(USERS)).toEqual(inputObjects(USERS));
  expect(outputObjects(USERS)).toEqual(['alice', 'carol']);
});

test('array of objects: all inactive', () => {
  const inactive = [
    { name: 'dave', active: false },
    { name: 'eve', active: false },
  ];
  expect(outputObjects(inactive)).toEqual(inputObjects(inactive));
  expect(outputObjects(inactive)).toEqual([]);
});

test('array of objects: all active', () => {
  const allActive = [
    { name: 'alice', active: true },
    { name: 'bob', active: true },
  ];
  expect(outputObjects(allActive)).toEqual(inputObjects(allActive));
});

// --- early-break (return on first match) ---

test('early break: returns first matching element', () => {
  expect(outputBreak(NUMBERS, 4)).toBe(inputBreak(NUMBERS, 4));
  // first element > 4 is 5
  expect(outputBreak(NUMBERS, 4)).toBe(5);
});

test('early break: returns undefined when no element matches', () => {
  expect(outputBreak(NUMBERS, 100)).toBe(inputBreak(NUMBERS, 100));
  expect(outputBreak(NUMBERS, 100)).toBeUndefined();
});

test('early break: returns first element when threshold is below all values', () => {
  expect(outputBreak(NUMBERS, 0)).toBe(inputBreak(NUMBERS, 0));
  // first element > 0 is 3
  expect(outputBreak(NUMBERS, 0)).toBe(3);
});

test('early break: empty array returns undefined', () => {
  expect(outputBreak([], 0)).toBe(inputBreak([], 0));
  expect(outputBreak([], 0)).toBeUndefined();
});

// --- iteration order ---

test('execution order is preserved for simple values', () => {
  const forOfOrder: number[] = [];
  const forOrder: number[] = [];

  for (const item of NUMBERS) {
    forOfOrder.push(item);
  }
  for (let i = 0; i < NUMBERS.length; i++) {
    forOrder.push(NUMBERS[i]);
  }

  expect(forOrder).toEqual(forOfOrder);
});
