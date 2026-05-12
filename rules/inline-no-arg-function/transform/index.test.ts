import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import rule from './index.js';

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'inline-no-arg': rule } } },
    rules: { 'opt/inline-no-arg': 'error' as Linter.RuleEntry },
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
  test('function with parameters is not inlined', () => {
    expect(
      lint(`function add(a, b) { return a + b; }\nadd(1, 2);`),
    ).toHaveLength(0);
  });

  test('function returning a value is not inlined', () => {
    expect(
      lint(`function compute() { return 42; }\nconst x = compute();`),
    ).toHaveLength(0);
  });

  test('async function is not inlined', () => {
    expect(
      lint(`async function fetchData() { await doWork(); }\nfetchData();`),
    ).toHaveLength(0);
  });

  test('generator function is not inlined', () => {
    expect(
      lint(`function* gen() { yield 1; }\ngen();`),
    ).toHaveLength(0);
  });

  test('function using this is not inlined', () => {
    expect(
      lint(`function update() { this.count++; }\nupdate();`),
    ).toHaveLength(0);
  });

  test('function using arguments is not inlined', () => {
    expect(
      lint(`function log() { console.log(arguments[0]); }\nlog();`),
    ).toHaveLength(0);
  });

  test('function with var declaration is not inlined', () => {
    expect(
      lint(`function init() { var x = 1; total += x; }\ninit();`),
    ).toHaveLength(0);
  });

  test('function using eval is not inlined', () => {
    expect(
      lint(`function dynamic() { eval('x = 1'); }\ndynamic();`),
    ).toHaveLength(0);
  });

  test('function binding reassigned is not inlined', () => {
    expect(
      lint(`function reset() { count = 0; }\nreset = function() {};\nreset();`),
    ).toHaveLength(0);
  });

  test('method call (obj.func()) is not inlined', () => {
    expect(
      lint(`function reset() { count = 0; }\nobj.reset();`),
    ).toHaveLength(0);
  });

  test('call with arguments passed is not inlined', () => {
    // funcName() with unexpected argument — treated as a different call shape;
    // the rule only handles 0-argument plain calls.
    expect(
      lint(`function reset() { count = 0; }\nreset(extraArg);`),
    ).toHaveLength(0);
  });

  test('called in expression context (return value consumed) is not inlined', () => {
    // The return value is consumed — the call is not an ExpressionStatement.
    expect(
      lint(`function noop() { }\nconst x = noop();`),
    ).toHaveLength(0);
  });

  test('function with early bare return is not inlined', () => {
    expect(
      lint(`function maybeTick() { if (skip) return; counter++; }\nmaybeTick();`),
    ).toHaveLength(0);
  });

  test('function with new.target call is not inlined', () => {
    // Called with `new` — not a plain call.
    expect(
      lint(`function Init() { count = 0; }\nnew Init();`),
    ).toHaveLength(0);
  });

  test('function never called is not reported', () => {
    // A declaration with no call sites produces no inline opportunity.
    expect(
      lint(`function tick() { counter++; }`),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// invalid: rule reports and fixes
// ---------------------------------------------------------------------------

describe('invalid: rule reports and fixes', () => {
  test('single-statement body', () => {
    const code = [
      'let counter = 0;',
      'function tick() {',
      '  counter++;',
      '}',
      'for (let i = 0; i < 10; i++) {',
      '  tick();',
      '}',
    ].join('\n');

    const messages = lint(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('inlineNoArgFunction');

    // The declaration is removed and the call site is replaced with the
    // re-indented body block.
    expect(applyFix(code)).toBe(
      [
        'let counter = 0;',
        'for (let i = 0; i < 10; i++) {',
        '  {',
        '    counter++;',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  test('multi-statement body', () => {
    const code = [
      'let hits = 0;',
      'let misses = 0;',
      'function resetCounters() {',
      '  hits = 0;',
      '  misses = 0;',
      '}',
      'for (let i = 0; i < 5; i++) {',
      '  resetCounters();',
      '}',
    ].join('\n');

    const messages = lint(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('inlineNoArgFunction');

    const fixed = applyFix(code);
    // The function declaration is removed and the call is replaced by the body block.
    expect(fixed).toContain('hits = 0;');
    expect(fixed).toContain('misses = 0;');
    expect(fixed).not.toContain('function resetCounters');
    expect(fixed).not.toContain('resetCounters()');
  });

  test('body with let/const declarations (block-scoped)', () => {
    const code = [
      'let total = 0;',
      'function addBatch() {',
      '  const batch = 10;',
      '  let bonus = batch * 2;',
      '  total += bonus;',
      '}',
      'for (let i = 0; i < 3; i++) {',
      '  addBatch();',
      '}',
    ].join('\n');

    const messages = lint(code);
    expect(messages).toHaveLength(1);

    const fixed = applyFix(code);
    expect(fixed).toContain('const batch = 10;');
    expect(fixed).toContain('let bonus = batch * 2;');
    expect(fixed).not.toContain('function addBatch');
  });

  test('trailing bare return is allowed', () => {
    const code = [
      'let count = 0;',
      'function maybeInc() {',
      '  count++;',
      '  return;',
      '}',
      'for (let i = 0; i < 5; i++) {',
      '  maybeInc();',
      '}',
    ].join('\n');

    const messages = lint(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('inlineNoArgFunction');
  });

  test('multiple call sites are all replaced', () => {
    const code = [
      'let x = 0;',
      'function inc() {',
      '  x++;',
      '}',
      'inc();',
      'inc();',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).not.toContain('function inc');
    expect(fixed).not.toContain('inc();');
    // Both call sites replaced by the inlined body
    expect((fixed.match(/\{\n\s*x\+\+;\n\s*\}/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fixture-based tests: transform input → output matches recorded fixture
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  test('single-stmt fixture', () => {
    const input = fixture('single-stmt', 'input.js');
    const output = fixture('single-stmt', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('multi-stmt fixture', () => {
    const input = fixture('multi-stmt', 'input.js');
    const output = fixture('multi-stmt', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('nested-call fixture', () => {
    const input = fixture('nested-call', 'input.js');
    const output = fixture('nested-call', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('let-const-scoping fixture', () => {
    const input = fixture('let-const-scoping', 'input.js');
    const output = fixture('let-const-scoping', 'output.js');
    expect(applyFix(input)).toBe(output);
  });
});
