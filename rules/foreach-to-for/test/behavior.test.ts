import { test, expect } from 'vitest';
import { run as inputBasic } from './fixtures/basic-item/input.js';
import { run as outputBasic } from './fixtures/basic-item/output.js';
import { run as inputItemIndex } from './fixtures/item-and-index/input.js';
import { run as outputItemIndex } from './fixtures/item-and-index/output.js';
import { run as inputNoParams } from './fixtures/no-params/input.js';
import { run as outputNoParams } from './fixtures/no-params/output.js';
import { run as inputThreeParams } from './fixtures/three-params/input.js';
import { run as outputThreeParams } from './fixtures/three-params/output.js';

const DATA = [3, 1, 4, 1, 5, 9, 2, 6];

test('basic item: for loop preserves forEach results', () => {
  expect(outputBasic(DATA)).toEqual(inputBasic(DATA));
});

test('basic item: empty array', () => {
  expect(outputBasic([])).toEqual(inputBasic([]));
});

test('basic item: single element', () => {
  expect(outputBasic([42])).toEqual(inputBasic([42]));
});

test('item and index: for loop preserves forEach results', () => {
  expect(outputItemIndex(DATA)).toEqual(inputItemIndex(DATA));
});

test('item and index: indices are correct', () => {
  const arr = ['a', 'b', 'c'];
  expect(outputItemIndex(arr)).toEqual(['0:a', '1:b', '2:c']);
  expect(outputItemIndex(arr)).toEqual(inputItemIndex(arr));
});

test('no params: for loop preserves count', () => {
  expect(outputNoParams(DATA)).toBe(inputNoParams(DATA));
  expect(outputNoParams(DATA)).toBe(DATA.length);
});

test('three params: srcArray reference is preserved', () => {
  expect(outputThreeParams(DATA)).toEqual(inputThreeParams(DATA));
  // every element should see the same array reference
  expect(outputThreeParams(DATA).every(Boolean)).toBe(true);
});

test('execution order is preserved', () => {
  const forEachOrder: number[] = [];
  const forOrder: number[] = [];

  DATA.forEach((item) => { forEachOrder.push(item); });

  for (let i = 0; i < DATA.length; i++) {
    const item = DATA[i];
    forOrder.push(item);
  }

  expect(forOrder).toEqual(forEachOrder);
});
