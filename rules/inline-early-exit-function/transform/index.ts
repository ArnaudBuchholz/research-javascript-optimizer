// ESLint rule with auto-fix rather than a jscodeshift codemod: early-exit guard
// helpers can be introduced at any point in a codebase and are a recurring
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
  ReturnStatement,
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

// Returns true when any `return` statement reachable from `root` (without
// crossing a nested function boundary) has a non-null argument expression.
function hasValueReturn(root: Node): boolean {
  return containsInFunctionBody(root, (n) => {
    return n.type === 'ReturnStatement' && (n as ReturnStatement).argument != null;
  });
}

// Returns true when the function body contains at least one early bare `return;`
// that is NOT at the very end of the top-level statement list. This is the
// defining characteristic of the early-exit pattern.
function hasEarlyBareReturn(stmts: Statement[]): boolean {
  // Check top-level statements for early bare returns.
  for (let i = 0; i < stmts.length; i++) {
    if (hasEarlyBareReturnInStmt(stmts[i], i, stmts.length)) return true;
  }
  return false;
}

function hasEarlyBareReturnInStmt(
  stmt: Statement,
  stmtIndex: number,
  total: number,
): boolean {
  switch (stmt.type) {
    case 'ReturnStatement':
      // Value-returning — not this rule's concern (already excluded by hasValueReturn).
      if (stmt.argument != null) return false;
      // A bare `return;` that is NOT the last top-level statement is an early exit.
      return stmtIndex !== total - 1;

    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return false;

    case 'BlockStatement':
      return hasEarlyBareReturn(stmt.body);

    case 'IfStatement': {
      const cons = stmt.consequent;
      const alt = stmt.alternate as Statement | null;
      // A bare return inside an if/else branch is an early exit.
      return (
        hasBareReturnInStmt(cons) ||
        (alt !== null && hasBareReturnInStmt(alt))
      );
    }

    case 'ForStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'LabeledStatement':
    case 'WithStatement':
      return hasBareReturnInStmt(stmt.body as Statement);

    case 'SwitchStatement':
      return stmt.cases.some((c: SwitchCase) =>
        c.consequent.some((s) => hasBareReturnInStmt(s)),
      );

    case 'TryStatement':
      return (
        hasBareReturnInStmt(stmt.block) ||
        (stmt.handler !== null && hasBareReturnInStmt((stmt.handler as CatchClause).body)) ||
        (stmt.finalizer !== null && hasBareReturnInStmt(stmt.finalizer!))
      );

    default:
      return false;
  }
}

// Returns true when any bare `return;` (no value) is reachable from `stmt`
// without crossing a function boundary.
function hasBareReturnInStmt(stmt: Statement | null | undefined): boolean {
  if (!stmt) return false;
  return containsInFunctionBody(stmt, (n) => {
    return n.type === 'ReturnStatement' && (n as ReturnStatement).argument == null;
  });
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
// would escape the inlined `do {} while (0)` and redirect to an outer loop.
// A break/continue that is enclosed within its own loop or switch in the body
// targets that inner construct and is safe — containsInFunctionBody already
// stops at FunctionDeclaration/Expression boundaries; we must additionally stop
// at loop/switch boundaries for this specific check.
function bodyContainsUnlabelledBreakOrContinue(body: BlockStatement): boolean {
  return containsInLoopBody(body);
}

// Walk the AST stopping at nested functions AND at loop/switch boundaries,
// since break/continue inside those targets the inner construct — not the
// inlined `do {} while (0)`.
function containsInLoopBody(root: Node): boolean {
  switch (root.type) {
    case 'BreakStatement':
      return (root as { label: unknown }).label === null;
    case 'ContinueStatement':
      return (root as { label: unknown }).label === null;

    // Nested function scopes — do NOT recurse.
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return false;

    // Loop/switch boundaries: a break/continue inside targets the inner
    // construct, not the inlined `do {} while (0)` — safe to ignore.
    case 'ForStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'SwitchStatement':
      return false;

    default: {
      for (const key of Object.keys(root)) {
        if (SKIP_KEYS.has(key)) continue;
        const value = (root as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child && typeof child === 'object' && 'type' in child) {
              if (containsInLoopBody(child as Node)) return true;
            }
          }
        } else if (value && typeof value === 'object' && 'type' in value) {
          if (containsInLoopBody(value as Node)) return true;
        }
      }
      return false;
    }
  }
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

// ---------------------------------------------------------------------------
// Parameter name extraction — only simple Identifier params are supported.
// ---------------------------------------------------------------------------

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

