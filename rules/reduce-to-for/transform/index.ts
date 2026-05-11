// ESLint rule with auto-fix rather than a jscodeshift codemod: `.reduce()` calls
// can appear anywhere in a codebase and are written continuously, so ongoing CI
// enforcement via an ESLint rule is more appropriate than a one-off migration.

import type { Rule } from 'eslint';
import type {
  Node,
  Expression,
  MemberExpression,
  ArrowFunctionExpression,
  Pattern,
  Statement,
  BlockStatement,
  SwitchCase,
  CatchClause,
  ReturnStatement,
  Identifier,
} from 'estree';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSafeExpression(node: Node): boolean {
  if (node.type === 'Identifier') return true;
  if (node.type === 'ThisExpression') return true;
  if (node.type === 'MemberExpression' && !node.computed) {
    return isSafeExpression(node.object);
  }
  return false;
}

// Collect all top-level ReturnStatements inside a list of statements.
// "Top-level" means not inside a nested function scope.
function collectTopLevelReturns(stmts: Statement[]): ReturnStatement[] {
  const found: ReturnStatement[] = [];
  for (const stmt of stmts) collectTopLevelReturnsInStatement(stmt, found);
  return found;
}

function collectTopLevelReturnsInStatement(
  stmt: Statement | null | undefined,
  out: ReturnStatement[],
): void {
  if (!stmt) return;
  switch (stmt.type) {
    case 'ReturnStatement':
      out.push(stmt);
      return;
    // Nested function scopes: returns inside do NOT belong to the callback
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return;
    case 'BlockStatement':
      for (const s of stmt.body) collectTopLevelReturnsInStatement(s, out);
      return;
    case 'IfStatement':
      collectTopLevelReturnsInStatement(stmt.consequent, out);
      collectTopLevelReturnsInStatement(stmt.alternate as Statement | null, out);
      return;
    case 'ForStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'LabeledStatement':
    case 'WithStatement':
      collectTopLevelReturnsInStatement(stmt.body as Statement, out);
      return;
    case 'SwitchStatement':
      for (const c of stmt.cases as SwitchCase[]) {
        for (const s of c.consequent)
          collectTopLevelReturnsInStatement(s, out);
      }
      return;
    case 'TryStatement':
      for (const s of stmt.block.body)
        collectTopLevelReturnsInStatement(s, out);
      if (stmt.handler) {
        for (const s of (stmt.handler as CatchClause).body.body)
          collectTopLevelReturnsInStatement(s, out);
      }
      if (stmt.finalizer) {
        for (const s of stmt.finalizer.body)
          collectTopLevelReturnsInStatement(s, out);
      }
      return;
    default:
      return;
  }
}

// All top-level returns in a block body must carry an argument so we can
// safely rewrite `return expr` → `acc = expr` or drop it when it's a bare
// `return acc` (no-op accumulator pass-through).
function allReturnsHaveArgument(returns: ReturnStatement[]): boolean {
  return returns.every((r) => r.argument != null);
}

// Returns true when the expression is a bare identifier reference matching
// `name`. Used to detect `return acc` (a no-op pass-through inside the loop).
function isIdentifierNamed(node: Expression, name: string): boolean {
  return node.type === 'Identifier' && (node as Identifier).name === name;
}

// Substitute every whole-word occurrence of `name` with `replacement` in
// `source`. Uses word-boundary regex so `acc` in `accumulated` is not replaced.
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

