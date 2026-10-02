/**
 * Export CSV des jeux de données des tableaux de bord : mêmes requêtes que l'API JSON (mêmes chiffres, même `asOf`), mis
 * en forme par `domain/csv.ts` (BOM, `;`, anti-injection de formule). Chaque export est AUDITÉ (`analytics.export.download`) :
 * les listes nominatives de créances et la masse salariale sont des données sensibles. L'audit est écrit AVANT de livrer le
 * fichier : un échec d'audit refuse l'export.
 */
import type { RequestContext, Result, AppError } from "@ecoledigitale/kernel";
import { err, ok, ValidationError } from "@ecoledigitale/kernel";
import { ANALYTICS_PERMISSIONS, type AnalyticsExportDataset } from "@ecoledigitale/contracts/src/v2/analytics";
import { toCsv, type CsvColumn } from "../domain/csv";
import { inTx } from "./deps";
import type { AnalyticsDeps } from "./ports";
import * as q from "./queries";
import type { ScopeQueryInput } from "./scope";

export interface ExportQuery extends ScopeQueryInput {
  granularity?: "day" | "week" | "month" | undefined;
}

export interface ExportResult {
  filename: string;
  csv: string;
  rows: number;
  asOf: string | null;
}

/** Permission DE DONNÉES requise par jeu de données (en plus de `analytics.export`). */
export const EXPORT_PERMISSIONS: Readonly<Record<AnalyticsExportDataset, string>> = {
  "enrollment-by-classroom": ANALYTICS_PERMISSIONS.read,
  "results-by-classroom": ANALYTICS_PERMISSIONS.pedagogy,
  "results-by-subject": ANALYTICS_PERMISSIONS.pedagogy,
  "attendance-by-day": ANALYTICS_PERMISSIONS.attendance,
  "attendance-by-classroom": ANALYTICS_PERMISSIONS.attendance,
  "receivables-by-classroom": ANALYTICS_PERMISSIONS.finance,
  "receivables-by-learner": ANALYTICS_PERMISSIONS.finance,
  collections: ANALYTICS_PERMISSIONS.treasury,
  "aged-balance": ANALYTICS_PERMISSIONS.treasury,
  "cash-sessions": ANALYTICS_PERMISSIONS.treasury,
  "payroll-mass": ANALYTICS_PERMISSIONS.payroll,
  "teaching-load": ANALYTICS_PERMISSIONS.pedagogy,
};

type Built = { csv: string; rows: number; asOf: string | null };
const built = <T>(columns: ReadonlyArray<CsvColumn<T>>, rows: readonly T[], asOf: string | null): Built => ({ csv: toCsv(columns, rows), rows: rows.length, asOf });
const bpsToPercent = (bps: number | null): number | null => (bps === null ? null : Math.round(bps) / 100);

