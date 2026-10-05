/**
 * Formats de référence des documents officiels. Le NUMÉRO vient du compteur transactionnel (`higher.next_number`), jamais
 * d'un comptage de lignes (R-HIG-07).
 *
 * Q-24 : les formats historiques ci-dessous restent les VALEURS PAR DÉFAUT ; chaque établissement peut choisir son propre
 * motif (voir « motif de numérotation libre » plus bas).
 */
import type { CounterKey } from "./types";

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** `DIP-AAAA-NNNNNN` (6 chiffres minimum). */
export function formatDiplomaReference(year: number, seq: number): string {
  assertSeq(seq);
  return `DIP-${pad(year, 4)}-${pad(seq, 6)}`;
}

/** `AUTH/AAAA/NNN` (3 chiffres minimum). */
export function formatAuthenticityReference(year: number, seq: number): string {
  assertSeq(seq);
  return `AUTH/${pad(year, 4)}/${pad(seq, 3)}`;
}

/** `ATT-AAAA-NNNNNN`. */
export function formatAttestationReference(year: number, seq: number): string {
  assertSeq(seq);
  return `ATT-${pad(year, 4)}-${pad(seq, 6)}`;
}

/** Duplicata : même numéro, suffixe `/Dn` (n = numéro de version - 1). La référence reste unique par nature de document. */
export function duplicateReference(reference: string, version: number): string {
  if (version <= 1) return reference;
  const base = reference.replace(/\/D\d+$/, "");
  return `${base}/D${version - 1}`;
}

export function formatReference(key: CounterKey, year: number, seq: number): string {
  switch (key) {
    case "DIPLOMA":
      return formatDiplomaReference(year, seq);
    case "AUTHENTICITY":
      return formatAuthenticityReference(year, seq);
    case "ATTESTATION":
      return formatAttestationReference(year, seq);
  }
}

function assertSeq(seq: number): void {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError("Le numéro d'ordre est un entier ≥ 1.");
}

// ---------------------------------------------------------------------------------------------------------------------
// Q-24 : motif de numérotation LIBRE par établissement
// ---------------------------------------------------------------------------------------------------------------------
//
// L'établissement choisit un motif par nature de document : texte libre (préfixe, séparateurs) + au plus un jalon d'année
// `{YYYY}` (2025) ou `{YY}` (25) + EXACTEMENT UN jalon de séquence `{SEQ}` ou `{SEQ:n}` (n chiffres au moins, 1 à 9).
// Exemples : `DIP-{YYYY}-{SEQ:6}` (défaut livré), `UNI/{YY}-D{SEQ:4}`, `CERT{SEQ:5}` (séquence continue, sans année).
//
// L'unicité d'une référence est garantie PAR CONTRAINTE (UNIQUE (tenant, référence) sur les octrois, UNIQUE (tenant, nature,
// référence) sur les documents) ; le numéro vient du compteur transactionnel. Un motif SANS année utilise une séquence
// continue (année de compteur 0) : elle ne repart pas à 1 chaque janvier, sinon deux années donneraient la même référence.

/** Année de compteur d'une séquence continue (motif sans jalon d'année). */
export const CONTINUOUS_COUNTER_YEAR = 0;

/** Motifs livrés : ce sont les formats historiques (Q-24 : « formats du legacy conservés »). */
export const DEFAULT_NUMBERING_PATTERNS: Readonly<Record<CounterKey, string>> = Object.freeze({
  DIPLOMA: "DIP-{YYYY}-{SEQ:6}",
  AUTHENTICITY: "AUTH/{YYYY}/{SEQ:3}",
  ATTESTATION: "ATT-{YYYY}-{SEQ:6}",
});

export const NUMBERING_PATTERN_MAX_LENGTH = 60;
const LITERAL_RE = /^[A-Za-z0-9._/#-]+$/;
const TOKEN_RE = /\{([A-Z]+)(?::(\d+))?\}/g;
/** Suffixe réservé aux duplicata (`/Dn`) : une référence ne doit jamais se terminer ainsi sans en être un. */
const DUPLICATE_SUFFIX_RE = /\/D\d+$/;

export type PatternPart =
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "year"; readonly digits: 2 | 4 }
  | { readonly kind: "seq"; readonly width: number };

