// ESLint rule with auto-fix rather than a jscodeshift codemod: spread-based
// array concatenation is a pattern that developers write continuously (not a
// legacy migration), so ongoing CI enforcement via an ESLint rule is more
// appropriate than a one-off codemod.

import type { Rule } from 'eslint';
import type { Node, SpreadElement, Expression } from 'estree';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Only identifiers and non-computed member chains are safe to use as the
// receiver of .concat() — they are guaranteed side-effect-free and produce a
// stable reference across multiple reads within the same expression.
function isSafeExpression(node: Node): boolean {
  if (node.type === 'Identifier') return true;
  if (node.type === 'ThisExpression') return true;
  if (node.type === 'MemberExpression' && !node.computed) {
    return isSafeExpression(node.object);
  }
  return false;
}

// Produce the source text for a concat argument from a run of elements.
// A run is either a single SpreadElement (yield the spread argument's source)
// or a sequence of non-spread elements wrapped in an array literal.
type Run =
  | { kind: 'spread'; source: string }
  | { kind: 'literals'; sources: string[] };

function runToArgSource(run: Run): string {
  if (run.kind === 'spread') return run.source;
  return `[${run.sources.join(', ')}]`;
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
      preferConcat:
        'Prefer Array.prototype.concat over spread-based array concatenation to eliminate iterator protocol overhead.',
    },
  },

  create(context) {
    return {
      ArrayExpression(node) {
        const elements = node.elements;

        // Only rewrite when the array has at least one SpreadElement — an empty
        // array or an array of only plain literals is not a concatenation pattern.
        const hasSpread = elements.some((el) => el?.type === 'SpreadElement');
        if (!hasSpread) return;

        // Null slots (trailing commas / holes) cannot be safely expressed
        // through concat — skip any array literal that contains a hole.
        if (elements.some((el) => el === null)) return;

        // Every spread argument must be a safe (side-effect-free, stable)
        // expression so we can emit it as a concat argument without worrying
        // about double-evaluation or ordering surprises.
        const spreadElements = elements.filter(
          (el): el is SpreadElement => el?.type === 'SpreadElement',
        );
        if (!spreadElements.every((el) => isSafeExpression(el.argument))) return;

        // The result must be consumed — we only auto-fix contexts where the
        // array literal appears as:
        //   1. The initialiser of a variable declaration
        //   2. The right-hand side of an assignment expression statement
        //   3. The argument of a return statement
        //
        // In all other positions the literal is embedded inside a larger
        // expression; replacing it with a method call is safe but the inline
        // substitution approach of ESLint fixers handles that fine too —
        // unlike for/filter rewrites we are not replacing a statement block,
        // just swapping one expression for another.  We allow inline substitution
        // here: the fixer replaces only the ArrayExpression node itself, which
        // ESLint can do in any expression position.
        //
        // We still guard against the discarded-result case (bare expression
        // statement containing only the array literal) since that pattern is
        // meaningless and not a candidate for concat either.
        const parent = (node as Rule.Node).parent;
        if (parent?.type === 'ExpressionStatement') return;

        const src = context.sourceCode;

        // Classify elements into runs: a run is either a single spread or a
        // contiguous sequence of non-spread (literal) elements.  This lets us
        // handle all three fixture patterns uniformly:
        //   [a, b]          → literals run only        (no spread — guarded above)
        //   [...a, ...b]    → spread, spread            (all-spread case)
        //   [x, ...a, y]    → literals, spread, literals (mixed case)
        const runs: Run[] = [];
        let currentLiterals: string[] | null = null;

        for (const el of elements) {
          if (el === null) break; // should never reach here after the null check above
          if (el.type === 'SpreadElement') {
            if (currentLiterals !== null) {
              runs.push({ kind: 'literals', sources: currentLiterals });
              currentLiterals = null;
            }
            runs.push({ kind: 'spread', source: src.getText(el.argument as Node) });
          } else {
            if (currentLiterals === null) currentLiterals = [];
            currentLiterals.push(src.getText(el as Node));
          }
        }
        if (currentLiterals !== null) {
          runs.push({ kind: 'literals', sources: currentLiterals });
        }

        // We need at least two runs (or one run that is a spread flanked by
        // literals) for the concat rewrite to be worthwhile.
        if (runs.length < 2) return;

        // Build the replacement expression.
        // The receiver is the first run; the remaining runs become concat arguments.
        const [firstRun, ...restRuns] = runs;
        const receiver = runToArgSource(firstRun);
        const args = restRuns.map(runToArgSource).join(', ');
        const replacement = `${receiver}.concat(${args})`;

        context.report({
          node,
          messageId: 'preferConcat',
          fix(fixer) {
            return fixer.replaceText(node as unknown as Node, replacement);
          },
        });
      },
    };
  },
};

export default rule;
