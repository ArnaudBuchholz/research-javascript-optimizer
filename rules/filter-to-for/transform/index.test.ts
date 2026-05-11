import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from './index.js';

const FIXTURES_DIR = new URL('../test/fixtures', import.meta.url).pathname;

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'filter-to-for': rule } } },
    rules: { 'opt/filter-to-for': 'error' as Linter.RuleEntry },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
];

function lint(code: string) {
  return new Linter({ configType: 'flat' }).verify(code, CONFIG);
}

function applyFix(code: string): string {
  return new Linter({ configType: 'flat' }).verifyAndFix(code, CONFIG).output;
}

function fixture(name: string, file: string): string {
  return readFileSync(join(FIXTURES_DIR, name, file), 'utf8');
}

// ---------------------------------------------------------------------------
// Fixture-driven tests
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  test('basic-predicate: rule fires and produces correct output', () => {
    const input = fixture('basic-predicate', 'input.js');
    const output = fixture('basic-predicate', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('empty-array: rule fires and produces correct output', () => {
    const input = fixture('empty-array', 'input.js');
    const output = fixture('empty-array', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('item-and-index: rule fires and produces correct output', () => {
    const input = fixture('item-and-index', 'input.js');
    const output = fixture('item-and-index', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('multi-statement: rule fires and produces correct output', () => {
    const input = fixture('multi-statement', 'input.js');
    const output = fixture('multi-statement', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });
});

// ---------------------------------------------------------------------------
// Valid: rule must NOT report
// ---------------------------------------------------------------------------

describe('valid: rule does not report', () => {
  test('function expression callback (not arrow)', () => {
    expect(
      lint(`const r = arr.filter(function(item) { return item > 0; });`),
    ).toHaveLength(0);
  });

  test('call expression as array (side-effectful, unsafe to re-evaluate)', () => {
    expect(
      lint(`const r = getArr().filter((item) => item > 0);`),
    ).toHaveLength(0);
  });

  test('computed member expression as array', () => {
    expect(
      lint(`const r = obj[key].filter((item) => item > 0);`),
    ).toHaveLength(0);
  });

  test('thisArg passed as second argument', () => {
    expect(
      lint(`const r = arr.filter((item) => item > 0, ctx);`),
    ).toHaveLength(0);
  });

  test('block body with no return (not a predicate)', () => {
    expect(
      lint(`const r = arr.filter((item) => { doSomething(item); });`),
    ).toHaveLength(0);
  });

  test('result not consumed — standalone expression statement (discarded filter)', () => {
    // A discarded .filter() result wastes allocations; foreach-to-for applies instead.
    expect(lint(`arr.filter((item) => item > 0);`)).toHaveLength(0);
  });

  test('result used in a nested expression (too complex to inline as statements)', () => {
    expect(
      lint(`process(arr.filter((item) => item > 0));`),
    ).toHaveLength(0);
  });

  test('block body return without argument (bare return)', () => {
    expect(
      lint(`const r = arr.filter((item) => { if (!item) return; return item > 0; });`),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid: rule reports and fix is correct
// ---------------------------------------------------------------------------

describe('invalid: rule reports and fixes', () => {
  test('concise body in return statement', () => {
    const code = [
      'function run(arr) {',
      '  return arr.filter((item) => item > 0);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'function run(arr) {',
        '  const result = [];',
        '  for (let i = 0; i < arr.length; i++) {',
        '    if (arr[i] > 0) {',
        '      result.push(arr[i]);',
        '    }',
        '  }',
        '  return result;',
        '}',
      ].join('\n'),
    );
  });

  test('concise body in variable declaration', () => {
    const code = `const filtered = arr.filter((item) => item > 0);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (arr[i] > 0) {',
        '    result.push(arr[i]);',
        '  }',
        '}',
        'const filtered = result;',
      ].join('\n'),
    );
  });

  test('variable already named result — no alias emitted', () => {
    const code = `const result = arr.filter((item) => item > 0);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (arr[i] > 0) {',
        '    result.push(arr[i]);',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  test('concise body in assignment expression', () => {
    const code = `x = arr.filter((item) => item > 0);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (arr[i] > 0) {',
        '    result.push(arr[i]);',
        '  }',
        '}',
        'x = result;',
      ].join('\n'),
    );
  });

  test('concise body with item and index params', () => {
    const code = `const r = arr.filter((item, index) => index % 2 === 0);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (i % 2 === 0) {',
        '    result.push(arr[i]);',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('block body with intermediate statements and return', () => {
    const code = [
      'const r = arr.filter((item) => {',
      '  const value = item.trim();',
      '  return value.length > 0;',
      '});',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  const value = item.trim();',
        '  if (value.length > 0) {',
        '    result.push(item);',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('member expression array (this.items)', () => {
    const code = `const r = this.items.filter((item) => item.active);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < this.items.length; i++) {',
        '  if (this.items[i].active) {',
        '    result.push(this.items[i]);',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('no params concise body', () => {
    const code = `const r = arr.filter(() => true);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (true) {',
        '    result.push(arr[i]);',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });
});
