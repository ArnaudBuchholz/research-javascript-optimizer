import { test, expect } from 'vitest';
import { run as inputBasic } from './fixtures/basic-transform/input.js';
import { run as outputBasic } from './fixtures/basic-transform/output.js';
import { run as inputItemIndex } from './fixtures/item-and-index/input.js';
import { run as outputItemIndex } from './fixtures/item-and-index/output.js';
import { run as inputMulti } from './fixtures/multi-statement-body/input.js';
import { run as outputMulti } from './fixtures/multi-statement-body/output.js';
import { run as inputEmpty } from './fixtures/empty-array/input.js';
import { run as outputEmpty } from './fixtures/empty-array/output.js';

const DATA = [3, 1, 4, 1, 5, 9, 2, 6];

test('basic transform: for loop produces the same mapped values as map', () => {
  expect(outputBasic(DATA)).toEqual(inputBasic(DATA));
});

test('basic transform: single element', () => {
  expect(outputBasic([42])).toEqual(inputBasic([42]));
});

test('basic transform: result length equals input length', () => {
  const result = outputBasic(DATA);
  expect(result).toHaveLength(DATA.length);
});

test('item and index: for loop produces the same indexed strings as map', () => {
  expect(outputItemIndex(DATA)).toEqual(inputItemIndex(DATA));
});

test('item and index: indices are zero-based and match element positions', () => {
  const arr = ['a', 'b', 'c'];
  expect(outputItemIndex(arr)).toEqual(['0:a', '1:b', '2:c']);
  expect(outputItemIndex(arr)).toEqual(inputItemIndex(arr));
});

test('multi-statement body: for loop produces the same normalized strings as map', () => {
  const strings = ['  Hello  ', ' WORLD ', '  Foo  '];
  expect(outputMulti(strings)).toEqual(inputMulti(strings));
});

test('multi-statement body: correct suffix and normalisation', () => {
  const strings = ['  Hello  '];
  const result = outputMulti(strings);
  expect(result[0]).toBe('hello_suffix');
});

test('empty array: both variants return an empty array', () => {
  expect(outputEmpty([])).toEqual(inputEmpty([]));
  expect(outputEmpty([])).toHaveLength(0);
});

// Verify the rewrite does not alter the source array
test('source array is not mutated', () => {
  const original = [1, 2, 3];
  const copy = [...original];
  outputBasic(original);
  expect(original).toEqual(copy);
});

// Verify execution order matches map's left-to-right order
test('execution order matches left-to-right map order', () => {
  const mapOrder: number[] = [];
  const forOrder: number[] = [];

  DATA.map((item) => { mapOrder.push(item); return item; });

  const result = new Array(DATA.length);
  for (let i = 0; i < DATA.length; i++) {
    forOrder.push(DATA[i]);
    result[i] = DATA[i];
  }

  expect(forOrder).toEqual(mapOrder);
});
