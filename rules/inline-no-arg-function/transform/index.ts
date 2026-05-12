// ESLint rule with auto-fix rather than a jscodeshift codemod: trivial no-arg void
// helper functions can be introduced at any point in a codebase and are a recurring
// micro-optimisation target, so ongoing CI enforcement fits better than a one-off
// migration script.

import type { Rule, Scope } from 'eslint';
import type {
  Node,
  Statement,
  FunctionDeclaration,
  BlockStatement,
  Identifier,
  SwitchCase,
  CatchClause,
  VariableDeclaration,
} from 'estree';

// ---------------------------------------------------------------------------
// Deep-walk helpers — stop at nested function boundaries
// ---------------------------------------------------------------------------

// Keys added by ESLint's traversal machinery that are NOT AST child nodes.
// `parent` is a circular back-reference; `start`/`end`/`loc`/`range` are
// source-position metadata. Including them causes infinite recursion.
const SKIP_KEYS = new Set(['parent', 'start', 'end', 'loc', 'range']);

// Returns true when any node reachable from `root` (without crossing a nested
// function boundary) satisfies `predicate`.
function containsInFunctionBody(
  root: Node,
  predicate: (n: Node) => boolean,
): boolean {
  if (predicate(root)) return true;

  switch (root.type) {
    // Nested function scopes — do NOT recurse; bindings inside are independent.
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return false;

    default: {
      for (const key of Object.keys(root)) {
        if (SKIP_KEYS.has(key)) continue;
        const value = (root as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child && typeof child === 'object' && 'type' in child) {
              if (containsInFunctionBody(child as Node, predicate)) return true;
            }
          }
        } else if (value && typeof value === 'object' && 'type' in value) {
          if (containsInFunctionBody(value as Node, predicate)) return true;
        }
      }
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Precondition checkers for the function definition
// ---------------------------------------------------------------------------

// Returns true when any top-level `return` (not inside a nested function) has
// an argument value, or appears before the last statement (early exit).
// A bare `return;` at the very end of the body is the only safe form.
function hasUnsafeReturn(stmts: Statement[]): boolean {
  return stmts.some((stmt, idx) => hasUnsafeReturnInStmt(stmt, idx, stmts.length));
}

function hasUnsafeReturnInStmt(
  stmt: Statement,
  stmtIndex: number,
  total: number,
): boolean {
  switch (stmt.type) {
    case 'ReturnStatement':
      // A bare `return;` at the last position is safe — it exits without a
      // value and has no effect beyond what a block statement provides.
      if (stmt.argument != null) return true;
      // A bare `return;` that is NOT the last statement is an early exit,
      // which requires the `do {} while(0)` / break treatment (a separate rule).
      return stmtIndex !== total - 1;

    // Nested function scopes: returns inside do not affect the outer function.
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return false;

    case 'BlockStatement':
      return hasUnsafeReturn(stmt.body);

    case 'IfStatement': {
      const cons = stmt.consequent;
      const alt = stmt.alternate as Statement | null;
      // Any return inside an if/else branch is an early exit (conditional):
      // a bare `return;` inside an if skips the rest of the function body just
      // as much as a `return value;` does. Both are unsafe.
      return (
        hasAnyReturnInStmt(cons) ||
        (alt !== null && hasAnyReturnInStmt(alt))
      );
    }

    case 'ForStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'LabeledStatement':
    case 'WithStatement':
      return hasAnyReturnInStmt(stmt.body as Statement);

    case 'SwitchStatement':
      return stmt.cases.some((c: SwitchCase) =>
        c.consequent.some((s) => hasAnyReturnInStmt(s)),
      );

    case 'TryStatement':
      // Any return inside a try/catch/finally block is an early exit relative
      // to the function body — even a bare `return;` at the last statement of
      // the try block would skip the catch/finally or anything after the try.
      return (
        hasAnyReturnInStmt(stmt.block) ||
        (stmt.handler !== null && hasAnyReturnInStmt((stmt.handler as CatchClause).body)) ||
        (stmt.finalizer !== null && hasAnyReturnInStmt(stmt.finalizer!))
      );

    default:
      return false;
  }
}

// Check whether any return statement (bare or with a value) is reachable from
// `stmt` without crossing a function boundary. Used for nested control flow
// (if/else, loops, switch, try) where any return — even a bare `return;` — is
// a conditional early exit that would transfer control to the caller after
// inlining, rather than just the helper function.
function hasAnyReturnInStmt(stmt: Statement | null | undefined): boolean {
  if (!stmt) return false;
  return containsInFunctionBody(stmt, (n) => n.type === 'ReturnStatement');
}

// Returns true when the body of `fn` references `this` (without crossing a
// nested regular-function boundary; arrow functions share the outer `this`).
function bodyUsesThis(body: BlockStatement): boolean {
  return containsInFunctionBody(body, (n) => n.type === 'ThisExpression');
}

// Returns true when the body references the `arguments` identifier.
function bodyUsesArguments(body: BlockStatement): boolean {
  return containsInFunctionBody(body, (n) => {
    return n.type === 'Identifier' && (n as Identifier).name === 'arguments';
  });
}

// Returns true when the body contains an `eval` call or a `with` statement.
function bodyUsesEvalOrWith(body: BlockStatement): boolean {
  return containsInFunctionBody(body, (n) => {
    if (n.type === 'WithStatement') return true;
    if (
      n.type === 'CallExpression' &&
      n.callee.type === 'Identifier' &&
      (n.callee as Identifier).name === 'eval'
    )
      return true;
    return false;
  });
}

// Returns true when the body contains any `var` declaration (which would hoist
// past the inlined block boundary into the caller's function scope).
function bodyContainsVar(body: BlockStatement): boolean {
  return containsInFunctionBody(body, (n) => {
    return n.type === 'VariableDeclaration' && (n as VariableDeclaration).kind === 'var';
  });
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

// Walk up scope chain to find where `name` is defined, starting from `scope`.
function findVariable(
  scope: Scope.Scope,
  name: string,
): Scope.Variable | null {
  let current: Scope.Scope | null = scope;
  while (current) {
    const variable = current.set.get(name);
    if (variable) return variable;
    current = current.upper;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fix helpers
// ---------------------------------------------------------------------------

// Re-indent the body text so its leading column aligns with the call site.
// The opening `{` is placed by the fixer at the call site position; every
// subsequent line is shifted by `callColumn - declColumn` spaces.
function reindentBody(bodyText: string, declColumn: number, callColumn: number): string {
  const delta = callColumn - declColumn;
  if (delta === 0) return bodyText;
  const lines = bodyText.split('\n');
  return lines
    .map((line, i) => {
      if (i === 0) return line; // opening `{` — positioned by the fixer
      if (line.trim() === '') return line; // blank lines stay blank
      if (delta > 0) return ' '.repeat(delta) + line;
      // delta < 0: remove leading spaces without going below zero
      const toRemove = Math.min(-delta, line.length - line.trimStart().length);
      return line.slice(toRemove);
    })
    .join('\n');
}

// Compute the removal range for a FunctionDeclaration: the declaration node
// itself plus one trailing newline (to avoid leaving a blank line), minus one
// leading newline from the blank line that preceded the declaration (so the
// surrounding blank lines collapse to a single blank line rather than two).
function computeRemoveRange(decl: FunctionDeclaration, sourceText: string): [number, number] {
  let start = (decl as unknown as { range: [number, number] }).range[0];
  let end = (decl as unknown as { range: [number, number] }).range[1];
  // Eat the newline immediately after the closing `}`.
  if (sourceText[end] === '\n') end++;
  // Collapse the preceding blank line: if the two characters before `start`
  // are both `\n`, eat one of them so we end up with a single blank line
  // rather than two.
  if (start >= 2 && sourceText[start - 1] === '\n' && sourceText[start - 2] === '\n') {
    start--;
  }
  return [start, end];
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
      inlineNoArgFunction:
        'Inline this no-argument void helper at the call site to eliminate per-call stack-frame and IC overhead.',
    },
  },

  create(context) {
    // Map from function name → its validated FunctionDeclaration node.
    const safeDeclarations = new Map<string, FunctionDeclaration>();

    // Map from function name → all ExpressionStatement call sites that are
    // safe to inline. Populated during CallExpression visits.
    const callSitesByDecl = new Map<string, Array<Rule.Node>>();

    // ---------------------------------------------------------------------------
    // Validate a FunctionDeclaration and register it when all preconditions hold.
    // ---------------------------------------------------------------------------
    function validateDeclaration(node: FunctionDeclaration): void {
      // Must have a name (always true for FunctionDeclaration, but be explicit).
      if (!node.id) return;

      // Must have zero declared parameters.
      if (node.params.length !== 0) return;

      // Must not be async or a generator.
      if (node.async || node.generator) return;

      const body = node.body;

      // Must not reference `this`.
      if (bodyUsesThis(body)) return;

      // Must not reference `arguments`.
      if (bodyUsesArguments(body)) return;

      // Must not use `eval` or `with`.
      if (bodyUsesEvalOrWith(body)) return;

      // Must not contain `var` declarations.
      if (bodyContainsVar(body)) return;

      // Must not have unsafe returns (returns with a value, or early bare returns).
      if (hasUnsafeReturn(body.body)) return;

      safeDeclarations.set(node.id.name, node);
    }

    // ---------------------------------------------------------------------------
    // Validate a call site and record it for later batch reporting.
    // ---------------------------------------------------------------------------
    function recordCallSite(
      callNode: Rule.Node & { type: 'CallExpression' },
    ): void {
      const node = callNode;

      // Must be a plain identifier call: `funcName()`.
      if (node.callee.type !== 'Identifier') return;

      // Must have zero arguments passed.
      if (node.arguments.length !== 0) return;

      const calleeName = (node.callee as Identifier).name;

      // Must correspond to a validated declaration.
      if (!safeDeclarations.has(calleeName)) return;

      // The call must be a plain ExpressionStatement (`funcName();`).
      const parent = node.parent;
      if (!parent || parent.type !== 'ExpressionStatement') return;

      if (!callSitesByDecl.has(calleeName)) callSitesByDecl.set(calleeName, []);
      callSitesByDecl.get(calleeName)!.push(parent as Rule.Node);
    }

    // ---------------------------------------------------------------------------
    // After the full file has been visited, perform binding validation and report.
    // Reporting on Program:exit lets us collect all call sites first so the fix
    // can atomically remove the declaration and replace every call site.
    // ---------------------------------------------------------------------------
    function reportInlineOpportunities(): void {
      for (const [name, decl] of safeDeclarations) {
        const callParents = callSitesByDecl.get(name);

        // No call sites — nothing to inline; leave the declaration untouched.
        if (!callParents || callParents.length === 0) continue;

        // Resolve the binding via ESLint's scope analysis (ESLint 9 API).
        // We need the scope at a call site to verify the binding is the same
        // declaration we validated — not a shadowed re-declaration.
        const firstCallScope = context.sourceCode.getScope(callParents[0]);
        const variable = findVariable(firstCallScope, name);

        // The binding must exist and must resolve to exactly one definition.
        if (!variable || variable.defs.length !== 1) continue;

        // The definition must be the FunctionDeclaration we validated.
        if (variable.defs[0].node !== decl) continue;

        // The binding must never be reassigned after its definition.
        // FunctionDeclaration bindings produce exactly one implicit write (the
        // hoisted binding itself), which appears as a write reference with a
        // null `writeExpr`. Any write reference with a non-null `writeExpr` is
        // an explicit reassignment statement.
        const hasReassignment = variable.references.some(
          (r) => r.isWrite() && r.writeExpr != null,
        );
        if (hasReassignment) continue;

        context.report({
          node: decl as unknown as Node,
          messageId: 'inlineNoArgFunction',
          fix(fixer) {
            const src = context.sourceCode;
            const sourceText = src.getText();
            const rawBodyText = src.getText(decl.body as unknown as Node);
            const declColumn = decl.loc!.start.column;

            const fixes: ReturnType<typeof fixer.removeRange>[] = [];

            // Remove the declaration, collapsing the surrounding blank lines.
            fixes.push(
              fixer.removeRange(computeRemoveRange(decl, sourceText)),
            );

            // Replace each ExpressionStatement call site with the re-indented body.
            for (const callParentNode of callParents) {
              const callColumn = (callParentNode as unknown as { loc: { start: { column: number } } }).loc.start.column;
              fixes.push(
                fixer.replaceText(
                  callParentNode,
                  reindentBody(rawBodyText, declColumn, callColumn),
                ),
              );
            }

            return fixes;
          },
        });
      }
    }

    return {
      FunctionDeclaration(node) {
        validateDeclaration(node as FunctionDeclaration);
      },
      CallExpression(node) {
        recordCallSite(node as unknown as Rule.Node & { type: 'CallExpression' });
      },
      'Program:exit'() {
        reportInlineOpportunities();
      },
    };
  },
};

export default rule;
