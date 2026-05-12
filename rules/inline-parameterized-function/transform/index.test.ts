import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import rule from './index.js';

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'inline-parameterized': rule } } },
    rules: { 'opt/inline-parameterized': 'error' as Linter.RuleEntry },
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
  test('zero-parameter function is not handled (covered by inline-no-arg-function)', () => {
    expect(
      lint(`function tick() { counter++; }\ntick();`),
    ).toHaveLength(0);
  });

  test('function returning a value is not inlined', () => {
    expect(
      lint(`function add(a, b) { return a + b; }\nadd(1, 2);`),
    ).toHaveLength(0);
  });

  test('function with early bare return is not inlined', () => {
    expect(
      lint(`function clamp(v, lo) { if (v < lo) return; total += v; }\nclamp(x, 0);`),
    ).toHaveLength(0);
  });

  test('async function is not inlined', () => {
    expect(
      lint(`async function store(v, k) { await db.set(k, v); }\nstore(1, 'a');`),
    ).toHaveLength(0);
  });

  test('generator function is not inlined', () => {
    expect(
      lint(`function* gen(n, m) { yield n + m; }\ngen(1, 2);`),
    ).toHaveLength(0);
  });

  test('function using this is not inlined', () => {
    expect(
      lint(`function update(v) { this.count = v; }\nupdate(1);`),
    ).toHaveLength(0);
  });

  test('function using arguments is not inlined', () => {
    expect(
      lint(`function log(prefix) { console.log(prefix, arguments[1]); }\nlog('x');`),
    ).toHaveLength(0);
  });

  test('function with var declaration is not inlined', () => {
    expect(
      lint(`function init(n) { var x = n; total += x; }\ninit(5);`),
    ).toHaveLength(0);
  });

  test('function using eval is not inlined', () => {
    expect(
      lint(`function dynamic(code) { eval(code); }\ndynamic('x=1');`),
    ).toHaveLength(0);
  });

  test('function binding reassigned is not inlined', () => {
    expect(
      lint(`function reset(v) { count = v; }\nreset = function(v) { count = v + 1; };\nreset(0);`),
    ).toHaveLength(0);
  });

  test('method call (obj.fn(x)) is not inlined', () => {
    expect(
      lint(`function push(v) { arr.push(v); }\nobj.push(1);`),
    ).toHaveLength(0);
  });

  test('call in expression context (return value consumed) is not inlined', () => {
    // The call is not an ExpressionStatement so it must not be reported.
    expect(
      lint(`function add(a, b) { total += a + b; }\nconst x = add(1, 2);`),
    ).toHaveLength(0);
  });

  test('rest parameter is not inlined', () => {
    // A rest parameter produces a non-Identifier pattern — the transform declines.
    expect(
      lint(`function sum(...args) { total += args.reduce((a, b) => a + b, 0); }\nsum(1, 2, 3);`),
    ).toHaveLength(0);
  });

  test('destructuring parameter is not inlined', () => {
    expect(
      lint(`function store({ key, val }) { map[key] = val; }\nstore({ key: 'a', val: 1 });`),
    ).toHaveLength(0);
  });

  test('call with spread argument is not inlined', () => {
    expect(
      lint(`function add(a, b) { total += a + b; }\nadd(...pair);`),
    ).toHaveLength(0);
  });

  test('function called with new is not inlined', () => {
    // `new fn()` is a NewExpression, not a CallExpression — rule does not fire.
    expect(
      lint(`function Init(v) { count = v; }\nnew Init(0);`),
    ).toHaveLength(0);
  });

  test('function never called is not reported', () => {
    expect(
      lint(`function add(a, b) { total += a + b; }`),
    ).toHaveLength(0);
  });

  test('function body with unlabelled break in loop is not inlined', () => {
    // An unlabelled break inside the body would redirect to the outer loop after
    // inlining; the rule must decline.
    expect(
      lint(`function scan(arr, limit) { for (let i = 0; i < arr.length; i++) { if (arr[i] > limit) break; count++; } }\nscan(data, 100);`),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// invalid: rule reports and fixes
// ---------------------------------------------------------------------------

describe('invalid: rule reports and fixes', () => {
  test('single-statement body with one param', () => {
    const code = [
      'let total = 0;',
      'function addValue(v) {',
      '  total += v;',
      '}',
      'for (let i = 0; i < 10; i++) {',
      '  addValue(data[i]);',
      '}',
    ].join('\n');

    const messages = lint(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('inlineParameterizedFunction');

    const fixed = applyFix(code);
    expect(fixed).toContain('const v = data[i];');
    expect(fixed).toContain('total += v;');
    expect(fixed).not.toContain('function addValue');
    expect(fixed).not.toContain('addValue(');
  });

  test('two-param body replaces both params with const bindings', () => {
    const code = [
      'let total = 0;',
      'function addWeighted(a, b) {',
      '  total += a * 0.7 + b * 0.3;',
      '}',
      'for (let i = 0; i < 10; i++) {',
      '  addWeighted(xs[i], ys[i]);',
      '}',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const a = xs[i];');
    expect(fixed).toContain('const b = ys[i];');
    expect(fixed).toContain('total += a * 0.7 + b * 0.3;');
    expect(fixed).not.toContain('function addWeighted');
    expect(fixed).not.toContain('addWeighted(');
  });

  test('missing argument emits explicit const = undefined binding', () => {
    const code = [
      'let total = 0;',
      'function add(a, b) {',
      '  total += a + (b !== undefined ? b : 0);',
      '}',
      'for (let i = 0; i < 10; i++) {',
      '  add(data[i]);',
      '}',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const a = data[i];');
    expect(fixed).toContain('const b = undefined;');
    expect(fixed).not.toContain('function add');
  });

  test('extra arguments beyond param count are silently dropped', () => {
    // The extra argument is evaluated for side effects at runtime; the transform
    // emits const bindings only for parameters.
    const code = [
      'let total = 0;',
      'function add(a) {',
      '  total += a;',
      '}',
      'add(1, sideEffect());',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const a = 1;');
    expect(fixed).not.toContain('function add');
  });

  test('param name colliding with outer binding is renamed', () => {
    // `key` is declared in the for-of loop; the parameter `key` must be renamed.
    const code = [
      'const map = {};',
      'function store(key, val) {',
      '  map[key] = val;',
      '}',
      'for (const key of keys) {',
      '  store(key, 1);',
      '}',
    ].join('\n');

    const fixed = applyFix(code);
    // `key` collides → renamed to `_key`; `val` does not collide → kept
    expect(fixed).toContain('const _key = key;');
    expect(fixed).toContain('const val = 1;');
    expect(fixed).toContain('map[_key] = val;');
    expect(fixed).not.toContain('function store');
  });

  test('multiple call sites are all replaced', () => {
    const code = [
      'let total = 0;',
      'function addV(v) {',
      '  total += v;',
      '}',
      'addV(1);',
      'addV(2);',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).not.toContain('function addV');
    expect(fixed).not.toContain('addV(');
    // Both call sites produce a const binding
    expect((fixed.match(/const v = /g) ?? []).length).toBe(2);
  });

  test('trailing bare return is allowed and inlined without the return statement', () => {
    const code = [
      'let total = 0;',
      'function addV(v) {',
      '  total += v;',
      '  return;',
      '}',
      'for (let i = 0; i < 5; i++) {',
      '  addV(data[i]);',
      '}',
    ].join('\n');

    const messages = lint(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('inlineParameterizedFunction');
  });

  test('body with local let declarations is wrapped in a block', () => {
    const code = [
      'let results = [];',
      'function processAndStore(value, min, max) {',
      '  let clamped = value < min ? min : value > max ? max : value;',
      '  results.push(clamped);',
      '}',
      'for (let i = 0; i < 10; i++) {',
      '  processAndStore(data[i], 0, 100);',
      '}',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const value = data[i];');
    expect(fixed).toContain('const min = 0;');
    expect(fixed).toContain('const max = 100;');
    expect(fixed).toContain('let clamped =');
    expect(fixed).not.toContain('function processAndStore');
  });
});

// ---------------------------------------------------------------------------
// Fixture-based tests: transform input → output matches recorded fixture
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  test('clamp-and-store fixture', () => {
    const input = fixture('clamp-and-store', 'input.js');
    const output = fixture('clamp-and-store', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('add-weighted fixture', () => {
    const input = fixture('add-weighted', 'input.js');
    const output = fixture('add-weighted', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('param-shadows-outer fixture', () => {
    const input = fixture('param-shadows-outer', 'input.js');
    const output = fixture('param-shadows-outer', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('missing-arg-undefined fixture', () => {
    const input = fixture('missing-arg-undefined', 'input.js');
    const output = fixture('missing-arg-undefined', 'output.js');
    expect(applyFix(input)).toBe(output);
  });
});
