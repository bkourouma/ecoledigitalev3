/**
 * UE annuelle (décision O-11) : une UE offerte sur plusieurs semestres, un résultat commun. Pur : aucune E/S, AUCUNE formule,
 * AUCUN seuil. Le module regroupe les résultats FINAL de chaque semestre (« parties ») et fabrique le contexte typé que les
 * RÈGLES évaluent ; la moyenne commune, la validation, l'état LMD et la session d'obtention sont DÉCIDÉS par le RuleSet.
 */
import type { DecimalString, UeState, Uuid } from "./types";

export const ANNUAL_UE_MIN_PARTS = 2;
export const ANNUAL_UE_MAX_PARTS = 4;

export interface AnnualUeDef {
  readonly id: Uuid;
  /** Lignée « ancre » : identité de l'UE annuelle au registre de crédits, aux prérequis et aux exigences de diplôme. */
  readonly ueNodeId: Uuid;
  readonly partsExpected: number;
  /** Lignées qui l'alimentent (l'ancre en fait partie). */
  readonly memberNodeIds: readonly Uuid[];
  readonly reason: string;
  readonly createdAt: Date;
}

/** Résultat FINAL d'un semestre pour une UE annuelle (une ligne de `annual_ue_parts`). */
export interface AnnualPart {
  readonly annualUeId: Uuid;
  readonly studentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly academicYearId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly partUeNodeId: Uuid;
  readonly credits: number;
  readonly averageExact: DecimalString | null;
  readonly validated: boolean;
  readonly ueState: UeState;
  readonly sessionObtained: 1 | 2 | null;
  readonly via: "DIRECT" | "RESIT" | "JURY_OVERRIDE";
  readonly overrideId: Uuid | null;
  readonly compensatedEcueCount: number;
  readonly sourceResultId: Uuid;
  readonly resultsVersion: number;
  readonly validatedAt: Date | null;
  readonly recordedAt: Date;
}

/**
 * Ligne d'UE « commune » : même forme que `UeResultLine` (port `CreditsSourcePort`, couche application) — le domaine ne dépend pas
 * de la couche application, la forme est donc répétée ici et vérifiée à la compilation par son usage dans `capitalizePeriod`.
 */
export interface CommonUeLine {
  readonly studentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly ueNodeId: Uuid;
  readonly academicYearId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly credits: number;
  readonly averageExact: DecimalString | null;
  readonly validated: boolean;
  readonly ueState: UeState;
  readonly sessionObtained: 1 | 2 | null;
  readonly via: "DIRECT" | "RESIT" | "JURY_OVERRIDE";
  readonly overrideId: Uuid | null;
  readonly compensatedEcueCount: number;
  readonly sourceResultId: Uuid;
  readonly resultsVersion: number;
  readonly validatedAt?: Date | undefined;
  readonly annual: true;
}

/** Verdict des règles pour l'UE annuelle (rendu par `DiplomaRulesPort.evaluateAnnualUe`). */
export interface AnnualUeVerdict {
  /** Moyenne commune exacte (règle `moyenne_annuelle` appliquée aux semestres de l'UE). */
  readonly average: DecimalString | null;
  /** Crédits de l'UE annuelle (règle `credits_ue`). */
  readonly credits: number;
  readonly validated: boolean;
  /** État LMD (règle `etat_ue`). */
  readonly state: UeState;
  /** Session d'obtention (règle `session_validation_ue`) ; `null` si non validée. */
  readonly sessionObtained: number | null;
}

/** Nombre de semestres DISTINCTS reçus. */
export function distinctPeriods(parts: readonly Pick<AnnualPart, "academicPeriodId">[]): number {
  return new Set(parts.map((p) => p.academicPeriodId)).size;
}

/** Tous les semestres attendus ont-ils un résultat FINAL ? Sinon l'UE annuelle reste « en attente » (rien au registre). */
export function isComplete(def: Pick<AnnualUeDef, "partsExpected">, parts: readonly Pick<AnnualPart, "academicPeriodId">[]): boolean {
  return distinctPeriods(parts) >= def.partsExpected;
}

