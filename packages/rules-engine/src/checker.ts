import type { BinaryNode, CallNode, MemberNode, NameNode, Node } from './ast';
import { locate, type Diagnostic, type RuleErrorCode } from './errors';
import { LAMBDA_FUNCTION_NAMES } from './function-names';
import { FUNCTIONS, arityText, type FnCheckCtx } from './functions';
import { isDeclarableName, type ResolvedSchema } from './schema';
import {
  T_BOOLEAN,
  T_NULL,
  T_NUMBER,
  T_STRING,
  describeType,
  listOf,
  nonNull,
  sameShape,
  unify,
  type Ty,
} from './types';

/**
 * Vérification statique (à la publication) : noms, champs, fonctions, arité,
 * types et nullité. Collecte plusieurs diagnostics au lieu de s'arrêter au
 * premier. Ne s'exécute jamais sur des données.
 */

export interface CheckResult {
  /** Type du résultat (undefined si des erreurs empêchent de le déterminer). */
  type: Ty | undefined;
  diagnostics: Diagnostic[];
  /** Variables lues par la règle (triées, sans doublon). */
  names: string[];
  /** Fonctions de la bibliothèque appelées. */
  functions: string[];
  /** Recherches (lookups) appelées. */
  lookups: string[];
  /** Type statique de chaque nœud vérifié sans erreur (utilisé par l'évaluateur pour convertir les données). */
  types: WeakMap<Node, Ty>;
}

const MAX_DIAGNOSTICS = 20;

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diag + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}

