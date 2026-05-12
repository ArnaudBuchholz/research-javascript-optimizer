import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from './index.js';

const FIXTURES_DIR = new URL('../test/fixtures', import.meta.url).pathname;

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'array-spread-concat': rule } } },
    rules: { 'opt/array-spread-concat': 'error' as Linter.RuleEntry },
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
  test('two-arrays: rule fires and produces correct output', () => {
    const input = fixture('two-arrays', 'input.js');
    const output = fixture('two-arrays', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('three-arrays: rule fires and produces correct output', () => {
    const input = fixture('three-arrays', 'input.js');
    const output = fixture('three-arrays', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });

  test('mixed-literals: rule fires and produces correct output', () => {
    const input = fixture('mixed-literals', 'input.js');
    const output = fixture('mixed-literals', 'output.js');
    expect(lint(input)).toHaveLength(1);
    expect(applyFix(input)).toBe(output);
  });
});

// ---------------------------------------------------------------------------
// Valid: rule must NOT report
// ---------------------------------------------------------------------------

describe('valid: rule does not report', () => {
  test('array literal with no spreads — plain array creation, not a concat pattern', () => {
    expect(lint(`const r = [1, 2, 3];`)).toHaveLength(0);
  });

  test('single spread operand — not a concat (just a copy)', () => {
    // [...a] is a copy, not a concatenation of multiple sources; no benefit from concat.
    expect(lint(`const r = [...a];`)).toHaveLength(0);
  });

  test('spread of a function call — side-effectful, unsafe to re-evaluate', () => {
    expect(lint(`const r = [...getA(), ...b];`)).toHaveLength(0);
  });

  test('spread of a computed member expression — side-effectful key access', () => {
    expect(lint(`const r = [...obj[key], ...b];`)).toHaveLength(0);
  });

  test('result discarded — bare expression statement, not consumed', () => {
    // A discarded array literal is semantically meaningless regardless.
    expect(lint(`[...a, ...b];`)).toHaveLength(0);
  });

  test('array with holes (sparse array) — concat copies holes differently than spread', () => {
    // Trailing comma creates a hole: [1, , 3]
    expect(lint(`const r = [1, , ...b];`)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid: rule reports and fix is correct
// ---------------------------------------------------------------------------

describe('invalid: rule reports and fixes', () => {
  test('two-array spread in variable declaration', () => {
    const code = `const r = [...a, ...b];`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`const r = a.concat(b);`);
  });

  test('three-array spread in variable declaration', () => {
    const code = `const r = [...a, ...b, ...c];`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`const r = a.concat(b, c);`);
  });

  test('four-array spread', () => {
    const code = `const r = [...a, ...b, ...c, ...d];`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`const r = a.concat(b, c, d);`);
  });

  test('mixed: leading literal, one spread', () => {
    const code = `const r = [x, ...a];`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`const r = [x].concat(a);`);
  });

  test('mixed: one spread, trailing literal', () => {
    const code = `const r = [...a, x];`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`const r = a.concat([x]);`);
  });

  test('mixed: leading literal, spread, trailing literal', () => {
    const code = `const r = [first, ...middle, last];`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`const r = [first].concat(middle, [last]);`);
  });

  test('mixed: multiple leading literals and one spread', () => {
    const code = `const r = [x, y, ...a];`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`const r = [x, y].concat(a);`);
  });

  test('two-array spread in return statement', () => {
    const code = ['function run(a, b) {', '  return [...a, ...b];', '}'].join(
      '\n',
    );
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      ['function run(a, b) {', '  return a.concat(b);', '}'].join('\n'),
    );
  });

  test('two-array spread in assignment expression statement', () => {
    const code = `x = [...a, ...b];`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`x = a.concat(b);`);
  });

  test('spread of member expression chains', () => {
    const code = `const r = [...this.items, ...obj.list];`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`const r = this.items.concat(obj.list);`);
  });

  test('spread used inline as argument — fixer replaces array literal only', () => {
    const code = `process([...a, ...b]);`;
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(`process(a.concat(b));`);
  });
});
