import { test, expect, beforeEach } from 'vitest';
import { run as inputClamp } from './fixtures/clamp-and-store/input.js';
import { run as outputClamp } from './fixtures/clamp-and-store/output.js';
import { run as inputWeighted } from './fixtures/add-weighted/input.js';
import { run as outputWeighted } from './fixtures/add-weighted/output.js';
import { run as inputShadow } from './fixtures/param-shadows-outer/input.js';
import { run as outputShadow } from './fixtures/param-shadows-outer/output.js';
import { run as inputMissing } from './fixtures/missing-arg-undefined/input.js';
import { run as outputMissing } from './fixtures/missing-arg-undefined/output.js';

// ─── clamp-and-store ──────────────────────────────────────────────────────────

test('clamp-and-store: values within range are stored unchanged', () => {
  const data = [10, 50, 100];
  expect(outputClamp(data, 0, 200)).toEqual(inputClamp(data, 0, 200));
});

test('clamp-and-store: values below min are clamped to min', () => {
  const data = [-5, -1, 0];
  const result = outputClamp(data, 0, 100);
  expect(result).toEqual([0, 0, 0]);
  expect(result).toEqual(inputClamp(data, 0, 100));
});

test('clamp-and-store: values above max are clamped to max', () => {
  const data = [200, 500, 1000];
  const result = outputClamp(data, 0, 100);
  expect(result).toEqual([100, 100, 100]);
  expect(result).toEqual(inputClamp(data, 0, 100));
});

test('clamp-and-store: mixed data produces correct per-element clamping', () => {
  const data = [-10, 50, 150, 0, 100];
  expect(outputClamp(data, 0, 100)).toEqual(inputClamp(data, 0, 100));
});

test('clamp-and-store: empty array produces empty output', () => {
  expect(outputClamp([], 0, 100)).toEqual([]);
  expect(outputClamp([], 0, 100)).toEqual(inputClamp([], 0, 100));
});

test('clamp-and-store: local variable in inlined block does not leak', () => {
  // If `clamped` leaked into the caller's scope this test would observe
  // cross-iteration contamination; each iteration must see an independent value.
  const data = [5, 150, 50];
  const result = outputClamp(data, 0, 100);
  expect(result).toEqual([5, 100, 50]);
});

test('clamp-and-store: single-element array', () => {
  expect(outputClamp([42], 0, 100)).toEqual(inputClamp([42], 0, 100));
});

// ─── add-weighted ─────────────────────────────────────────────────────────────

test('add-weighted: weighted sum matches original for integer arrays', () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [5, 4, 3, 2, 1];
  expect(outputWeighted(xs, ys)).toBeCloseTo(inputWeighted(xs, ys), 10);
});

test('add-weighted: all-zero inputs yield 0', () => {
  const xs = [0, 0, 0];
  const ys = [0, 0, 0];
  expect(outputWeighted(xs, ys)).toBe(0);
  expect(outputWeighted(xs, ys)).toBe(inputWeighted(xs, ys));
});

test('add-weighted: empty arrays yield 0', () => {
  expect(outputWeighted([], [])).toBe(0);
  expect(outputWeighted([], [])).toBe(inputWeighted([], []));
});

test('add-weighted: single pair', () => {
  // 10 * 0.7 + 20 * 0.3 = 7 + 6 = 13
  expect(outputWeighted([10], [20])).toBeCloseTo(13, 10);
  expect(outputWeighted([10], [20])).toBeCloseTo(inputWeighted([10], [20]), 10);
});

test('add-weighted: large array sum matches original', () => {
  const n = 10_000;
  const xs = Array.from({ length: n }, (_, i) => i % 100);
  const ys = Array.from({ length: n }, (_, i) => (i + 1) % 100);
  expect(outputWeighted(xs, ys)).toBeCloseTo(inputWeighted(xs, ys), 5);
});

// ─── param-shadows-outer ─────────────────────────────────────────────────────

test('param-shadows-outer: keys are lower-cased and deduplicated', () => {
  const result = outputShadow(['Hello', 'WORLD', 'foo']);
  expect(result).toEqual(['foo', 'hello', 'world']);
  expect(result).toEqual(inputShadow(['Hello', 'WORLD', 'foo']));
});

test('param-shadows-outer: already lower-case keys are preserved', () => {
  expect(outputShadow(['abc', 'def'])).toEqual(inputShadow(['abc', 'def']));
});

test('param-shadows-outer: empty array yields no keys', () => {
  expect(outputShadow([])).toEqual([]);
  expect(outputShadow([])).toEqual(inputShadow([]));
});

test('param-shadows-outer: renamed binding does not shadow the outer loop variable', () => {
  // The for-of variable `key` must retain its original value throughout each
  // iteration; only the inlined alias `_key` should hold a copy of it.
  // The first parameter `map` does not clash with `key` and keeps its name.
  const keys = ['Alpha', 'Beta'];
  // Both variants must produce identical results — any shadowing bug would
  // cause one to silently use the wrong value.
  expect(outputShadow(keys)).toEqual(inputShadow(keys));
});

// ─── missing-arg-undefined ───────────────────────────────────────────────────

test('missing-arg-undefined: missing parameter behaves as undefined', () => {
  const values = [1, 2, 3];
  expect(outputMissing(values)).toEqual(inputMissing(values));
});

test('missing-arg-undefined: each result is just the stringified value', () => {
  // suffix === undefined → empty string appended → just String(value)
  const result = outputMissing([42, 7]);
  expect(result).toEqual(['42', '7']);
});

test('missing-arg-undefined: empty array yields empty result', () => {
  expect(outputMissing([])).toEqual([]);
  expect(outputMissing([])).toEqual(inputMissing([]));
});

test('missing-arg-undefined: single-element array', () => {
  expect(outputMissing([99])).toEqual(inputMissing([99]));
});
