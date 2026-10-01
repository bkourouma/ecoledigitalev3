import type { BinaryNode, CallNode, LambdaNode, MemberNode, NameNode, Node } from './ast';
import { Decimal } from './decimal';
import { LAMBDA_FUNCTION_NAMES } from './function-names';
import { FUNCTIONS } from './functions';
import type { PlainObject, Runtime, Value } from './runtime';
import type { ResolvedSchema } from './schema';
import type { Ty } from './types';

/**
 * Interpréteur de l'AST. Il n'exécute QUE des nœuds connus (liste blanche) :
 * aucune évaluation dynamique, aucun appel de fonction fournie par les
 * données, aucune lecture hors des propriétés propres du contexte.
 * La récursion est bornée par la hauteur de l'arbre (limitée à la compilation).
 */
export function interpret(root: Node, rt: Runtime, schema: ResolvedSchema, types: WeakMap<Node, Ty>): Value {
  const tyOf = (n: Node): Ty => {
    const t = types.get(n);
    if (!t) throw new Error('rules-engine : nœud sans type statique (règle non vérifiée)');
    return t;
  };

  const num = (v: Value, at: Node, what: string): Decimal => {
    if (v instanceof Decimal) return v;
    return rt.fail('VALEUR_ABSENTE', `${what} est absent alors qu'un nombre est requis.`, at);
  };

  /** Paramètres de lambdas liés (pas de masquage possible : vérifié à la compilation). */
  const bindings = new Map<string, Value>();

  function evalName(node: NameNode): Value {
    if (bindings.has(node.name)) return bindings.get(node.name) as Value;
    const vars = rt.ctx.variables;
    const raw = vars ? rt.readField(vars as PlainObject, node.name, node) : undefined;
    const v = rt.coerce(raw, schema.variables[node.name] as Ty, `« ${node.name} »`, node);
    rt.record(node, 'name', node.name, v);
    return v;
  }

  function evalMember(node: MemberNode): Value {
    const target = ev(node.object);
    const ty = tyOf(node);
    let out: Value;
    if (Array.isArray(target)) {
      const items = target as readonly Value[];
      const itemTy = ty.k === 'list' ? ty.item : ty;
      rt.consume(items.length, node);
      out = items.map((o, i) =>
        rt.coerce(rt.readField(o as PlainObject, node.property, node), itemTy, `« ${node.property} » de l'élément ${i + 1}`, node),
      );
    } else {
      out = rt.coerce(rt.readField(target as PlainObject, node.property, node), ty, `« ${node.property} »`, node);
    }
    rt.record(node, 'member', node.property, out);
    return out;
  }

  function evalBinary(node: BinaryNode): Value {
    const op = node.op;
    if (op === '&&' || op === '||') {
      const l = ev(node.left);
      if (typeof l !== 'boolean') return rt.fail('VALEUR_ABSENTE', `Le côté gauche de « ${op} » est absent alors qu'un booléen est requis.`, node.left);
      let out: boolean;
      if (op === '&&' ? !l : l) {
        out = l;
      } else {
        const r = ev(node.right);
        if (typeof r !== 'boolean') return rt.fail('VALEUR_ABSENTE', `Le côté droit de « ${op} » est absent alors qu'un booléen est requis.`, node.right);
        out = r;
      }
      rt.record(node, 'binary', op, out);
      return out;
    }

    const l = ev(node.left);
    const r = ev(node.right);
    let out: Value;
    if (op === '==' || op === '!=') {
      let eq: boolean;
      if (l === null || r === null) eq = l === r;
      else if (l instanceof Decimal && r instanceof Decimal) eq = l.eq(r);
      else eq = l === r;
      out = op === '==' ? eq : !eq;
    } else {
      const a = num(l, node.left, 'Le côté gauche');
      const b = num(r, node.right, 'Le côté droit');
      switch (op) {
        case '+':
          out = a.plus(b);
          break;
        case '-':
          out = a.minus(b);
          break;
        case '*':
          out = a.times(b);
          break;
        case '/':
          if (b.isZero()) return rt.fail('DIVISION_PAR_ZERO', 'Division par zéro.', node.right, 'Testez le diviseur avec if(diviseur == 0, …, a / diviseur).');
          out = a.div(b);
          break;
        case '%':
          if (b.isZero()) return rt.fail('DIVISION_PAR_ZERO', 'Modulo par zéro.', node.right, 'Testez le diviseur avec if(diviseur == 0, …, a % diviseur).');
          out = a.mod(b);
          break;
        case '<':
          out = a.lt(b);
          break;
        case '<=':
          out = a.lte(b);
          break;
        case '>':
          out = a.gt(b);
          break;
        default:
          out = a.gte(b);
          break;
      }
    }
    rt.record(node, 'binary', op, out);
    return out;
  }

  function evalLambdaCall(node: CallNode, fn: string): Value {
    const list = ev(node.args[0] as Node) as readonly Value[];
    const lam = node.args[1] as LambdaNode;
    rt.consume(list.length, node);
    const body = (item: Value): Value => {
      bindings.set(lam.param, item);
      try {
        return ev(lam.body);
      } finally {
        bindings.delete(lam.param);
      }
    };
    const truth = (v: Value): boolean => {
      if (typeof v !== 'boolean') return rt.fail('VALEUR_ABSENTE', `Le corps de « ${fn} » est absent alors qu'un booléen est requis.`, lam.body);
      return v;
    };
    rt.suppressTrace++;
    try {
      switch (fn) {
        case 'map':
          return list.map(body);
        case 'filter':
          return list.filter((item) => truth(body(item)));
        case 'any':
          return list.some((item) => truth(body(item)));
        default:
          return list.every((item) => truth(body(item)));
      }
    } finally {
      rt.suppressTrace--;
    }
  }

  function evalCall(node: CallNode): Value {
    const lookup = Object.hasOwn(schema.lookups, node.callee) ? schema.lookups[node.callee] : undefined;
    if (lookup) {
      const key = ev(node.args[0] as Node);
      const tables = rt.ctx.lookups;
      const table = tables ? (rt.readField(tables as PlainObject, node.callee, node) as PlainObject | undefined) : undefined;
      const k = String(key);
      const what = `${node.callee}(${JSON.stringify(k)})`;
      let raw: unknown;
      if (table !== undefined && table !== null && typeof table === 'object') raw = rt.readField(table, k, node);
      const v = rt.coerce(raw, lookup.value, what, node);
      rt.record(node, 'lookup', what, v);
      return v;
    }

    const def = FUNCTIONS.get(node.callee);
    if (!def) throw new Error(`rules-engine : fonction inconnue « ${node.callee} » (règle non vérifiée)`);
    let out: Value;
    if (LAMBDA_FUNCTION_NAMES.has(def.name)) {
      out = evalLambdaCall(node, def.name);
    } else if (def.name === 'if') {
      const c = ev(node.args[0] as Node);
      if (typeof c !== 'boolean') return rt.fail('VALEUR_ABSENTE', 'La condition de « if » est absente alors qu\'un booléen est requis.', node.args[0] as Node);
      out = ev((c ? node.args[1] : node.args[2]) as Node);
    } else if (def.name === 'coalesce') {
      const x = ev(node.args[0] as Node);
      out = x === null ? ev(node.args[1] as Node) : x;
    } else {
      const args = node.args.map((a) => ev(a));
      out = (def.run as NonNullable<typeof def.run>)(rt, node, args);
    }
    rt.record(node, 'call', def.name, out);
    return out;
  }

  function ev(node: Node): Value {
    rt.consume(1, node);
    switch (node.t) {
      case 'number':
        return new Decimal(node.value);
      case 'string':
        return node.value;
      case 'boolean':
        return node.value;
      case 'null':
        return null;
      case 'name':
        return evalName(node);
      case 'member':
        return evalMember(node);
      case 'call':
        return evalCall(node);
      case 'unary': {
        const v = ev(node.operand);
        let out: Value;
        if (node.op === '-') {
          out = num(v, node.operand, 'L\'opérande').neg();
        } else {
          if (typeof v !== 'boolean') return rt.fail('VALEUR_ABSENTE', 'L\'opérande de « ! » est absent alors qu\'un booléen est requis.', node.operand);
          out = !v;
        }
        rt.record(node, 'unary', node.op, out);
        return out;
      }
      case 'binary':
        return evalBinary(node);
      case 'lambda':
        throw new Error("rules-engine : lambda hors d'un appel map/filter/any/all (règle non vérifiée)");
      case 'list': {
        const items = node.items.map((i) => ev(i));
        rt.consume(items.length, node);
        rt.record(node, 'list', '[…]', items);
        return items;
      }
    }
  }

  return ev(root);
}
