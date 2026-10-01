// Prototype : parseur Peggy + interpréteur à liste blanche + decimal.js (spike ADR-003).
import peggy from 'peggy';
import Decimal from 'decimal.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const grammar = readFileSync(join(here, 'grammar.peggy'), 'utf8');
export const parser = peggy.generate(grammar);
export const generatedParserSize = peggy.generate(grammar, { output: 'source', format: 'commonjs' }).length;

const D = (x) => new Decimal(x);
const isD = (x) => x instanceof Decimal;

const FUNCS = {
  avg: (...a) => a.reduce((s, x) => s.plus(x), D(0)).div(a.length),
  sum: (...a) => a.reduce((s, x) => s.plus(x), D(0)),
  min: (...a) => Decimal.min(...a),
  max: (...a) => Decimal.max(...a),
  clamp: (x, lo, hi) => Decimal.min(Decimal.max(x, lo), hi),
  round_half_up: (x, n = D(0)) => x.toDecimalPlaces(n.toNumber(), Decimal.ROUND_HALF_UP),
  round_half_even: (x, n = D(0)) => x.toDecimalPlaces(n.toNumber(), Decimal.ROUND_HALF_EVEN),
  floor: (x) => x.floor(),
  ceil: (x) => x.ceil(),
};

class BudgetError extends Error {}

export function check(ast, names) {
  const walk = (n) => {
    switch (n.t) {
      case 'id':
        if (!names.vars.includes(n.n)) throw new Error(`Nom inconnu « ${n.n} » (position ${n.pos})`);
        break;
      case 'call':
        if (n.f.t !== 'id') throw new Error(`Appel non autorisé (position ${n.pos})`);
        if (!(n.f.n in FUNCS) && n.f.n !== 'period')
          throw new Error(`Fonction inconnue « ${n.f.n} » (position ${n.pos})`);
        n.a.forEach(walk);
        break;
      case 'bin':
        walk(n.l);
        walk(n.r);
        break;
      case 'member':
      case 'neg':
      case 'not':
        walk(n.e);
        break;
      case 'if':
        walk(n.c);
        walk(n.a);
        walk(n.b);
        break;
      default:
    }
  };
  walk(ast);
  return ast;
}

export function compile(src, names = { vars: [] }) {
  const ast = parser.parse(src);
  return check(ast, names);
}

export function evaluate(ast, ctx, { budget = 10_000 } = {}) {
  let steps = 0;
  const ev = (n) => {
    if (++steps > budget) throw new BudgetError('Budget d’évaluation dépassé');
    switch (n.t) {
      case 'num':
        return D(n.v);
      case 'str':
        return n.v;
      case 'bool':
        return n.v;
      case 'id':
        return Object.hasOwn(ctx.vars, n.n) ? ctx.vars[n.n] : undefined;
      case 'neg':
        return ev(n.e).neg();
      case 'not':
        return !ev(n.e);
      case 'member': {
        const o = ev(n.e);
        if (o === null || typeof o !== 'object' || isD(o)) throw new Error(`Accès « .${n.n} » impossible`);
        return Object.hasOwn(o, n.n) ? o[n.n] : undefined;
      }
      case 'call': {
        const args = n.a.map(ev);
        if (n.f.n === 'period') return ctx.periods[args[0]];
        return FUNCS[n.f.n](...args);
      }
      case 'if':
        return ev(n.c) ? ev(n.a) : ev(n.b);
      case 'bin': {
        if (n.op === '&&') return ev(n.l) && ev(n.r);
        if (n.op === '||') return ev(n.l) || ev(n.r);
        const l = ev(n.l);
        const r = ev(n.r);
        switch (n.op) {
          case '+': return l.plus(r);
          case '-': return l.minus(r);
          case '*': return l.times(r);
          case '/': return l.div(r);
          case '%': return l.mod(r);
          case '==': return isD(l) ? l.eq(r) : l === r;
          case '!=': return isD(l) ? !l.eq(r) : l !== r;
          case '<': return l.lt(r);
          case '<=': return l.lte(r);
          case '>': return l.gt(r);
          case '>=': return l.gte(r);
          default: throw new Error('op');
        }
      }
      default:
        throw new Error('nœud inconnu');
    }
  };
  return ev(ast);
}
