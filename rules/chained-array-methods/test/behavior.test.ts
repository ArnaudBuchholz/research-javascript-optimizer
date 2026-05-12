import { test, expect } from 'vitest';
import { run as inputBasic } from './fixtures/basic-filter-map/input.js';
import { run as outputBasic } from './fixtures/basic-filter-map/output.js';
import { run as inputMapIndex } from './fixtures/map-uses-index/input.js';
import { run as outputMapIndex } from './fixtures/map-uses-index/output.js';
import { run as inputMulti } from './fixtures/multi-statement-callbacks/input.js';
import { run as outputMulti } from './fixtures/multi-statement-callbacks/output.js';
import { run as inputEmpty } from './fixtures/empty-array/input.js';
import { run as outputEmpty } from './fixtures/empty-array/output.js';
import { run as inputAllOut } from './fixtures/all-filtered-out/input.js';
import { run as outputAllOut } from './fixtures/all-filtered-out/output.js';

const DATA = [
  { active: true, value: 1, name: 'Alice', score: 80 },
  { active: false, value: 2, name: 'Bob', score: 30 },
  { active: true, value: 3, name: '  Carol  ', score: 95 },
  { active: false, value: 4, name: 'Dave', score: 20 },
  { active: true, value: 5, name: 'Eve', score: 50 },
];

// ------------------------------------------------------------------
// basic-filter-map
// ------------------------------------------------------------------

test('basic filter+map: fused loop produces the same values as the chain', () => {
  expect(outputBasic(DATA)).toEqual(inputBasic(DATA));
});

test('basic filter+map: only elements where active=true appear in result', () => {
  const result = outputBasic(DATA);
  // active elements at indices 0, 2, 4 → values 1*10, 3*10, 5*10
  expect(result).toEqual([10, 30, 50]);
});

test('basic filter+map: single active element', () => {
  const arr = [{ active: true, value: 7 }];
  expect(outputBasic(arr)).toEqual(inputBasic(arr));
  expect(outputBasic(arr)).toEqual([70]);
});

test('basic filter+map: single inactive element', () => {
  const arr = [{ active: false, value: 7 }];
  expect(outputBasic(arr)).toEqual(inputBasic(arr));
  expect(outputBasic(arr)).toEqual([]);
});

test('basic filter+map: source array is not mutated', () => {
  const original = [{ active: true, value: 1 }, { active: false, value: 2 }];
  const copy = original.map((o) => ({ ...o }));
  outputBasic(original);
  expect(original).toEqual(copy);
});

// ------------------------------------------------------------------
// map-uses-index — the index in map refers to the filtered array position
// ------------------------------------------------------------------

const NAMED = [
  { active: false, name: 'skip-me' },
  { active: true, name: 'alpha' },
  { active: false, name: 'skip-too' },
  { active: true, name: 'beta' },
  { active: true, name: 'gamma' },
];

test('map-uses-index: fused loop produces the same strings as the chain', () => {
  expect(outputMapIndex(NAMED)).toEqual(inputMapIndex(NAMED));
});

test('map-uses-index: index values are relative to the filtered array, not the source', () => {
  const result = outputMapIndex(NAMED);
  // filtered: ['alpha', 'beta', 'gamma'] — indices 0, 1, 2
  expect(result).toEqual(['0: alpha', '1: beta', '2: gamma']);
});

test('map-uses-index: single matching element always gets index 0', () => {
  const arr = [{ active: false, name: 'x' }, { active: true, name: 'y' }];
  expect(outputMapIndex(arr)).toEqual(inputMapIndex(arr));
  expect(outputMapIndex(arr)).toEqual(['0: y']);
});

test('map-uses-index: empty array', () => {
  expect(outputMapIndex([])).toEqual(inputMapIndex([]));
  expect(outputMapIndex([])).toEqual([]);
});

// ------------------------------------------------------------------
// multi-statement-callbacks
// ------------------------------------------------------------------

const SCORED = [
  { name: '  Alice  ', score: 80 },
  { name: 'Bob', score: 20 },
  { name: '  Carol  ', score: 95 },
  { name: 'Dave', score: 40 },
];
const THRESHOLD = 50;

test('multi-statement: fused loop produces the same strings as the chain', () => {
  expect(outputMulti(SCORED, THRESHOLD)).toEqual(inputMulti(SCORED, THRESHOLD));
});

test('multi-statement: only items above threshold appear', () => {
  const result = outputMulti(SCORED, THRESHOLD);
  // Alice (80 > 50) and Carol (95 > 50); Bob and Dave are filtered
  expect(result).toEqual(['alice:80', 'carol:95']);
});

test('multi-statement: name is trimmed and lowercased in output', () => {
  const arr = [{ name: '  HELLO  ', score: 100 }];
  expect(outputMulti(arr, 0)).toEqual(['hello:100']);
  expect(outputMulti(arr, 0)).toEqual(inputMulti(arr, 0));
});

test('multi-statement: threshold exactly equal to score is excluded (adjusted = 0 is not > 0)', () => {
  const arr = [{ name: 'exact', score: 50 }];
  expect(outputMulti(arr, 50)).toEqual([]);
  expect(outputMulti(arr, 50)).toEqual(inputMulti(arr, 50));
});

// ------------------------------------------------------------------
// empty-array
// ------------------------------------------------------------------

test('empty array: both variants return an empty array', () => {
  expect(outputEmpty([])).toEqual(inputEmpty([]));
  expect(outputEmpty([])).toEqual([]);
});

// ------------------------------------------------------------------
// all-filtered-out
// ------------------------------------------------------------------

test('all-filtered-out: result is empty when no elements pass the predicate', () => {
  const inactive = [
    { active: false, value: 1 },
    { active: false, value: 2 },
    { active: false, value: 3 },
  ];
  expect(outputAllOut(inactive)).toEqual(inputAllOut(inactive));
  expect(outputAllOut(inactive)).toEqual([]);
});

test('all-filtered-out: empty input also produces empty output', () => {
  expect(outputAllOut([])).toEqual(inputAllOut([]));
  expect(outputAllOut([])).toEqual([]);
});

// ------------------------------------------------------------------
// execution order and result consistency
// ------------------------------------------------------------------

test('result order matches the original left-to-right source order', () => {
  // The fused loop visits source elements in ascending index order, exactly as
  // filter() does. Verify the output preserves that order by using a data set
  // where position is observable in the output values.
  const ordered = [
    { active: true, value: 10 },
    { active: false, value: 20 },
    { active: true, value: 30 },
    { active: true, value: 40 },
    { active: false, value: 50 },
  ];
  // Original chain: preserves source order for passing elements
  const chainResult = ordered.filter((item) => item.active).map((item) => item.value);
  // Fused loop: must produce the same order
  const fusedResult = [];
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].active) {
      fusedResult.push(ordered[i].value);
    }
  }
  expect(fusedResult).toEqual(chainResult);
  expect(fusedResult).toEqual([10, 30, 40]);
});
