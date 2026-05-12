// ESLint rule with auto-fix rather than a jscodeshift codemod: parameterized
// void helpers can be introduced at any point in a codebase and are a recurring
// micro-optimisation target in hot loops, so ongoing CI enforcement fits better
// than a one-off migration script.

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
  Pattern,
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
      if (stmt.argument != null) return true;
      // A bare `return;` that is NOT the last statement is an early exit.
      return stmtIndex !== total - 1;

    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return false;

    case 'BlockStatement':
      return hasUnsafeReturn(stmt.body);

    case 'IfStatement': {
      const cons = stmt.consequent;
      const alt = stmt.alternate as Statement | null;
      // Any return inside an if/else branch is an early exit (conditional).
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
      return (
        hasAnyReturnInStmt(stmt.block) ||
        (stmt.handler !== null && hasAnyReturnInStmt((stmt.handler as CatchClause).body)) ||
        (stmt.finalizer !== null && hasAnyReturnInStmt(stmt.finalizer!))
      );

    default:
      return false;
  }
}

// Returns true when any return statement (bare or with a value) is reachable
// from `stmt` without crossing a function boundary.
function hasAnyReturnInStmt(stmt: Statement | null | undefined): boolean {
  if (!stmt) return false;
  return containsInFunctionBody(stmt, (n) => n.type === 'ReturnStatement');
}

function bodyUsesThis(body: BlockStatement): boolean {
  return containsInFunctionBody(body, (n) => n.type === 'ThisExpression');
}

function bodyUsesArguments(body: BlockStatement): boolean {
  return containsInFunctionBody(body, (n) => {
    return n.type === 'Identifier' && (n as Identifier).name === 'arguments';
  });
}

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

function bodyContainsVar(body: BlockStatement): boolean {
  return containsInFunctionBody(body, (n) => {
    return n.type === 'VariableDeclaration' && (n as VariableDeclaration).kind === 'var';
  });
}