/**
 * Le rattrapage des parties est-il épuisé ? Une UE annuelle non validée est « à repasser » tant qu'au moins une partie est
 * encore à repasser, « en dette » sinon. Fait de contexte transmis à la règle `etat_ue` (`session2_tentee`) : la règle décide.
 */
export function resitExhausted(parts: readonly Pick<AnnualPart, "ueState">[]): boolean {
  return parts.every((p) => p.ueState !== "RESIT");
}

/** Plus récent des résultats de l'ensemble (clôture la plus tardive, puis réception, puis identifiant de période : déterministe). */
export function latestPart<T extends Pick<AnnualPart, "validatedAt" | "recordedAt" | "academicPeriodId">>(parts: readonly T[]): T {
  const rank = (p: T): number => (p.validatedAt ?? p.recordedAt).getTime();
  return [...parts].sort((a, b) => rank(b) - rank(a) || b.academicPeriodId.localeCompare(a.academicPeriodId))[0] as T;
}

/**
 * Ligne d'UE « commune » transmise à la capitalisation ordinaire : l'UE annuelle est UNE écriture au registre, sous son ancre.
 * Les identifiants (inscription, période, résultat source) sont ceux de la partie la plus récente ; la version est la plus haute.
 */
export function commonLine(def: Pick<AnnualUeDef, "ueNodeId">, parts: readonly AnnualPart[], verdict: AnnualUeVerdict): CommonUeLine {
  const last = latestPart(parts);
  const allOverrides = parts.length > 0 && parts.every((p) => p.via === "JURY_OVERRIDE" && p.overrideId !== null);
  const session: 1 | 2 | null = verdict.validated ? (verdict.sessionObtained !== null && verdict.sessionObtained >= 2 ? 2 : 1) : null;
  const via: CommonUeLine["via"] = allOverrides ? "JURY_OVERRIDE" : session === 2 ? "RESIT" : "DIRECT";
  const ready = (p: AnnualPart): Date | null => p.validatedAt;
  const validatedAt = parts.map(ready).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    studentId: last.studentId,
    enrollmentId: last.enrollmentId,
    ueNodeId: def.ueNodeId,
    academicYearId: last.academicYearId,
    academicPeriodId: last.academicPeriodId,
    credits: verdict.credits,
    averageExact: verdict.average,
    validated: verdict.validated,
    ueState: verdict.state,
    sessionObtained: session,
    via,
    overrideId: allOverrides ? (parts.find((p) => p.overrideId !== null)?.overrideId ?? null) : null,
    compensatedEcueCount: parts.reduce((n, p) => n + p.compensatedEcueCount, 0),
    sourceResultId: last.sourceResultId,
    resultsVersion: parts.reduce((m, p) => Math.max(m, p.resultsVersion), 0),
    ...(validatedAt ? { validatedAt } : {}),
    annual: true,
  };
}

/**
 * Replie les UE d'un cycle / programme : les lignées qui alimentent une UE annuelle sont remplacées par l'ANCRE, dont les
 * crédits sont la somme des parties présentes. Utilisé pour les exigences de diplôme et les attestations (une UE annuelle =
 * UNE exigence). Une UE sans déclaration est rendue telle quelle (parité).
 */
export function foldAnnualUes<T extends { nodeId: Uuid; credits: number }>(ues: readonly T[], defs: readonly AnnualUeDef[]): T[] {
  if (defs.length === 0) return [...ues];
  const byMember = new Map<Uuid, AnnualUeDef>();
  for (const d of defs) for (const m of d.memberNodeIds) byMember.set(m, d);
  const out: T[] = [];
  const totals = new Map<Uuid, number>();
  for (const ue of ues) {
    const def = byMember.get(ue.nodeId);
    if (def) totals.set(def.id, Math.round(((totals.get(def.id) ?? 0) + ue.credits) * 100) / 100);
  }
  const emitted = new Set<Uuid>();
  for (const ue of ues) {
    const def = byMember.get(ue.nodeId);
    if (!def) {
      out.push(ue);
      continue;
    }
    if (ue.nodeId !== def.ueNodeId || emitted.has(def.id)) continue;
    emitted.add(def.id);
    out.push({ ...ue, credits: totals.get(def.id) ?? ue.credits });
  }
  return out;
}
