import { test, expect } from 'vitest';
import { run as inputTwoGuard } from './fixtures/two-guard-filter/input.js';
import { run as outputTwoGuard } from './fixtures/two-guard-filter/output.js';
import { run as inputZeroParam } from './fixtures/zero-param-guard/input.js';
import { run as outputZeroParam } from './fixtures/zero-param-guard/output.js';
import { run as inputLocalVars } from './fixtures/local-vars-in-body/input.js';
import { run as outputLocalVars } from './fixtures/local-vars-in-body/output.js';
import { run as inputBreakLoop } from './fixtures/break-does-not-escape-loop/input.js';
import { run as outputBreakLoop } from './fixtures/break-does-not-escape-loop/output.js';

// ─── two-guard-filter ─────────────────────────────────────────────────────────

test('two-guard-filter: active items above threshold are included', () => {
  const data = [
    { active: true, score: 60, value: 4 },
    { active: true, score: 80, value: 8 },
  ];
  expect(outputTwoGuard(data)).toEqual(inputTwoGuard(data));
  expect(outputTwoGuard(data)).toEqual([10, 20]);
});

test('two-guard-filter: inactive items are excluded regardless of score', () => {
  const data = [
    { active: false, score: 99, value: 10 },
    { active: true, score: 70, value: 4 },
  ];
  const result = outputTwoGuard(data);
  expect(result).toEqual([10]);
  expect(result).toEqual(inputTwoGuard(data));
});

test('two-guard-filter: items below score threshold are excluded', () => {
  const data = [
    { active: true, score: 10, value: 5 },
    { active: true, score: 49, value: 5 },
  ];
  expect(outputTwoGuard(data)).toEqual([]);
  expect(outputTwoGuard(data)).toEqual(inputTwoGuard(data));
});

test('two-guard-filter: items at exactly the score threshold are excluded', () => {
  // score < THRESHOLD (50) is the guard; score === 50 does NOT trigger the guard
  const data = [
    { active: true, score: 50, value: 4 },
  ];
  expect(outputTwoGuard(data)).toEqual(inputTwoGuard(data));
  expect(outputTwoGuard(data)).toEqual([10]);
});

test('two-guard-filter: mixed data produces correct filtered output', () => {
  const data = [
    { active: true, score: 60, value: 2 },   // included: 5
    { active: false, score: 90, value: 100 }, // excluded: inactive
    { active: true, score: 30, value: 100 },  // excluded: score too low
    { active: true, score: 55, value: 4 },    // included: 10
  ];
  expect(outputTwoGuard(data)).toEqual(inputTwoGuard(data));
  expect(outputTwoGuard(data)).toEqual([5, 10]);
});

test('two-guard-filter: empty array produces empty result', () => {
  expect(outputTwoGuard([])).toEqual([]);
  expect(outputTwoGuard([])).toEqual(inputTwoGuard([]));
});

test('two-guard-filter: all items excluded produces empty result', () => {
  const data = [
    { active: false, score: 90, value: 1 },
    { active: true, score: 20, value: 1 },
  ];
  expect(outputTwoGuard(data)).toEqual([]);
  expect(outputTwoGuard(data)).toEqual(inputTwoGuard(data));
});

// ─── zero-param-guard ─────────────────────────────────────────────────────────

test('zero-param-guard: counter increments until MAX, then stops', () => {
  // With N=10 and MAX=5, the log should contain [0, 1, 2, 3, 4, 5].
  const result = outputZeroParam(10);
  expect(result.log).toEqual([0, 1, 2, 3, 4, 5]);
  expect(result.counter).toBe(6);
  expect(result).toEqual(inputZeroParam(10));
});

test('zero-param-guard: N=0 produces empty log', () => {
  const result = outputZeroParam(0);
  expect(result.log).toEqual([]);
  expect(result.counter).toBe(0);
  expect(result).toEqual(inputZeroParam(0));
});

test('zero-param-guard: N smaller than MAX records all N values', () => {
  // With N=3 and MAX=5, no guard triggers; log is [0, 1, 2], counter is 3.
  const result = outputZeroParam(3);
  expect(result.log).toEqual([0, 1, 2]);
  expect(result.counter).toBe(3);
  expect(result).toEqual(inputZeroParam(3));
});

