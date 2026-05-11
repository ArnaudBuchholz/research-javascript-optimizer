import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from './index.js';

const CONFIG: Linter.Config[] = [
  {
    plugins: { opt: { rules: { foreach: rule } } },
    rules: { 'opt/foreach': 'error' as Linter.RuleEntry },
    languageOptions: { ecmaVersion: 2022 },
  },
];

function lint(code: string) {
  return new Linter({ configType: 'flat' }).verify(code, CONFIG);
}

function applyFix(code: string): string {
  return new Linter({ configType: 'flat' }).verifyAndFix(code, CONFIG).output;
}

describe('valid: rule does not report', () => {
  test('function expression callback', () => {
    expect(lint(`arr.forEach(function(item) { doSomething(item); });`)).toHaveLength(0);
  });

  test('arrow with top-level return', () => {
    expect(
      lint(`arr.forEach((item) => { if (item > 0) return; doSomething(item); });`),
    ).toHaveLength(0);
  });

  test('call expression as array (unsafe to re-evaluate)', () => {
    expect(lint(`getArr().forEach((item) => { doSomething(item); });`)).toHaveLength(0);
  });

  test('expression body (not a block)', () => {
    expect(lint(`arr.forEach((item) => doSomething(item));`)).toHaveLength(0);
  });

  test('two arguments (second is thisArg)', () => {
    expect(
      lint(`arr.forEach((item) => { doSomething(item); }, ctx);`),
    ).toHaveLength(0);
  });
});

describe('invalid: rule reports and fixes', () => {
  test('single parameter', () => {
    const code = ['arr.forEach((item) => {', '  doSomething(item);', '});'].join('\n');
    const messages = lint(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('preferForLoop');
    expect(applyFix(code)).toBe(
      ['for (let i = 0; i < arr.length; i++) {', '  const item = arr[i];', '  doSomething(item);', '}'].join('\n'),
    );
  });

  test('two parameters (item + index)', () => {
    const code = ['arr.forEach((item, index) => {', '  result.push(item, index);', '});'].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  const index = i;',
        '  result.push(item, index);',
        '}',
      ].join('\n'),
    );
  });

  test('no parameters', () => {
    const code = ['arr.forEach(() => {', '  counter++;', '});'].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      ['for (let i = 0; i < arr.length; i++) {', '  counter++;', '}'].join('\n'),
    );
  });

  test('three parameters (item + index + srcArray)', () => {
    const code = [
      'arr.forEach((item, index, srcArray) => {',
      '  result.push(item, index, srcArray.length);',
      '});',
    ].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < arr.length; i++) {',
        '  const item = arr[i];',
        '  const index = i;',
        '  const srcArray = arr;',
        '  result.push(item, index, srcArray.length);',
        '}',
      ].join('\n'),
    );
  });

  test('member expression array (this.items)', () => {
    const code = ['this.items.forEach((item) => {', '  process(item);', '});'].join('\n');
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

  test('destructuring parameter', () => {
    const code = ['arr.forEach(({ id, name }) => {', '  process(id, name);', '});'].join('\n');
    expect(lint(code)).toHaveLength(1);
    expect(applyFix(code)).toBe(
      [
        'for (let i = 0; i < arr.length; i++) {',
        '  const { id, name } = arr[i];',
        '  process(id, name);',
        '}',
      ].join('\n'),
    );
  });
});
