// ESLint rule with auto-fix rather than a jscodeshift codemod: `.map()` calls
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

// Collect all top-level ReturnStatements inside a block.
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

// All code paths that can produce a value from a block-body arrow must reach a
// `return`; this checks that every top-level return has an argument (so we can
// safely rewrite `return expr` → `result[i] = expr`).
function allReturnsHaveArgument(returns: ReturnStatement[]): boolean {
  return returns.every((r) => r.argument != null);
}

// Substitute every whole-word occurrence of `name` with `replacement` in
// `source`. We use a word-boundary regex so `item` in `itemCount` is not
// replaced. This is text-level and deliberately conservative.
function substituteIdentifier(
  source: string,
  name: string,
  replacement: string,
): string {
  // \b won't match the boundary before `[` in `arr[i]`, but since we only
  // ever substitute *param names* (bare identifiers), both boundaries are
  // simple word boundaries.
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
  return source.replace(re, replacement);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        'Prefer a pre-allocated for loop over .map() to eliminate callback and ArraySpeciesCreate overhead.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Must be `<expr>.map(<callback>)` with exactly one argument
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.computed ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'map' ||
          node.arguments.length !== 1
        )
          return;

        const [callback] = node.arguments;

        // Only arrow functions — regular `function` expressions have `this`
        // binding from the optional `thisArg`; arrow functions do not use `this`
        // from `map`'s binding so they are safe to inline.
        if (callback.type !== 'ArrowFunctionExpression') return;

        const arrow = callback as ArrowFunctionExpression;

        // The array expression must be safe to evaluate multiple times
        // (once for `new Array(arr.length)`, once for the condition, and once
        // per element access `arr[i]`).
        const callee = node.callee as MemberExpression;
        if (!isSafeExpression(callee.object)) return;

        // Determine whether this is a concise body or a block body
        const isConcise = arrow.body.type !== 'BlockStatement';

        if (!isConcise) {
          // Block body: verify all top-level returns have an argument so we
          // can safely replace `return expr` with `result[i] = expr`.
          const returns = collectTopLevelReturns(
            (arrow.body as BlockStatement).body,
          );
          if (returns.length === 0) return; // void map — use foreach-to-for instead
          if (!allReturnsHaveArgument(returns)) return;
        }

        // Determine the context where this call appears so we know what to
        // replace and what name to give the result array.
        const parent = (node as Rule.Node).parent;
        const grandparent =
          parent && (parent as unknown as Rule.Node).parent;

        // Supported contexts:
        //   1. return arr.map(fn)          — ReturnStatement
        //   2. const x = arr.map(fn)       — VariableDeclarator (single)
        //   3. x = arr.map(fn)             — AssignmentExpression in ExpressionStatement
        //
        // In all other positions (nested call arg, ternary, etc.) we do not
        // auto-fix because inlining a statement block mid-expression is not
        // possible with a single-pass text replacement.

        let contextType:
          | 'return'
          | 'varDecl'
          | 'assignment'
          | null = null;

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

            // Determine the indentation of the statement being replaced so that
            // all generated lines after the first are aligned correctly.
            const targetNode =
              contextType === 'return'
                ? (parent as unknown as Node)
                : (grandparent as unknown as Node);
            const col = (targetNode as Node & { loc?: { start: { column: number } } })
              .loc?.start.column ?? 0;
            const indent = ' '.repeat(col);

            // Add indentation to all lines after the first in a multi-line string.
            function indentLines(text: string): string {
              return text
                .split('\n')
                .map((line, idx) => (idx === 0 ? line : `${indent}${line}`))
                .join('\n');
            }

            // Build the loop body lines
            const loopBodyLines: string[] = [];

            if (isConcise) {
              // Concise body: substitute param names directly in the expression
              // source and emit a single assignment.
              let exprSource = src.getText(arrow.body as Node);

              if (params.length >= 1 && params[0].type === 'Identifier') {
                exprSource = substituteIdentifier(
                  exprSource,
                  params[0].name,
                  `${arraySource}[i]`,
                );
              }
              if (params.length >= 2 && params[1].type === 'Identifier') {
                exprSource = substituteIdentifier(exprSource, params[1].name, 'i');
              }
              // A third param (the array itself) is rare in concise bodies;
              // substitute it too for completeness.
              if (params.length >= 3 && params[2].type === 'Identifier') {
                exprSource = substituteIdentifier(
                  exprSource,
                  params[2].name,
                  arraySource,
                );
              }

              loopBodyLines.push(`result[i] = ${exprSource};`);
            } else {
              // Block body: prepend param declarations then inline the body
              // statements, replacing `return expr` with `result[i] = expr`.
              if (params.length >= 1) {
                loopBodyLines.push(
                  `const ${src.getText(params[0] as Node)} = ${arraySource}[i];`,
                );
              }
              if (params.length >= 2) {
                loopBodyLines.push(
                  `const ${src.getText(params[1] as Node)} = i;`,
                );
              }
              if (params.length >= 3) {
                loopBodyLines.push(
                  `const ${src.getText(params[2] as Node)} = ${arraySource};`,
                );
              }

              const block = arrow.body as BlockStatement;
              for (const stmt of block.body) {
                if (
                  stmt.type === 'ReturnStatement' &&
                  stmt.argument != null
                ) {
                  loopBodyLines.push(
                    `result[i] = ${src.getText(stmt.argument as Node)};`,
                  );
                } else {
                  loopBodyLines.push(src.getText(stmt as Node));
                }
              }
            }

            const indentedBody = loopBodyLines.map((l) => `  ${l}`).join('\n');
            const forLoop =
              `const result = new Array(${arraySource}.length);\n` +
              `for (let i = 0; i < ${arraySource}.length; i++) {\n` +
              indentedBody +
              '\n}';

            if (contextType === 'return') {
              const returnStmt = parent as ReturnStatement;
              return fixer.replaceText(
                returnStmt as unknown as Node,
                indentLines(`${forLoop}\nreturn result;`),
              );
            }

            if (contextType === 'varDecl') {
              // Replace the whole VariableDeclaration, adopting its variable
              // name as the result variable by appending an alias.
              const varDecl = grandparent as unknown as Node;
              const varDeclarator = parent as unknown as {
                id: Pattern;
              };
              const varName = src.getText(varDeclarator.id as Node);
              if (varName === 'result') {
                // Variable is already named `result` — emit without the alias
                return fixer.replaceText(varDecl, indentLines(forLoop));
              }
              return fixer.replaceText(
                varDecl,
                indentLines(`${forLoop}\nconst ${varName} = result;`),
              );
            }

            if (contextType === 'assignment') {
              // Replace the whole ExpressionStatement
              const exprStmt = grandparent as unknown as Node;
              const assignExpr = parent as unknown as {
                left: Expression;
                operator: string;
              };
              const leftSource = src.getText(assignExpr.left as Node);
              return fixer.replaceText(
                exprStmt,
                indentLines(`${forLoop}\n${leftSource} = result;`),
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
