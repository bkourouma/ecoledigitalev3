import { RuleSyntaxError, locate } from './errors';

export type TokenType = 'number' | 'string' | 'ident' | 'op' | 'eof';

export interface Token {
  readonly type: TokenType;
  /** Texte brut du jeton (pour les chaînes : contenu déjà décodé). */
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||', '=>']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '<', '>', '!', '(', ')', '[', ']', ',', '.']);

const MAX_STRING_LENGTH = 200;
const MAX_NUMBER_DIGITS = 40;

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c);

export function describeChar(c: string): string {
  const code = c.codePointAt(0) ?? 0;
  if (code < 32) return `caractère de contrôle U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  return `« ${c} »`;
}

/**
 * Découpe la source en jetons. Pas d'exposant, pas de nombres hexadécimaux,
 * identifiants ASCII uniquement, commentaires `// …` jusqu'à la fin de ligne.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;

  const err = (code: ConstructorParameters<typeof RuleSyntaxError>[0]['code'], message: string, start: number, end: number, hint?: string): never => {
    throw new RuleSyntaxError({
      code,
      phase: 'syntax',
      message,
      position: locate(source, start, end),
      ...(hint ? { hint } : {}),
    });
  };

  while (i < n) {
    const c = source.charAt(i);

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (c === '/' && source.charAt(i + 1) === '/') {
      while (i < n && source.charAt(i) !== '\n') i++;
      continue;
    }

    if (isDigit(c)) {
      const start = i;
      while (i < n && isDigit(source.charAt(i))) i++;
      if (source.charAt(i) === '.' && isDigit(source.charAt(i + 1))) {
        i++;
        while (i < n && isDigit(source.charAt(i))) i++;
      }
      const next = source.charAt(i);
      if (next !== '' && (isIdentPart(next) || (next === '.' && isDigit(source.charAt(i + 1))))) {
        while (i < n && (isIdentPart(source.charAt(i)) || source.charAt(i) === '.')) i++;
        err(
          'SYNTAXE_NOMBRE_INVALIDE',
          `Nombre invalide « ${source.slice(start, i)} ».`,
          start,
          i,
          'Écrivez les nombres en notation décimale simple (ex. 12 ou 0.4) ; ni exposant, ni séparateur de milliers.',
        );
      }
      const text = source.slice(start, i);
      if (text.replace('.', '').replace(/^0+(?=\d)/, '').length > MAX_NUMBER_DIGITS) {
        err('SYNTAXE_NOMBRE_INVALIDE', `Nombre trop long « ${text.slice(0, 20)}… » (maximum ${MAX_NUMBER_DIGITS} chiffres).`, start, i);
      }
      tokens.push({ type: 'number', text, start, end: i });
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdentPart(source.charAt(i))) i++;
      tokens.push({ type: 'ident', text: source.slice(start, i), start, end: i });
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let out = '';
      let closed = false;
      while (i < n) {
        const d = source.charAt(i);
        if (d === quote) {
          closed = true;
          i++;
          break;
        }
        if (d === '\n' || d === '\r') break;
        if (d === '\\') {
          const e = source.charAt(i + 1);
          if (e === quote || e === '\\') out += e;
          else if (e === 'n') out += '\n';
          else if (e === 't') out += '\t';
          else err('SYNTAXE_ECHAPPEMENT_INVALIDE', `Séquence d'échappement inconnue « \\${e} » dans un texte.`, i, i + 2, 'Séquences admises : \\" \\\' \\\\ \\n \\t.');
          i += 2;
          continue;
        }
        if (d.charCodeAt(0) < 32) {
          err('SYNTAXE_CARACTERE_INATTENDU', `Caractère de contrôle interdit dans un texte.`, i, i + 1);
        }
        out += d;
        i++;
        if (out.length > MAX_STRING_LENGTH) {
          err('SYNTAXE_TEXTE_NON_TERMINE', `Texte trop long (maximum ${MAX_STRING_LENGTH} caractères).`, start, i);
        }
      }
      if (!closed) {
        err('SYNTAXE_TEXTE_NON_TERMINE', `Texte non terminé : il manque le guillemet fermant ${quote}.`, start, Math.min(i, n));
      }
      tokens.push({ type: 'string', text: out, start, end: i });
      continue;
    }

    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: 'op', text: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ type: 'op', text: c, start: i, end: i + 1 });
      i++;
      continue;
    }

    const cp = source.codePointAt(i) ?? 0;
    const len = cp > 0xffff ? 2 : 1;
    const hint =
      c === '=' ? 'Pour comparer, utilisez « == » ; l\'affectation n\'existe pas dans le DSL.'
      : c === '&' || c === '|' ? 'Les opérateurs logiques s\'écrivent « && » et « || ».'
      : c === '{' || c === '}' ? 'Les objets littéraux ne sont pas supportés.'
      : undefined;
    err('SYNTAXE_CARACTERE_INATTENDU', `Caractère inattendu ${describeChar(source.slice(i, i + len))}.`, i, i + len, hint);
  }

  tokens.push({ type: 'eof', text: '', start: n, end: n });
  return tokens;
}
