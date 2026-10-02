/**
 * Détection de doublons de personnes (fonctions PURES) : un AVERTISSEMENT humain, jamais une contrainte (R11).
 *
 * Règles (spec 008 AC1.4, spec 009 AC1.6) :
 *  - `EXACT`     : mêmes mots (sans accents, insensible à la casse, permutation nom/prénom admise) ET même date de naissance ;
 *  - `NEAR`      : chaque mot à une faute de frappe près (distance de Levenshtein ≤ 1) ET même date de naissance ;
 *  - `NAME_ONLY` : mêmes mots, une des deux dates de naissance est inconnue (on ne peut pas départager) ;
 *  - `EMAIL` / `PHONE` : même adresse e-mail / même téléphone (personnel).
 * Deux homonymes de dates différentes (jumeaux compris) ne sont PAS signalés comme doublons par le nom.
 */
import { nameTokens, normalizeEmail } from "./normalize";

export type DuplicateMatch = "EXACT" | "NEAR" | "NAME_ONLY" | "EMAIL" | "PHONE";

export interface DuplicateSubject {
  readonly lastName: string;
  readonly firstName: string;
  readonly otherNames?: string | null | undefined;
  readonly birthDate?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly phone?: string | null | undefined;
}

export interface DuplicateOptions {
  /** Comparer aussi l'e-mail et le téléphone (création de personnel). */
  readonly contactSignals?: boolean;
}

/** Distance de Levenshtein bornée : renvoie `max + 1` dès que la distance dépasse `max`. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((t, i) => t === sb[i]);
}

/** Chaque mot de `a` trouve un mot de `b` à ≤ 1 faute (appariement glouton, mots de ≥ 4 lettres seulement tolérés). */
function nearTokens(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const pool = [...b];
  for (const t of a) {
    const tolerance = t.length >= 4 ? 1 : 0;
    const idx = pool.findIndex((u) => boundedLevenshtein(t, u, tolerance) <= tolerance);
    if (idx < 0) return false;
    pool.splice(idx, 1);
  }
  return true;
}

/** Lien le plus fort entre un brouillon et une personne existante, ou `null`. */
export function matchPerson(draft: DuplicateSubject, existing: DuplicateSubject, options: DuplicateOptions = {}): DuplicateMatch | null {
  if (options.contactSignals) {
    if (draft.email && existing.email && normalizeEmail(draft.email) === normalizeEmail(existing.email)) return "EMAIL";
  }
  const a = nameTokens(draft.lastName, draft.firstName, draft.otherNames);
  const b = nameTokens(existing.lastName, existing.firstName, existing.otherNames);
  // Les « autres prénoms » ne doivent pas empêcher le rapprochement : on compare aussi sans eux.
  const aCore = nameTokens(draft.lastName, draft.firstName);
  const bCore = nameTokens(existing.lastName, existing.firstName);
  const exactName = sameTokens(a, b) || sameTokens(aCore, bCore);
  const dateKnown = Boolean(draft.birthDate) && Boolean(existing.birthDate);
  const sameDate = dateKnown && draft.birthDate === existing.birthDate;
  if (exactName && sameDate) return "EXACT";
  if (!exactName && sameDate && (nearTokens(a, b) || nearTokens(aCore, bCore))) return "NEAR";
  if (exactName && !dateKnown) return "NAME_ONLY";
  if (options.contactSignals && draft.phone && existing.phone && draft.phone === existing.phone) return "PHONE";
  return null;
}

const RANK: Readonly<Record<DuplicateMatch, number>> = { EXACT: 0, EMAIL: 1, PHONE: 2, NEAR: 3, NAME_ONLY: 4 };

export function compareMatches(a: DuplicateMatch, b: DuplicateMatch): number {
  return RANK[a] - RANK[b];
}

// ---------------------------------------------------------------------------
// Score et raisons (spec 007 §16 « 008 »)
// ---------------------------------------------------------------------------

/** Raisons d'un rapprochement : CODES stables, aucune donnée personnelle (miroir de `PEOPLE_DUPLICATE_REASONS`). */
export type DuplicateReason = "SAME_NAME" | "SIMILAR_NAME" | "SAME_BIRTHDATE" | "BIRTHDATE_UNKNOWN" | "SAME_EMAIL" | "SAME_PHONE";

/**
 * Confiance INDICATIVE (0-100) par type de rapprochement, dans l'ordre de `RANK`. Ce n'est ni un seuil ni une règle : le
 * rapprochement reste un avertissement que l'humain tranche (R11) ; le score ne sert qu'à trier et à afficher.
 */
const BASE_SCORE: Readonly<Record<DuplicateMatch, number>> = { EXACT: 100, EMAIL: 90, PHONE: 80, NEAR: 70, NAME_ONLY: 40 };

/**
 * Signaux qui fondent le rapprochement, en CODES. Calculé indépendamment du lien retenu : un doublon « e-mail » dont le nom
 * est aussi identique porte les deux raisons. Les signaux de contact ne sont examinés qu'avec `contactSignals`.
 */
export function duplicateReasons(draft: DuplicateSubject, existing: DuplicateSubject, options: DuplicateOptions = {}): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  const a = nameTokens(draft.lastName, draft.firstName, draft.otherNames);
  const b = nameTokens(existing.lastName, existing.firstName, existing.otherNames);
  const aCore = nameTokens(draft.lastName, draft.firstName);
  const bCore = nameTokens(existing.lastName, existing.firstName);
  const sameName = sameTokens(a, b) || sameTokens(aCore, bCore);
  const dateKnown = Boolean(draft.birthDate) && Boolean(existing.birthDate);
  if (sameName) reasons.push("SAME_NAME");
  else if (nearTokens(a, b) || nearTokens(aCore, bCore)) reasons.push("SIMILAR_NAME");
  if (dateKnown && draft.birthDate === existing.birthDate) reasons.push("SAME_BIRTHDATE");
  if (!dateKnown && reasons.length > 0) reasons.push("BIRTHDATE_UNKNOWN");
  if (options.contactSignals) {
    if (draft.email && existing.email && normalizeEmail(draft.email) === normalizeEmail(existing.email)) reasons.push("SAME_EMAIL");
    if (draft.phone && existing.phone && draft.phone === existing.phone) reasons.push("SAME_PHONE");
  }
  return reasons;
}

/** Score 0-100 : base du type de rapprochement, +5 par signal de contact concordant en plus (plafonné à 100). */
export function duplicateScore(match: DuplicateMatch, reasons: readonly DuplicateReason[]): number {
  const contactBonus = (match !== "EMAIL" && reasons.includes("SAME_EMAIL") ? 5 : 0) + (match !== "PHONE" && reasons.includes("SAME_PHONE") ? 5 : 0);
  return Math.min(100, BASE_SCORE[match] + contactBonus);
}
