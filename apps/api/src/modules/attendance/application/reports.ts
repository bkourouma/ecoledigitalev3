/**
 * Rapports et portails : liste des absences (export CSV audité), conformité de l'appel, données d'attestation de
 * fréquentation, vues « mon enfant » / « moi ». Données BRUTES : aucun seuil (« enseignant sous appel », « élève à
 * risque »…) — ils sont la configuration des consommateurs (025, 016, portails).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { absenceRateBps } from "../domain/summary";
import { AttendanceCode, forbidden, notFound } from "../domain/errors";
import type { IsoDate, Uuid } from "../domain/types";
import { listAbsences, listTakenOccurrenceIds, type AbsenceFilter, type AbsenceRow } from "../infrastructure/sessions-repository";
import { EventBuffer, actorOf, inTx, todayOf, type AttendanceDeps, type CallerCaps } from "./deps";
import type { OccurrenceInfo, PeriodInfo } from "./ports";
import { listJustifications, type JustificationView } from "./justifications";
import { getAttendanceSummary, type SummaryView } from "./summaries";

// ---------------------------------------------------------------------------
// Absences
// ---------------------------------------------------------------------------

export interface AbsencesQuery extends AbsenceFilter {
  readonly periodId?: Uuid | undefined;
}

async function resolveWindow(deps: AttendanceDeps, ctx: RequestContext, q: { periodId?: Uuid | undefined; from?: IsoDate | undefined; to?: IsoDate | undefined }): Promise<Result<{ from?: IsoDate; to?: IsoDate }, AppError>> {
  if (!q.periodId) return ok({ ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) });
  const period = await deps.ports.periods.getPeriod(ctx, q.periodId);
  if (!period) return err(notFound(AttendanceCode.PERIOD_NOT_FOUND, "Période", q.periodId));
  return ok({ from: q.from && q.from > period.startsOn ? q.from : period.startsOn, to: q.to && q.to < period.endsOn ? q.to : period.endsOn });
}

/** `listAbsences` : liste paginée (200 max) par élève, classe, période, statut, justifié ou non. Lecture seule. */
export async function listAbsencesReport(deps: AttendanceDeps, ctx: RequestContext, q: AbsencesQuery): Promise<Result<{ items: AbsenceRow[]; nextCursor: string | null }, AppError>> {
  const window = await resolveWindow(deps, ctx, q);
  if (!window.ok) return window;
  return inTx(deps, ctx, async (tx) => ok(await listAbsences(tx, { ...q, ...window.value })), { readOnly: true });
}

/** Limite de lignes d'un export (protection de l'API, pas une règle métier). */
export const CSV_EXPORT_MAX_ROWS = 5000;

/** Neutralise l'injection de formule des tableurs (`=`, `+`, `-`, `@`) et échappe les séparateurs. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface AbsencesCsv {
  readonly csv: string;
  readonly rows: number;
  readonly truncated: boolean;
}

/** Export CSV (5 000 lignes max), AUDITÉ (`attendance.report.exported`). */
export async function exportAbsencesCsv(deps: AttendanceDeps, ctx: RequestContext, q: AbsencesQuery): Promise<Result<AbsencesCsv, AppError>> {
  const window = await resolveWindow(deps, ctx, q);
  if (!window.ok) return window;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const rows: AbsenceRow[] = [];
    let cursor: string | undefined;
    let truncated = false;
    for (;;) {
      const page = await listAbsences(tx, { ...q, ...window.value, limit: Math.min(200, CSV_EXPORT_MAX_ROWS - rows.length), cursor });
      rows.push(...page.items);
      if (!page.nextCursor) break;
      if (rows.length >= CSV_EXPORT_MAX_ROWS) {
        truncated = true;
        break;
      }
      cursor = page.nextCursor;
    }
    const names = await deps.ports.people.getStudentsByIds(ctx, [...new Set(rows.map((r) => r.studentId))]).catch(() => []);
    const nameOf = new Map(names.map((n) => [n.studentId, n.displayName]));
    const header = ["date", "eleve_id", "eleve", "classe_id", "statut", "justifie", "minutes", "justificatif_id"];
    const lines = rows.map((r) =>
      [r.sessionDate, r.studentId, nameOf.get(r.studentId) ?? "", r.classroomId, r.statusCode, r.excused ? "oui" : "non", r.countedMinutes ?? r.minutesLate ?? "", r.justificationId ?? ""].map(csvCell).join(";"),
    );
    events.audit({
      action: "attendance.report.exported", resourceType: "report", resourceId: "absences", sensitive: true,
      metadata: { rows: rows.length, truncated, filters: { classroomId: q.classroomId ?? null, studentId: q.studentId ?? null, from: window.value.from ?? null, to: window.value.to ?? null } },
    });
    await events.flush(tx);
    return ok({ csv: [header.join(";"), ...lines].join("\r\n") + "\r\n", rows: rows.length, truncated });
  });
}

