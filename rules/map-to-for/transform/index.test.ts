import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from './index.js';

const FIXTURES_DIR = new URL('../test/fixtures', import.meta.url).pathname;

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'map-to-for': rule } } },
    rules: { 'opt/map-to-for': 'error' as Linter.RuleEntry },
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
  test('basic-transform: rule fires and produces correct output', () => {
    const input = fixture('basic-transform', 'input.js');
    const output = fixture('basic-transform', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('item-and-index: rule fires and produces correct output', () => {
    const input = fixture('item-and-index', 'input.js');
    const output = fixture('item-and-index', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('multi-statement-body: rule fires and produces correct output', () => {
    const input = fixture('multi-statement-body', 'input.js');
    const output = fixture('multi-statement-body', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('empty-array: rule fires and produces correct output', () => {
    const input = fixture('empty-array', 'input.js');
    const output = fixture('empty-array', 'output.js');
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
      lint(`const r = arr.map(function(item) { return item * 2; });`),
    ).toHaveLength(0);
  });

  test('call expression as array (side-effectful, unsafe to re-evaluate)', () => {
    expect(
      lint(`const r = getArr().map((item) => item * 2);`),
    ).toHaveLength(0);
  });

  test('computed member expression as array', () => {
    expect(
      lint(`const r = obj[key].map((item) => item * 2);`),
    ).toHaveLength(0);
  });

  test('thisArg passed as second argument', () => {
    expect(
      lint(`const r = arr.map((item) => item * 2, ctx);`),
    ).toHaveLength(0);
  });

  test('block body with no return (void map — use foreach-to-for)', () => {
    expect(
      lint(`const r = arr.map((item) => { doSomething(item); });`),
    ).toHaveLength(0);
  });

  test('result not consumed — standalone expression statement (discarded map)', () => {
    // A discarded .map() result is not a safe candidate for map-to-for because
    // pre-allocating an array that is never read wastes memory.
    expect(lint(`arr.map((item) => item * 2);`)).toHaveLength(0);
  });

  test('result used in a nested expression (too complex to inline as statements)', () => {
    expect(
      lint(`process(arr.map((item) => item * 2));`),
    ).toHaveLength(0);
  });

  test('block body return without argument (bare return)', () => {
    expect(
      lint(`const r = arr.map((item) => { if (!item) return; return item * 2; });`),
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
      '  return arr.map((item) => item * 2);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'function run(arr) {',
        '  const result = new Array(arr.length);',
        '  for (let i = 0; i < arr.length; i++) {',
        '    result[i] = arr[i] * 2;',
        '  }',
        '  return result;',
        '}',
      ].join('\n'),
    );
  });

  test('concise body in variable declaration', () => {
    const code = `const mapped = arr.map((item) => item * 2);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = new Array(arr.length);',
        'for (let i = 0; i < arr.length; i++) {',
        '  result[i] = arr[i] * 2;',
        '}',
        'const mapped = result;',
      ].join('\n'),
    );
  });

  test('variable already named result — no alias emitted', () => {
    const code = `const result = arr.map((item) => item * 2);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = new Array(arr.length);',
        'for (let i = 0; i < arr.length; i++) {',
        '  result[i] = arr[i] * 2;',
        '}',
      ].join('\n'),
    );
  });

  test('concise body in assignment expression', () => {
    const code = `x = arr.map((item) => item * 2);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = new Array(arr.length);',
        'for (let i = 0; i < arr.length; i++) {',
        '  result[i] = arr[i] * 2;',
        '}',
        'x = result;',
      ].join('\n'),
    );
  });

  test('concise body with item and index params', () => {
    const code = `const r = arr.map((item, index) => \`\${index}:\${item}\`);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = new Array(arr.length);',
        'for (let i = 0; i < arr.length; i++) {',
        '  result[i] = `${i}:${arr[i]}`;',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('block body with single return statement', () => {
    const code = [
      'const r = arr.map((item) => {',
      '  return item * 2;',
      '});',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = new Array(arr.length);',
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  result[i] = item * 2;',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('block body with multi-statement and return', () => {
    const code = [
      'const r = arr.map((item) => {',
      '  const n = item.trim();',
      '  return n + "_suffix";',
      '});',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = new Array(arr.length);',
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  const n = item.trim();',
        '  result[i] = n + "_suffix";',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('member expression array (this.items)', () => {
    const code = `const r = this.items.map((item) => item * 2);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = new Array(this.items.length);',
        'for (let i = 0; i < this.items.length; i++) {',
        '  result[i] = this.items[i] * 2;',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('no params concise body', () => {
    const code = `const r = arr.map(() => 42);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = new Array(arr.length);',
        'for (let i = 0; i < arr.length; i++) {',
        '  result[i] = 42;',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });
});
