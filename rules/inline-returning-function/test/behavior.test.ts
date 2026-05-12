import { test, expect } from 'vitest';
import { run as inputClamp } from './fixtures/clamp-value/input.js';
import { run as outputClamp } from './fixtures/clamp-value/output.js';
import { run as inputScore } from './fixtures/score-getter/input.js';
import { run as outputScore } from './fixtures/score-getter/output.js';
import { run as inputNoParam } from './fixtures/no-param-return/input.js';
import { run as outputNoParam } from './fixtures/no-param-return/output.js';
import { run as inputMultiCall } from './fixtures/multiple-calls-same-scope/input.js';
import { run as outputMultiCall } from './fixtures/multiple-calls-same-scope/output.js';

// ─── clamp-value ──────────────────────────────────────────────────────────────

test('clamp-value: values within range are returned unchanged', () => {
  const data = [0, 50, 100];
  expect(outputClamp(data, 0, 100)).toEqual(inputClamp(data, 0, 100));
});

test('clamp-value: values below min are clamped to min', () => {
  const data = [-5, -1, 0];
  const result = outputClamp(data, 0, 100);
  expect(result).toEqual([0, 0, 0]);
  expect(result).toEqual(inputClamp(data, 0, 100));
});

test('clamp-value: values above max are clamped to max', () => {
  const data = [101, 500, 999];
  const result = outputClamp(data, 0, 100);
  expect(result).toEqual([100, 100, 100]);
  expect(result).toEqual(inputClamp(data, 0, 100));
});

test('clamp-value: mixed data produces correct per-element results', () => {
  const data = [-10, 0, 50, 100, 150];
  expect(outputClamp(data, 0, 100)).toEqual(inputClamp(data, 0, 100));
});

test('clamp-value: empty array returns empty array', () => {
  expect(outputClamp([], 0, 100)).toEqual([]);
  expect(outputClamp([], 0, 100)).toEqual(inputClamp([], 0, 100));
});

test('clamp-value: _result does not leak between iterations', () => {
  // Each iteration must compute an independent _result; if _result leaked,
  // subsequent iterations could observe the previous clamped value.
  const data = [200, 50, -10];
  const result = outputClamp(data, 0, 100);
  expect(result).toEqual([100, 50, 0]);
});

test('clamp-value: single-element array', () => {
  expect(outputClamp([42], 0, 100)).toEqual(inputClamp([42], 0, 100));
});

// ─── score-getter ─────────────────────────────────────────────────────────────

test('score-getter: best score is found among multiple entries', () => {
  const items = [
    { hits: 5, misses: 1 },
    { hits: 10, misses: 0 },
    { hits: 3, misses: 5 },
  ];
  expect(outputScore(items)).toBe(inputScore(items));
});

test('score-getter: all-zero entries yield score 0', () => {
  const items = [
    { hits: 0, misses: 0 },
    { hits: 0, misses: 0 },
  ];
  expect(outputScore(items)).toBe(0);
  expect(outputScore(items)).toBe(inputScore(items));
});

test('score-getter: single entry returns its own score', () => {
  const items = [{ hits: 4, misses: 2 }];
  // 4 * 10 - 2 * 3 = 40 - 6 = 34
  expect(outputScore(items)).toBe(34);
  expect(outputScore(items)).toBe(inputScore(items));
});

test('score-getter: empty array returns initial accumulator 0', () => {
  expect(outputScore([])).toBe(0);
  expect(outputScore([])).toBe(inputScore([]));
});

test('score-getter: negative scores are outclassed by the initial 0 accumulator', () => {
  const items = [{ hits: 0, misses: 5 }];
  // score = 0 - 15 = -15; Math.max(0, -15) = 0
  expect(outputScore(items)).toBe(0);
  expect(outputScore(items)).toBe(inputScore(items));
});

// ─── no-param-return ─────────────────────────────────────────────────────────

test('no-param-return: produces sequential IDs starting from 1', () => {
  expect(outputNoParam(5)).toEqual([1, 2, 3, 4, 5]);
});

test('no-param-return: result matches original for 10 iterations', () => {
  expect(outputNoParam(10)).toEqual(inputNoParam(10));
});

test('no-param-return: zero iterations yields empty array', () => {
  expect(outputNoParam(0)).toEqual([]);
  expect(outputNoParam(0)).toEqual(inputNoParam(0));
});

test('no-param-return: single iteration yields [1]', () => {
  expect(outputNoParam(1)).toEqual([1]);
  expect(outputNoParam(1)).toEqual(inputNoParam(1));
});

// ─── multiple-calls-same-scope ────────────────────────────────────────────────

test('multiple-calls-same-scope: both inlined results are computed independently', () => {
  const data = [3, 4, 5];
  // double(x) + negate(x) = 2x + (-x) = x
  expect(outputMultiCall(data)).toEqual([3, 4, 5]);
  expect(outputMultiCall(data)).toEqual(inputMultiCall(data));
});

test('multiple-calls-same-scope: zero produces zero for both functions', () => {
  expect(outputMultiCall([0])).toEqual([0]);
  expect(outputMultiCall([0])).toEqual(inputMultiCall([0]));
});

test('multiple-calls-same-scope: negative values', () => {
  const data = [-2, -5];
  expect(outputMultiCall(data)).toEqual(inputMultiCall(data));
});

test('multiple-calls-same-scope: empty array', () => {
  expect(outputMultiCall([])).toEqual([]);
  expect(outputMultiCall([])).toEqual(inputMultiCall([]));
});