export interface NumberingPattern {
  readonly source: string;
  readonly parts: ReadonlyArray<PatternPart>;
  /** `false` ⇒ séquence continue (compteur d'année 0). */
  readonly usesYear: boolean;
  readonly seqWidth: number;
}

export type PatternParse = { readonly ok: true; readonly value: NumberingPattern } | { readonly ok: false; readonly message: string };

/** Analyse et valide un motif de numérotation. Aucune exception : un motif invalide renvoie le message à afficher. */
export function parseNumberingPattern(source: string): PatternParse {
  const text = typeof source === "string" ? source.trim() : "";
  if (text.length === 0) return { ok: false, message: "Le motif de numérotation est obligatoire." };
  if (text.length > NUMBERING_PATTERN_MAX_LENGTH) return { ok: false, message: `Le motif est limité à ${NUMBERING_PATTERN_MAX_LENGTH} caractères.` };
  const parts: PatternPart[] = [];
  let last = 0;
  let seqCount = 0;
  let yearCount = 0;
  let seqWidth = 1;
  let usesYear = false;
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index as number;
    if (start > last) parts.push({ kind: "literal", text: text.slice(last, start) });
    const name = m[1] as string;
    const arg = m[2];
    if (name === "YYYY" || name === "YY") {
      if (arg !== undefined) return { ok: false, message: `Le jalon {${name}} n'accepte pas de paramètre.` };
      yearCount += 1;
      usesYear = true;
      parts.push({ kind: "year", digits: name === "YYYY" ? 4 : 2 });
    } else if (name === "SEQ") {
      seqCount += 1;
      const width = arg === undefined ? 1 : Number(arg);
      if (!Number.isInteger(width) || width < 1 || width > 9) return { ok: false, message: "La largeur de la séquence, {SEQ:n}, est comprise entre 1 et 9." };
      seqWidth = width;
      parts.push({ kind: "seq", width });
    } else {
      return { ok: false, message: `Jalon inconnu : {${name}}. Jalons admis : {YYYY}, {YY}, {SEQ}, {SEQ:n}.` };
    }
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "literal", text: text.slice(last) });
  if (seqCount !== 1) return { ok: false, message: "Le motif doit contenir exactement un jalon de séquence, {SEQ} ou {SEQ:n}." };
  if (yearCount > 1) return { ok: false, message: "Le motif ne peut contenir qu'un seul jalon d'année." };
  for (const p of parts) {
    if (p.kind === "literal" && !LITERAL_RE.test(p.text)) {
      return { ok: false, message: "Le texte fixe du motif n'admet que lettres non accentuées, chiffres et . _ / # - (pas d'espace, d'accolade isolée ni de caractère spécial)." };
    }
  }
  const pattern: NumberingPattern = { source: text, parts, usesYear, seqWidth };
  if (DUPLICATE_SUFFIX_RE.test(formatWithPattern(pattern, 2026, 1)) || DUPLICATE_SUFFIX_RE.test(formatWithPattern(pattern, 2026, 123456789))) {
    return { ok: false, message: "Le motif ne peut pas se terminer par /D suivi du numéro : ce suffixe est réservé aux duplicata." };
  }
  return { ok: true, value: pattern };
}

/** Année du compteur d'un motif : l'année civile pour un motif à année, 0 (séquence continue) sinon. */
export const counterYearFor = (pattern: NumberingPattern, year: number): number => (pattern.usesYear ? year : CONTINUOUS_COUNTER_YEAR);

/** Référence d'un document selon le motif. `seq` ≥ 1 ; `year` : année civile d'émission (4 chiffres). */
export function formatWithPattern(pattern: NumberingPattern, year: number, seq: number): string {
  assertSeq(seq);
  return pattern.parts
    .map((p) => {
      if (p.kind === "literal") return p.text;
      if (p.kind === "year") return p.digits === 4 ? pad(year, 4) : pad(year % 100, 2);
      return pad(seq, p.width);
    })
    .join("");
}

/** Motif livré d'une nature de document (toujours valide). */
export function defaultNumberingPattern(key: CounterKey): NumberingPattern {
  const parsed = parseNumberingPattern(DEFAULT_NUMBERING_PATTERNS[key]);
  if (!parsed.ok) throw new Error(`Motif livré invalide (${key}) : ${parsed.message}`);
  return parsed.value;
}
