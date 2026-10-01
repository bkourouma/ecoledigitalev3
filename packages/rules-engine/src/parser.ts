import type { BinaryOp, Node } from './ast';
import { RuleSyntaxError, locate, type RuleErrorCode } from './errors';
import { tokenize, type Token } from './lexer';

/** Limites imposées à la compilation (défense contre les expressions pathologiques). */
export interface CompileLimits {
  /** Longueur maximale de la source, en caractères. */
  maxSourceLength: number;
  /** Profondeur maximale de récursion de l'analyseur (parenthèses, opérateurs unaires, arguments imbriqués). */
  maxDepth: number;
  /** Hauteur maximale de l'arbre (borne la récursion du vérificateur et de l'évaluateur). */
  maxHeight: number;
  /** Nombre maximal de nœuds de l'arbre. */
  maxNodes: number;
}

export const DEFAULT_LIMITS: Readonly<CompileLimits> = Object.freeze({
  maxSourceLength: 10_000,
  maxDepth: 64,
  maxHeight: 128,
  maxNodes: 2_000,
});

const MAX_ARGS = 16;
const MAX_LIST_ITEMS = 200;

/** Puissance de liaison des opérateurs binaires (plus grand = lie plus fort). */
const BINARY_BP: Readonly<Record<string, number>> = Object.freeze({
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
});

function describeToken(t: Token): string {
  switch (t.type) {
    case 'eof':
      return 'la fin de l\'expression';
    case 'string':
      return `le texte "${t.text.length > 20 ? `${t.text.slice(0, 20)}…` : t.text}"`;
    case 'number':
      return `le nombre ${t.text}`;
    default:
      return `« ${t.text} »`;
  }
}