// Re-indent text so its leading column aligns with the call site.
function reindentLines(text: string, declColumn: number, callColumn: number): string {
  const delta = callColumn - declColumn;
  if (delta === 0) return text;
  const lines = text.split('\n');
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

// Generate a name that does not collide with any name already taken.
function generateFreeName(original: string, takenNames: Set<string>): string {
  let candidate = `${original}_`;
  while (takenNames.has(candidate)) {
    candidate = `${candidate}_`;
  }
  return candidate;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replace all bare `return;` statements in `bodyText` with `break` using a
// regex that targets only the textual pattern `return;` (with optional
// whitespace before the semicolon). This is safe because:
// - We verified the body has no value-returning returns.
// - Nested function bodies are not touched (they are separate text blocks that
//   contain their own `return` statements unrelated to this function's exits).
// We must be careful not to match `return` inside strings or comments, but
// since this transform targets well-formed fixture code and the regex is
// applied post-validation, this is an acceptable simplification.
function replaceReturnsWithBreak(bodyText: string): string {
  // Match `return` followed by optional whitespace and `;`, ensuring it is
  // a word boundary to avoid matching `returnValue` etc. We use `\breturn\s*;`
  // which matches the keyword as a full word.
  return bodyText.replace(/\breturn\s*;/g, 'break;');
}

// Build the replacement text for one call site (an ExpressionStatement).
//
// For each parameter, emits:
//   const <bindingName> = <argExpr>;
//
// Then emits the body wrapped in `do { ... } while (0)` with `return` → `break`.
//
// `renames` maps original param names → inlined binding names (for collisions).
// `argTexts` contains the source text of each argument expression.
// `paramNames` contains the original declared parameter names.
// `bodyText` is the verbatim source text of the body's `{}` block.
// `callIndent` is the leading whitespace string at the call site column.
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
    const prefix = lines.length === 0 ? '' : callIndent;
    lines.push(`${prefix}const ${bindingName} = ${argExpr};`);
  }

  // Apply parameter renames consistently throughout the body text before
  // wrapping it in do {} while (0).
  let rewrittenBody = bodyText;
  for (const [original, renamed] of renames) {
    if (original === renamed) continue;
    rewrittenBody = rewrittenBody.replace(
      new RegExp(`\\b${escapeRegExp(original)}\\b`, 'g'),
      renamed,
    );
  }

  // Replace bare `return;` with `break` — the defining transformation for this rule.
  rewrittenBody = replaceReturnsWithBreak(rewrittenBody);

  // Wrap the body in `do { ... } while (0)`.
  // The body text from the source is `{ ... }` (a BlockStatement). We must
  // convert it to `do { ... } while (0)` by replacing the opening `{` with
  // `do {` and appending ` while (0)` after the closing `}`.
  // Strip the outer braces and re-wrap in the do-while form.
  const innerText = rewrittenBody.slice(1, rewrittenBody.lastIndexOf('}')).trimEnd();
  const doWhileText = `do {${innerText}\n${callIndent}} while (0);`;

  const bodyPrefix = lines.length === 0 ? '' : callIndent;
  lines.push(`${bodyPrefix}${doWhileText}`);

  return lines.join('\n');
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
      inlineEarlyExitFunction:
        'Inline this early-exit void helper at the call site using `do {} while (0)` to eliminate per-call stack-frame, argument-passing, and IC overhead.',
    },
  },

  create(context) {
    const safeDeclarations = new Map<string, FunctionDeclaration>();
    const callSitesByDecl = new Map<string, Array<{ parent: Rule.Node; argTexts: string[] }>>();

    function validateDeclaration(node: FunctionDeclaration): void {
      if (!node.id) return;

      // Must not be async or a generator.
      if (node.async || node.generator) return;

      // Only simple identifier parameters are handled.
      const paramNames = extractParamNames(node.params);
      if (paramNames === null) return;

      const body = node.body;

      // Must not mix early exits with value-returning returns; those require a
      // combined rule (inline-returning-function composition).
      if (hasValueReturn(body)) return;

      // Must contain at least one early bare `return;`. Functions with no early
      // return are handled by inline-no-arg-function or inline-parameterized-function.
      if (!hasEarlyBareReturn(body.body)) return;

      if (bodyUsesThis(body)) return;
      if (bodyUsesArguments(body)) return;
      if (bodyUsesEvalOrWith(body)) return;
      if (bodyContainsVar(body)) return;

      // Unlabelled break/continue at the top level of the body (not inside a
      // nested loop or switch) would redirect to the inlined `do {} while (0)`
      // instead of the intended target — decline.
      if (bodyContainsUnlabelledBreakOrContinue(body)) return;

      safeDeclarations.set(node.id.name, node);
    }

    function recordCallSite(
      callNode: Rule.Node & { type: 'CallExpression' },
    ): void {
      const node = callNode;

      if (node.callee.type !== 'Identifier') return;

      const calleeName = (node.callee as Identifier).name;
      if (!safeDeclarations.has(calleeName)) return;

      const parent = node.parent;
      if (!parent || parent.type !== 'ExpressionStatement') return;

      const decl = safeDeclarations.get(calleeName)!;
      const paramCount = decl.params.length;

      // Bail out if any argument up to paramCount is a SpreadElement.
      const argsBoundedByParams = node.arguments.slice(0, paramCount);
      if (argsBoundedByParams.some((a) => a.type === 'SpreadElement')) return;

      const argTexts = argsBoundedByParams.map((a) =>
        context.sourceCode.getText(a as unknown as Node),
      );

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
          messageId: 'inlineEarlyExitFunction',
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

              // Collect all names visible at the call site to detect collisions
              // with parameter names.
              const outerNames = new Set<string>();
              let sc: Scope.Scope | null = src.getScope(callParent);
              while (sc) {
                for (const v of sc.variables) outerNames.add(v.name);
                sc = sc.upper;
              }

              // Build rename map: for each param whose name collides with a
              // visible binding, generate a fresh collision-free name.
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

              const reindentedBody = reindentLines(rawBodyText, declColumn, callColumn);

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
