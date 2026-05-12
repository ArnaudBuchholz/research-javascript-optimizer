import { test, expect } from 'vitest';
import { run as inputTwoArrays } from './fixtures/two-arrays/input.js';
import { run as outputTwoArrays } from './fixtures/two-arrays/output.js';
import { run as inputThreeArrays } from './fixtures/three-arrays/input.js';
import { run as outputThreeArrays } from './fixtures/three-arrays/output.js';
import { run as inputMixedLiterals } from './fixtures/mixed-literals/input.js';
import { run as outputMixedLiterals } from './fixtures/mixed-literals/output.js';

test('two-arrays: concat produces the same result as spread', () => {
  const a = [1, 2, 3];
  const b = [4, 5, 6];
  expect(outputTwoArrays(a, b)).toEqual(inputTwoArrays(a, b));
  expect(outputTwoArrays(a, b)).toEqual([1, 2, 3, 4, 5, 6]);
});

test('two-arrays: empty first array', () => {
  const a: number[] = [];
  const b = [1, 2, 3];
  expect(outputTwoArrays(a, b)).toEqual(inputTwoArrays(a, b));
  expect(outputTwoArrays(a, b)).toEqual([1, 2, 3]);
});

test('two-arrays: empty second array', () => {
  const a = [1, 2, 3];
  const b: number[] = [];
  expect(outputTwoArrays(a, b)).toEqual(inputTwoArrays(a, b));
  expect(outputTwoArrays(a, b)).toEqual([1, 2, 3]);
});

test('two-arrays: both empty', () => {
  expect(outputTwoArrays([], [])).toEqual(inputTwoArrays([], []));
  expect(outputTwoArrays([], [])).toEqual([]);
});

test('two-arrays: string elements', () => {
  const a = ['hello', 'world'];
  const b = ['foo', 'bar'];
  expect(outputTwoArrays(a, b)).toEqual(inputTwoArrays(a, b));
});

test('two-arrays: object elements are not deep-copied (same references)', () => {
  const obj1 = { x: 1 };
  const obj2 = { x: 2 };
  const a = [obj1];
  const b = [obj2];
  const resultInput = inputTwoArrays(a, b);
  const resultOutput = outputTwoArrays(a, b);
  // both variants must preserve object identity
  expect(resultOutput[0]).toBe(obj1);
  expect(resultOutput[1]).toBe(obj2);
  expect(resultOutput).toEqual(resultInput);
});

test('two-arrays: result is a new array (does not mutate sources)', () => {
  const a = [1, 2];
  const b = [3, 4];
  const aSnapshot = [...a];
  const bSnapshot = [...b];
  outputTwoArrays(a, b);
  expect(a).toEqual(aSnapshot);
  expect(b).toEqual(bSnapshot);
});

test('two-arrays: result is a plain Array instance', () => {
  const result = outputTwoArrays([1], [2]);
  // spread also returns a plain Array — both should pass this check
  expect(Array.isArray(result)).toBe(true);
});

test('three-arrays: concat(b, c) matches spread [...a, ...b, ...c]', () => {
  const a = [1, 2];
  const b = [3, 4];
  const c = [5, 6];
  expect(outputThreeArrays(a, b, c)).toEqual(inputThreeArrays(a, b, c));
  expect(outputThreeArrays(a, b, c)).toEqual([1, 2, 3, 4, 5, 6]);
});

test('three-arrays: one array empty', () => {
  expect(outputThreeArrays([1], [], [2])).toEqual(inputThreeArrays([1], [], [2]));
  expect(outputThreeArrays([1], [], [2])).toEqual([1, 2]);
});

test('three-arrays: all empty', () => {
  expect(outputThreeArrays([], [], [])).toEqual(inputThreeArrays([], [], []));
  expect(outputThreeArrays([], [], [])).toEqual([]);
});

test('mixed-literals: [first, ...middle, last] matches [first].concat(middle, [last])', () => {
  const middle = [2, 3, 4];
  expect(outputMixedLiterals(1, middle, 5)).toEqual(inputMixedLiterals(1, middle, 5));
  expect(outputMixedLiterals(1, middle, 5)).toEqual([1, 2, 3, 4, 5]);
});

test('mixed-literals: empty middle array', () => {
  expect(outputMixedLiterals('a', [], 'z')).toEqual(inputMixedLiterals('a', [], 'z'));
  expect(outputMixedLiterals('a', [], 'z')).toEqual(['a', 'z']);
});

test('mixed-literals: single-element middle', () => {
  expect(outputMixedLiterals(0, [99], 100)).toEqual(inputMixedLiterals(0, [99], 100));
  expect(outputMixedLiterals(0, [99], 100)).toEqual([0, 99, 100]);
});

test('element order is preserved across all variants', () => {
  const a = [1, 2, 3];
  const b = [4, 5, 6];
  const c = [7, 8, 9];
  const spread = [...a, ...b, ...c];
  const concatResult = a.concat(b, c);
  expect(concatResult).toEqual(spread);
});
