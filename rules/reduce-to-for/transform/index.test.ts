import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from './index.js';

const FIXTURES_DIR = new URL('../test/fixtures', import.meta.url).pathname;

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'reduce-to-for': rule } } },
    rules: { 'opt/reduce-to-for': 'error' as Linter.RuleEntry },
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
  test('sum-numbers: rule fires and produces correct output', () => {
    const input = fixture('sum-numbers', 'input.js');
    const output = fixture('sum-numbers', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('block-body: rule fires and produces correct output', () => {
    const input = fixture('block-body', 'input.js');
    const output = fixture('block-body', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('index-parameter: rule fires and produces correct output', () => {
    const input = fixture('index-parameter', 'input.js');
    const output = fixture('index-parameter', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('object-accumulator: rule fires and produces correct output', () => {
    const input = fixture('object-accumulator', 'input.js');
    const output = fixture('object-accumulator', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });
});

// ---------------------------------------------------------------------------
// Valid: rule must NOT report
// ---------------------------------------------------------------------------

describe('valid: rule does not report', () => {
  test('no initialValue (one-argument form) — implicit accumulator not supported', () => {
    expect(
      lint(`const s = arr.reduce((acc, item) => acc + item);`),
    ).toHaveLength(0);
  });

  test('function expression callback (not arrow)', () => {
    expect(
      lint(`const s = arr.reduce(function(acc, item) { return acc + item; }, 0);`),
    ).toHaveLength(0);
  });

  test('call expression as array (side-effectful, unsafe to re-evaluate)', () => {
    expect(
      lint(`const s = getArr().reduce((acc, item) => acc + item, 0);`),
    ).toHaveLength(0);
  });

  test('computed member expression as array', () => {
    expect(
      lint(`const s = obj[key].reduce((acc, item) => acc + item, 0);`),
    ).toHaveLength(0);
  });

  test('block body with no return (not a reducer)', () => {
    expect(
      lint(`const s = arr.reduce((acc, item) => { doSomething(item); }, 0);`),
    ).toHaveLength(0);
  });

  test('block body return without argument (bare return)', () => {
    expect(
      lint(`const s = arr.reduce((acc, item) => { if (!item) return; return acc + item; }, 0);`),
    ).toHaveLength(0);
  });

  test('result used in a nested expression (too complex to inline as statements)', () => {
    expect(
      lint(`process(arr.reduce((acc, item) => acc + item, 0));`),
    ).toHaveLength(0);
  });

  test('result discarded — standalone expression statement', () => {
    expect(
      lint(`arr.reduce((acc, item) => acc + item, 0);`),
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
      '  return arr.reduce((acc, item) => acc + item, 0);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'function run(arr) {',
        '  let acc = 0;',
        '  for (let i = 0; i < arr.length; i++) {',
        '    acc = acc + arr[i];',
        '  }',
        '  return acc;',
        '}',
      ].join('\n'),
    );
  });

  test('concise body in variable declaration', () => {
    const code = `const sum = arr.reduce((acc, item) => acc + item, 0);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'let acc = 0;',
        'for (let i = 0; i < arr.length; i++) {',
        '  acc = acc + arr[i];',
        '}',
        'const sum = acc;',
      ].join('\n'),
    );
  });

  test('variable already named same as accumulator param — no alias emitted', () => {
    const code = `const acc = arr.reduce((acc, item) => acc + item, 0);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'let acc = 0;',
        'for (let i = 0; i < arr.length; i++) {',
        '  acc = acc + arr[i];',
        '}',
      ].join('\n'),
    );
  });

  test('concise body in assignment expression', () => {
    const code = `total = arr.reduce((acc, item) => acc + item, 0);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'let acc = 0;',
        'for (let i = 0; i < arr.length; i++) {',
        '  acc = acc + arr[i];',
        '}',
        'total = acc;',
      ].join('\n'),
    );
  });

  test('concise body with item and index params', () => {
    const code = `const s = arr.reduce((acc, item, index) => acc + item * index, 0);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'let acc = 0;',
        'for (let i = 0; i < arr.length; i++) {',
        '  acc = acc + arr[i] * i;',
        '}',
        'const s = acc;',
      ].join('\n'),
    );
  });

  test('object accumulator — uses const, return acc is dropped', () => {
    const code = [
      'const grouped = arr.reduce((acc, item) => {',
      '  acc[item.key] = item.value;',
      '  return acc;',
      '}, {});',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const acc = {};',
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  acc[item.key] = item.value;',
        '}',
        'const grouped = acc;',
      ].join('\n'),
    );
  });

  test('array accumulator — uses const', () => {
    const code = `const doubled = arr.reduce((acc, item) => { acc.push(item * 2); return acc; }, []);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const acc = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  acc.push(item * 2);',
        '}',
        'const doubled = acc;',
      ].join('\n'),
    );
  });

  test('block body return with expression (non-pass-through)', () => {
    const code = [
      'const total = arr.reduce((acc, item) => {',
      '  const v = item.price * item.qty;',
      '  return acc + v;',
      '}, 0);',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'let acc = 0;',
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  const v = item.price * item.qty;',
        '  acc = acc + v;',
        '}',
        'const total = acc;',
      ].join('\n'),
    );
  });

  test('member expression array (this.items)', () => {
    const code = `const s = this.items.reduce((acc, item) => acc + item, 0);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'let acc = 0;',
        'for (let i = 0; i < this.items.length; i++) {',
        '  acc = acc + this.items[i];',
        '}',
        'const s = acc;',
      ].join('\n'),
    );
  });
});
