// ESLint rule with auto-fix rather than a jscodeshift codemod: `.filter().map()`
// chains can appear anywhere in a codebase and are written continuously, so
// ongoing CI enforcement via an ESLint rule is more appropriate than a one-off
// migration.

import type { Rule } from 'eslint';
import type {
  Node,
  Expression,
  MemberExpression,
  CallExpression,
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
    // Nested function scopes: returns inside do NOT belong to this callback
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

function allReturnsHaveArgument(returns: ReturnStatement[]): boolean {
  return returns.every((r) => r.argument != null);
}

// Substitute every whole-word occurrence of `name` with `replacement` in
// `source`. Uses word-boundary regex so `item` in `itemCount` is not replaced.
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

// Returns true when the arrow callback uses its second parameter (index) — needed
// only for the map callback to decide whether to emit a `mappedIndex` counter.
// A concise body is checked by text substitution detection; a block body is
// checked structurally. We look for a reference to the named param anywhere in
// the callback body source. Using `substituteIdentifier` on the body source and
// comparing lengths is the simplest conservative check.
function callbackUsesParam(arrow: ArrowFunctionExpression, paramIndex: number, src: { getText(node: Node): string }): boolean {
  if (paramIndex >= arrow.params.length) return false;
  const param = arrow.params[paramIndex];
  if (param.type !== 'Identifier') return false;
  const name = (param as Identifier).name;
  const bodySource = src.getText(arrow.body as Node);
  // If replacing the name leaves the source unchanged, the param is not used.
  const substituted = substituteIdentifier(bodySource, name, '\x00');
  return substituted !== bodySource;
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
        'Prefer a fused for loop over .filter().map() to eliminate the intermediate array allocation, double traversal, and per-element callback overhead.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Outer call must be `<expr>.map(<mapCallback>)` with exactly one argument.
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.computed ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'map' ||
          node.arguments.length !== 1
        )
          return;

        const mapCallee = node.callee as MemberExpression;
        const [mapCbArg] = node.arguments;

        // Map callback must be an arrow function (no `this` binding dependency).
        if (mapCbArg.type !== 'ArrowFunctionExpression') return;
        const mapArrow = mapCbArg as ArrowFunctionExpression;

        // The map callback must not use its third parameter (the intermediate
        // filtered array). Using it requires materialising the intermediate array,
        // which defeats the whole purpose of the fused rewrite.
        if (mapArrow.params.length >= 3) return;

        // Inner call must be `<arrayExpr>.filter(<filterCallback>)` with exactly one argument.
        const filterCall = mapCallee.object;
        if (
          filterCall.type !== 'CallExpression' ||
          (filterCall as CallExpression).callee.type !== 'MemberExpression' ||
          ((filterCall as CallExpression).callee as MemberExpression).computed ||
          ((filterCall as CallExpression).callee as MemberExpression).property
            .type !== 'Identifier' ||
          (
            ((filterCall as CallExpression).callee as MemberExpression)
              .property as Identifier
          ).name !== 'filter' ||
          (filterCall as CallExpression).arguments.length !== 1
        )
          return;

        const filterCallee = (filterCall as CallExpression).callee as MemberExpression;
        const [filterCbArg] = (filterCall as CallExpression).arguments;

        // Filter callback must be an arrow function.
        if (filterCbArg.type !== 'ArrowFunctionExpression') return;
        const filterArrow = filterCbArg as ArrowFunctionExpression;

        // The filter callback must not use its third parameter (the original array).
        // Using it changes reference semantics that the rewrite cannot replicate.
        if (filterArrow.params.length >= 3) return;

        // The source array expression must be safe to re-evaluate multiple times
        // (used for `array.length` in the loop header and `array[i]` per iteration).
        if (!isSafeExpression(filterCallee.object)) return;

        // Validate block body for filter: all top-level returns must carry an argument.
        const filterIsConcise = filterArrow.body.type !== 'BlockStatement';
        if (!filterIsConcise) {
          const returns = collectTopLevelReturns(
            (filterArrow.body as BlockStatement).body,
          );
          if (returns.length === 0) return;
          if (!allReturnsHaveArgument(returns)) return;
        }

        // Validate block body for map: all top-level returns must carry an argument.
        const mapIsConcise = mapArrow.body.type !== 'BlockStatement';
        if (!mapIsConcise) {
          const returns = collectTopLevelReturns(
            (mapArrow.body as BlockStatement).body,
          );
          if (returns.length === 0) return;
          if (!allReturnsHaveArgument(returns)) return;
        }

        // Determine the context where the chain result is consumed.
        // Supported contexts:
        //   1. return arr.filter(fn1).map(fn2)    — ReturnStatement
        //   2. const x = arr.filter(fn1).map(fn2) — VariableDeclarator
        //   3. x = arr.filter(fn1).map(fn2)       — AssignmentExpression in ExpressionStatement
        //
        // All other positions (nested call arg, ternary, etc.) are skipped because
        // inlining a statement block mid-expression is not possible with a single
        // text replacement.

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
            const arraySource = src.getText(filterCallee.object);
            const filterParams = filterArrow.params as Pattern[];
            const mapParams = mapArrow.params as Pattern[];

            // The element param name from the filter callback, used as the local
            // binding `const <name> = array[i]` when any block body is involved.
            const filterItemName =
              filterParams.length >= 1 && filterParams[0].type === 'Identifier'
                ? (filterParams[0] as Identifier).name
                : null;

            // The map callback's index param is the position within the *filtered*
            // intermediate array, not within the source array. When the map callback
            // uses its index param, emit a separate `mappedIndex` counter that
            // increments only when the predicate passes — not on every iteration.
            const mapUsesIndex = callbackUsesParam(mapArrow, 1, src);
            const mapIndexName =
              mapParams.length >= 2 && mapParams[1].type === 'Identifier'
                ? (mapParams[1] as Identifier).name
                : 'index';

            // Determine the indentation of the statement being replaced.
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

            // Build the loop body lines.
            const loopBodyLines: string[] = [];

            // When either callback has a block body, or when the two callbacks share
            // a different param name for the element, introduce a local binding so
            // that both callbacks can reference the element by the same identifier.
            //
            // For concise+concise we inline `array[i]` directly by substitution
            // and never need the local binding.
            const needsItemBinding = !filterIsConcise || !mapIsConcise;
            const itemExpr = needsItemBinding
              ? (filterItemName ?? 'item')
              : `${arraySource}[i]`;

            if (needsItemBinding) {
              loopBodyLines.push(
                `const ${filterItemName ?? 'item'} = ${arraySource}[i];`,
              );
            }

            // ---- Build filter predicate and its preamble statements ----

            let predicateSource: string;

            if (filterIsConcise) {
              predicateSource = src.getText(filterArrow.body as Node);
              if (filterParams.length >= 1 && filterParams[0].type === 'Identifier') {
                predicateSource = substituteIdentifier(
                  predicateSource,
                  (filterParams[0] as Identifier).name,
                  needsItemBinding ? itemExpr : `${arraySource}[i]`,
                );
              }
              if (filterParams.length >= 2 && filterParams[1].type === 'Identifier') {
                predicateSource = substituteIdentifier(
                  predicateSource,
                  (filterParams[1] as Identifier).name,
                  'i',
                );
              }
            } else {
              // Block body: emit intermediate statements verbatim (after the local
              // item binding already appended above), then extract the predicate
              // from the final `return expr` statement.
              const filterBlock = filterArrow.body as BlockStatement;
              let returnExprSource = 'true';
              for (const stmt of filterBlock.body) {
                if (stmt.type === 'ReturnStatement' && stmt.argument != null) {
                  returnExprSource = src.getText(stmt.argument as Node);
                } else {
                  loopBodyLines.push(src.getText(stmt as Node));
                }
              }
              predicateSource = returnExprSource;
            }

            // ---- Build map push expression and its preamble statements ----
            // These go inside the `if (predicate)` block.

            const ifBodyLines: string[] = [];

            if (mapIsConcise) {
              let mapExprSource = src.getText(mapArrow.body as Node);
              const mapItemName =
                mapParams.length >= 1 && mapParams[0].type === 'Identifier'
                  ? (mapParams[0] as Identifier).name
                  : null;

              if (mapItemName != null) {
                // When we have a shared local binding from a block filter, the map
                // param name may differ. Substitute it with the element expression.
                mapExprSource = substituteIdentifier(
                  mapExprSource,
                  mapItemName,
                  itemExpr,
                );
              }
              if (mapUsesIndex && mapIndexName != null) {
                mapExprSource = substituteIdentifier(
                  mapExprSource,
                  mapIndexName,
                  'mappedIndex',
                );
              }
              ifBodyLines.push(`result.push(${mapExprSource});`);
            } else {
              // Block body: emit param bindings (skip the item param if a shared
              // local binding is already in scope), then inline body statements
              // substituting `return expr` with `result.push(expr)`.

              const mapItemName =
                mapParams.length >= 1 && mapParams[0].type === 'Identifier'
                  ? (mapParams[0] as Identifier).name
                  : null;

              // Only emit a local item binding for the map param if the map callback
              // uses a different name than the filter callback's item binding, or if
              // there is no shared item binding (both callbacks are concise — but
              // that can't happen here since mapIsConcise is false in this branch).
              if (mapItemName != null && mapItemName !== (filterItemName ?? 'item')) {
                ifBodyLines.push(
                  `const ${mapItemName} = ${itemExpr};`,
                );
              }

              if (mapUsesIndex && mapParams.length >= 2) {
                ifBodyLines.push(
                  `const ${src.getText(mapParams[1] as Node)} = mappedIndex;`,
                );
              }

              const mapBlock = mapArrow.body as BlockStatement;
              for (const stmt of mapBlock.body) {
                if (stmt.type === 'ReturnStatement' && stmt.argument != null) {
                  ifBodyLines.push(
                    `result.push(${src.getText(stmt.argument as Node)});`,
                  );
                } else {
                  ifBodyLines.push(src.getText(stmt as Node));
                }
              }
            }

            if (mapUsesIndex) {
              ifBodyLines.push('mappedIndex++;');
            }

            // ---- Assemble the if block as flat lines ----
            // Each element of loopBodyLines is a single line (no embedded newlines)
            // so that the per-line `  ` prefix applied below indents every line
            // uniformly within the for loop body.

            loopBodyLines.push(`if (${predicateSource}) {`);
            for (const line of ifBodyLines) {
              loopBodyLines.push(`  ${line}`);
            }
            loopBodyLines.push('}');

            const indentedBody = loopBodyLines.map((l) => `  ${l}`).join('\n');

            // Prepend `let mappedIndex = 0` before the loop when needed.
            const mappedIndexDecl = mapUsesIndex ? 'let mappedIndex = 0;\n' : '';

            const forLoop =
              `const result = [];\n` +
              mappedIndexDecl +
              `for (let i = 0; i < ${arraySource}.length; i++) {\n` +
              indentedBody +
              '\n}';

            if (contextType === 'return') {
              return fixer.replaceText(
                parent as unknown as Node,
                indentLines(`${forLoop}\nreturn result;`),
              );
            }

            if (contextType === 'varDecl') {
              const varDecl = grandparent as unknown as Node;
              const varDeclarator = parent as unknown as { id: Pattern };
              const varName = src.getText(varDeclarator.id as Node);
              if (varName === 'result') {
                return fixer.replaceText(varDecl, indentLines(forLoop));
              }
              return fixer.replaceText(
                varDecl,
                indentLines(`${forLoop}\nconst ${varName} = result;`),
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
