import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from './index.js';

const FIXTURES_DIR = new URL('../test/fixtures', import.meta.url).pathname;

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'for-of-to-for': rule } } },
    rules: { 'opt/for-of-to-for': 'error' as Linter.RuleEntry },
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
  test('simple-values: rule fires and produces correct output', () => {
    const input = fixture('simple-values', 'input.js');
    const output = fixture('simple-values', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('entries-index: rule fires and produces correct output', () => {
    const input = fixture('entries-index', 'input.js');
    const output = fixture('entries-index', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('array-of-objects: rule fires and produces correct output', () => {
    const input = fixture('array-of-objects', 'input.js');
    const output = fixture('array-of-objects', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('early-break: rule fires and produces correct output', () => {
    const input = fixture('early-break', 'input.js');
    const output = fixture('early-break', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });
});

// ---------------------------------------------------------------------------
// Valid: rule must NOT report
// ---------------------------------------------------------------------------

describe('valid: rule does not report', () => {
  test('for await...of (async iteration — different semantics)', () => {
    expect(
      lint(`async function run(gen) { for await (const item of gen) { use(item); } }`),
    ).toHaveLength(0);
  });

  test('iterable is a call expression (side-effectful, unsafe to re-evaluate)', () => {
    expect(
      lint(`for (const item of getItems()) { use(item); }`),
    ).toHaveLength(0);
  });

  test('iterable is a computed member expression (unsafe to re-evaluate)', () => {
    expect(
      lint(`for (const item of obj[key]) { use(item); }`),
    ).toHaveLength(0);
  });

  test('loop variable is not const (let/var bindings not rewritten)', () => {
    expect(
      lint(`for (let item of arr) { use(item); }`),
    ).toHaveLength(0);
  });

  test('entries() call with extra arguments (non-standard usage)', () => {
    expect(
      lint(`for (const [i, v] of arr.entries(extraArg)) { use(i, v); }`),
    ).toHaveLength(0);
  });

  test('entries() pattern with only one element (not a two-element destructure)', () => {
    expect(
      lint(`for (const [item] of arr.entries()) { use(item); }`),
    ).toHaveLength(0);
  });

  test('entries() pattern where index or item is not a plain identifier', () => {
    // Nested destructuring in entries pattern — not handled by this rule.
    expect(
      lint(`for (const [i, { x }] of arr.entries()) { use(i, x); }`),
    ).toHaveLength(0);
  });

  test('entries() called on a call expression (unsafe array source)', () => {
    expect(
      lint(`for (const [i, v] of getItems().entries()) { use(i, v); }`),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid: rule reports and fix is correct
// ---------------------------------------------------------------------------

describe('invalid: rule reports and fixes', () => {
  test('simple identifier variable and plain array identifier', () => {
    const code = [
      'for (const item of arr) {',
      '  doSomething(item);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  doSomething(item);',
        '}',
      ].join('\n'),
    );
  });

  test('member expression array (this.items)', () => {
    const code = [
      'for (const item of this.items) {',
      '  process(item);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < this.items.length; i++) {',
        '  const item = this.items[i];',
        '  process(item);',
        '}',
      ].join('\n'),
    );
  });

  test('destructuring pattern (object destructure)', () => {
    const code = [
      'for (const { id, name } of users) {',
      '  process(id, name);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < users.length; i++) {',
        '  const { id, name } = users[i];',
        '  process(id, name);',
        '}',
      ].join('\n'),
    );
  });

  test('entries() form replaces index and item references in body', () => {
    const code = [
      'for (const [idx, val] of arr.entries()) {',
      '  result.push(idx + val);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < arr.length; i++) {',
        '  result.push(i + arr[i]);',
        '}',
      ].join('\n'),
    );
  });

  test('entries() form with member expression array (this.list)', () => {
    const code = [
      'for (const [index, item] of this.list.entries()) {',
      '  log(index, item);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < this.list.length; i++) {',
        '  log(i, this.list[i]);',
        '}',
      ].join('\n'),
    );
  });

  test('loop with break (break/return semantics are preserved)', () => {
    const code = [
      'for (const item of arr) {',
      '  if (item > 10) break;',
      '  use(item);',
      '}',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  if (item > 10) break;',
        '  use(item);',
        '}',
      ].join('\n'),
    );
  });

  test('no-braces body is wrapped in a block', () => {
    const code = `for (const item of arr) use(item);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  use(item);',
        '}',
      ].join('\n'),
    );
  });
});