async function build(deps: AnalyticsDeps, ctx: RequestContext, dataset: AnalyticsExportDataset, query: ExportQuery): Promise<Result<Built, AppError>> {
  switch (dataset) {
    case "enrollment-by-classroom": {
      const r = await q.getEnrollment(deps, ctx, query);
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Classe", value: (x) => x.name },
            { header: "Niveau", value: (x) => x.gradeLevelLabel },
            { header: "Inscrits (tous statuts)", value: (x) => x.count },
            { header: "Effectif en scolarité", value: (x) => x.inSchooling },
            { header: "Garçons", value: (x) => x.male },
            { header: "Filles", value: (x) => x.female },
          ],
          r.value.data.byClassroom,
          r.value.meta.asOf,
        ),
      );
    }
    case "results-by-classroom": {
      const r = await q.getResults(deps, ctx, query);
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Classe", value: (x) => x.name },
            { header: "Niveau", value: (x) => x.gradeLevelLabel },
            { header: "Résultats", value: (x) => x.count },
            { header: "Moyenne", value: (x) => x.average },
            { header: "Minimum", value: (x) => x.min },
            { header: "Maximum", value: (x) => x.max },
            { header: "Validés", value: (x) => x.validatedCount },
            { header: "Taux de validation (%)", value: (x) => bpsToPercent(x.validationRateBps) },
          ],
          r.value.data.byClassroom,
          r.value.meta.asOf,
        ),
      );
    }
    case "results-by-subject": {
      const r = await q.getResults(deps, ctx, query);
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Code", value: (x) => x.code },
            { header: "Matière / UE", value: (x) => x.label },
            { header: "Niveau", value: (x) => x.level },
            { header: "Résultats", value: (x) => x.count },
            { header: "Moyenne", value: (x) => x.average },
            { header: "Validés", value: (x) => x.validatedCount },
            { header: "Taux de validation (%)", value: (x) => bpsToPercent(x.validationRateBps) },
            { header: "Éligibles au rattrapage", value: (x) => x.resitEligibleCount },
            { header: "Obtenus en session 2", value: (x) => x.session2Count },
          ],
          r.value.data.bySubject,
          r.value.meta.asOf,
        ),
      );
    }
    case "attendance-by-day": {
      const r = await q.getAttendance(deps, ctx, query);
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Jour", value: (x) => x.day },
            { header: "Pointages", value: (x) => x.recordsCount },
            { header: "Présents", value: (x) => x.presentCount },
            { header: "Absents", value: (x) => x.absentCount },
            { header: "Dont justifiés", value: (x) => x.excusedCount },
            { header: "Retards", value: (x) => x.lateCount },
            { header: "Taux de présence (%)", value: (x) => bpsToPercent(x.rateBps) },
          ],
          r.value.data.byDay,
          r.value.meta.asOf,
        ),
      );
    }
    case "attendance-by-classroom": {
      const r = await q.getAttendance(deps, ctx, query);
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Classe", value: (x) => x.name },
            { header: "Niveau", value: (x) => x.gradeLevelLabel },
            { header: "Pointages", value: (x) => x.recordsCount },
            { header: "Présents", value: (x) => x.presentCount },
            { header: "Absents", value: (x) => x.absentCount },
            { header: "Dont justifiés", value: (x) => x.excusedCount },
            { header: "Retards", value: (x) => x.lateCount },
            { header: "Minutes d'absence", value: (x) => x.absentMinutes },
            { header: "Taux de présence (%)", value: (x) => bpsToPercent(x.rateBps) },
          ],
          r.value.data.byClassroom,
          r.value.meta.asOf,
        ),
      );
    }
    case "receivables-by-classroom":
    case "receivables-by-learner": {
      const by = dataset === "receivables-by-learner" ? "learner" : "class";
      const r = await q.getReceivables(deps, ctx, { ...query, by, onlyOutstanding: false, limit: 500, offset: 0 });
      if (!r.ok) return r;
      return ok(
        built(
          [
            ...(by === "learner" ? [{ header: "Apprenant", value: (x: (typeof r.value.data.rows)[number]) => x.label }, { header: "Classe", value: (x: (typeof r.value.data.rows)[number]) => x.groupLabel }] : [{ header: "Classe", value: (x: (typeof r.value.data.rows)[number]) => x.label }, { header: "Apprenants", value: (x: (typeof r.value.data.rows)[number]) => x.learnerCount }]),
            { header: "Facturé", value: (x) => x.billed },
            { header: "Avoirs", value: (x) => x.credited },
            { header: "Encaissé", value: (x) => x.collected },
            { header: "Reste dû", value: (x) => x.outstanding },
            { header: "Dont en retard", value: (x) => x.overdue },
            { header: "Taux de recouvrement (%)", value: (x) => bpsToPercent(x.collectionRateBps) },
            ...(by === "learner" ? [{ header: "Plus ancienne échéance en retard", value: (x: (typeof r.value.data.rows)[number]) => x.oldestOverdueDate }] : []),
          ],
          r.value.data.rows,
          r.value.meta.asOf,
        ),
      );
    }
    case "collections": {
      const r = await q.getCollections(deps, ctx, { from: query.from, to: query.to, granularity: query.granularity });
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Début de période", value: (x) => x.bucket },
            { header: "Encaissé", value: (x) => x.collected },
            { header: "Remboursé", value: (x) => x.refunded },
            { header: "Net", value: (x) => x.net },
            { header: "Paiements", value: (x) => x.paymentCount },
          ],
          r.value.data.points,
          r.value.meta.asOf,
        ),
      );
    }
    case "aged-balance": {
      const r = await q.getAged(deps, ctx, { ...query, learners: 200 });
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Apprenant", value: (x) => x.learnerName },
            { header: "Non échu", value: (x) => x.notDue },
            { header: "1-30 jours", value: (x) => x.d1_30 },
            { header: "31-60 jours", value: (x) => x.d31_60 },
            { header: "61-90 jours", value: (x) => x.d61_90 },
            { header: "Plus de 90 jours", value: (x) => x.d91_plus },
            { header: "Total", value: (x) => x.total },
          ],
          r.value.data.learners,
          r.value.meta.asOf,
        ),
      );
    }
    case "cash-sessions": {
      const r = await q.getCash(deps, ctx, query);
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Session", value: (x) => x.sessionId },
            { header: "Statut", value: (x) => x.status },
            { header: "Ouverte le", value: (x) => x.openedAt },
            { header: "Clôturée le", value: (x) => x.closedAt },
            { header: "Fonds de caisse", value: (x) => x.openingFloat },
            { header: "Attendu", value: (x) => x.expected },
            { header: "Compté", value: (x) => x.counted },
            { header: "Écart", value: (x) => x.variance },
          ],
          r.value.data.sessions,
          r.value.meta.asOf,
        ),
      );
    }
    case "payroll-mass": {
      const r = await q.getPayroll(deps, ctx, query);
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Période de paie", value: (x) => x.name },
            { header: "Du", value: (x) => x.startsOn },
            { header: "Au", value: (x) => x.endsOn },
            { header: "Bulletins comptés", value: (x) => x.counted.payslips },
            { header: "Masse comptée", value: (x) => x.counted.total },
            { header: "Bulletins annulés", value: (x) => x.cancelled.payslips },
            { header: "Montant annulé", value: (x) => x.cancelled.total },
            { header: "Bulletins contestés", value: (x) => x.disputed.payslips },
            { header: "Montant contesté", value: (x) => x.disputed.total },
          ],
          r.value.data.periods,
          r.value.meta.asOf,
        ),
      );
    }
    case "teaching-load": {
      const r = await q.getTeachingLoad(deps, ctx, query);
      if (!r.ok) return r;
      return ok(
        built(
          [
            { header: "Enseignant", value: (x) => x.displayName },
            { header: "Statut", value: (x) => x.status },
            { header: "Heures prévues", value: (x) => x.plannedHours },
            { header: "Classes", value: (x) => x.classroomCount },
            { header: "Heures contractuelles / semaine", value: (x) => x.contractualHoursPerWeek },
          ],
          r.value.data.rows,
          r.value.meta.asOf,
        ),
      );
    }
  }
  return err(new ValidationError("Jeu de données inconnu.", [{ path: ["dataset"], message: "Jeu de données inconnu.", code: "unknown_dataset" }]));
}

export async function exportDataset(deps: AnalyticsDeps, ctx: RequestContext, dataset: AnalyticsExportDataset, query: ExportQuery): Promise<Result<ExportResult, AppError>> {
  const b = await build(deps, ctx, dataset, query);
  if (!b.ok) return b;
  await inTx(deps, ctx, async (tx) => {
    await deps.audit.record(tx, {
      action: "analytics.export.download",
      entity: "export",
      entityId: dataset,
      metadata: { dataset, rows: b.value.rows, asOf: b.value.asOf, institutionId: query.institutionId ?? null, campusId: query.campusId ?? null, yearId: query.yearId ?? null },
      severity: dataset === "payroll-mass" || dataset === "receivables-by-learner" ? "warning" : "notice",
    });
  });
  const stamp = deps.clock.now().toISOString().slice(0, 10);
  return ok({ filename: `analytics-${dataset}-${stamp}.csv`, csv: b.value.csv, rows: b.value.rows, asOf: b.value.asOf });
}