// ---------------------------------------------------------------------------
// Conformité de l'appel
// ---------------------------------------------------------------------------

export interface ComplianceLine {
  readonly expected: number;
  readonly taken: number;
  readonly missing: number;
  /** Taux d'appel en points de base (10 000 = 100 %) ; `null` sans séance attendue. Donnée brute, sans seuil. */
  readonly rateBps: number | null;
}

export interface CallCompliance extends ComplianceLine {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly byStaff: Array<ComplianceLine & { staffId: Uuid | null }>;
  readonly byClassroom: Array<ComplianceLine & { classroomId: Uuid }>;
  readonly missingOccurrences: Array<{ occurrenceId: Uuid; classroomId: Uuid; date: IsoDate; staffIds: Uuid[] }>;
}

const line = (expected: number, taken: number): ComplianceLine => ({
  expected,
  taken,
  missing: expected - taken,
  rateBps: expected === 0 ? null : 10_000 - absenceRateBps(expected, expected - taken),
});

/** Séances planifiées PASSÉES sans appel soumis, par enseignant et par classe (le seuil « sous appel » est la configuration de 025). */
export async function getCallCompliance(
  deps: AttendanceDeps,
  ctx: RequestContext,
  q: { from: IsoDate; to: IsoDate; institutionId?: Uuid | undefined; staffId?: Uuid | undefined },
): Promise<Result<CallCompliance, AppError>> {
  const now = deps.clock.now();
  const today = todayOf(deps);
  const expected = (await deps.ports.occurrences.listExpectedOccurrences(ctx, q)).filter(
    (o: OccurrenceInfo) => o.date < today || (o.date === today && (o.endsAt === null || o.endsAt <= now)),
  );
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const taken = await listTakenOccurrenceIds(tx, expected.map((o) => o.occurrenceId));
      const staffAgg = new Map<Uuid | null, { e: number; t: number }>();
      const roomAgg = new Map<Uuid, { e: number; t: number }>();
      const missing: CallCompliance["missingOccurrences"] = [];
      for (const o of expected) {
        const done = taken.has(o.occurrenceId);
        const lead = o.staff.find((s) => s.role === "LEAD") ?? o.staff[0];
        const k = lead?.staffId ?? null;
        const s = staffAgg.get(k) ?? { e: 0, t: 0 };
        s.e += 1;
        if (done) s.t += 1;
        staffAgg.set(k, s);
        const r = roomAgg.get(o.classroomId) ?? { e: 0, t: 0 };
        r.e += 1;
        if (done) r.t += 1;
        roomAgg.set(o.classroomId, r);
        if (!done && missing.length < 500) missing.push({ occurrenceId: o.occurrenceId, classroomId: o.classroomId, date: o.date, staffIds: o.staff.map((x) => x.staffId) });
      }
      const total = expected.length;
      const done = expected.filter((o) => taken.has(o.occurrenceId)).length;
      return ok({
        from: q.from,
        to: q.to,
        ...line(total, done),
        byStaff: [...staffAgg.entries()].map(([staffId, v]) => ({ staffId, ...line(v.e, v.t) })),
        byClassroom: [...roomAgg.entries()].map(([classroomId, v]) => ({ classroomId, ...line(v.e, v.t) })),
        missingOccurrences: missing,
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Attestation de fréquentation (données)
// ---------------------------------------------------------------------------

export interface CertificateData {
  readonly studentId: Uuid;
  readonly displayName: string | null;
  readonly enrollmentId: Uuid;
  readonly classroomId: Uuid;
  readonly periodId: Uuid;
  readonly windowFrom: IsoDate | null;
  readonly windowTo: IsoDate | null;
  readonly summary: SummaryView["effective"];
  readonly overridden: boolean;
}

/** `getAttendanceCertificateData` : données (nom, classe, période, comptages effectifs) pour 013 / 024 ; le PDF n'est pas produit ici. */
export async function getAttendanceCertificateData(deps: AttendanceDeps, ctx: RequestContext, q: { studentId: Uuid; periodId: Uuid }): Promise<Result<CertificateData, AppError>> {
  const period: PeriodInfo | null = await deps.ports.periods.getPeriod(ctx, q.periodId);
  if (!period) return err(notFound(AttendanceCode.PERIOD_NOT_FOUND, "Période", q.periodId));
  const enrollments = await deps.ports.roster.findEnrollmentsOfStudent(ctx, q.studentId, { from: period.startsOn, to: period.endsOn });
  const enrollment = enrollments.find((e) => e.active) ?? enrollments[0];
  if (!enrollment) return err(notFound(AttendanceCode.ENROLLMENT_NOT_FOUND, "Inscription de l'élève sur la période", q.studentId));
  const summary = await getAttendanceSummary(deps, ctx, { enrollmentId: enrollment.enrollmentId, periodId: q.periodId });
  if (!summary.ok) return summary;
  const names = await deps.ports.people.getStudentsByIds(ctx, [q.studentId]);
  return ok({
    studentId: q.studentId,
    displayName: names[0]?.displayName ?? null,
    enrollmentId: enrollment.enrollmentId,
    classroomId: enrollment.classroomId,
    periodId: q.periodId,
    windowFrom: summary.value.windowFrom,
    windowTo: summary.value.windowTo,
    summary: summary.value.effective,
    overridden: summary.value.overridden,
  });
}

// ---------------------------------------------------------------------------
// Portails élève / parent
// ---------------------------------------------------------------------------

export interface PortalView {
  readonly studentId: Uuid;
  readonly records: AbsenceRow[];
  readonly justifications: JustificationView[];
  readonly summary: SummaryView | null;
}

/**
 * Vue portail d'UN élève. `via: 'child'` : le tuteur doit être LIÉ à l'élève (`isGuardianOfStudent`, jamais un en-tête
 * client) ; `via: 'self'` : l'élève ne voit que lui-même. Motif et décision des justificatifs sont visibles, pas la pièce.
 */
export async function getStudentPortalView(
  deps: AttendanceDeps,
  ctx: RequestContext,
  q: { studentId: Uuid; via: "child" | "self"; periodId?: Uuid | undefined; from?: IsoDate | undefined; to?: IsoDate | undefined; limit?: number | undefined; cursor?: string | undefined; caps?: CallerCaps },
): Promise<Result<PortalView & { nextCursor: string | null }, AppError>> {
  const user = actorOf(ctx);
  if (!user) return err(forbidden(AttendanceCode.FORBIDDEN, "Utilisateur identifié requis."));
  const allowed =
    q.via === "child"
      ? await deps.ports.people.isGuardianOfStudent(ctx, user, q.studentId)
      : (await deps.ports.people.getStudentIdForUser(ctx, user)) === q.studentId;
  // 404 plutôt que 403 : on ne révèle pas l'existence d'un élève qui n'est pas le sien.
  if (!allowed) return err(notFound(AttendanceCode.NOT_GUARDIAN, "Élève", q.studentId));

  const window = await resolveWindow(deps, ctx, q);
  if (!window.ok) return window;
  const page = await inTx(deps, ctx, async (tx) => ok(await listAbsences(tx, { studentId: q.studentId, ...window.value, limit: q.limit, cursor: q.cursor })), { readOnly: true });
  if (!page.ok) return page;
  const justifications = await listJustifications(deps, ctx, { studentId: q.studentId, caps: { justificationRead: true }, limit: 200 });
  if (!justifications.ok) return justifications;

  let summary: SummaryView | null = null;
  if (q.periodId) {
    const period = await deps.ports.periods.getPeriod(ctx, q.periodId);
    const enrollments = period ? await deps.ports.roster.findEnrollmentsOfStudent(ctx, q.studentId, { from: period.startsOn, to: period.endsOn }) : [];
    const enrollment = enrollments.find((e) => e.active) ?? enrollments[0];
    if (enrollment) {
      const s = await getAttendanceSummary(deps, ctx, { enrollmentId: enrollment.enrollmentId, periodId: q.periodId });
      if (s.ok) summary = s.value;
    }
  }
  return ok({ studentId: q.studentId, records: page.value.items, nextCursor: page.value.nextCursor, justifications: justifications.value.items, summary });
}
