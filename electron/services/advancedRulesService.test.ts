import { describe, expect, it } from 'vitest';
import jsep from 'jsep';

// Minimal evaluator copy for tests (ensures jsep supports ternary + calls)
function evalAst(node: any, ctx: Record<string, any>): any {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier':
      if (Object.prototype.hasOwnProperty.call(ctx, node.name)) return ctx[node.name];
      throw new Error(`Unknown identifier ${node.name}`);
    case 'UnaryExpression': {
      const a = evalAst(node.argument, ctx);
      if (node.operator === '!') return !a;
      if (node.operator === '-') return -a;
      if (node.operator === '+') return +a;
      throw new Error('bad unary');
    }
    case 'BinaryExpression': {
      const l = evalAst(node.left, ctx);
      const r = evalAst(node.right, ctx);
      switch (node.operator) {
        case '>':
          return l > r;
        case '&&':
          return l && r;
        case '+':
          return l + r;
        default:
          throw new Error('bad op');
      }
    }
    case 'LogicalExpression': {
      const l = evalAst(node.left, ctx);
      if (node.operator === '&&') return l ? evalAst(node.right, ctx) : l;
      if (node.operator === '||') return l ? l : evalAst(node.right, ctx);
      throw new Error('bad logical');
    }
    case 'ConditionalExpression':
      return evalAst(node.test, ctx) ? evalAst(node.consequent, ctx) : evalAst(node.alternate, ctx);
    case 'CallExpression': {
      if (node.callee.type !== 'Identifier') throw new Error('bad call');
      const fn = ctx[node.callee.name];
      const args = node.arguments.map((a: any) => evalAst(a, ctx));
      if (typeof fn !== 'function') throw new Error('bad fn');
      return fn(...args);
    }
    default:
      throw new Error(`bad node ${node.type}`);
  }
}

describe('advanced rules expression parser', () => {
  it('supports value() and ternary', () => {
    const ast = jsep('value(\"a\") > 10 ? 1 : 0');
    const ctx = { value: (id: string) => (id === 'a' ? 12 : 0) };
    expect(evalAst(ast as any, ctx)).toBe(1);
  });

  it('supports logical ops', () => {
    const ast = jsep('value(\"a\") > 10 && value(\"b\") > 5');
    const ctx = { value: (id: string) => (id === 'a' ? 12 : id === 'b' ? 6 : 0) };
    expect(!!evalAst(ast as any, ctx)).toBe(true);
  });
});