// Determines whether the initialValue expression is a mutable reference type
// (object literal `{}` or array literal `[]`). Reference-type accumulators
// are never reassigned — they are mutated in place — so the variable should
// be `const`. Primitive initial values require `let` because the accumulator
// is reassigned each iteration.
function isReferenceTypeInit(node: Expression): boolean {
  return node.type === 'ObjectExpression' || node.type === 'ArrayExpression';
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
        'Prefer a for loop with an explicit accumulator over .reduce() to eliminate per-element callback overhead.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Must be `<expr>.reduce(<callback>, <initialValue>)` — exactly two arguments.
        // The no-initialValue form uses array[0] as the implicit accumulator and
        // starts at index 1; emitting correct code for that variant is substantially
        // more complex and is explicitly excluded (see README "When it does NOT apply").
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.computed ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'reduce' ||
          node.arguments.length !== 2
        )
          return;

        const [callback, initArg] = node.arguments;

        // Only arrow functions — regular `function` expressions have a `this`
        // binding that differs from the outer scope; arrow functions are safe.
        if (callback.type !== 'ArrowFunctionExpression') return;

        const arrow = callback as ArrowFunctionExpression;

        // The array expression must be safe to evaluate multiple times
        // (once for the loop condition `i < arr.length` and once per element `arr[i]`).
        const callee = node.callee as MemberExpression;
        if (!isSafeExpression(callee.object)) return;

        const isConcise = arrow.body.type !== 'BlockStatement';

        if (!isConcise) {
          // Block body: all top-level returns must carry an argument so we can
          // rewrite `return expr` → `acc = expr` or drop `return acc` (pass-through).
          const returns = collectTopLevelReturns(
            (arrow.body as BlockStatement).body,
          );
          if (returns.length === 0) return; // no return — not a reducer
          if (!allReturnsHaveArgument(returns)) return;
        }

        // Supported contexts where the reduce result is consumed:
        //   1. return arr.reduce(fn, init)          — ReturnStatement
        //   2. const x = arr.reduce(fn, init)       — VariableDeclarator (single)
        //   3. x = arr.reduce(fn, init)             — AssignmentExpression in ExpressionStatement
        //
        // In all other positions (nested call arg, ternary, etc.) we do not
        // auto-fix because hoisting the accumulator declaration mid-expression
        // is not possible with a single-pass text replacement.

        const parent = (node as Rule.Node).parent;
        const grandparent = parent && (parent as unknown as Rule.Node).parent;

        let contextType: 'return' | 'varDecl' | 'assignment' | null = null;

        if (parent?.type === 'ReturnStatement') {
          contextType = 'return';
        } else if (
          parent?.type === 'VariableDeclarator' &&
          grandparent?.type === 'VariableDeclaration'
        ) {
          contextType = 'varDecl';
        } else if (
          parent?.type === 'AssignmentExpression' &&
          grandparent?.type === 'ExpressionStatement'
        ) {
          contextType = 'assignment';
        }

        if (contextType === null) return;

        context.report({
          node,
          messageId: 'preferForLoop',
          fix(fixer) {
            const src = context.sourceCode;
            const arraySource = src.getText(callee.object);
            const params = arrow.params as Pattern[];
            const initSource = src.getText(initArg as Node);

            // The accumulator variable name is always the first callback parameter.
            // Fallback to `acc` when the callback omits the param (extremely rare
            // for reduce, but handled defensively).
            const accName =
              params.length >= 1 && params[0].type === 'Identifier'
                ? (params[0] as Identifier).name
                : 'acc';

            // Reference-type initial values (objects/arrays) are mutated, not
            // reassigned — `const` prevents accidental shadowing by the caller.
            // Primitive initial values are reassigned each iteration — require `let`.
            const accKeyword = isReferenceTypeInit(initArg as Expression)
              ? 'const'
              : 'let';

            // Determine the indentation of the statement being replaced so that
            // all generated lines after the first are aligned correctly.
            const targetNode =
              contextType === 'return'
                ? (parent as unknown as Node)
                : (grandparent as unknown as Node);
            const col = (
              targetNode as Node & { loc?: { start: { column: number } } }
            ).loc?.start.column ?? 0;
            const indent = ' '.repeat(col);

            function indentLines(text: string): string {
              return text
                .split('\n')
                .map((line, idx) => (idx === 0 ? line : `${indent}${line}`))
                .join('\n');
            }

            // Build the loop body lines (without outer braces of the for loop).
            const loopBodyLines: string[] = [];

            if (isConcise) {
              // Concise body: the expression IS the new accumulator value each
              // iteration. Substitute the element param and optional index param,
              // leaving the accumulator param name untouched (it refers to the
              // hoisted `let acc` variable in the outer scope).
              let exprSource = src.getText(arrow.body as Node);

              // Second param = current element
              if (params.length >= 2 && params[1].type === 'Identifier') {
                exprSource = substituteIdentifier(
                  exprSource,
                  (params[1] as Identifier).name,
                  `${arraySource}[i]`,
                );
              }
              // Third param = current index
              if (params.length >= 3 && params[2].type === 'Identifier') {
                exprSource = substituteIdentifier(
                  exprSource,
                  (params[2] as Identifier).name,
                  'i',
                );
              }
              // Fourth param (original array) — rare, substitute for completeness.
              if (params.length >= 4 && params[3].type === 'Identifier') {
                exprSource = substituteIdentifier(
                  exprSource,
                  (params[3] as Identifier).name,
                  arraySource,
                );
              }

              loopBodyLines.push(`${accName} = ${exprSource};`);
            } else {
              // Block body: prepend param declarations, keep intermediate
              // statements verbatim, and transform `return expr`:
              //   - `return acc`  → drop (pass-through; accumulator is unchanged)
              //   - `return expr` → `acc = expr;`

              // First param is acc (already declared outside the loop — skip it).
              // Second param is the current element.
              if (params.length >= 2) {
                loopBodyLines.push(
                  `const ${src.getText(params[1] as Node)} = ${arraySource}[i];`,
                );
              }
              // Third param = current index
              if (params.length >= 3) {
                loopBodyLines.push(`const ${src.getText(params[2] as Node)} = i;`);
              }
              // Fourth param = original array
              if (params.length >= 4) {
                loopBodyLines.push(
                  `const ${src.getText(params[3] as Node)} = ${arraySource};`,
                );
              }

              const block = arrow.body as BlockStatement;
              for (const stmt of block.body) {
                if (stmt.type === 'ReturnStatement' && stmt.argument != null) {
                  // Drop `return acc` — it just passes the accumulator through
                  // unchanged; no assignment is needed.
                  if (isIdentifierNamed(stmt.argument as Expression, accName)) {
                    continue;
                  }
                  loopBodyLines.push(
                    `${accName} = ${src.getText(stmt.argument as Node)};`,
                  );
                } else {
                  loopBodyLines.push(src.getText(stmt as Node));
                }
              }
            }

            const indentedBody = loopBodyLines.map((l) => `  ${l}`).join('\n');
            const forLoop =
              `${accKeyword} ${accName} = ${initSource};\n` +
              `for (let i = 0; i < ${arraySource}.length; i++) {\n` +
              indentedBody +
              '\n}';

            if (contextType === 'return') {
              return fixer.replaceText(
                parent as unknown as Node,
                indentLines(`${forLoop}\nreturn ${accName};`),
              );
            }

            if (contextType === 'varDecl') {
              const varDecl = grandparent as unknown as Node;
              const varDeclarator = parent as unknown as { id: Pattern };
              const varName = src.getText(varDeclarator.id as Node);
              if (varName === accName) {
                // Variable is already named the same as the accumulator — no alias needed.
                return fixer.replaceText(varDecl, indentLines(forLoop));
              }
              return fixer.replaceText(
                varDecl,
                indentLines(`${forLoop}\nconst ${varName} = ${accName};`),
              );
            }

            if (contextType === 'assignment') {
              const exprStmt = grandparent as unknown as Node;
              const assignExpr = parent as unknown as {
                left: Expression;
                operator: string;
              };
              const leftSource = src.getText(assignExpr.left as Node);
              return fixer.replaceText(
                exprStmt,
                indentLines(`${forLoop}\n${leftSource} = ${accName};`),
              );
            }

            return null;
          },
        });
      },
    };
  },
};

export default rule;
