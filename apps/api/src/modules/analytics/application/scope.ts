/**
 * Périmètre de lecture et méta des réponses.
 *
 *  - `resolveScope` : établissement / campus / année / période demandés, bornés par le périmètre de l'utilisateur
 *    (`ctx.institutionId` / `ctx.campusId`) : un utilisateur limité à un campus ne peut demander ni un autre campus ni
 *    l'établissement entier ; l'année par défaut est l'année COURANTE ;
 *  - `buildMeta` : horodatage `asOf`, fraîcheur et manques déclarés de CHAQUE réponse (cache et fraîcheur explicites).
 */
import { ForbiddenError, ValidationError, type AppError, type RequestContext, type Result, err, ok } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AnalyticsMeta, AnalyticsGap } from "@ecoledigitale/contracts/src/v2/analytics";
import { DEFAULT_DISPLAY_THRESHOLDS, type DisplayThresholds } from "../domain/display-thresholds";
import { REFRESH_KINDS, type RefreshKind } from "../domain/types";
import { selectPeriods, selectScopes, selectYears, type PeriodDim, type YearDim } from "../infrastructure/dims-repository";
import { selectSettings, type ReadScope } from "../infrastructure/read-repository";
import { listStates, type RefreshStateRow } from "../infrastructure/requests-repository";

