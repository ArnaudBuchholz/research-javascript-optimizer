import { test, expect } from 'vitest';
import { run as inputBasic } from './fixtures/basic-predicate/input.js';
import { run as outputBasic } from './fixtures/basic-predicate/output.js';
import { run as inputItemIndex } from './fixtures/item-and-index/input.js';
import { run as outputItemIndex } from './fixtures/item-and-index/output.js';
import { run as inputMulti } from './fixtures/multi-statement/input.js';
import { run as outputMulti } from './fixtures/multi-statement/output.js';
import { run as inputEmpty } from './fixtures/empty-array/input.js';
import { run as outputEmpty } from './fixtures/empty-array/output.js';

const DATA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('basic predicate: for loop result matches filter result', () => {
  expect(outputBasic(DATA)).toEqual(inputBasic(DATA));
});

test('basic predicate: only even numbers are kept', () => {
  expect(outputBasic(DATA)).toEqual([2, 4, 6, 8, 10]);
});

test('basic predicate: nothing passes the predicate', () => {
  const allOdd = [1, 3, 5, 7];
  expect(outputBasic(allOdd)).toEqual(inputBasic(allOdd));
  expect(outputBasic(allOdd)).toEqual([]);
});

test('basic predicate: all elements pass the predicate', () => {
  const allEven = [2, 4, 6];
  expect(outputBasic(allEven)).toEqual(inputBasic(allEven));
  expect(outputBasic(allEven)).toEqual([2, 4, 6]);
});

test('basic predicate: single element that passes', () => {
  expect(outputBasic([2])).toEqual(inputBasic([2]));
  expect(outputBasic([2])).toEqual([2]);
});

test('basic predicate: single element that does not pass', () => {
  expect(outputBasic([1])).toEqual(inputBasic([1]));
  expect(outputBasic([1])).toEqual([]);
});

test('item and index: for loop result matches filter result', () => {
  expect(outputItemIndex(DATA)).toEqual(inputItemIndex(DATA));
});

test('item and index: only even-indexed elements are kept', () => {
  const arr = ['a', 'b', 'c', 'd', 'e'];
  // indices 0, 2, 4 pass (even)
  expect(outputItemIndex(arr)).toEqual(inputItemIndex(arr));
  expect(outputItemIndex(arr)).toEqual(['a', 'c', 'e']);
});

test('multi-statement: for loop result matches filter result', () => {
  expect(outputMulti(DATA, 10)).toEqual(inputMulti(DATA, 10));
});

test('multi-statement: threshold filters correctly', () => {
  // item * 2 > 10 means item > 5 → keeps 6,7,8,9,10
  expect(outputMulti(DATA, 10)).toEqual([6, 7, 8, 9, 10]);
});

test('multi-statement: threshold zero keeps all positive', () => {
  expect(outputMulti(DATA, 0)).toEqual(inputMulti(DATA, 0));
  expect(outputMulti(DATA, 0)).toEqual(DATA);
});

test('multi-statement: threshold above all keeps none', () => {
  expect(outputMulti(DATA, 100)).toEqual(inputMulti(DATA, 100));
  expect(outputMulti(DATA, 100)).toEqual([]);
});

test('empty array: filter and for loop both return empty array', () => {
  expect(outputEmpty([])).toEqual(inputEmpty([]));
  expect(outputEmpty([])).toEqual([]);
});

test('result is a new array (not a reference to the input)', () => {
  const arr = [2, 4, 6];
  const result = outputBasic(arr);
  expect(result).not.toBe(arr);
});

test('execution order is preserved (elements appear in original order)', () => {
  const arr = [10, 3, 7, 2, 8, 1];
  const filterOrder = arr.filter((item) => item > 4);
  const forOrder: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > 4) forOrder.push(arr[i]);
  }
  expect(forOrder).toEqual(filterOrder);
});
