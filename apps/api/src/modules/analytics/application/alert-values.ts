/**
 * Lecture de la valeur COURANTE d'un indicateur d'alerte, dans les read-models d'`analytics` uniquement (SQL du schéma
 * `analytics`, aucune lecture d'un autre module). `value: null` = « non mesuré » : jamais converti en zéro, ne déclenche ni ne
 * résout aucune alerte.
 *
 * Aucune formule métier : taux et totaux viennent des faits déjà lus des modules sources. Un taux de validation reposant sur
 * un jeu de règles de DÉMONSTRATION n'est pas mesuré (aucun chiffre non officiel ne déclenche une alerte).
 */
import type { Tx } from "@ecoledigitale/database";
import { addDays } from "../domain/refresh-plan";
import type { AlertMetricDef } from "../domain/alert-metrics";
import { selectScopes } from "../infrastructure/dims-repository";
import * as repo from "../infrastructure/read-repository";
import type { ResolvedScope } from "./scope";

export interface MetricReading {
  value: number | null;
  currency: string | null;
  yearId: string | null;
  periodId: string | null;
  /** Raison lisible quand la valeur n'est pas mesurée (journal d'évaluation). */
  reason?: string;
}

const none = (scope: ResolvedScope, reason: string): MetricReading => ({ value: null, currency: null, yearId: scope.yearId, periodId: scope.periodId, reason });

/** Clés des tables `finance_*` pour le périmètre d'une règle ; `null` si un établissement à plusieurs campus n'en désigne aucun. */
async function financeKeysOf(tx: Tx, scope: ResolvedScope): Promise<repo.FinanceKeys | null> {
  let campusKey = scope.campusId ?? "*";
  if (!scope.campusId && scope.institutionId) {
    const campuses = (await selectScopes(tx)).filter((s) => s.kind === "CAMPUS" && s.parentId === scope.institutionId);
    if (campuses.length === 1) campusKey = (campuses[0] as { id: string }).id;
    else if (campuses.length > 1) return null;
  }
  return { yearKey: scope.year?.code ?? "*", campusKey };
}

export async function readMetric(tx: Tx, def: AlertMetricDef, rule: { windowDays: number | null; institutionId: string | null }, scope: ResolvedScope, today: string): Promise<MetricReading> {
  const windowDays = rule.windowDays ?? def.defaultWindowDays ?? 30;
  switch (def.metric) {
    case "ATTENDANCE_RATE": {
      const b = await repo.attendanceBreakdown(tx, scope, { from: addDays(today, -(windowDays - 1)), to: today });
      return b.totals.rateBps === null ? none(scope, "aucun pointage dans la fenêtre") : { value: b.totals.rateBps, currency: null, yearId: scope.yearId, periodId: null };
    }
    case "COLLECTION_RATE":
    case "OVERDUE_AMOUNT": {
      const keys = await financeKeysOf(tx, scope);
      if (!keys) return none(scope, "campus requis : la facturation est suivie par campus");
      const row = await repo.financeSummaryRow(tx, keys);
      if (!row) return none(scope, "aucune facturation lue");
      if (def.metric === "COLLECTION_RATE") return row.collection_rate_bps === null ? none(scope, "rien à recouvrer") : { value: Number(row.collection_rate_bps), currency: row.currency, yearId: scope.yearId, periodId: null };
      return { value: Number(row.overdue), currency: row.currency, yearId: scope.yearId, periodId: null };
    }
    case "VALIDATION_RATE": {
      const latest = await repo.latestFinalPeriod(tx, scope.yearId);
      if (!latest) return none(scope, "aucune période clôturée");
      const periodScope = { ...scope, periodId: latest.periodId };
      const source = await repo.rulesSourceSummary(tx, periodScope);
      if (source.demonstration) return none(scope, "règles de démonstration : chiffre non officiel");
      if (source.unknownClassPeriods > 0) return none(scope, "provenance des règles non lisible");
      const stats = await repo.resultsTotals(tx, periodScope);
      return stats.validationRateBps === null ? none(scope, "aucune validation mesurable") : { value: stats.validationRateBps, currency: null, yearId: scope.yearId, periodId: latest.periodId };
    }
    case "ENROLLMENT_IN_SCHOOLING": {
      const h = await repo.headcountOverview(tx, scope);
      return h.total === 0 ? none(scope, "aucune inscription lue") : { value: h.inSchooling, currency: null, yearId: scope.yearId, periodId: null };
    }
    case "CASH_VARIANCE": {
      const c = await repo.cashSessions(tx, { from: addDays(today, -(windowDays - 1)), to: today, limit: 1 });
      return c.totals.closed === 0 ? none(scope, "aucune session de caisse close dans la fenêtre") : { value: c.totals.absoluteVariance, currency: c.currency, yearId: null, periodId: null };
    }
    case "SCHOOLLIFE_OPEN_INCIDENTS":
    case "SCHOOLLIFE_MEASURES_TO_VALIDATE": {
      const indicator = def.metric === "SCHOOLLIFE_OPEN_INCIDENTS" ? "OPEN_INCIDENTS" : "MEASURES_TO_VALIDATE";
      const v = await repo.schoolLifeValue(tx, scope.institutionId ?? rule.institutionId ?? "*", indicator);
      return v === null ? none(scope, "vie scolaire non lue") : { value: v, currency: null, yearId: null, periodId: null };
    }
  }
}