/** Meilleure suggestion orthographique (distance de Levenshtein faible). */
export function suggest(name: string, candidates: Iterable<string>): string | undefined {
  const limit = name.length <= 4 ? 1 : 2;
  let best: string | undefined;
  let bestD = limit + 1;
  for (const c of candidates) {
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

type NonNullSet = ReadonlySet<string>;
const EMPTY: NonNullSet = new Set();

/** Clé canonique d'une valeur « traçable » (nom, champ, recherche à clé littérale). */
function keyOf(node: Node): string | undefined {
  switch (node.t) {
    case 'name':
      return node.name;
    case 'member': {
      const k = keyOf(node.object);
      return k === undefined ? undefined : `${k}.${node.property}`;
    }
    case 'call': {
      const a = node.args[0];
      return node.args.length === 1 && a && a.t === 'string' ? `${node.callee}(${JSON.stringify(a.value)})` : undefined;
    }
    default:
      return undefined;
  }
}

/** Valeurs prouvées non nulles quand `cond` est vraie / fausse. */
function nonNullWhen(cond: Node, truth: boolean): string[] {
  switch (cond.t) {
    case 'call': {
      if (cond.callee === 'is_null' && cond.args.length === 1 && !truth) {
        const k = keyOf(cond.args[0] as Node);
        return k === undefined ? [] : [k];
      }
      return [];
    }
    case 'unary':
      return cond.op === '!' ? nonNullWhen(cond.operand, !truth) : [];
    case 'binary': {
      if (cond.op === '&&' && truth) return [...nonNullWhen(cond.left, true), ...nonNullWhen(cond.right, true)];
      if (cond.op === '||' && !truth) return [...nonNullWhen(cond.left, false), ...nonNullWhen(cond.right, false)];
      if ((cond.op === '==' || cond.op === '!=') && truth === (cond.op === '!=')) {
        const [a, b] = [cond.left, cond.right];
        const other = a.t === 'null' ? b : b.t === 'null' ? a : undefined;
        const k = other ? keyOf(other) : undefined;
        return k === undefined ? [] : [k];
      }
      return [];
    }
    default:
      return [];
  }
}

function extend(base: NonNullSet, more: string[]): NonNullSet {
  if (more.length === 0) return base;
  const s = new Set(base);
  for (const k of more) s.add(k);
  return s;
}

export function check(root: Node, schema: ResolvedSchema, source: string): CheckResult {
  const diagnostics: Diagnostic[] = [];
  const names = new Set<string>();
  const functions = new Set<string>();
  const lookups = new Set<string>();
  const types = new WeakMap<Node, Ty>();
  /** Paramètres de lambdas en cours de vérification (jamais de masquage : un nom ne peut pas être redéfini). */
  const scope = new Map<string, Ty>();

  const report = (code: RuleErrorCode, message: string, at: { start: number; end: number }, hint?: string): void => {
    if (diagnostics.length >= MAX_DIAGNOSTICS) return;
    diagnostics.push({
      code,
      phase: 'check',
      message,
      position: locate(source, at.start, at.end),
      ...(hint ? { hint } : {}),
    });
  };
  const fnCtx: FnCheckCtx = { report: (code, message, node, hint) => report(code, message, node, hint) };

  const nullHint = 'Utilisez coalesce(valeur, défaut), ou testez is_null(valeur) avant (ex. if(is_null(x), …, x + 1)).';

  function checkName(node: NameNode, nn: NonNullSet): Ty | undefined {
    const bound = scope.get(node.name);
    if (bound) return nn.has(node.name) ? nonNull(bound) : bound;
    if (Object.hasOwn(schema.variables, node.name)) {
      names.add(node.name);
      const t = schema.variables[node.name] as Ty;
      return nn.has(node.name) ? nonNull(t) : t;
    }
    let hint: string | undefined;
    if (Object.hasOwn(schema.lookups, node.name)) {
      hint = `« ${node.name} » est une recherche : écrivez ${node.name}("clé").`;
    } else if (FUNCTIONS.has(node.name)) {
      hint = `« ${node.name} » est une fonction : écrivez ${node.name}(…).`;
    } else {
      const s = suggest(node.name, Object.keys(schema.variables));
      hint = s ? `Vouliez-vous dire « ${s} » ?` : `Variables disponibles : ${Object.keys(schema.variables).join(', ') || '(aucune)'}.`;
    }
    report('NOM_INCONNU', `Nom inconnu « ${node.name} ».`, node, hint);
    return undefined;
  }

  function checkMember(node: MemberNode, nn: NonNullSet): Ty | undefined {
    const objTy = go(node.object, nn);
    if (!objTy) return undefined;
    const at = { start: node.propertyStart, end: node.end };
    let container: Ty = objTy;
    let isPluck = false;
    if (objTy.k === 'list') {
      if (objTy.nullable) {
        report('VALEUR_PEUT_ETRE_ABSENTE', `La liste peut être absente : impossible de lire le champ « ${node.property} ».`, node.object, nullHint);
        return undefined;
      }
      container = objTy.item;
      isPluck = true;
    }
    if (container.k !== 'object') {
      report('TYPE_INCOMPATIBLE', `Impossible de lire le champ « ${node.property} » : la valeur est ${describeType(container)}, pas un objet.`, at);
      return undefined;
    }
    if (container.nullable) {
      report('VALEUR_PEUT_ETRE_ABSENTE', `L'objet peut être absent : impossible de lire le champ « ${node.property} ».`, node.object, nullHint);
      return undefined;
    }
    if (!Object.hasOwn(container.fields, node.property)) {
      const available = Object.keys(container.fields);
      const s = suggest(node.property, available);
      report(
        'CHAMP_INCONNU',
        `Le champ « ${node.property} » n'existe pas.`,
        at,
        s ? `Vouliez-vous dire « ${s} » ?` : `Champs disponibles : ${available.join(', ') || '(aucun)'}.`,
      );
      return undefined;
    }
    const fieldTy = container.fields[node.property] as Ty;
    if (isPluck) return listOf(fieldTy);
    const k = keyOf(node);
    return k !== undefined && nn.has(k) ? nonNull(fieldTy) : fieldTy;
  }

  function checkBinary(node: BinaryNode, nn: NonNullSet): Ty | undefined {
    const op = node.op;
    if (op === '&&' || op === '||') {
      const l = go(node.left, nn);
      const r = go(node.right, extend(nn, nonNullWhen(node.left, op === '&&')));
      let ok = true;
      for (const [t, side, n] of [[l, 'gauche', node.left], [r, 'droit', node.right]] as const) {
        if (!t) {
          ok = false;
        } else if (t.k !== 'boolean') {
          report('TYPE_INCOMPATIBLE', `L'opérateur « ${op} » attend des booléens : le côté ${side} est ${describeType(t)}.`, n);
          ok = false;
        } else if (t.nullable) {
          report('VALEUR_PEUT_ETRE_ABSENTE', `Le côté ${side} de « ${op} » peut être absent.`, n, nullHint);
          ok = false;
        }
      }
      return ok ? T_BOOLEAN : undefined;
    }

    const l = go(node.left, nn);
    const r = go(node.right, nn);

    if (op === '==' || op === '!=') {
      if (!l || !r) return undefined;
      if (l.k === 'list' || l.k === 'object' || r.k === 'list' || r.k === 'object') {
        report('TYPE_INCOMPATIBLE', `La comparaison « ${op} » ne s'applique pas aux listes ni aux objets.`, node);
        return undefined;
      }
      if (l.k !== 'null' && r.k !== 'null' && !sameShape(l, r)) {
        report('TYPE_INCOMPATIBLE', `Impossible de comparer ${describeType(l)} et ${describeType(r)} avec « ${op} ».`, node);
        return undefined;
      }
      return T_BOOLEAN;
    }

    // + - * / % < <= > >= : nombres non nuls des deux côtés
    let ok = true;
    for (const [t, side, n] of [[l, 'gauche', node.left], [r, 'droit', node.right]] as const) {
      if (!t) {
        ok = false;
      } else if (t.k !== 'number') {
        report(
          'TYPE_INCOMPATIBLE',
          `L'opérateur « ${op} » attend des nombres : le côté ${side} est ${describeType(t)}.`,
          n,
          op === '+' && t.k === 'string' ? 'La concaténation de textes n\'existe pas dans le DSL.' : undefined,
        );
        ok = false;
      } else if (t.nullable) {
        report('VALEUR_PEUT_ETRE_ABSENTE', `Le côté ${side} de « ${op} » peut être absent.`, n, nullHint);
        ok = false;
      }
    }
    if (!ok) return undefined;
    return op === '<' || op === '<=' || op === '>' || op === '>=' ? T_BOOLEAN : T_NUMBER;
  }

  /** map / filter / any / all : `fonction(liste, x => expression)`. */
  function checkLambdaCall(node: CallNode, fn: string, nn: NonNullSet): Ty | undefined {
    const [listNode, lam] = node.args as [Node, Node];
    const tl = go(listNode, nn);
    if (lam.t !== 'lambda') {
      report('ARGUMENT_INVALIDE', `Le 2e argument de « ${fn} » doit être une fonction de la forme « x => expression ».`, lam);
      return undefined;
    }
    if (!tl) return undefined;
    if (tl.k !== 'list') {
      report('TYPE_INCOMPATIBLE', `Le 1er argument de « ${fn} » doit être une liste, mais c'est : ${describeType(tl)}.`, listNode);
      return undefined;
    }
    if (tl.nullable) {
      report('VALEUR_PEUT_ETRE_ABSENTE', `Le 1er argument de « ${fn} » (une liste) peut être absent.`, listNode, nullHint);
      return undefined;
    }
    if (!isDeclarableName(lam.param) || scope.has(lam.param) || Object.hasOwn(schema.variables, lam.param)) {
      report(
        'NOM_INTERDIT',
        `Le nom de paramètre « ${lam.param} » est interdit ou déjà utilisé.`,
        { start: lam.paramStart, end: lam.paramStart + lam.param.length },
        'Choisissez un nom court et distinct des variables du schéma (ex. e, u, x).',
      );
      return undefined;
    }
    scope.set(lam.param, tl.item);
    let body: Ty | undefined;
    try {
      body = go(lam.body, nn);
    } finally {
      scope.delete(lam.param);
    }
    if (!body) return undefined;
    if (fn === 'map') {
      if (body.k === 'list' || body.k === 'object' || body.k === 'null') {
        report('TYPE_INCOMPATIBLE', `Le corps de « map » doit produire un nombre, un texte ou un booléen, mais produit : ${describeType(body)}.`, lam.body);
        return undefined;
      }
      return listOf(body);
    }
    if (body.k !== 'boolean') {
      report('TYPE_INCOMPATIBLE', `Le corps de « ${fn} » doit être un booléen, mais c'est : ${describeType(body)}.`, lam.body);
      return undefined;
    }
    if (body.nullable) {
      report('VALEUR_PEUT_ETRE_ABSENTE', `Le corps de « ${fn} » peut être absent.`, lam.body, nullHint);
      return undefined;
    }
    return fn === 'filter' ? tl : T_BOOLEAN;
  }

  function checkCall(node: CallNode, nn: NonNullSet): Ty | undefined {
    // Recherche déclarée dans le schéma, p. ex. period("S1")
    if (Object.hasOwn(schema.lookups, node.callee)) {
      lookups.add(node.callee);
      const lk = schema.lookups[node.callee] as NonNullable<ResolvedSchema['lookups'][string]>;
      const args = node.args.map((a) => go(a, nn));
      if (node.args.length !== 1) {
        report('ARITE_INVALIDE', `La recherche « ${node.callee} » attend 1 argument (la clé), mais en reçoit ${node.args.length}.`, node);
        return undefined;
      }
      const a0 = args[0];
      const arg = node.args[0] as Node;
      if (!a0) return undefined;
      if (a0.k !== 'string' || a0.nullable) {
        report('TYPE_INCOMPATIBLE', `La clé de « ${node.callee} » doit être un texte, mais c'est : ${describeType(a0)}.`, arg);
        return undefined;
      }
      if (arg.t === 'string' && lk.keys && !lk.keys.includes(arg.value)) {
        const s = suggest(arg.value, lk.keys);
        report(
          'CLE_INCONNUE',
          `Clé inconnue « ${arg.value} » pour « ${node.callee} ».`,
          arg,
          s ? `Vouliez-vous dire « ${s} » ?` : `Clés disponibles : ${lk.keys.join(', ')}.`,
        );
        return undefined;
      }
      const lkKey = keyOf(node);
      return lkKey !== undefined && nn.has(lkKey) ? nonNull(lk.value) : lk.value;
    }

    const def = FUNCTIONS.get(node.callee);
    if (!def) {
      const s = suggest(node.callee, [...FUNCTIONS.keys(), ...Object.keys(schema.lookups)]);
      const asVar = Object.hasOwn(schema.variables, node.callee);
      report(
        'FONCTION_INCONNUE',
        `Fonction inconnue « ${node.callee} ».`,
        { start: node.start, end: node.calleeEnd },
        asVar ? `« ${node.callee} » est une variable, pas une fonction.` : s ? `Vouliez-vous dire « ${s} » ?` : `Fonctions disponibles : ${[...FUNCTIONS.keys()].join(', ')}.`,
      );
      node.args.forEach((a) => go(a, nn));
      return undefined;
    }
    functions.add(def.name);

    if (node.args.length < def.min || node.args.length > def.max) {
      report('ARITE_INVALIDE', `La fonction « ${def.name} » attend ${arityText(def)}, mais en reçoit ${node.args.length}.`, node);
      node.args.forEach((a) => go(a, nn));
      return undefined;
    }

    if (LAMBDA_FUNCTION_NAMES.has(def.name)) return checkLambdaCall(node, def.name, nn);

    if (def.name === 'if') {
      const [c, a, b] = node.args as [Node, Node, Node];
      const tc = go(c, nn);
      const ta = go(a, extend(nn, nonNullWhen(c, true)));
      const tb = go(b, extend(nn, nonNullWhen(c, false)));
      let ok = true;
      if (tc && tc.k !== 'boolean') {
        report('TYPE_INCOMPATIBLE', `La condition de « if » doit être un booléen, mais c'est : ${describeType(tc)}.`, c);
        ok = false;
      } else if (tc && tc.nullable) {
        report('VALEUR_PEUT_ETRE_ABSENTE', 'La condition de « if » peut être absente.', c, nullHint);
        ok = false;
      } else if (!tc) {
        ok = false;
      }
      if (!ta || !tb) return undefined;
      const u = unify(ta, tb);
      if (!u) {
        report('TYPE_INCOMPATIBLE', `Les deux branches de « if » doivent avoir le même type : ${describeType(ta)} et ${describeType(tb)}.`, node);
        return undefined;
      }
      return ok ? u : undefined;
    }

    if (def.name === 'coalesce') {
      const [x, d] = node.args as [Node, Node];
      const tx = go(x, nn);
      const td = go(d, nn);
      if (!tx || !td) return undefined;
      if (tx.k === 'null') return td;
      const u = unify(nonNull(tx), td);
      if (!u) {
        report('TYPE_INCOMPATIBLE', `Les deux arguments de « coalesce » doivent avoir le même type : ${describeType(tx)} et ${describeType(td)}.`, node);
        return undefined;
      }
      return u;
    }

    const argTys = node.args.map((a) => go(a, nn));
    return def.check ? def.check(fnCtx, node, argTys) : undefined;
  }

  function go(node: Node, nn: NonNullSet): Ty | undefined {
    const t = goInner(node, nn);
    if (t) types.set(node, t);
    return t;
  }

  function goInner(node: Node, nn: NonNullSet): Ty | undefined {
    switch (node.t) {
      case 'number':
        return T_NUMBER;
      case 'string':
        return T_STRING;
      case 'boolean':
        return T_BOOLEAN;
      case 'null':
        return T_NULL;
      case 'name':
        return checkName(node, nn);
      case 'member':
        return checkMember(node, nn);
      case 'call':
        return checkCall(node, nn);
      case 'unary': {
        const t = go(node.operand, nn);
        if (!t) return undefined;
        const want = node.op === '-' ? 'number' : 'boolean';
        if (t.k !== want) {
          report('TYPE_INCOMPATIBLE', `L'opérateur « ${node.op} » attend ${want === 'number' ? 'un nombre' : 'un booléen'}, mais reçoit ${describeType(t)}.`, node);
          return undefined;
        }
        if (t.nullable) {
          report('VALEUR_PEUT_ETRE_ABSENTE', `L'opérande de « ${node.op} » peut être absent.`, node.operand, nullHint);
          return undefined;
        }
        return t;
      }
      case 'binary':
        return checkBinary(node, nn);
      case 'lambda':
        report('ARGUMENT_INVALIDE', 'Une fonction « x => … » n\'est admise que comme 2e argument de map, filter, any ou all.', node);
        return undefined;
      case 'list': {
        let acc: Ty | undefined;
        let ok = true;
        if (node.items.length === 0) {
          report('ARGUMENT_INVALIDE', 'Une liste littérale ne peut pas être vide.', node);
          return undefined;
        }
        for (const it of node.items) {
          const t = go(it, nn);
          if (!t) {
            ok = false;
            continue;
          }
          if (t.k === 'list' || t.k === 'object') {
            report('TYPE_INCOMPATIBLE', 'Une liste littérale ne peut contenir que des valeurs simples (nombres, textes, booléens).', it);
            ok = false;
            continue;
          }
          if (acc === undefined) {
            acc = t;
          } else {
            const u = unify(acc, t);
            if (!u) {
              report('TYPE_INCOMPATIBLE', `Les éléments d'une liste doivent avoir le même type : ${describeType(acc)} et ${describeType(t)}.`, it);
              ok = false;
            } else {
              acc = u;
            }
          }
        }
        return ok && acc ? listOf(acc.k === 'null' ? { k: 'number', nullable: true } : acc) : undefined;
      }
    }
  }

  const type = go(root, EMPTY);
  if (type && diagnostics.length === 0 && type.k !== 'number' && type.k !== 'string' && type.k !== 'boolean') {
    report(
      'TYPE_RESULTAT_INVALIDE',
      `Le résultat d'une règle doit être un nombre, un texte ou un booléen, mais c'est : ${describeType(type)}.`,
      root,
    );
  }
  return {
    type: diagnostics.length === 0 ? type : undefined,
    diagnostics,
    names: [...names].sort(),
    functions: [...functions].sort(),
    lookups: [...lookups].sort(),
    types,
  };
}
