import type { Rule } from 'eslint';
import type {
  Node,
  Statement,
  BlockStatement,
  MemberExpression,
  SwitchCase,
  CatchClause,
} from 'estree';

function isSafeExpression(node: Node): boolean {
  if (node.type === 'Identifier') return true;
  if (node.type === 'ThisExpression') return true;
  if (node.type === 'MemberExpression' && !node.computed) {
    return isSafeExpression(node.object);
  }
  return false;
}

function hasTopLevelReturnInStatements(stmts: Statement[]): boolean {
  return stmts.some(hasTopLevelReturnInStatement);
}

function hasTopLevelReturnInStatement(stmt: Statement | null | undefined): boolean {
  if (!stmt) return false;
  switch (stmt.type) {
    case 'ReturnStatement':
      return true;
    // Nested function scopes: return inside them does NOT affect the forEach callback
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return false;
    case 'BlockStatement':
      return hasTopLevelReturnInStatements(stmt.body);
    case 'IfStatement':
      return (
        hasTopLevelReturnInStatement(stmt.consequent) ||
        hasTopLevelReturnInStatement(stmt.alternate as Statement | null)
      );
    case 'ForStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'LabeledStatement':
    case 'WithStatement':
      return hasTopLevelReturnInStatement(stmt.body as Statement);
    case 'SwitchStatement':
      return stmt.cases.some((c: SwitchCase) =>
        hasTopLevelReturnInStatements(c.consequent),
      );
    case 'TryStatement':
      return (
        hasTopLevelReturnInStatements(stmt.block.body) ||
        (stmt.handler !== null &&
          hasTopLevelReturnInStatements(
            (stmt.handler as CatchClause).body.body,
          )) ||
        (stmt.finalizer !== null &&
          hasTopLevelReturnInStatements(stmt.finalizer!.body))
      );
    default:
      return false;
  }
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    schema: [],
    messages: {
      preferForLoop:
        'Prefer a for loop over .forEach() to eliminate per-element function call overhead.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.computed ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'forEach' ||
          node.arguments.length !== 1
        )
          return;

        const [callback] = node.arguments;
        if (
          callback.type !== 'ArrowFunctionExpression' ||
          callback.body.type !== 'BlockStatement'
        )
          return;

        if (hasTopLevelReturnInStatements(callback.body.body)) return;

        // TypeScript can't narrow node.callee past the early-return check above
        const callee = node.callee as MemberExpression;

        // Only autofix when the array expression is safe to evaluate multiple times
        if (!isSafeExpression(callee.object)) return;

        context.report({
          node,
          messageId: 'preferForLoop',
          fix(fixer) {
            const src = context.sourceCode;
            const arraySource = src.getText(callee.object);
            const params = callback.params;
            const body = callback.body as BlockStatement;

            // Strip the outer braces; preserve the inner content verbatim
            const bodyText = src.getText(body);
            const innerBody = bodyText.slice(1, -1);

            const paramDecls: string[] = [];
            if (params.length >= 1) {
              paramDecls.push(
                `const ${src.getText(params[0] as Node)} = ${arraySource}[i];`,
              );
            }
            if (params.length >= 2) {
              paramDecls.push(`const ${src.getText(params[1] as Node)} = i;`);
            }
            if (params.length >= 3) {
              paramDecls.push(
                `const ${src.getText(params[2] as Node)} = ${arraySource};`,
              );
            }

            const declsSource =
              paramDecls.length > 0 ? '\n  ' + paramDecls.join('\n  ') : '';

            const forLoop =
              `for (let i = 0; i < ${arraySource}.length; i++) {` +
              declsSource +
              innerBody +
              '}';

            // Replace the whole ExpressionStatement to avoid a dangling semicolon
            const parent = (node as Rule.Node).parent;
            const target =
              parent?.type === 'ExpressionStatement' ? parent : node;
            return fixer.replaceText(target, forLoop);
          },
        });
      },
    };
  },
};

export default rule;
