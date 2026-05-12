import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import rule from './index.js';

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'inline-returning': rule } } },
    rules: { 'opt/inline-returning': 'error' as Linter.RuleEntry },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
];

function lint(code: string) {
  return new Linter({ configType: 'flat' }).verify(code, CONFIG);
}

function applyFix(code: string): string {
  return new Linter({ configType: 'flat' }).verifyAndFix(code, CONFIG).output;
}

function fixture(dir: string, file: string): string {
  return readFileSync(
    join(import.meta.dirname, '..', 'test', 'fixtures', dir, file),
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// valid: rule does not report
// ---------------------------------------------------------------------------

describe('valid: rule does not report', () => {
  test('void function (no return value) is not handled', () => {
    expect(
      lint(`function tick() { counter++; }\nconst x = tick();`),
    ).toHaveLength(0);
  });

  test('function with bare return; is not inlined', () => {
    expect(
      lint(`function clamp(v, lo) { if (v < lo) return; return v; }\nconst x = clamp(y, 0);`),
    ).toHaveLength(0);
  });

  test('function that falls off the end (no return on all paths) is not inlined', () => {
    expect(
      lint(`function maybe(v) { if (v > 0) return v; }\nconst x = maybe(5);`),
    ).toHaveLength(0);
  });

  test('async function is not inlined', () => {
    expect(
      lint(`async function fetch(url) { return await get(url); }\nconst x = fetch('a');`),
    ).toHaveLength(0);
  });

  test('generator function is not inlined', () => {
    expect(
      lint(`function* gen(n) { return n * 2; }\nconst x = gen(1);`),
    ).toHaveLength(0);
  });

  test('function using this is not inlined', () => {
    expect(
      lint(`function compute(v) { return this.base + v; }\nconst x = compute(1);`),
    ).toHaveLength(0);
  });

  test('function using arguments is not inlined', () => {
    expect(
      lint(`function first() { return arguments[0]; }\nconst x = first(1, 2);`),
    ).toHaveLength(0);
  });

  test('function with var declaration is not inlined', () => {
    expect(
      lint(`function compute(n) { var x = n * 2; return x; }\nconst r = compute(5);`),
    ).toHaveLength(0);
  });

  test('function using eval is not inlined', () => {
    expect(
      lint(`function run(code) { return eval(code); }\nconst r = run('1+1');`),
    ).toHaveLength(0);
  });

  test('function binding reassigned is not inlined', () => {
    expect(
      lint(`function add(a, b) { return a + b; }\nadd = (a, b) => a - b;\nconst r = add(1, 2);`),
    ).toHaveLength(0);
  });

  test('method call (obj.fn(x)) is not inlined', () => {
    expect(
      lint(`function compute(v) { return v * 2; }\nconst r = obj.compute(1);`),
    ).toHaveLength(0);
  });

  test('call result discarded (expression statement) is not inlined by this rule', () => {
    // ExpressionStatement context — inline-parameterized-function handles this.
    expect(
      lint(`function sideEffect(v) { return v * 2; }\nsideEffect(1);`),
    ).toHaveLength(0);
  });

  test('rest parameter is not inlined', () => {
    expect(
      lint(`function sum(...args) { return args.reduce((a, b) => a + b, 0); }\nconst r = sum(1, 2, 3);`),
    ).toHaveLength(0);
  });

  test('destructuring parameter is not inlined', () => {
    expect(
      lint(`function score({ hits, misses }) { return hits * 10 - misses * 3; }\nconst r = score(item);`),
    ).toHaveLength(0);
  });

  test('call with spread argument is not inlined', () => {
    expect(
      lint(`function add(a, b) { return a + b; }\nconst r = add(...pair);`),
    ).toHaveLength(0);
  });

  test('function body with unlabelled break in loop is not inlined', () => {
    expect(
      lint(`function scan(arr, limit) { for (let i = 0; i < arr.length; i++) { if (arr[i] > limit) break; } return 0; }\nconst r = scan(data, 100);`),
    ).toHaveLength(0);
  });

  test('function never called is not reported', () => {
    expect(
      lint(`function add(a, b) { return a + b; }`),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// invalid: rule reports and fixes
// ---------------------------------------------------------------------------

describe('invalid: rule reports and fixes', () => {
  test('single-expression return function is reported', () => {
    const code = [
      'function double(x) {',
      '  return x * 2;',
      '}',
      'const r = double(5);',
    ].join('\n');

    const messages = lint(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('inlineReturningFunction');
  });

  test('single-expression return: fix produces let _result + block + reference', () => {
    const code = [
      'function double(x) {',
      '  return x * 2;',
      '}',
      'const r = double(5);',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const x = 5;');
    expect(fixed).toContain('let _result;');
    expect(fixed).toContain('_result = x * 2;');
    expect(fixed).toContain('const r = _result;');
    expect(fixed).not.toContain('function double');
    expect(fixed).not.toContain('double(');
  });

  test('zero-parameter returning function is inlined without const bindings', () => {
    const code = [
      'let n = 0;',
      'function next() {',
      '  return ++n;',
      '}',
      'const r = next();',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('let _result;');
    expect(fixed).toContain('_result = ++n;');
    expect(fixed).toContain('const r = _result;');
    expect(fixed).not.toContain('function next');
    expect(fixed).not.toContain('next()');
  });

  test('multi-branch function returns are rewritten into if/else chain', () => {
    const code = [
      'function clamp(v, lo, hi) {',
      '  if (v < lo) return lo;',
      '  if (v > hi) return hi;',
      '  return v;',
      '}',
      'const r = clamp(x, 0, 100);',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const v = x;');
    expect(fixed).toContain('const lo = 0;');
    expect(fixed).toContain('const hi = 100;');
    expect(fixed).toContain('let _result;');
    expect(fixed).toContain('_result = lo;');
    expect(fixed).toContain('_result = hi;');
    expect(fixed).toContain('_result = v;');
    expect(fixed).toContain('const r = _result;');
    expect(fixed).not.toContain('function clamp');
    expect(fixed).not.toContain('clamp(');
  });

  test('call inside an arrow expression body expands the arrow to block body', () => {
    const code = [
      'function double(x) {',
      '  return x * 2;',
      '}',
      'const results = items.map((item) => double(item));',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const x = item;');
    expect(fixed).toContain('let _result;');
    expect(fixed).toContain('_result = x * 2;');
    expect(fixed).toContain('return _result;');
    expect(fixed).not.toContain('function double');
    expect(fixed).not.toContain('double(');
  });

  test('multiple calls in the same expression get numbered result variables', () => {
    const code = [
      'function double(x) {',
      '  return x * 2;',
      '}',
      'function negate(x) {',
      '  return -x;',
      '}',
      'const r = double(5) + negate(3);',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('_result_1');
    expect(fixed).toContain('_result_2');
    expect(fixed).not.toContain('function double');
    expect(fixed).not.toContain('function negate');
  });

  test('param name colliding with outer binding is renamed', () => {
    const code = [
      'const x = 10;',
      'function double(x) {',
      '  return x * 2;',
      '}',
      'const r = double(5);',
    ].join('\n');

    const fixed = applyFix(code);
    // x collides with outer const x → renamed to _x
    expect(fixed).toContain('const _x = 5;');
    expect(fixed).toContain('_result = _x * 2;');
    expect(fixed).not.toContain('function double');
  });

  test('missing argument emits explicit const = undefined', () => {
    const code = [
      'function add(a, b) {',
      '  return a + (b !== undefined ? b : 0);',
      '}',
      'const r = add(5);',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const a = 5;');
    expect(fixed).toContain('const b = undefined;');
    expect(fixed).not.toContain('function add');
  });

  test('multiple call sites for the same function are all replaced', () => {
    const code = [
      'function double(x) {',
      '  return x * 2;',
      '}',
      'const a = double(1);',
      'const b = double(2);',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).not.toContain('function double');
    expect(fixed).not.toContain('double(');
    // Each call site produces a const x and let _result
    expect((fixed.match(/const x = /g) ?? []).length).toBe(2);
    expect((fixed.match(/let _result/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fixture-based tests: transform input → output matches recorded fixture
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  test('clamp-value fixture', () => {
    const input = fixture('clamp-value', 'input.js');
    const output = fixture('clamp-value', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('score-getter fixture', () => {
    const input = fixture('score-getter', 'input.js');
    const output = fixture('score-getter', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('no-param-return fixture', () => {
    const input = fixture('no-param-return', 'input.js');
    const output = fixture('no-param-return', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('multiple-calls-same-scope fixture', () => {
    const input = fixture('multiple-calls-same-scope', 'input.js');
    const output = fixture('multiple-calls-same-scope', 'output.js');
    expect(applyFix(input)).toBe(output);
  });
});
