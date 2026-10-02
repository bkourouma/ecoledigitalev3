/**
 * Mesures PURES sur des comptes et des montants : taux en points de base, lecture « feu tricolore », classes d'un
 * histogramme, empreinte de contenu. AUCUNE formule de résultat scolaire (moyenne, rang, crédits, décision) : celles-ci
 * viennent des résultats FINAL de `results` et ne sont jamais recalculées ici ; ce fichier ne fait que compter,
 * regrouper et présenter.
 */
import { createHash } from "node:crypto";

/** Taux en points de base (1 % = 100), arrondi demi-supérieur ; `null` si le dénominateur est nul ou négatif. */
export function rateBps(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.floor((numerator * 10_000 * 2 + denominator) / (denominator * 2));
}

export type ReadingStatus = "good" | "warning" | "critical" | "neutral";

/**
 * Lecture d'un taux au regard des seuils d'AFFICHAGE de l'établissement (`settings`). Sans valeur ou sans seuil :
 * `neutral` — jamais une couleur inventée.
 */
export function readingStatus(valueBps: number | null, thresholds: { goodBps: number | null; warningBps: number | null }): ReadingStatus {
  if (valueBps === null || thresholds.goodBps === null || thresholds.warningBps === null) return "neutral";
  if (valueBps >= thresholds.goodBps) return "good";
  if (valueBps >= thresholds.warningBps) return "warning";
  return "critical";
}

export interface HistogramBin {
  index: number;
  from: number;
  /** Borne haute EXCLUE, sauf pour la dernière classe qui contient `scaleMax`. */
  to: number;
  count: number;
}

/** Nombre de classes d'un histogramme de largeur `binWidth` sur `[0, scaleMax]` (au plus 100). */
export function binCount(scaleMax: number, binWidth: number): number {
  if (!(scaleMax > 0) || !(binWidth > 0)) return 0;
  return Math.min(100, Math.max(1, Math.ceil(scaleMax / binWidth)));
}

/** Indice de classe d'une valeur (bornée à `[0, scaleMax]`) : la dernière classe contient `scaleMax`. */
export function binIndex(value: number, scaleMax: number, binWidth: number): number {
  const n = binCount(scaleMax, binWidth);
  if (n === 0) return 0;
  const clamped = Math.min(Math.max(value, 0), scaleMax);
  return Math.min(n - 1, Math.floor(clamped / binWidth));
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Complète les classes vides : `counts` associe un indice de classe à un effectif. */
export function buildBins(counts: ReadonlyMap<number, number>, scaleMax: number, binWidth: number): HistogramBin[] {
  const n = binCount(scaleMax, binWidth);
  const bins: HistogramBin[] = [];
  for (let i = 0; i < n; i += 1) {
    bins.push({ index: i, from: round2(i * binWidth), to: round2(Math.min(scaleMax, (i + 1) * binWidth)), count: counts.get(i) ?? 0 });
  }
  return bins;
}

/** Décimal exact lu de la base (chaîne) présenté avec 2 décimales : affichage uniquement, jamais réinjecté dans un calcul. */
export function presentDecimal(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? round2(n) : null;
}

/** JSON canonique (clés triées) : même contenu = même chaîne, quel que soit l'ordre des clés. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Empreinte (SHA-256 hexadécimale) du contenu canonique d'un ensemble de faits. */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