/** Analyse la source et produit l'AST. Lève `RuleSyntaxError`. */
export function parse(source: string, limitsIn: Partial<CompileLimits> = {}): Node {
  const limits: CompileLimits = { ...DEFAULT_LIMITS, ...limitsIn };

  const fail = (code: RuleErrorCode, message: string, start: number, end: number, hint?: string): never => {
    throw new RuleSyntaxError({
      code,
      phase: 'syntax',
      message,
      position: locate(source, start, end),
      ...(hint ? { hint } : {}),
    });
  };

  if (source.length > limits.maxSourceLength) {
    fail(
      'LIMITE_SOURCE_TROP_LONGUE',
      `Expression trop longue : ${source.length} caractères (maximum ${limits.maxSourceLength}).`,
      0,
      1,
      'Découpez la règle en plusieurs règles plus simples.',
    );
  }
  if (source.trim().length === 0) fail('SYNTAXE_FIN_INATTENDUE', 'Expression vide.', 0, 0);

  const tokens = tokenize(source);
  let pos = 0;
  let depth = 0;
  let nodeCount = 0;

  const peek = (): Token => tokens[pos] as Token;
  const advance = (): Token => {
    const t = peek();
    if (t.type !== 'eof') pos++;
    return t;
  };
  const isOp = (t: Token, text: string) => t.type === 'op' && t.text === text;

  /** Crée un nœud en appliquant les limites de taille et de hauteur. */
  const make = <N extends Node>(build: (height: number) => N, childHeights: readonly number[], start: number, end: number): N => {
    nodeCount++;
    if (nodeCount > limits.maxNodes) {
      fail('LIMITE_NOMBRE_DE_NOEUDS', `Expression trop volumineuse : plus de ${limits.maxNodes} éléments.`, start, end, 'Découpez la règle en plusieurs règles plus simples.');
    }
    const height = 1 + childHeights.reduce((m, h) => (h > m ? h : m), 0);
    if (height > limits.maxHeight) {
      fail('LIMITE_PROFONDEUR', `Expression trop profonde : plus de ${limits.maxHeight} niveaux d'imbrication.`, start, end, 'Utilisez sum(...), avg(...) ou découpez la règle en plusieurs règles.');
    }
    return build(height);
  };

  const descend = (t: Token): void => {
    depth++;
    if (depth > limits.maxDepth) {
      fail('LIMITE_PROFONDEUR', `Expression trop imbriquée : plus de ${limits.maxDepth} niveaux de parenthèses ou d'opérateurs.`, t.start, t.end);
    }
  };

  const unexpected = (t: Token, expectation: string): never => {
    if (t.type === 'eof') {
      return fail('SYNTAXE_FIN_INATTENDUE', `Fin d'expression inattendue : ${expectation}.`, Math.max(0, source.length - 1), source.length);
    }
    return fail('SYNTAXE_JETON_INATTENDU', `Jeton inattendu ${describeToken(t)} : ${expectation}.`, t.start, t.end);
  };

  const expectOp = (text: string, expectation: string, opener?: Token): Token => {
    const t = peek();
    if (!isOp(t, text)) {
      if (opener && t.type === 'eof') {
        const o = locate(source, opener.start);
        return fail('SYNTAXE_FIN_INATTENDUE', `« ${opener.text} » ouverte (ligne ${o.line}, colonne ${o.column}) sans « ${text} » correspondante.`, Math.max(0, source.length - 1), source.length);
      }
      return unexpected(t, expectation);
    }
    return advance();
  };

  function parseExpr(minBp: number): Node {
    const first = peek();
    descend(first);
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t.type !== 'op') break;
      const bp = BINARY_BP[t.text];
      if (bp === undefined || bp <= minBp) break;
      advance();
      const right = parseExpr(bp);
      const l = left;
      left = make<Node>(
        (height) => ({ t: 'binary', op: t.text as BinaryOp, left: l, right, opStart: t.start, start: l.start, end: right.end, height }),
        [l.height, right.height],
        l.start,
        right.end,
      );
    }
    depth--;
    return left;
  }

  function parseUnary(): Node {
    const t = peek();
    if (t.type === 'op' && (t.text === '-' || t.text === '!')) {
      advance();
      descend(t);
      const operand = parseUnary();
      depth--;
      return make<Node>(
        (height) => ({ t: 'unary', op: t.text as '-' | '!', operand, start: t.start, end: operand.end, height }),
        [operand.height],
        t.start,
        operand.end,
      );
    }
    return parsePostfix(parsePrimary());
  }

  function parsePostfix(base: Node): Node {
    let node = base;
    for (;;) {
      const t = peek();
      if (isOp(t, '.')) {
        advance();
        const name = peek();
        if (name.type !== 'ident') {
          unexpected(name, 'un nom de champ est attendu après « . »');
        }
        advance();
        const obj = node;
        node = make<Node>(
          (height) => ({ t: 'member', object: obj, property: name.text, propertyStart: name.start, start: obj.start, end: name.end, height }),
          [obj.height],
          obj.start,
          name.end,
        );
        continue;
      }
      if (isOp(t, '(')) {
        return fail(
          'SYNTAXE_APPEL_NON_AUTORISE',
          'Appel non autorisé : seules les fonctions de la bibliothèque peuvent être appelées, par leur nom (ex. avg(a, b)).',
          t.start,
          t.end,
          'Les appels sur un résultat, un champ ou une méthode (x.f(), f(a)(b)) n\'existent pas dans le DSL.',
        );
      }
      if (isOp(t, '[')) {
        return fail('SYNTAXE_NON_SUPPORTE', 'L\'indexation « [ ] » n\'est pas supportée.', t.start, t.end, 'Utilisez les fonctions de liste (avg, wavg, sum, min, max, rank…).');
      }
      return node;
    }
  }

  function parseLambda(): Node {
    const p = advance();
    advance(); // =>
    descend(p);
    const body = parseExpr(0);
    depth--;
    return make<Node>(
      (height) => ({ t: 'lambda', param: p.text, paramStart: p.start, body, start: p.start, end: body.end, height }),
      [body.height],
      p.start,
      body.end,
    );
  }

  function parseArgs(closer: string, opener: Token, max: number, what: string, allowLambda = false): Node[] {
    const items: Node[] = [];
    if (isOp(peek(), closer)) {
      advance();
      return items;
    }
    for (;;) {
      const nextTok = tokens[pos + 1];
      items.push(allowLambda && peek().type === 'ident' && nextTok !== undefined && isOp(nextTok, '=>') ? parseLambda() : parseExpr(0));
      if (items.length > max) {
        const t = peek();
        fail('LIMITE_NOMBRE_DE_NOEUDS', `Trop d'éléments dans ${what} (maximum ${max}).`, t.start, t.end);
      }
      const t = peek();
      if (isOp(t, ',')) {
        advance();
        continue;
      }
      expectOp(closer, `« , » ou « ${closer} » est attendu`, opener);
      return items;
    }
  }

  function parsePrimary(): Node {
    const t = peek();
    switch (t.type) {
      case 'number':
        advance();
        return make<Node>((height) => ({ t: 'number', value: t.text, start: t.start, end: t.end, height }), [], t.start, t.end);
      case 'string':
        advance();
        return make<Node>((height) => ({ t: 'string', value: t.text, start: t.start, end: t.end, height }), [], t.start, t.end);
      case 'ident': {
        advance();
        if (t.text === 'true' || t.text === 'false') {
          return make<Node>((height) => ({ t: 'boolean', value: t.text === 'true', start: t.start, end: t.end, height }), [], t.start, t.end);
        }
        if (t.text === 'null') {
          return make<Node>((height) => ({ t: 'null', start: t.start, end: t.end, height }), [], t.start, t.end);
        }
        const open = peek();
        if (isOp(open, '=>')) {
          return fail(
            'SYNTAXE_NON_SUPPORTE',
            "Fonction fléchée non autorisée ici : « x => … » n'existe que comme 2e argument de map, filter, any ou all.",
            t.start,
            open.end,
          );
        }
        if (isOp(open, '(')) {
          advance();
          const args = parseArgs(')', open, MAX_ARGS, 'un appel de fonction', true);
          const end = tokens[pos - 1] as Token;
          return make<Node>(
            (height) => ({ t: 'call', callee: t.text, calleeEnd: t.end, args, start: t.start, end: end.end, height }),
            args.map((a) => a.height),
            t.start,
            end.end,
          );
        }
        return make<Node>((height) => ({ t: 'name', name: t.text, start: t.start, end: t.end, height }), [], t.start, t.end);
      }
      case 'op': {
        if (t.text === '(') {
          advance();
          const inner = parseExpr(0);
          expectOp(')', 'une parenthèse fermante « ) » est attendue', t);
          return inner;
        }
        if (t.text === '[') {
          advance();
          const items = parseArgs(']', t, MAX_LIST_ITEMS, 'une liste');
          const end = tokens[pos - 1] as Token;
          return make<Node>(
            (height) => ({ t: 'list', items, start: t.start, end: end.end, height }),
            items.map((a) => a.height),
            t.start,
            end.end,
          );
        }
        return unexpected(t, 'une valeur est attendue (nombre, texte, nom, fonction ou parenthèse)');
      }
      default:
        return unexpected(t, 'une valeur est attendue (nombre, texte, nom, fonction ou parenthèse)');
    }
  }

  const root = parseExpr(0);
  const rest = peek();
  if (rest.type !== 'eof') {
    unexpected(rest, 'un opérateur ou la fin de l\'expression est attendu');
  }
  return root;
}