// Returns true when the body contains an unlabelled break or continue that
// would escape the inlined block and redirect to the outer loop.
function bodyContainsUnlabelledBreakOrContinue(body: BlockStatement): boolean {
  return containsInFunctionBody(body, (n) => {
    if (n.type === 'BreakStatement' && (n as { label: null | unknown }).label === null) return true;
    if (n.type === 'ContinueStatement' && (n as { label: null | unknown }).label === null) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

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

// Collect all names declared in a given scope (not ancestors).
function scopeLocalNames(scope: Scope.Scope): Set<string> {
  return new Set(scope.variables.map((v) => v.name));
}

// ---------------------------------------------------------------------------
// Parameter name extraction — only simple Identifier params are supported.
// ---------------------------------------------------------------------------

// Returns the list of param names, or null if any param is non-Identifier
// (destructuring, default, rest) which the transform cannot safely handle.
function extractParamNames(params: Pattern[]): string[] | null {
  const names: string[] = [];
  for (const p of params) {
    if (p.type !== 'Identifier') return null;
    names.push((p as Identifier).name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Fix helpers
// ---------------------------------------------------------------------------

// Re-indent the body text so its leading column aligns with the call site.
function reindentBody(bodyText: string, declColumn: number, callColumn: number): string {
  const delta = callColumn - declColumn;
  if (delta === 0) return bodyText;
  const lines = bodyText.split('\n');
  return lines
    .map((line, i) => {
      if (i === 0) return line;
      if (line.trim() === '') return line;
      if (delta > 0) return ' '.repeat(delta) + line;
      const toRemove = Math.min(-delta, line.length - line.trimStart().length);
      return line.slice(toRemove);
    })
    .join('\n');
}

function computeRemoveRange(decl: FunctionDeclaration, sourceText: string): [number, number] {
  let start = (decl as unknown as { range: [number, number] }).range[0];
  let end = (decl as unknown as { range: [number, number] }).range[1];
  if (sourceText[end] === '\n') end++;
  if (start >= 2 && sourceText[start - 1] === '\n' && sourceText[start - 2] === '\n') {
    start--;
  }
  return [start, end];
}

// Generate a name that does not collide with any name in `takenNames`.
// Tries `_original`, `__original`, etc. until a free name is found.
function generateFreeName(original: string, takenNames: Set<string>): string {
  let candidate = `_${original}`;
  while (takenNames.has(candidate)) {
    candidate = `_${candidate}`;
  }
  return candidate;
}

// Build the text to replace a call site's ExpressionStatement:
//   const <param0> = <arg0>;
//   const <param1> = <arg1>;
//   ...
//   <re-indented body block>
//
// `renames` maps original param names → inlined binding names (for collisions).
// `argTexts` contains the source text of each argument expression.
// `paramNames` contains the original declared parameter names.
// `bodyText` is the verbatim source text of the body's `{}` block.
function buildInlineText(
  paramNames: string[],
  argTexts: string[],
  renames: Map<string, string>,
  bodyText: string,
  callIndent: string,
): string {
  const lines: string[] = [];

  for (let i = 0; i < paramNames.length; i++) {
    const paramName = paramNames[i];
    const bindingName = renames.get(paramName) ?? paramName;
    const argExpr = i < argTexts.length ? argTexts[i] : 'undefined';
    // The first line must not include callIndent: fixer.replaceText positions
    // the replacement immediately after the existing leading whitespace already
    // present in the source file.  Every subsequent line starts fresh and needs
    // the full indent prefix.
    const prefix = lines.length === 0 ? '' : callIndent;
    lines.push(`${prefix}const ${bindingName} = ${argExpr};`);
  }

  // Apply parameter renames consistently throughout the body text.
  // This must be done carefully so that renaming `key` → `_key` does not
  // accidentally rename `keyMap` as well. We replace only whole-word occurrences.
  let rewrittenBody = bodyText;
  for (const [original, renamed] of renames) {
    if (original === renamed) continue;
    // Replace whole-word occurrences of `original` with `renamed`.
    rewrittenBody = rewrittenBody.replace(
      new RegExp(`\\b${escapeRegExp(original)}\\b`, 'g'),
      renamed,
    );
  }

  // The body block's opening `{` is the first character of `rewrittenBody`.
  // When appended after a `\n`, it must be prefixed with callIndent so the
  // brace aligns with the const bindings above it.  When there are no param
  // bindings above (zero-param case not handled here, but guarded), the body
  // is the first line and needs no prefix.
  const bodyPrefix = lines.length === 0 ? '' : callIndent;
  lines.push(`${bodyPrefix}${rewrittenBody}`);
  return lines.join('\n');
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
      inlineParameterizedFunction:
        'Inline this parameterized void helper at the call site to eliminate per-call stack-frame, argument-passing, and IC overhead.',
    },
  },

  create(context) {
    const safeDeclarations = new Map<string, FunctionDeclaration>();

    // Map from function name → all ExpressionStatement call sites.
    const callSitesByDecl = new Map<string, Array<{ parent: Rule.Node; argTexts: string[] }>>();

    function validateDeclaration(node: FunctionDeclaration): void {
      if (!node.id) return;

      // Must have at least one parameter.
      if (node.params.length === 0) return;

      // Must not be async or a generator.
      if (node.async || node.generator) return;

      // Only simple identifier parameters are handled.
      const paramNames = extractParamNames(node.params);
      if (paramNames === null) return;

      const body = node.body;

      if (bodyUsesThis(body)) return;
      if (bodyUsesArguments(body)) return;
      if (bodyUsesEvalOrWith(body)) return;
      if (bodyContainsVar(body)) return;
      if (hasUnsafeReturn(body.body)) return;

      // Unlabelled break/continue inside the body would redirect to an outer loop
      // after inlining; this requires the `inline-loop-in-function` treatment.
      if (bodyContainsUnlabelledBreakOrContinue(body)) return;

      safeDeclarations.set(node.id.name, node);
    }

    function recordCallSite(
      callNode: Rule.Node & { type: 'CallExpression' },
    ): void {
      const node = callNode;

      // Must be a plain identifier call.
      if (node.callee.type !== 'Identifier') return;

      const calleeName = (node.callee as Identifier).name;
      if (!safeDeclarations.has(calleeName)) return;

      // The call must be used as a standalone statement (void context).
      const parent = node.parent;
      if (!parent || parent.type !== 'ExpressionStatement') return;

      const decl = safeDeclarations.get(calleeName)!;
      const paramCount = decl.params.length;

      // Extra arguments are ignored at runtime (safe). Missing arguments are
      // emitted as explicit `const p = undefined;` bindings. Either way, record.
      const argTexts = node.arguments
        // SpreadElement is unsafe — bail out of this call site only.
        .filter((a) => {
          if (a.type === 'SpreadElement') return false;
          return true;
        })
        .slice(0, paramCount)
        .map((a) => context.sourceCode.getText(a as unknown as Node));

      // If any argument was a SpreadElement we filtered it out, meaning argTexts
      // length would be less than node.arguments.length (not just paramCount).
      // Detect this by comparing filtered count with original count up to paramCount.
      const argsBoundedByParams = node.arguments.slice(0, paramCount);
      if (argsBoundedByParams.some((a) => a.type === 'SpreadElement')) return;

      if (!callSitesByDecl.has(calleeName)) callSitesByDecl.set(calleeName, []);
      callSitesByDecl.get(calleeName)!.push({
        parent: parent as Rule.Node,
        argTexts,
      });
    }

    function reportInlineOpportunities(): void {
      for (const [name, decl] of safeDeclarations) {
        const sites = callSitesByDecl.get(name);
        if (!sites || sites.length === 0) continue;

        // Scope check: binding must resolve to exactly this declaration.
        const firstCallScope = context.sourceCode.getScope(sites[0].parent);
        const variable = findVariable(firstCallScope, name);
        if (!variable || variable.defs.length !== 1) continue;
        if (variable.defs[0].node !== decl) continue;

        const hasReassignment = variable.references.some(
          (r) => r.isWrite() && r.writeExpr != null,
        );
        if (hasReassignment) continue;

        const paramNames = extractParamNames(decl.params)!;

        context.report({
          node: decl as unknown as Node,
          messageId: 'inlineParameterizedFunction',
          fix(fixer) {
            const src = context.sourceCode;
            const sourceText = src.getText();
            const rawBodyText = src.getText(decl.body as unknown as Node);
            const declColumn = decl.loc!.start.column;

            const fixes: ReturnType<typeof fixer.removeRange>[] = [];

            fixes.push(fixer.removeRange(computeRemoveRange(decl, sourceText)));

            for (const { parent: callParent, argTexts } of sites) {
              const callLoc = (callParent as unknown as { loc: { start: { line: number; column: number } } }).loc.start;
              const callColumn = callLoc.column;
              const callIndent = ' '.repeat(callColumn);

              // Determine the set of names already visible at this call site to
              // detect collisions between parameter names and outer bindings.
              const callScope = src.getScope(callParent);
              const outerNames = new Set<string>();

              // Walk from the call scope upward, collecting all visible names.
              let sc: Scope.Scope | null = callScope;
              while (sc) {
                for (const v of sc.variables) outerNames.add(v.name);
                sc = sc.upper;
              }

              // Also collect names declared at the same block level — scopeLocalNames
              // only covers the current scope, but we need to avoid conflicts with
              // sibling declarations in the same block too.
              const blockScopeNames = scopeLocalNames(callScope);
              for (const n of blockScopeNames) outerNames.add(n);

              // Build rename map: for each param whose name collides, generate a
              // fresh name that is not in `takenNames` (which grows as we assign).
              const takenNames = new Set(outerNames);
              const renames = new Map<string, string>();
              for (const paramName of paramNames) {
                if (outerNames.has(paramName)) {
                  const fresh = generateFreeName(paramName, takenNames);
                  renames.set(paramName, fresh);
                  takenNames.add(fresh);
                } else {
                  renames.set(paramName, paramName);
                  takenNames.add(paramName);
                }
              }

              // Re-indent the body relative to call site vs. declaration column.
              const reindentedBody = reindentBody(rawBodyText, declColumn, callColumn);

              const inlineText = buildInlineText(
                paramNames,
                argTexts,
                renames,
                reindentedBody,
                callIndent,
              );

              fixes.push(fixer.replaceText(callParent, inlineText));
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