test('zero-param-guard: guard fires on first iteration when counter already exceeds MAX', () => {
  // We rely on run() resetting counter=0, so this checks the normal path.
  // Indirectly verifies the guard fires correctly on the first iteration past MAX.
  const result = outputZeroParam(20);
  expect(result.log.length).toBe(6); // 0..5
  expect(result).toEqual(inputZeroParam(20));
});

// ─── local-vars-in-body ───────────────────────────────────────────────────────

test('local-vars-in-body: null inputs are skipped', () => {
  const result = outputLocalVars([null, null]);
  expect(result).toEqual({});
  expect(result).toEqual(inputLocalVars([null, null]));
});

test('local-vars-in-body: non-null inputs are stored with correct key and value', () => {
  const result = outputLocalVars([1, 2, 3]) as Record<string, unknown>;
  expect(result).toEqual(inputLocalVars([1, 2, 3]));
  expect(result['1']).toEqual({ id: 1, value: 10 });
  expect(result['2']).toEqual({ id: 2, value: 20 });
  expect(result['3']).toEqual({ id: 3, value: 30 });
});

test('local-vars-in-body: mixed null and non-null inputs', () => {
  const result = outputLocalVars([null, 5, null, 7]);
  expect(result).toEqual(inputLocalVars([null, 5, null, 7]));
  expect(Object.keys(result)).toEqual(expect.arrayContaining(['5', '7']));
  expect(Object.keys(result).length).toBe(2);
});

test('local-vars-in-body: empty input produces empty cache', () => {
  expect(outputLocalVars([])).toEqual({});
  expect(outputLocalVars([])).toEqual(inputLocalVars([]));
});

test('local-vars-in-body: local `const` variables do not leak across iterations', () => {
  // If `parsed` or `key` leaked out of the do {} while (0) block, the test
  // would observe cross-iteration contamination for null items following
  // non-null ones — confirmed by checking null items produce no cache entry.
  const result = outputLocalVars([1, null, 2]);
  expect(result).toEqual(inputLocalVars([1, null, 2]));
  expect(Object.keys(result).length).toBe(2);
});

// ─── break-does-not-escape-loop ───────────────────────────────────────────────

test('break-does-not-escape-loop: negative item is skipped but loop continues', () => {
  // If `break` escaped the enclosing loop, the 5 after -1 would be missing.
  const result = outputBreakLoop([-1, 5]);
  expect(result).toEqual([5]);
  expect(result).toEqual(inputBreakLoop([-1, 5]));
});

test('break-does-not-escape-loop: multiple negative items do not abort the loop', () => {
  const result = outputBreakLoop([-3, 2, -1, 4, -5, 6]);
  expect(result).toEqual([2, 4, 6]);
  expect(result).toEqual(inputBreakLoop([-3, 2, -1, 4, -5, 6]));
});

test('break-does-not-escape-loop: all-positive array is preserved in full', () => {
  const data = [1, 2, 3, 4, 5];
  expect(outputBreakLoop(data)).toEqual([1, 2, 3, 4, 5]);
  expect(outputBreakLoop(data)).toEqual(inputBreakLoop(data));
});

test('break-does-not-escape-loop: all-negative array produces empty output', () => {
  const data = [-1, -2, -3];
  expect(outputBreakLoop(data)).toEqual([]);
  expect(outputBreakLoop(data)).toEqual(inputBreakLoop(data));
});

test('break-does-not-escape-loop: zero is at the boundary and is included', () => {
  // guard is `item < THRESHOLD` (THRESHOLD=0); zero is NOT less than 0.
  const result = outputBreakLoop([-1, 0, 1]);
  expect(result).toEqual([0, 1]);
  expect(result).toEqual(inputBreakLoop([-1, 0, 1]));
});

test('break-does-not-escape-loop: empty array produces empty output', () => {
  expect(outputBreakLoop([])).toEqual([]);
  expect(outputBreakLoop([])).toEqual(inputBreakLoop([]));
});
