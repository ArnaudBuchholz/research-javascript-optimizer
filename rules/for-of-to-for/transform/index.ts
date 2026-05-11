// ESLint rule with auto-fix rather than a jscodeshift codemod: `for...of` loops
// can appear anywhere in a codebase and are written continuously, so ongoing CI
// enforcement via an ESLint rule is more appropriate than a one-off migration.

import type { Rule } from 'eslint';
import type {
  Node,
  Pattern,
  ForOfStatement,
  Statement,
  BlockStatement,
  Identifier,
  MemberExpression,
  ArrayPattern,
  Expression,
} from 'estree';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Only rewrites when the iterable expression is side-effect-free and can be
// safely re-evaluated for `array.length` and `array[i]` accesses.
function isSafeExpression(node: Node): boolean {
  if (node.type === 'Identifier') return true;
  if (node.type === 'ThisExpression') return true;
  if (node.type === 'MemberExpression' && !node.computed) {
    return isSafeExpression(node.object);
  }
  return false;
}

// Extracts [indexName, itemName] from a `const [index, item] of array.entries()` pattern.
// Returns null when the pattern does not match the two-element destructure form.
function extractEntriesPattern(
  left: Pattern,
): [string, string] | null {
  if (left.type !== 'ArrayPattern') return null;
  const arr = left as ArrayPattern;
  if (arr.elements.length !== 2) return null;
  const [first, second] = arr.elements;
  if (!first || first.type !== 'Identifier') return null;
  if (!second || second.type !== 'Identifier') return null;
  return [(first as Identifier).name, (second as Identifier).name];
}

// Detect `array.entries()` call: the right side must be a CallExpression with
// no arguments, whose callee is a non-computed MemberExpression whose property
// is the identifier `entries`, and whose object is a safe expression.
function extractEntriesTarget(
  right: Expression,
): Node | null {
  if (right.type !== 'CallExpression') return null;
  if (right.arguments.length !== 0) return null;
  const callee = right.callee;
  if (callee.type !== 'MemberExpression') return null;
  if (callee.computed) return null;
  if (
    callee.property.type !== 'Identifier' ||
    (callee.property as Identifier).name !== 'entries'
  )
    return null;
  if (!isSafeExpression(callee.object)) return null;
  return callee.object;
}

// Normalises the loop body to a string without outer braces (when it is a
// block) or as a single indented statement (when it is a bare statement).
// The returned string is ready to be spliced inside `{ ... }`.
function getBodyText(
  src: ReturnType<Rule.RuleContext['getSourceCode']>,
  body: Statement,
): string {
  if (body.type === 'BlockStatement') {
    const raw = src.getText(body as Node);
    // Strip the opening `{` and closing `}`, keeping the interior verbatim.
    return raw.slice(1, -1);
  }
  // Bare statement body (no braces): wrap so the generated loop has a block.
  return `\n  ${src.getText(body as Node)}\n`;
}

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    schema: [],
    messages: {
      preferForLoop:
        'Prefer an indexed for loop over for...of to eliminate iterator protocol overhead.',
    },
  },

  create(context) {
    return {
      ForOfStatement(node: ForOfStatement) {
        // `for await (... of ...)` is async iteration — semantics differ; skip.
        if (node.await) return;

        const left = node.left;
        const right = node.right as Expression;

        // The loop variable must be declared with `const` (VariableDeclaration
        // with a single declarator). Patterns like `for (item of arr)` where
        // `item` is an existing binding would require `let` or `var` and are
        // more complex to analyse safely.
        if (
          left.type !== 'VariableDeclaration' ||
          left.kind !== 'const' ||
          left.declarations.length !== 1
        )
          return;

        const declarator = left.declarations[0];
        const varPattern = declarator.id;
        const body = node.body as Statement;

        // -----------------------------------------------------------------------
        // Form 1: `for (const [index, item] of array.entries())`
        // -----------------------------------------------------------------------
        const entriesTarget = extractEntriesTarget(right);
        if (entriesTarget !== null) {
          const names = extractEntriesPattern(varPattern);
          if (names === null) return;
          const [indexName, itemName] = names;

          const src = context.getSourceCode();
          const arraySource = src.getText(entriesTarget);
          const innerBody = getBodyText(src, body);

          context.report({
            node: node as unknown as Node,
            messageId: 'preferForLoop',
            fix(fixer) {
              // Replace [index, item] references with i and array[i] in the body.
              // The body text is re-used verbatim after variable substitution so
              // that comments and whitespace inside the original loop are kept.
              let newBody = innerBody;

              // Substitute itemName → array[i] before indexName → i so that a
              // name like `index` appearing inside `items` is not double-replaced.
              newBody = substituteIdentifier(newBody, itemName, `${arraySource}[i]`);
              newBody = substituteIdentifier(newBody, indexName, 'i');

              const forLoop =
                `for (let i = 0; i < ${arraySource}.length; i++) {` +
                newBody +
                '}';

              return fixer.replaceText(node as unknown as Node, forLoop);
            },
          });
          return;
        }

        // -----------------------------------------------------------------------
        // Form 2: `for (const item of array)` — simple value iteration
        // -----------------------------------------------------------------------

        // The iterable must be a safe expression (Identifier or dot-chained
        // MemberExpression) so that `array.length` and `array[i]` are valid.
        if (!isSafeExpression(right)) return;

        // Only handle a simple Identifier or destructuring pattern as the loop
        // variable. Other left-hand patterns (e.g. nested destructuring with
        // defaults) are left for a future rule extension.
        if (
          varPattern.type !== 'Identifier' &&
          varPattern.type !== 'ObjectPattern' &&
          varPattern.type !== 'ArrayPattern'
        )
          return;

        const src = context.getSourceCode();
        const arraySource = src.getText(right as Node);
        const varSource = src.getText(varPattern as Node);
        const innerBody = getBodyText(src, body);

        context.report({
          node: node as unknown as Node,
          messageId: 'preferForLoop',
          fix(fixer) {
            // Prepend `const <pattern> = array[i];` as the first statement in
            // the loop body so that all existing references inside `innerBody`
            // continue to resolve correctly without any text substitution.
            //
            // The indentation of the injected declaration must match the
            // indentation already used by the existing body statements so that
            // the generated loop is consistently formatted regardless of
            // nesting depth.
            const bodyIndent = detectIndent(innerBody);
            const forLoop =
              `for (let i = 0; i < ${arraySource}.length; i++) {\n` +
              `${bodyIndent}const ${varSource} = ${arraySource}[i];` +
              innerBody +
              '}';

            return fixer.replaceText(node as unknown as Node, forLoop);
          },
        });
      },
    };
  },
};

// Returns the leading whitespace of the first non-empty line in `text`.
// Used to align the injected `const` declaration with the existing body lines.
function detectIndent(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) {
      const match = /^(\s*)/.exec(line);
      return match ? match[1] : '';
    }
  }
  return '  ';
}

// Substitute every whole-word occurrence of `name` with `replacement` in
// `source`. Word boundaries prevent replacing `index` inside `indexCount`.
function substituteIdentifier(
  source: string,
  name: string,
  replacement: string,
): string {
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
  return source.replace(re, replacement);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default rule;