export interface ScopeQueryInput {
  institutionId?: string | undefined;
  campusId?: string | undefined;
  yearId?: string | undefined;
  periodId?: string | undefined;
  classroomId?: string | undefined;
  gradeLevelCode?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface ResolvedScope extends ReadScope {
  /** Année retenue (explicite ou courante) avec son code (clé des factures de finance). */
  year: YearDim | null;
  period: PeriodDim | null;
  /** Le contexte est limité à un établissement ou un campus. */
  restricted: boolean;
}

/** Libellés des sources pour les manques déclarés. */
export const SOURCE_LABELS: Readonly<Record<RefreshKind, string>> = {
  REBUILD: "Reconstruction",
  CALENDAR: "Calendrier scolaire",
  ENROLLMENT: "Inscriptions",
  RESULTS: "Résultats",
  ATTENDANCE: "Présences des élèves",
  STAFF_PRESENCE: "Présences du personnel",
  FINANCE: "Facturation et créances",
  COLLECTIONS: "Encaissements",
  CASH: "Sessions de caisse",
  PAYROLL: "Paie",
  TEACHING_LOAD: "Charge d'enseignement",
};

const forbidden = (message: string): AppError => new ForbiddenError(message, { code: "analytics.scope_forbidden" });

export async function loadDims(tx: Tx): Promise<{ years: YearDim[]; periods: PeriodDim[] }> {
  return { years: await selectYears(tx), periods: await selectPeriods(tx) };
}

export function resolveScope(ctx: RequestContext, query: ScopeQueryInput, dims: { years: readonly YearDim[]; periods: readonly PeriodDim[] }): Result<ResolvedScope, AppError> {
  const institutionId = ctx.institutionId ?? query.institutionId ?? null;
  if (ctx.institutionId && query.institutionId && query.institutionId !== ctx.institutionId) return err(forbidden("Cet établissement est hors de votre périmètre."));
  const campusId = ctx.campusId ?? query.campusId ?? null;
  if (ctx.campusId && query.campusId && query.campusId !== ctx.campusId) return err(forbidden("Ce campus est hors de votre périmètre."));

  const candidates = dims.years.filter((y) => !institutionId || y.institutionId === institutionId);
  let year: YearDim | null = null;
  if (query.yearId) {
    year = dims.years.find((y) => y.id === query.yearId) ?? null;
    if (!year) return err(new ValidationError("Année inconnue.", [{ path: ["yearId"], message: "Année inconnue.", code: "unknown_year" }]));
  } else {
    year = candidates.find((y) => y.isCurrent) ?? candidates[0] ?? null; // `selectYears` trie par début décroissant
  }
  let period: PeriodDim | null = null;
  if (query.periodId) {
    period = dims.periods.find((p) => p.id === query.periodId) ?? null;
    if (!period) return err(new ValidationError("Période inconnue.", [{ path: ["periodId"], message: "Période inconnue.", code: "unknown_period" }]));
    if (year && period.yearId !== year.id) return err(new ValidationError("Cette période n'appartient pas à l'année demandée.", [{ path: ["periodId"], message: "Période hors année.", code: "period_year_mismatch" }]));
  }
  if (query.from && query.to && query.from > query.to) return err(new ValidationError("La fin de période précède le début.", [{ path: ["to"], message: "Fin avant début.", code: "range_inverted" }]));

  return ok({
    institutionId,
    campusId,
    yearId: year?.id ?? null,
    periodId: period?.id ?? null,
    classroomId: query.classroomId ?? null,
    gradeLevelCode: query.gradeLevelCode ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
    year,
    period,
    restricted: Boolean(ctx.institutionId || ctx.campusId),
  });
}

export async function loadThresholds(tx: Tx): Promise<DisplayThresholds & { source: "DEFAULT" | "TENANT" }> {
  const row = await selectSettings(tx);
  const d = DEFAULT_DISPLAY_THRESHOLDS;
  return {
    collectionGoodBps: row?.collectionGoodBps ?? d.collectionGoodBps,
    collectionWarningBps: row?.collectionWarningBps ?? d.collectionWarningBps,
    attendanceGoodBps: row?.attendanceGoodBps ?? d.attendanceGoodBps,
    attendanceWarningBps: row?.attendanceWarningBps ?? d.attendanceWarningBps,
    staleAfterSeconds: row?.staleAfterSeconds ?? d.staleAfterSeconds,
    source: row ? "TENANT" : "DEFAULT",
  };
}

/** `asOf` d'un genre = la passe réussie la plus récente parmi ses périmètres ; manques déclarés par genre. */
export function summarizeStates(states: readonly RefreshStateRow[], kinds: readonly RefreshKind[]): { sources: Record<string, string | null>; gaps: AnalyticsGap[] } {
  const sources: Record<string, string | null> = {};
  const gaps: AnalyticsGap[] = [];
  for (const kind of kinds) {
    const rows = states.filter((s) => s.kind === kind);
    const successes = rows.map((r) => r.lastSuccessAt).filter((d): d is Date => d !== null);
    sources[kind] = successes.length > 0 ? new Date(Math.max(...successes.map((d) => d.getTime()))).toISOString() : null;
    const label = SOURCE_LABELS[kind];
    if (rows.length === 0) {
      gaps.push({ source: kind, reason: "NEVER_COMPUTED", message: `${label} : aucune lecture de la source n'a encore eu lieu.` });
      continue;
    }
    const bad = rows.find((r) => r.lastStatus !== "OK");
    if (bad) {
      gaps.push(
        bad.lastStatus === "UNAVAILABLE"
          ? { source: kind, reason: "NOT_WIRED", message: `${label} : source non branchée sur cette plateforme (${bad.lastError ?? "indisponible"}).` }
          : { source: kind, reason: "FAILED", message: `${label} : la dernière lecture a échoué${sources[kind] ? " ; les chiffres affichés sont ceux de la dernière lecture réussie" : ""}.` },
      );
    }
  }
  return { sources, gaps };
}

export function buildMetaFromStates(states: readonly RefreshStateRow[], kinds: readonly RefreshKind[], scope: ReadScope, thresholds: { staleAfterSeconds: number }, now: Date, extraGaps: AnalyticsGap[] = []): AnalyticsMeta {
  const { sources, gaps } = summarizeStates(states, kinds);
  const dates = Object.values(sources).filter((v): v is string => v !== null);
  const asOf = dates.length > 0 ? dates.reduce((min, cur) => (cur < min ? cur : min)) : null;
  const stale = asOf === null || dates.length < kinds.length || now.getTime() - Date.parse(asOf) > thresholds.staleAfterSeconds * 1000;
  return {
    asOf,
    stale,
    sources,
    gaps: [...gaps, ...extraGaps],
    scope: { institutionId: scope.institutionId, campusId: scope.campusId, yearId: scope.yearId, periodId: scope.periodId, from: scope.from, to: scope.to },
  };
}

export async function buildMeta(tx: Tx, kinds: readonly RefreshKind[], scope: ReadScope, thresholds: { staleAfterSeconds: number }, now: Date, extraGaps: AnalyticsGap[] = []): Promise<AnalyticsMeta> {
  return buildMetaFromStates(await listStates(tx), kinds, scope, thresholds, now, extraGaps);
}

export { REFRESH_KINDS, selectScopes };
