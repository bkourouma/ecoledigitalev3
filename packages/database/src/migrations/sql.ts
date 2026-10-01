/**
 * Outils SQL purs : checksum normalisé, découpage en instructions, directives.
 */
import { createHash } from "node:crypto";

/** Retire le BOM UTF-8 et normalise les fins de ligne : un checkout Windows ne change pas l'empreinte. */
export function normalizeSql(content: string): string {
  return content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

export function checksumOf(content: string): string {
  return createHash("sha256").update(normalizeSql(content), "utf8").digest("hex");
}

export type MigrationDirective = "no-transaction" | "no-role";

/**
 * Directives d'en-tête : lignes `-- no-transaction` / `-- no-role` situées dans
 * le bloc de commentaires qui précède la première instruction.
 *  - no-transaction : instructions exécutées une à une en autocommit ;
 *  - no-role        : exécution sous le rôle de CONNEXION, jamais sous `--role`
 *                     (fichiers de bootstrap qui créent ou modifient des rôles).
 */
export function headerDirectives(content: string): Set<MigrationDirective> {
  const found = new Set<MigrationDirective>();
  for (const raw of normalizeSql(content).split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (!line.startsWith("--")) break; // fin de l'en-tête
    const m = /^--\s*(no-transaction|no-role)\s*$/i.exec(line);
    if (m) found.add((m[1] as string).toLowerCase() as MigrationDirective);
  }
  return found;
}

/** Directive `-- no-transaction` dans le bloc de commentaires d'en-tête. */
export function hasNoTransactionDirective(content: string): boolean {
  return headerDirectives(content).has("no-transaction");
}

export interface SqlStatement {
  /** Texte de l'instruction (sans le `;` final), commentaires internes conservés. */
  sql: string;
  /** Premier mot-clé hors commentaires, en majuscules (`CREATE`, `BEGIN`…). */
  keyword: string;
}

const isIdentStart = (c: string): boolean => /[A-Za-z_\u0080-￿]/.test(c);
const isIdentPart = (c: string): boolean => /[A-Za-z0-9_\u0080-￿]/.test(c);

/**
 * Découpe un script en instructions au niveau supérieur. Comprend :
 * chaînes '…' (avec '' et E'…\\'…'), identifiants "…", dollar-quoting
 * `$tag$…$tag$`, commentaires `-- …` et `/* … *​/` (imbriqués).
 * Ne gère pas les méta-commandes psql (`\i`, `\set`) : elles n'ont pas leur place
 * dans une migration.
 */
export function splitStatements(script: string): SqlStatement[] {
  const text = normalizeSql(script);
  const out: SqlStatement[] = [];
  let start = 0;
  let i = 0;
  let hasContent = false;
  let keyword = "";
  let readingKeyword = false;

  const flush = (end: number): void => {
    if (hasContent) out.push({ sql: text.slice(start, end).trim(), keyword: keyword.toUpperCase() });
    start = end + 1;
    hasContent = false;
    keyword = "";
    readingKeyword = false;
  };

  const markContent = (): void => {
    hasContent = true;
  };

  while (i < text.length) {
    const c = text[i] as string;
    const next = text[i + 1];

    // commentaire de ligne
    if (c === "-" && next === "-") {
      const eol = text.indexOf("\n", i);
      i = eol === -1 ? text.length : eol + 1;
      readingKeyword = false;
      continue;
    }
    // commentaire de bloc (imbriqué)
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      readingKeyword = false;
      continue;
    }
    // chaîne
    if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(text[i - 1] as string) && (i < 2 || !isIdentPart(text[i - 2] as string));
      markContent();
      readingKeyword = false;
      i++;
      while (i < text.length) {
        if (escapes && text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // identifiant entre guillemets
    if (c === '"') {
      markContent();
      readingKeyword = false;
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // dollar-quoting
    if (c === "$" && !(i > 0 && isIdentPart(text[i - 1] as string))) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 130));
      if (m) {
        const tag = m[0];
        markContent();
        readingKeyword = false;
        const close = text.indexOf(tag, i + tag.length);
        i = close === -1 ? text.length : close + tag.length;
        continue;
      }
    }
    if (c === ";") {
      flush(i);
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      readingKeyword = false;
      i++;
      continue;
    }

    // jeton ordinaire
    if (!hasContent && isIdentStart(c)) {
      readingKeyword = true;
    }
    if (readingKeyword && isIdentPart(c)) keyword += c;
    else readingKeyword = false;
    markContent();
    i++;
  }
  flush(text.length);
  return out;
}

/** Numéro de ligne (1-based) correspondant à `position` (1-based, offset en caractères renvoyé par pg). */
export function lineAt(sql: string, position: number): number {
  const upTo = normalizeSql(sql).slice(0, Math.max(0, position - 1));
  return upTo.split("\n").length;
}
