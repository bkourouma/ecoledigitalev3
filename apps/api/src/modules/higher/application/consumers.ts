/**
 * Consommateurs d'événements (abonnés du worker) — logique testable sans worker.
 *
 *  - `onResultsPeriodClosed` : `results.period.closed` -> capitalisation (registre, dettes, issue des rattrapages).
 *  - `onCreditsCapitalized`  : `higher.credits.capitalized` -> évaluation d'éligibilité aux diplômes. ABONNÉ DISTINCT, dans
 *    sa propre transaction : sa défaillance ne bloque ni n'annule jamais la capitalisation (R-HIG-10, AC5.2) ; le worker le
 *    rejoue (reprises puis dead-letter).
 */
import { createSystemContext, err, isUuid, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import { HigherCode, validation } from "../domain/errors";
import type { Uuid } from "../domain/types";
import { expireCredits, capitalizePeriod, type CapitalizeReport } from "./ledger";
import { evaluateStudentDiplomas, type RecomputeReport } from "./awards";
import type { HigherDeps } from "./deps";

export interface PeriodClosedPayload {
  readonly classroomId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly stateId?: Uuid | undefined;
  readonly resultsVersion?: number | undefined;
}

/** Lit un identifiant avec tolérance sur le nom du champ (le payload d'un autre module n'est pas figé). */
export function pickUuid(payload: unknown, ...keys: string[]): Uuid | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  for (const k of keys) {
    const v = (payload as Record<string, unknown>)[k];
    if (typeof v === "string" && isUuid(v)) return v;
  }
  return undefined;
}

export function parsePeriodClosed(payload: unknown): PeriodClosedPayload | null {
  const classroomId = pickUuid(payload, "classroomId");
  const academicPeriodId = pickUuid(payload, "academicPeriodId", "periodId");
  if (!classroomId || !academicPeriodId) return null;
  const p = payload as Record<string, unknown>;
  const version = typeof p.resultsVersion === "number" && Number.isInteger(p.resultsVersion) && p.resultsVersion >= 0 ? p.resultsVersion : undefined;
  return { classroomId, academicPeriodId, stateId: pickUuid(payload, "stateId"), resultsVersion: version };
}

export async function onResultsPeriodClosed(deps: HigherDeps, ctx: RequestContext, payload: unknown): Promise<Result<CapitalizeReport, AppError>> {
  const parsed = parsePeriodClosed(payload);
  if (!parsed) return err(validation(HigherCode.INVALID_INPUT, "Payload results.period.closed inexploitable (classe ou période absente).", "payload"));
  return capitalizePeriod(deps, ctx, parsed);
}

/** `higher.credits.capitalized` : l'étudiant et l'UE dont les crédits viennent d'être capitalisés. */
export function parseCreditsCapitalized(payload: unknown): { studentId: Uuid; ueNodeId: Uuid } | null {
  const studentId = pickUuid(payload, "studentId");
  const ueNodeId = pickUuid(payload, "ueNodeId");
  return studentId && ueNodeId ? { studentId, ueNodeId } : null;
}

export async function onCreditsCapitalized(deps: HigherDeps, ctx: RequestContext, payload: unknown): Promise<Result<RecomputeReport, AppError>> {
  const parsed = parseCreditsCapitalized(payload);
  if (!parsed) return err(validation(HigherCode.INVALID_INPUT, "Payload higher.credits.capitalized inexploitable.", "payload"));
  return evaluateStudentDiplomas(deps, ctx, parsed);
}

/**
 * Erreurs qu'un rejeu ne corrigera jamais (payload inexploitable, diplôme supprimé) : l'abonné les journalise et passe.
 * Les autres (règle indisponible, base) sont relancées pour que le worker rejoue.
 */
export function isBenignConsumerError(error: AppError): boolean {
  return error.code === HigherCode.INVALID_INPUT || error.code === HigherCode.DIPLOMA_NOT_FOUND;
}

/** Job `higher.expire-credits` : balaye, tenant par tenant, les acquisitions dont la durée de validité est dépassée. */
export async function expireAllTenants(deps: HigherDeps, systemDb: SystemDb): Promise<ForEachTenantReport<{ expired: number }>> {
  return systemDb.forEachTenant("higher-expire-credits", async (_tx, tenant) => {
    const r = await expireCredits(deps, createSystemContext(tenant.id));
    if (!r.ok) throw r.error;
    return r.value;
  });
}
