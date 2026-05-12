import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from './index.js';

const FIXTURES_DIR = new URL('../test/fixtures', import.meta.url).pathname;

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'chained-array-methods': rule } } },
    rules: {
      'opt/chained-array-methods': 'error' as Linter.RuleEntry,
    },
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
  test('basic-filter-map: rule fires and produces correct output', () => {
    const input = fixture('basic-filter-map', 'input.js');
    const output = fixture('basic-filter-map', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('map-uses-index: rule fires and produces correct output', () => {
    const input = fixture('map-uses-index', 'input.js');
    const output = fixture('map-uses-index', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('multi-statement-callbacks: rule fires and produces correct output', () => {
    const input = fixture('multi-statement-callbacks', 'input.js');
    const output = fixture('multi-statement-callbacks', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('empty-array: rule fires and produces correct output', () => {
    const input = fixture('empty-array', 'input.js');
    const output = fixture('empty-array', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('all-filtered-out: rule fires and produces correct output', () => {
    const input = fixture('all-filtered-out', 'input.js');
    const output = fixture('all-filtered-out', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });
});

// ---------------------------------------------------------------------------
// Valid: rule must NOT report
// ---------------------------------------------------------------------------

describe('valid: rule does not report', () => {
  test('standalone .map() without a .filter() callee', () => {
    expect(
      lint(`const r = arr.map((item) => item * 2);`),
    ).toHaveLength(0);
  });

  test('standalone .filter() without a .map() callee', () => {
    expect(
      lint(`const r = arr.filter((item) => item > 0);`),
    ).toHaveLength(0);
  });

  test('filter callback is a regular function expression (not arrow)', () => {
    expect(
      lint(`const r = arr.filter(function(item) { return item > 0; }).map((item) => item * 2);`),
    ).toHaveLength(0);
  });

  test('map callback is a regular function expression (not arrow)', () => {
    expect(
      lint(`const r = arr.filter((item) => item > 0).map(function(item) { return item * 2; });`),
    ).toHaveLength(0);
  });

  test('call expression as array (side-effectful, unsafe to re-evaluate)', () => {
    expect(
      lint(`const r = getArr().filter((item) => item.active).map((item) => item.value);`),
    ).toHaveLength(0);
  });

  test('computed member expression as array', () => {
    expect(
      lint(`const r = obj[key].filter((item) => item > 0).map((item) => item * 2);`),
    ).toHaveLength(0);
  });

  test('thisArg passed to filter', () => {
    expect(
      lint(`const r = arr.filter((item) => item > 0, ctx).map((item) => item * 2);`),
    ).toHaveLength(0);
  });

  test('thisArg passed to map', () => {
    expect(
      lint(`const r = arr.filter((item) => item > 0).map((item) => item * 2, ctx);`),
    ).toHaveLength(0);
  });

  test('filter callback uses its third array argument', () => {
    expect(
      lint(`const r = arr.filter((item, i, arr) => arr.includes(item)).map((item) => item * 2);`),
    ).toHaveLength(0);
  });

  test('map callback uses its third array argument', () => {
    expect(
      lint(`const r = arr.filter((item) => item > 0).map((item, i, filtered) => filtered.length);`),
    ).toHaveLength(0);
  });

  test('triple chain .filter().map().filter() — not exactly two steps', () => {
    expect(
      lint(`const r = arr.filter((x) => x > 0).map((x) => x * 2).filter((x) => x < 10);`),
    ).toHaveLength(0);
  });

  test('result not consumed — discarded chain expression', () => {
    expect(
      lint(`arr.filter((item) => item.active).map((item) => item.value);`),
    ).toHaveLength(0);
  });

  test('result used in a nested expression (too complex to inline as statements)', () => {
    expect(
      lint(`process(arr.filter((item) => item.active).map((item) => item.value));`),
    ).toHaveLength(0);
  });

  test('filter block body with no return — not a predicate', () => {
    expect(
      lint(`const r = arr.filter((item) => { doSomething(item); }).map((item) => item.value);`),
    ).toHaveLength(0);
  });

  test('filter block body with bare return (no argument)', () => {
    expect(
      lint(`const r = arr.filter((item) => { if (!item) return; return item > 0; }).map((item) => item * 2);`),
    ).toHaveLength(0);
  });

  test('map block body with no return — void map', () => {
    expect(
      lint(`const r = arr.filter((item) => item > 0).map((item) => { doSomething(item); });`),
    ).toHaveLength(0);
  });

  test('map block body with bare return (no argument)', () => {
    expect(
      lint(`const r = arr.filter((item) => item > 0).map((item) => { if (!item) return; return item * 2; });`),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid: rule reports and fix is correct
// ---------------------------------------------------------------------------

describe('invalid: rule reports and fixes', () => {
  test('both concise bodies in return statement', () => {
    const code = [
      'function run(arr) {',
      '  return arr.filter((item) => item.active).map((item) => item.value);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'function run(arr) {',
        '  const result = [];',
        '  for (let i = 0; i < arr.length; i++) {',
        '    if (arr[i].active) {',
        '      result.push(arr[i].value);',
        '    }',
        '  }',
        '  return result;',
        '}',
      ].join('\n'),
    );
  });

  test('both concise bodies in variable declaration', () => {
    const code = `const values = arr.filter((item) => item.active).map((item) => item.value);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (arr[i].active) {',
        '    result.push(arr[i].value);',
        '  }',
        '}',
        'const values = result;',
      ].join('\n'),
    );
  });

  test('variable already named result — no alias emitted', () => {
    const code = `const result = arr.filter((item) => item.active).map((item) => item.value);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (arr[i].active) {',
        '    result.push(arr[i].value);',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  test('both concise bodies in assignment expression', () => {
    const code = `x = arr.filter((item) => item.active).map((item) => item.value);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (arr[i].active) {',
        '    result.push(arr[i].value);',
        '  }',
        '}',
        'x = result;',
      ].join('\n'),
    );
  });

  test('map callback uses index — emits mappedIndex counter', () => {
    const code = `const r = arr.filter((item) => item.enabled).map((item, index) => \`\${index}: \${item.name}\`);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'let mappedIndex = 0;',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (arr[i].enabled) {',
        '    result.push(`${mappedIndex}: ${arr[i].name}`);',
        '    mappedIndex++;',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('filter concise + map has index only param (no item param)', () => {
    // Map callback that only uses the index, not the element
    const code = `const r = arr.filter((x) => x > 0).map((_item, idx) => idx);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'let mappedIndex = 0;',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (arr[i] > 0) {',
        '    result.push(mappedIndex);',
        '    mappedIndex++;',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('filter and map with index in filter (filter uses index param)', () => {
    const code = `const r = arr.filter((item, idx) => idx % 2 === 0).map((item) => item * 2);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (i % 2 === 0) {',
        '    result.push(arr[i] * 2);',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('member expression array (this.items)', () => {
    const code = `const r = this.items.filter((item) => item.active).map((item) => item.value);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < this.items.length; i++) {',
        '  if (this.items[i].active) {',
        '    result.push(this.items[i].value);',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('filter block body + map concise body', () => {
    const code = [
      'const r = arr.filter((item) => {',
      '  const score = compute(item);',
      '  return score > threshold;',
      '}).map((item) => item.value);',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  const score = compute(item);',
        '  if (score > threshold) {',
        '    result.push(item.value);',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('filter concise body + map block body', () => {
    const code = [
      'const r = arr.filter((item) => item.active).map((item) => {',
      '  const label = item.name.trim();',
      '  return label + "!";',
      '});',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  if (item.active) {',
        '    const label = item.name.trim();',
        '    result.push(label + "!");',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('no params on filter callback', () => {
    const code = `const r = arr.filter(() => true).map((item) => item * 2);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (true) {',
        '    result.push(arr[i] * 2);',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('no params on map callback', () => {
    const code = `const r = arr.filter((item) => item > 0).map(() => 42);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'const result = [];',
        'for (let i = 0; i < arr.length; i++) {',
        '  if (arr[i] > 0) {',
        '    result.push(42);',
        '  }',
        '}',
        'const r = result;',
      ].join('\n'),
    );
  });

  test('indented return statement — generated code preserves indentation', () => {
    const code = [
      'function run(arr) {',
      '  function inner() {',
      '    return arr.filter((item) => item.active).map((item) => item.value);',
      '  }',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'function run(arr) {',
        '  function inner() {',
        '    const result = [];',
        '    for (let i = 0; i < arr.length; i++) {',
        '      if (arr[i].active) {',
        '        result.push(arr[i].value);',
        '      }',
        '    }',
        '    return result;',
        '  }',
        '}',
      ].join('\n'),
    );
  });
});
