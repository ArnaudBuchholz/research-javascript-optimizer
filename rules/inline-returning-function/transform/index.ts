// ESLint rule with auto-fix rather than a jscodeshift codemod: value-returning
// helpers can be introduced at any point in a codebase and are a recurring
// micro-optimisation target in hot loops, so ongoing CI enforcement fits better
// than a one-off migration script.

import type { Rule, Scope, SourceCode } from 'eslint';
import type {
  Node,
  Statement,
  Expression,
  FunctionDeclaration,
  BlockStatement,
  IfStatement,
  ReturnStatement,
  Identifier,
  SwitchCase,
  CatchClause,
  VariableDeclaration,
  Pattern,
  ArrowFunctionExpression,
} from 'estree';

// ---------------------------------------------------------------------------
// Deep-walk helpers — stop at nested function boundaries
// ---------------------------------------------------------------------------

const SKIP_KEYS = new Set(['parent', 'start', 'end', 'loc', 'range']);

function containsInFunctionBody(
  root: Node,
  predicate: (n: Node) => boolean,
): boolean {
  if (predicate(root)) return true;

  switch (root.type) {
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

function hasUnsafeReturn(stmts: Statement[]): boolean {
  return stmts.some((stmt) => hasAnyVoidReturnInStmt(stmt));
}

// Returns true if stmt or any descendant (not crossing function scopes) is a
// bare `return;`.
function hasAnyVoidReturnInStmt(stmt: Statement): boolean {
  return containsInFunctionBody(
    stmt as unknown as Node,
    (n) => n.type === 'ReturnStatement' && (n as ReturnStatement).argument == null,
  );
}

// Returns true when every execution path through the statement list ends
// with a `return <expr>`.
function bodyAlwaysReturnsValue(stmts: Statement[]): boolean {
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  return stmtAlwaysReturnsValue(last);
}

function stmtAlwaysReturnsValue(stmt: Statement): boolean {
  switch (stmt.type) {
    case 'ReturnStatement':
      return (stmt as ReturnStatement).argument != null;

    case 'BlockStatement':
      return bodyAlwaysReturnsValue((stmt as BlockStatement).body);

    case 'IfStatement': {
      const is = stmt as IfStatement;
      const alt = is.alternate as Statement | null;
      if (alt == null) return false;
      return (
        stmtAlwaysReturnsValue(is.consequent) &&
        stmtAlwaysReturnsValue(alt)
      );
    }

    default:
      return false;
  }
}

function bodyUsesThis(body: BlockStatement): boolean {
  return containsInFunctionBody(body as unknown as Node, (n) => n.type === 'ThisExpression');
}

function bodyUsesArguments(body: BlockStatement): boolean {
  return containsInFunctionBody(body as unknown as Node, (n) => {
    return n.type === 'Identifier' && (n as Identifier).name === 'arguments';
  });
}

function bodyUsesEvalOrWith(body: BlockStatement): boolean {
  return containsInFunctionBody(body as unknown as Node, (n) => {
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
  return containsInFunctionBody(body as unknown as Node, (n) => {
    return n.type === 'VariableDeclaration' && (n as VariableDeclaration).kind === 'var';
  });
}

function bodyContainsUnlabelledBreakOrContinue(body: BlockStatement): boolean {
  return containsInFunctionBody(body as unknown as Node, (n) => {
    if (n.type === 'BreakStatement' && (n as { label: null | unknown }).label === null) return true;
    if (n.type === 'ContinueStatement' && (n as { label: null | unknown }).label === null) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

function findVariable(scope: Scope.Scope, name: string): Scope.Variable | null {
  let current: Scope.Scope | null = scope;
  while (current) {
    const v = current.set.get(name);
    if (v) return v;
    current = current.upper;
  }
  return null;
}

function allVisibleNames(scope: Scope.Scope): Set<string> {
  const names = new Set<string>();
  let sc: Scope.Scope | null = scope;
  while (sc) {
    for (const v of sc.variables) names.add(v.name);
    sc = sc.upper;
  }
  return names;
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
// Misc text helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyRenames(text: string, renames: Map<string, string>): string {
  let result = text;
  for (const [original, renamed] of renames) {
    if (original === renamed) continue;
    result = result.replace(
      new RegExp(`\\b${escapeRegExp(original)}\\b`, 'g'),
      renamed,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Body-rewriting: replaces `return <expr>` with `<resultVar> = <expr>` and
// restructures early-return if-statements into if/else chains.
// ---------------------------------------------------------------------------

function rewriteStmts(
  stmts: Statement[],
  src: SourceCode,
  resultVar: string,
  renames: Map<string, string>,
  indent: string,
): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < stmts.length) {
    const stmt = stmts[i];

    if (stmt.type === 'ReturnStatement') {
      const rs = stmt as ReturnStatement;
      const argText = rs.argument
        ? applyRenames(src.getText(rs.argument as unknown as Node), renames)
        : 'undefined';
      result.push(`${indent}${resultVar} = ${argText};`);
      i++;
      continue;
    }

    if (stmt.type === 'IfStatement' && consequentContainsReturn(stmt as IfStatement)) {
      const remaining = stmts.slice(i + 1);
      result.push(
        buildIfElseChain(stmt as IfStatement, remaining, src, resultVar, renames, indent),
      );
      // All remaining statements were folded into the else branches.
      i = stmts.length;
      continue;
    }

    result.push(`${indent}${applyRenames(src.getText(stmt as unknown as Node), renames)}`);
    i++;
  }

  return result;
}

// Returns true when the consequent of an IfStatement directly contains a
// return statement (not crossing nested function boundaries or block nesting
// beyond direct children — only "can the branch exit with a return?").
function consequentContainsReturn(stmt: IfStatement): boolean {
  return stmtDirectlyContainsReturn(stmt.consequent);
}

function stmtDirectlyContainsReturn(stmt: Statement): boolean {
  if (stmt.type === 'ReturnStatement') return true;
  if (stmt.type === 'BlockStatement') {
    return (stmt as BlockStatement).body.some(stmtDirectlyContainsReturn);
  }
  return false;
}

// Builds an if/else chain for an IfStatement whose consequent contains a return.
// `rest` is the sibling statements that follow (they become the else branch).
function buildIfElseChain(
  node: IfStatement,
  rest: Statement[],
  src: SourceCode,
  resultVar: string,
  renames: Map<string, string>,
  indent: string,
): string {
  const condText = applyRenames(src.getText(node.test as unknown as Node), renames);
  const innerIndent = indent + '  ';

  const consLines = rewriteConsequent(node.consequent, src, resultVar, renames, innerIndent);
  const consBlock = `{\n${consLines.join('\n')}\n${indent}}`;

  let elseText: string;
  if (node.alternate !== null) {
    const alt = node.alternate as Statement;
    if (alt.type === 'IfStatement') {
      elseText = ` else ${buildIfElseChain(alt as IfStatement, rest, src, resultVar, renames, indent)}`;
    } else {
      const altLines = rewriteConsequent(alt, src, resultVar, renames, innerIndent);
      elseText = ` else {\n${altLines.join('\n')}\n${indent}}`;
    }
  } else if (rest.length > 0) {
    const firstRest = rest[0];
    if (firstRest.type === 'IfStatement' && consequentContainsReturn(firstRest as IfStatement)) {
      // Produce `else if (...)` directly rather than `else { if (...) }` to
      // match the canonical if/else if/else form expected by the fixtures.
      const elseIfText = buildIfElseChain(
        firstRest as IfStatement,
        rest.slice(1),
        src,
        resultVar,
        renames,
        indent,
      );
      // buildIfElseChain already prepends `indent`, so strip the leading indent
      // here since we're appending after `}` on the same line.
      elseText = ` else ${elseIfText.slice(indent.length)}`;
    } else {
      const elseLines = rewriteStmts(rest, src, resultVar, renames, innerIndent);
      elseText = ` else {\n${elseLines.join('\n')}\n${indent}}`;
    }
  } else {
    elseText = '';
  }

  return `${indent}if (${condText}) ${consBlock}${elseText}`;
}

function rewriteConsequent(
  stmt: Statement,
  src: SourceCode,
  resultVar: string,
  renames: Map<string, string>,
  indent: string,
): string[] {
  if (stmt.type === 'BlockStatement') {
    return rewriteStmts((stmt as BlockStatement).body, src, resultVar, renames, indent);
  }
  return rewriteStmts([stmt], src, resultVar, renames, indent);
}

// ---------------------------------------------------------------------------
// Enclosing-statement finder
// ---------------------------------------------------------------------------

interface EnclosingInfo {
  stmt: Rule.Node;
  arrowToExpand: (Rule.Node & { type: 'ArrowFunctionExpression' }) | null;
}

function findEnclosingStatement(call: Rule.Node): EnclosingInfo {
  let current: Rule.Node = call;
  let arrowToExpand: (Rule.Node & { type: 'ArrowFunctionExpression' }) | null = null;

  while (current.parent) {
    const parent = current.parent as Rule.Node;

    if (
      parent.type === 'ArrowFunctionExpression' &&
      (parent as unknown as ArrowFunctionExpression).body.type !== 'BlockStatement'
    ) {
      arrowToExpand = parent as Rule.Node & { type: 'ArrowFunctionExpression' };
    }

    if (isStatementType(parent.type)) {
      return { stmt: parent, arrowToExpand };
    }

    if (parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression') {
      break;
    }

    current = parent;
  }

  return { stmt: current, arrowToExpand };
}

const STATEMENT_TYPES = new Set([
  'ExpressionStatement',
  'VariableDeclaration',
  'ReturnStatement',
  'IfStatement',
  'ForStatement',
  'WhileStatement',
  'DoWhileStatement',
  'ForInStatement',
  'ForOfStatement',
  'ThrowStatement',
  'LabeledStatement',
  'BlockStatement',
  'SwitchStatement',
  'TryStatement',
  'WithStatement',
]);

function isStatementType(type: string): boolean {
  return STATEMENT_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

type Range = [number, number];

function nodeRange(node: Rule.Node | Node): Range {
  return (node as unknown as { range: Range }).range;
}

function nodeLoc(node: Rule.Node | Node): { start: { line: number; column: number } } {
  return (node as unknown as { loc: { start: { line: number; column: number } } }).loc;
}

// Returns the position of the start of the line (after the previous newline).
function lineStart(pos: number, sourceText: string): number {
  let p = pos;
  while (p > 0 && sourceText[p - 1] !== '\n') p--;
  return p;
}

function computeRemoveRange(decl: FunctionDeclaration, sourceText: string): Range {
  let start = nodeRange(decl as unknown as Rule.Node)[0];
  let end = nodeRange(decl as unknown as Rule.Node)[1];
  if (sourceText[end] === '\n') end++;
  if (start >= 2 && sourceText[start - 1] === '\n' && sourceText[start - 2] === '\n') {
    start--;
  }
  return [start, end];
}

// ---------------------------------------------------------------------------
// Per-call preamble builder
// ---------------------------------------------------------------------------

// Describes one inlined call site.
interface InlineCallSite {
  callNode: Rule.Node;
  decl: FunctionDeclaration;
  paramNames: string[];
  argTexts: string[];
  enclosingStmt: Rule.Node;
  arrowToExpand: (Rule.Node & { type: 'ArrowFunctionExpression' }) | null;
  resultVar: string;
  renames: Map<string, string>;
}

// Builds the preamble lines (const bindings + let _result + rewritten body block)
// using `stmtIndent` as the base indentation of the enclosing statement.
function buildPreambleLines(
  site: InlineCallSite,
  src: SourceCode,
  stmtIndent: string,
): string[] {
  const { decl, paramNames, argTexts, resultVar, renames } = site;
  const innerIndent = stmtIndent + '  ';
  const lines: string[] = [];

  for (let i = 0; i < paramNames.length; i++) {
    const bindingName = renames.get(paramNames[i])!;
    const argExpr = i < argTexts.length ? argTexts[i] : 'undefined';
    lines.push(`${stmtIndent}const ${bindingName} = ${argExpr};`);
  }

  lines.push(`${stmtIndent}let ${resultVar};`);
  lines.push(`${stmtIndent}{`);

  const bodyLines = rewriteStmts(
    decl.body.body as Statement[],
    src,
    resultVar,
    renames,
    innerIndent,
  );
  for (const line of bodyLines) lines.push(line);

  lines.push(`${stmtIndent}}`);

  return lines;
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
      inlineReturningFunction:
        'Inline this value-returning helper at the call site to eliminate per-call stack-frame, return-value protocol, and IC overhead.',
    },
  },

  create(context) {
    // Map from function name → validated FunctionDeclaration.
    const safeDeclarations = new Map<string, FunctionDeclaration>();

    // All value-position call nodes grouped by callee name.
    const callSitesByDecl = new Map<string, Rule.Node[]>();

    function validateDeclaration(node: FunctionDeclaration): void {
      if (!node.id) return;
      if (node.async || node.generator) return;

      const paramNames = extractParamNames(node.params);
      if (paramNames === null) return;

      const body = node.body;

      if (bodyUsesThis(body)) return;
      if (bodyUsesArguments(body)) return;
      if (bodyUsesEvalOrWith(body)) return;
      if (bodyContainsVar(body)) return;
      if (bodyContainsUnlabelledBreakOrContinue(body)) return;
      if (hasUnsafeReturn(body.body)) return;
      if (!bodyAlwaysReturnsValue(body.body)) return;

      safeDeclarations.set(node.id.name, node);
    }

    function recordCallSite(callNode: Rule.Node & { type: 'CallExpression' }): void {
      if (callNode.callee.type !== 'Identifier') return;

      const calleeName = (callNode.callee as unknown as Identifier).name;
      if (!safeDeclarations.has(calleeName)) return;

      // Only value-position calls (not standalone expression statements).
      const parent = callNode.parent as Rule.Node;
      if (parent && parent.type === 'ExpressionStatement') return;

      if (callNode.arguments.some((a) => a.type === 'SpreadElement')) return;

      if (!callSitesByDecl.has(calleeName)) callSitesByDecl.set(calleeName, []);
      callSitesByDecl.get(calleeName)!.push(callNode as unknown as Rule.Node);
    }

    function reportInlineOpportunities(): void {
      const src = context.sourceCode;
      const sourceText = src.getText();

      // Build a flat list of (callNode, decl) pairs for all valid call sites,
      // ordered by their position in the source so deterministic numbering works.
      const allSites: Array<{ callNode: Rule.Node; decl: FunctionDeclaration; paramNames: string[] }> = [];

      for (const [name, decl] of safeDeclarations) {
        const callNodes = callSitesByDecl.get(name);
        if (!callNodes || callNodes.length === 0) continue;

        // Scope check: binding must resolve to exactly this declaration.
        const firstCallScope = src.getScope(callNodes[0]);
        const variable = findVariable(firstCallScope, name);
        if (!variable || variable.defs.length !== 1) continue;
        if (variable.defs[0].node !== decl) continue;

        const hasReassignment = variable.references.some(
          (r) => r.isWrite() && r.writeExpr != null,
        );
        if (hasReassignment) continue;

        const paramNames = extractParamNames(decl.params)!;

        for (const callNode of callNodes) {
          allSites.push({ callNode, decl, paramNames });
        }
      }

      if (allSites.length === 0) return;

      // Sort by source position so we assign _N suffixes in document order.
      allSites.sort(
        (a, b) => nodeRange(a.callNode)[0] - nodeRange(b.callNode)[0],
      );

      // Group call sites by their enclosing statement to detect multi-call scopes.
      // Key: range start of the enclosing statement.
      const sitesByStmt = new Map<
        number,
        Array<{ callNode: Rule.Node; decl: FunctionDeclaration; paramNames: string[] }>
      >();

      const enclosingInfoByCall = new Map<Rule.Node, EnclosingInfo>();

      for (const site of allSites) {
        const info = findEnclosingStatement(site.callNode);
        enclosingInfoByCall.set(site.callNode, info);
        const key = nodeRange(info.stmt)[0];
        if (!sitesByStmt.has(key)) sitesByStmt.set(key, []);
        sitesByStmt.get(key)!.push(site);
      }

      // Assign names: for each enclosing statement, build the InlineCallSite
      // descriptors with correct rename maps.
      const completeSites: InlineCallSite[] = [];

      for (const [, stmtSites] of sitesByStmt) {
        const multiCall = stmtSites.length > 1;
        const { stmt: enclosingStmt, arrowToExpand } = enclosingInfoByCall.get(stmtSites[0].callNode)!;
        const callScope = src.getScope(stmtSites[0].callNode);
        const outerNames = allVisibleNames(callScope);
        const takenNames = new Set(outerNames);

        stmtSites.forEach(({ callNode, decl, paramNames }, idx) => {
          const callIndex = idx + 1;
          const renames = new Map<string, string>();

          for (const paramName of paramNames) {
            let bindingName: string;
            if (multiCall) {
              // In multi-call scopes always use numbered suffix to avoid collisions.
              bindingName = `${paramName}_${callIndex}`;
              // Handle the case where even the numbered name is taken.
              while (takenNames.has(bindingName)) {
                bindingName = `_${bindingName}`;
              }
            } else if (takenNames.has(paramName)) {
              let candidate = `_${paramName}`;
              while (takenNames.has(candidate)) candidate = `_${candidate}`;
              bindingName = candidate;
            } else {
              bindingName = paramName;
            }
            renames.set(paramName, bindingName);
            takenNames.add(bindingName);
          }

          let resultVar: string;
          if (multiCall) {
            resultVar = `_result_${callIndex}`;
            while (takenNames.has(resultVar)) resultVar = `_${resultVar}`;
          } else {
            resultVar = '_result';
            let suffix = 1;
            while (takenNames.has(resultVar)) resultVar = `_result_${suffix++}`;
          }
          takenNames.add(resultVar);

          const argTexts = (callNode as unknown as { arguments: Expression[] }).arguments
            .slice(0, paramNames.length)
            .map((a) => src.getText(a as unknown as Node));

          const info = enclosingInfoByCall.get(callNode)!;

          completeSites.push({
            callNode,
            decl,
            paramNames,
            argTexts,
            enclosingStmt: info.stmt,
            arrowToExpand: info.arrowToExpand,
            resultVar,
            renames,
          });
        });
      }

      // Determine which declarations need to be reported and removed.
      const declsToRemove = new Set<FunctionDeclaration>();
      for (const site of completeSites) declsToRemove.add(site.decl);

      // Report once per function declaration.
      // All fixes are bundled into the first declaration's report so they apply
      // atomically in a single ESLint fix pass, preventing name collisions.
      const reported = new Set<FunctionDeclaration>();

      // We'll report on the first declaration in source order and bundle all fixes.
      const declsInOrder = [...declsToRemove].sort(
        (a, b) => nodeRange(a as unknown as Rule.Node)[0] - nodeRange(b as unknown as Rule.Node)[0],
      );

      if (declsInOrder.length === 0) return;

      // Report on the first declaration and include ALL fixes in its fixer.
      const firstDecl = declsInOrder[0];
      reported.add(firstDecl);

      context.report({
        node: firstDecl as unknown as Node,
        messageId: 'inlineReturningFunction',
        fix(fixer) {
          const fixes: ReturnType<typeof fixer.replaceTextRange>[] = [];

          // Remove all function declarations.
          for (const decl of declsToRemove) {
            fixes.push(fixer.removeRange(computeRemoveRange(decl, sourceText)));
          }

          // Group call sites by enclosing statement for combined preamble insertion.
          // We process in source order so that multiple calls in the same stmt
          // produce preambles in document order.
          const processedByStmt = new Map<number, {
            preambles: string[];
            replacements: Array<{ callNode: Rule.Node; resultVar: string }>;
            arrowToExpand: (Rule.Node & { type: 'ArrowFunctionExpression' }) | null;
            enclosingStmt: Rule.Node;
            stmtIndent: string;
          }>();

          for (const site of completeSites) {
            const stmtKey = nodeRange(site.enclosingStmt)[0];
            const stmtLoc = nodeLoc(site.enclosingStmt);
            const stmtIndent = ' '.repeat(stmtLoc.start.column);

            if (!processedByStmt.has(stmtKey)) {
              processedByStmt.set(stmtKey, {
                preambles: [],
                replacements: [],
                arrowToExpand: site.arrowToExpand,
                enclosingStmt: site.enclosingStmt,
                stmtIndent,
              });
            }

            const entry = processedByStmt.get(stmtKey)!;
            const preambleLines = buildPreambleLines(site, src, stmtIndent);
            entry.preambles.push(...preambleLines);
            entry.replacements.push({ callNode: site.callNode, resultVar: site.resultVar });
          }

          // Apply fixes per enclosing statement.
          for (const [, entry] of processedByStmt) {
            const { preambles, replacements, arrowToExpand, enclosingStmt, stmtIndent } = entry;

            if (arrowToExpand !== null) {
              // Build expanded arrow function incorporating all preambles + return.
              const arrowNode = arrowToExpand as unknown as ArrowFunctionExpression;
              let bodyExprText = src.getText(arrowNode.body as unknown as Node);
              const bodyStart = nodeRange(arrowNode.body as unknown as Rule.Node)[0];

              // Apply all call replacements within the arrow body expression,
              // from right to left to preserve offsets.
              const replacementsSorted = [...replacements].sort(
                (a, b) => nodeRange(b.callNode)[1] - nodeRange(a.callNode)[1],
              );
              for (const { callNode, resultVar } of replacementsSorted) {
                const callRange = nodeRange(callNode);
                const startOff = callRange[0] - bodyStart;
                const endOff = callRange[1] - bodyStart;
                bodyExprText =
                  bodyExprText.slice(0, startOff) +
                  resultVar +
                  bodyExprText.slice(endOff);
              }

              // Find the enclosing statement's indentation to use as the arrow block indent.
              const arrowEnclosingInfo = findEnclosingStatement(arrowToExpand as unknown as Rule.Node);
              const arrowStmtLoc = nodeLoc(arrowEnclosingInfo.stmt);
              const arrowBlockIndent = ' '.repeat(arrowStmtLoc.start.column);
              const arrowBlockInner = arrowBlockIndent + '  ';

              // Re-indent preambles to use arrowBlockInner instead of stmtIndent.
              const reindentedPreambles = preambles.map((line) => {
                if (line.trim() === '') return line;
                const stripped = line.slice(stmtIndent.length);
                return `${arrowBlockInner}${stripped}`;
              });

              // Build the expanded arrow: (params) => { preambles; return bodyExpr; }
              const params = arrowNode.params
                .map((p) => src.getText(p as unknown as Node))
                .join(', ');
              const asyncPrefix = arrowNode.async ? 'async ' : '';

              const expandedArrow = [
                `${asyncPrefix}(${params}) => {`,
                ...reindentedPreambles,
                `${arrowBlockInner}return ${bodyExprText};`,
                `${arrowBlockIndent}}`,
              ].join('\n');

              fixes.push(
                fixer.replaceText(arrowToExpand as unknown as Node, expandedArrow),
              );
            } else {
              // Replace each call expression with its result variable.
              for (const { callNode, resultVar } of replacements) {
                fixes.push(fixer.replaceText(callNode as unknown as Node, resultVar));
              }

              // Insert all preambles before the enclosing statement.
              // Use replaceTextRange starting at line-start so that the existing
              // leading whitespace is included and the first preamble line is
              // correctly indented.
              const stmtRange = nodeRange(enclosingStmt);
              const stmtLineStart = lineStart(stmtRange[0], sourceText);

              // The text from stmtLineStart to stmtRange[0] is the leading whitespace
              // (stmtIndent). We prepend it to first preamble line and append it before
              // the original statement, replacing the range [stmtLineStart, stmtRange[0]].
              const preambleText = preambles.join('\n') + '\n' + stmtIndent;
              fixes.push(
                fixer.replaceTextRange([stmtLineStart, stmtRange[0]], preambleText),
              );
            }
          }

          return fixes;
        },
      });

      // Report the remaining declarations separately (no fix) so lint output
      // identifies them, but only the combined fix on the first decl handles
      // the actual transformation.
      for (const decl of declsInOrder.slice(1)) {
        if (!reported.has(decl)) {
          context.report({
            node: decl as unknown as Node,
            messageId: 'inlineReturningFunction',
          });
        }
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
