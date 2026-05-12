import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import rule from './index.js';

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { 'inline-early-exit': rule } } },
    rules: { 'opt/inline-early-exit': 'error' as Linter.RuleEntry },
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
  test('no-arg function with no early return is not reported (inline-no-arg-function rule)', () => {
    expect(
      lint(`function tick() { counter++; }\ntick();`),
    ).toHaveLength(0);
  });

  test('function with only a value-returning return is not reported', () => {
    expect(
      lint(`function add(a, b) { return a + b; }\nadd(1, 2);`),
    ).toHaveLength(0);
  });

  test('function with no early returns is not reported (inline-parameterized-function rule)', () => {
    expect(
      lint(`function push(v) { arr.push(v); }\npush(1);`),
    ).toHaveLength(0);
  });

  test('function mixing early bare return with value-returning return is not reported', () => {
    // A mix of return; and return <expr> requires a combined rule — decline.
    expect(
      lint(`function get(v) { if (!v) return; return v * 2; }\nget(x);`),
    ).toHaveLength(0);
  });

  test('async function is not reported', () => {
    expect(
      lint(`async function guard(v) { if (!v) return; await write(v); }\nguard(1);`),
    ).toHaveLength(0);
  });

  test('generator function is not reported', () => {
    expect(
      lint(`function* gen(n) { if (!n) return; yield n; }\ngen(1);`),
    ).toHaveLength(0);
  });

  test('function using this is not reported', () => {
    expect(
      lint(`function update(v) { if (!v) return; this.count = v; }\nupdate(1);`),
    ).toHaveLength(0);
  });

  test('function using arguments is not reported', () => {
    expect(
      lint(`function log(prefix) { if (!prefix) return; console.log(arguments[1]); }\nlog('x');`),
    ).toHaveLength(0);
  });

  test('function with var declaration is not reported', () => {
    expect(
      lint(`function init(n) { if (!n) return; var x = n; total += x; }\ninit(5);`),
    ).toHaveLength(0);
  });

  test('function using eval is not reported', () => {
    expect(
      lint(`function dynamic(code) { if (!code) return; eval(code); }\ndynamic('x=1');`),
    ).toHaveLength(0);
  });

  test('function binding reassigned is not reported', () => {
    expect(
      lint(`function guard(v) { if (!v) return; count = v; }\nguard = function(v) {};\nguard(0);`),
    ).toHaveLength(0);
  });

  test('method call is not reported', () => {
    expect(
      lint(`function guard(v) { if (!v) return; arr.push(v); }\nobj.guard(1);`),
    ).toHaveLength(0);
  });

  test('call in expression context is not reported', () => {
    expect(
      lint(`function guard(v) { if (!v) return; total += v; }\nconst x = guard(1);`),
    ).toHaveLength(0);
  });

  test('rest parameter is not reported', () => {
    expect(
      lint(`function guard(...args) { if (!args.length) return; total++; }\nguard(1, 2);`),
    ).toHaveLength(0);
  });

  test('destructuring parameter is not reported', () => {
    expect(
      lint(`function guard({ key }) { if (!key) return; map[key] = 1; }\nguard({ key: 'a' });`),
    ).toHaveLength(0);
  });

  test('call with spread argument is not reported', () => {
    expect(
      lint(`function guard(a, b) { if (!a) return; total += a + b; }\nguard(...pair);`),
    ).toHaveLength(0);
  });

  test('function never called is not reported', () => {
    expect(
      lint(`function guard(v) { if (!v) return; total += v; }`),
    ).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// invalid: rule reports and fixes
// ---------------------------------------------------------------------------

describe('invalid: rule reports and fixes', () => {
  test('zero-param function with early-exit reports and wraps in do-while', () => {
    const code = [
      'let counter = 0;',
      'const MAX = 5;',
      'function guard() {',
      '  if (counter > MAX) return;',
      '  counter++;',
      '}',
      'for (let i = 0; i < 10; i++) {',
      '  guard();',
      '}',
    ].join('\n');

    const messages = lint(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('inlineEarlyExitFunction');

    const fixed = applyFix(code);
    expect(fixed).toContain('do {');
    expect(fixed).toContain('} while (0)');
    expect(fixed).toContain('break;');
    expect(fixed).not.toContain('return;');
    expect(fixed).not.toContain('function guard');
    expect(fixed).not.toContain('guard()');
  });

  test('single-param function with early-exit emits const binding outside do-while', () => {
    const code = [
      'let total = 0;',
      'function addIfPositive(v) {',
      '  if (v <= 0) return;',
      '  total += v;',
      '}',
      'for (let i = 0; i < 10; i++) {',
      '  addIfPositive(data[i]);',
      '}',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const v = data[i];');
    expect(fixed).toContain('do {');
    expect(fixed).toContain('} while (0)');
    expect(fixed).toContain('break;');
    expect(fixed).not.toContain('return;');
    expect(fixed).not.toContain('function addIfPositive');
  });

  test('two-param function with two guards produces two const bindings', () => {
    const code = [
      'let results = [];',
      'function process(item, threshold) {',
      '  if (!item.active) return;',
      '  if (item.score < threshold) return;',
      '  results.push(item.value);',
      '}',
      'for (let i = 0; i < data.length; i++) {',
      '  process(data[i], 50);',
      '}',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const item = data[i];');
    expect(fixed).toContain('const threshold = 50;');
    expect(fixed).toContain('do {');
    expect(fixed).not.toContain('function process');
  });

  test('param name colliding with outer binding is renamed with trailing underscore', () => {
    // `raw` is declared in the for-of loop; the parameter `raw` must be renamed.
    const code = [
      'const cache = {};',
      'function maybeStore(raw) {',
      '  if (raw === null) return;',
      '  cache[raw] = raw;',
      '}',
      'for (const raw of inputs) {',
      '  maybeStore(raw);',
      '}',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const raw_ = raw;');
    expect(fixed).toContain('cache[raw_] = raw_;');
    expect(fixed).not.toContain('function maybeStore');
  });

  test('multiple call sites are all replaced', () => {
    const code = [
      'let total = 0;',
      'function addV(v) {',
      '  if (v < 0) return;',
      '  total += v;',
      '}',
      'addV(1);',
      'addV(2);',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).not.toContain('function addV');
    expect(fixed).not.toContain('addV(');
    expect((fixed.match(/const v = /g) ?? []).length).toBe(2);
  });

  test('trailing-only bare return at end of body is not considered an early exit', () => {
    // A function that only has `return;` as the last statement — not an early exit.
    // That's the inline-parameterized-function case, not this rule.
    const code = [
      'let total = 0;',
      'function addV(v) {',
      '  total += v;',
      '  return;',
      '}',
      'addV(data[0]);',
    ].join('\n');

    // Should NOT be reported by THIS rule (no early return).
    expect(lint(code)).toHaveLength(0);
  });

  test('body with local const/let declarations inside do-while stays block-scoped', () => {
    const code = [
      'const cache = {};',
      'function maybeStore(raw) {',
      '  const parsed = raw !== null ? { id: raw } : null;',
      '  if (parsed === null) return;',
      '  const key = parsed.id.toString();',
      '  cache[key] = parsed;',
      '}',
      'for (const x of inputs) {',
      '  maybeStore(x);',
      '}',
    ].join('\n');

    const fixed = applyFix(code);
    expect(fixed).toContain('const raw = x;');
    expect(fixed).toContain('do {');
    expect(fixed).toContain('const parsed =');
    expect(fixed).toContain('const key =');
    expect(fixed).not.toContain('function maybeStore');
  });

  test('break inside inner for loop is safe — function with early exit and inner loop is inlined', () => {
    // The break inside the inner `for` loop targets that loop, not the inlined
    // `do {} while (0)` — so the function is safe to inline and IS reported.
    const messages = lint(
      `function scan(items) { if (items.length === 0) return; for (let i = 0; i < items.length; i++) { if (items[i] > 10) break; total++; } }\nscan(data);`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('inlineEarlyExitFunction');
  });
});

// ---------------------------------------------------------------------------
// Fixture-based tests: transform input → output matches recorded fixture
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  test('two-guard-filter fixture', () => {
    const input = fixture('two-guard-filter', 'input.js');
    const output = fixture('two-guard-filter', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('zero-param-guard fixture', () => {
    const input = fixture('zero-param-guard', 'input.js');
    const output = fixture('zero-param-guard', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('local-vars-in-body fixture', () => {
    const input = fixture('local-vars-in-body', 'input.js');
    const output = fixture('local-vars-in-body', 'output.js');
    expect(applyFix(input)).toBe(output);
  });

  test('break-does-not-escape-loop fixture', () => {
    const input = fixture('break-does-not-escape-loop', 'input.js');
    const output = fixture('break-does-not-escape-loop', 'output.js');
    expect(applyFix(input)).toBe(output);
  });
});
