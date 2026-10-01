/**
 * Lectures : bulletins (accès réservé à son TITULAIRE ou à la GESTION), historique, rapports, masse salariale,
 * comptes rendus, export CSV.
 *
 * ACCÈS (R-PAY-16, AC8.1/8.5) — vérifié ICI, par la couche d'accès, jamais par l'écran :
 *   - gestion (`payroll.payslip.read`) : tous les bulletins ;
 *   - titulaire (`payroll.payslip.read_own`) : uniquement les bulletins dont `staff_id` est le sien, résolu depuis
 *     SON COMPTE (port personnel) — jamais depuis un paramètre — et seulement une fois le montant arrêté
 *     (APPROVED, DISPUTED, PAID : un brouillon calculé ou un bulletin annulé n'est pas le sien à lire) ;
 *   - tout autre compte : 403.
 */
import { Money, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { ForbiddenError } from "@ecoledigitale/kernel";
import { PayrollCodes, forbidden, notFound, portUnavailable } from "../domain/errors";
import type { AdjustmentRecord, CalculationRunItemRecord, CalculationRunRecord, PayslipEventRecord, PayslipLineRecord, PayslipRecord } from "../domain/records";
import type { PayslipSnapshot } from "../domain/snapshot";
import type { HourSourceKind, IsoDate, PayslipStatus, Uuid } from "../domain/types";
import * as repo from "../infrastructure/payslip-repo";
import * as reports from "../infrastructure/report-repo";
import * as setup from "../infrastructure/setup-repo";
import { EventBuffer, inTx, type PayrollDeps } from "./deps";
import { buildSnapshot, snapshotHash } from "./snapshots";
import { fallbackStaffName, requireUser, staffInfoMap } from "./support";

/** Statuts qu'un enseignant lit pour lui-même. */
export const OWN_VISIBLE_STATUSES: readonly PayslipStatus[] = Object.freeze(["APPROVED", "DISPUTED", "PAID"] as const);

export interface ReadCaps {
  /** `payroll.payslip.read` : la gestion lit tout. */
  readonly readAll: boolean;
  /** `payroll.payslip.read_own` : le titulaire lit les siens. */
  readonly readOwn: boolean;
}

/** Le membre du personnel lié au compte de l'appelant (port 009) ; jamais lu depuis la requête. */
export async function ownStaffId(deps: PayrollDeps, ctx: RequestContext): Promise<Result<Uuid, AppError>> {
  if (!ctx.userId) return err(forbidden("Aucun compte utilisateur."));
  const port = deps.ports.staff;
  if (!port) return err(portUnavailable("personnel (009)"));
  let staffId: Uuid | null;
  try {
    staffId = await port.getStaffIdForUser(ctx, ctx.userId);
  } catch {
    return err(portUnavailable("personnel (009)"));
  }
  return staffId ? ok(staffId) : err(forbidden("Votre compte n'est lié à aucun membre du personnel."));
}

/** Autorise la lecture d'UN bulletin : gestion ou titulaire (bulletin arrêté). */
export async function authorizeRead(deps: PayrollDeps, ctx: RequestContext, p: Pick<PayslipRecord, "staffId" | "status">, caps: ReadCaps): Promise<Result<true, AppError>> {
  if (caps.readAll) return ok(true);
  if (caps.readOwn) {
    const own = await ownStaffId(deps, ctx);
    if (!own.ok) return own;
    if (own.value === p.staffId && OWN_VISIBLE_STATUSES.includes(p.status)) return ok(true);
  }
  return err(new ForbiddenError("Ce bulletin n'est accessible qu'à son titulaire et à la gestion.", { code: PayrollCodes.forbidden }));
}

export interface PayslipDetail {
  readonly payslip: PayslipRecord;
  readonly staffName: string;
  readonly lines: readonly PayslipLineRecord[];
  readonly adjustments: readonly AdjustmentRecord[];
  readonly events: readonly PayslipEventRecord[];
}

export async function getPayslipDetail(deps: PayrollDeps, ctx: RequestContext, input: { payslipId: Uuid; caps: ReadCaps }): Promise<Result<PayslipDetail, AppError>> {
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const p = await repo.getPayslip(tx, input.payslipId);
      return p ? ok(p) : err(notFound("Bulletin de paie", input.payslipId));
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const allowed = await authorizeRead(deps, ctx, loaded.value, input.caps);
  if (!allowed.ok) return allowed;
  const p = loaded.value;
  const infos = await staffInfoMap(deps, ctx, [p.staffId]);
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok({
        payslip: p,
        staffName: infos.get(p.staffId)?.displayName ?? fallbackStaffName(p.staffId),
        lines: await repo.listLines(tx, p.id, p.currency),
        adjustments: await repo.listAdjustments(tx, p.id, p.currency),
        // le journal complet n'est montré qu'à la gestion
        events: input.caps.readAll ? await repo.listEvents(tx, p.id) : [],
      }),
    { readOnly: true },
  );
}

export interface PayslipDocument {
  /** `true` : snapshot figé à l'arrêt du montant ; `false` : brouillon calculé (non opposable). */
  readonly final: boolean;
  /** Filigrane « NON VERSÉ » tant que le bulletin n'est pas payé (Q-29). */
  readonly watermark: "NON VERSÉ" | null;
  readonly status: PayslipStatus;
  readonly snapshotHash: string | null;
  /** L'empreinte stockée correspond au snapshot lu (intégrité). */
  readonly intact: boolean | null;
  readonly document: PayslipSnapshot;
  readonly payment: { paidAt: string; paidByName: string; method: string; reference: string | null } | null;
}

/**
 * Données du bulletin pour le rendu (013 / worker) : le SNAPSHOT figé à l'arrêt du montant — le rendu ne recalcule
 * rien. Avant l'arrêt (gestion seulement), un brouillon construit à partir des lignes courantes, marqué `final: false`.
 */
export async function getPayslipData(deps: PayrollDeps, ctx: RequestContext, input: { payslipId: Uuid; caps: ReadCaps }): Promise<Result<PayslipDocument, AppError>> {
  const detail = await getPayslipDetail(deps, ctx, input);
  if (!detail.ok) return detail;
  const { payslip: p } = detail.value;
  const infos = await staffInfoMap(deps, ctx, [p.staffId]);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const watermark = p.status === "PAID" ? null : ("NON VERSÉ" as const);
      const payment = p.status === "PAID" && p.paidAt && p.paidByName && p.paymentMethod ? { paidAt: p.paidAt.toISOString(), paidByName: p.paidByName, method: p.paymentMethod, reference: p.paymentReference } : null;
      const stored = await repo.getSnapshot(tx, p.id);
      if (stored) {
        const doc = stored.snapshot as PayslipSnapshot;
        return ok<PayslipDocument>({ final: true, watermark, status: p.status, snapshotHash: stored.hash, intact: stored.hash === snapshotHash(doc), document: doc, payment });
      }
      const period = await setup.getPeriod(tx, p.periodId);
      if (!period) return err(notFound("Période de paie", p.periodId));
      const draft = buildSnapshot({ payslip: p, period, lines: detail.value.lines, adjustments: detail.value.adjustments, staff: infos.get(p.staffId), approvedAt: p.calculatedAt, approvedByName: "—" });
      return ok<PayslipDocument>({ final: false, watermark, status: p.status, snapshotHash: null, intact: null, document: draft, payment });
    },
    { readOnly: true },
  );
}

export interface PayslipListItem {
  readonly payslip: PayslipRecord;
  readonly staffName: string;
}

export interface PayslipFilterInput {
  periodId?: Uuid | undefined;
  staffId?: Uuid | undefined;
  statuses?: readonly PayslipStatus[] | undefined;
  academicYearId?: Uuid | undefined;
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

async function listWithNames(deps: PayrollDeps, ctx: RequestContext, filter: repo.PayslipFilter): Promise<Result<{ items: PayslipListItem[]; total: number }, AppError>> {
  const page = await inTx(deps, ctx, async (tx) => ok(await repo.listPayslips(tx, filter)), { readOnly: true });
  if (!page.ok) return page;
  const infos = await staffInfoMap(deps, ctx, page.value.items.map((p) => p.staffId));
  return ok({ items: page.value.items.map((payslip) => ({ payslip, staffName: infos.get(payslip.staffId)?.displayName ?? fallbackStaffName(payslip.staffId) })), total: page.value.total });
}

/** Liste de la gestion (tous les bulletins). */
export async function listPayslips(deps: PayrollDeps, ctx: RequestContext, f: PayslipFilterInput): Promise<Result<{ items: PayslipListItem[]; total: number }, AppError>> {
  return listWithNames(deps, ctx, { ...f, limit: f.limit ?? 50, offset: f.offset ?? 0 });
}

/** Historique : bulletins ARRÊTÉS (approuvés, contestés, payés), le plus récent d'abord ; statut « Impayé » tant que non versé. */
export async function listHistory(deps: PayrollDeps, ctx: RequestContext, f: PayslipFilterInput): Promise<Result<{ items: PayslipListItem[]; total: number }, AppError>> {
  return listWithNames(deps, ctx, { ...f, stopped: true, order: "approved", limit: f.limit ?? 50, offset: f.offset ?? 0 });
}

/** Espace enseignant : MES bulletins (identité dérivée du compte, aucun paramètre `teacherId`). */
export async function listMyPayslips(deps: PayrollDeps, ctx: RequestContext, f: { limit?: number | undefined; offset?: number | undefined }): Promise<Result<{ items: PayslipListItem[]; total: number }, AppError>> {
  const own = await ownStaffId(deps, ctx);
  if (!own.ok) return own;
  return listWithNames(deps, ctx, { staffId: own.value, statuses: OWN_VISIBLE_STATUSES, order: "period", limit: f.limit ?? 50, offset: f.offset ?? 0 });
}

// ---------------------------------------------------------------------------
// Comptes rendus
// ---------------------------------------------------------------------------

export async function getRun(deps: PayrollDeps, ctx: RequestContext, runId: Uuid): Promise<Result<{ run: CalculationRunRecord; items: CalculationRunItemRecord[] }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const run = await repo.getRun(tx, runId);
      if (!run) return err(notFound("Compte rendu de calcul", runId));
      const settings = await setup.getSettings(tx);
      return ok({ run, items: await repo.listRunItems(tx, runId, settings?.currency ?? "XOF") });
    },
    { readOnly: true },
  );
}

export async function listRuns(deps: PayrollDeps, ctx: RequestContext, input: { periodId: Uuid; limit?: number | undefined }): Promise<Result<CalculationRunRecord[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listRuns(tx, input.periodId, input.limit ?? 20)), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Rapports
// ---------------------------------------------------------------------------

export type SourceFilter = HourSourceKind | "ALL";

export interface SummaryRow {
  readonly status: PayslipStatus;
  readonly payslips: number;
  readonly total: Money;
  readonly attendance: Money;
  readonly session: Money;
  readonly outOfHours: Money;
  /** Montant selon le filtre d'origine (T18) : `ALL` = total ; `SESSION`/`ATTENDANCE` = le poste correspondant. */
  readonly filtered: Money;
}

const pick = (row: { total: Money; attendance: Money; session: Money }, source: SourceFilter): Money => (source === "ALL" ? row.total : source === "SESSION" ? row.session : row.attendance);

/** Ventilation à trois postes par statut : Σ présences + Σ séances + hors-heures = total (invariant T18). */
export async function reportSummary(deps: PayrollDeps, ctx: RequestContext, f: reports.BreakdownFilter & { source?: SourceFilter | undefined }): Promise<Result<{ rows: SummaryRow[]; sources: reports.SourceTotals[]; filteredTotal: Money }, AppError>> {
  const source = f.source ?? "ALL";
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await setup.getSettings(tx);
      const currency = settings?.currency ?? "XOF";
      const rows = (await reports.breakdownByStatus(tx, f, currency)).map((r) => ({ ...r, filtered: pick(r, source) }));
      const sources = await reports.totalsBySource(tx, { ...f, statuses: ["CALCULATED", "APPROVED", "PAID"] }, currency);
      const counted = rows.filter((r) => r.status !== "CANCELLED" && r.status !== "DISPUTED");
      return ok({ rows, sources, filteredTotal: Money.sum(counted.map((r) => r.filtered), currency) });
    },
    { readOnly: true },
  );
}

export interface OwnerMassPeriod {
  readonly periodId: Uuid;
  readonly periodName: string;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly academicYearId: Uuid;
  readonly byStatus: Partial<Record<PayslipStatus, { payslips: number; total: Money }>>;
  /** Total compté : calculés + arrêtés (« impayés ») + payés. Annulés et contestés en sont EXCLUS mais montrés à part. */
  readonly counted: { payslips: number; total: Money };
  readonly apart: { cancelled: { payslips: number; total: Money }; disputed: { payslips: number; total: Money } };
}

/** Masse salariale par période et statut (vue du propriétaire, AC7.1). */
export async function ownerMass(deps: PayrollDeps, ctx: RequestContext, f: { academicYearId?: Uuid | undefined; periodId?: Uuid | undefined }): Promise<Result<{ periods: OwnerMassPeriod[]; counted: { payslips: number; total: Money } }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await setup.getSettings(tx);
      const currency = settings?.currency ?? "XOF";
      const rows = await reports.massByPeriodStatus(tx, f, currency);
      const periods = new Map<Uuid, OwnerMassPeriod & { byStatus: Partial<Record<PayslipStatus, { payslips: number; total: Money }>> }>();
      const zero = Money.zero(currency);
      for (const r of rows) {
        let p = periods.get(r.periodId);
        if (!p) {
          p = { periodId: r.periodId, periodName: r.periodName, startDate: r.startDate, endDate: r.endDate, academicYearId: r.academicYearId, byStatus: {}, counted: { payslips: 0, total: zero }, apart: { cancelled: { payslips: 0, total: zero }, disputed: { payslips: 0, total: zero } } };
          periods.set(r.periodId, p);
        }
        p.byStatus[r.status] = { payslips: r.payslips, total: r.total };
      }
      const out: OwnerMassPeriod[] = [];
      let countedPayslips = 0;
      let countedTotal = zero;
      for (const p of periods.values()) {
        let payslips = 0;
        let total = zero;
        for (const s of ["CALCULATED", "APPROVED", "PAID"] as const) {
          const v = p.byStatus[s];
          if (v) {
            payslips += v.payslips;
            total = total.add(v.total);
          }
        }
        countedPayslips += payslips;
        countedTotal = countedTotal.add(total);
        out.push({ ...p, counted: { payslips, total }, apart: { cancelled: p.byStatus.CANCELLED ?? { payslips: 0, total: zero }, disputed: p.byStatus.DISPUTED ?? { payslips: 0, total: zero } } });
      }
      return ok({ periods: out, counted: { payslips: countedPayslips, total: countedTotal } });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Export CSV (audité : les salaires sont des données sensibles)
// ---------------------------------------------------------------------------

const CSV_MAX_ROWS = 20_000;
const FORMULA_CHARS = /^[=+\-@\t\r]/;

/** Cellule CSV : guillemets doublés ; neutralise l'injection de formule (=, +, -, @) des tableurs. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && FORMULA_CHARS.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface ExportInput extends reports.BreakdownFilter {
  source?: SourceFilter | undefined;
  stopped?: boolean | undefined;
  statuses?: readonly PayslipStatus[] | undefined;
}

export async function exportPayslipsCsv(deps: PayrollDeps, ctx: RequestContext, input: ExportInput): Promise<Result<{ csv: string; rows: number; filename: string }, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const source = input.source ?? "ALL";
  const rows = await inTx(deps, ctx, async (tx) => {
    const settings = await setup.getSettings(tx);
    return ok(await reports.exportRows(tx, { ...input, limit: CSV_MAX_ROWS + 1 }, settings?.currency ?? "XOF"));
  }, { readOnly: true });
  if (!rows.ok) return rows;
  if (rows.value.length > CSV_MAX_ROWS) return err(new ForbiddenError(`L'export dépasse ${CSV_MAX_ROWS} lignes : affinez les filtres.`, { code: PayrollCodes.invalidInput }));
  const infos = await staffInfoMap(deps, ctx, rows.value.map((r) => r.staffId));
  // Filtre d'origine : appliqué à l'affichage, aux totaux et à l'export (AC10.1).
  const kept = rows.value.filter((r) => source === "ALL" || pick(r, source).amount > 0);
  const header = ["Période", "Début", "Fin", "Matricule", "Enseignant", "Statut", "Salaire", "Heures normales", "Heures supplémentaires", "Primes", "Retenues", "Montant présences", "Montant séances", "Hors heures", "Total", "Devise", "Arrêté le", "Arrêté par", "Versé le", "Versé par", "Mode de versement", "Référence"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of kept) {
    const info = infos.get(r.staffId);
    const total = source === "ALL" ? r.total : pick(r, source);
    lines.push(
      [
        r.periodName, r.startDate, r.endDate, info?.matricule ?? "", info?.displayName ?? fallbackStaffName(r.staffId),
        r.status === "APPROVED" ? "Impayé" : r.status, r.salary.amount, r.regularHours.amount, r.overtime.amount, r.bonus.amount, r.deduction.amount,
        r.attendance.amount, r.session.amount, r.outOfHours.amount, total.amount, r.currency,
        r.approvedAt ? r.approvedAt.toISOString() : "", r.approvedByName ?? "", r.paidAt ? r.paidAt.toISOString() : "", r.paidByName ?? "", r.paymentMethod ?? "", r.paymentReference ?? "",
      ]
        .map((v) => csvCell(v as string | number))
        .join(","),
    );
  }
  const csv = `﻿${lines.join("\r\n")}\r\n`;
  // L'export est audité (qui, quel périmètre, combien de lignes) — jamais le contenu.
  const audited = await inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    buf.audit({ action: "payroll.export.generated", resourceType: "payroll_export", resourceId: deps.newId(), sensitive: true, metadata: { rows: kept.length, source, periodId: input.periodId ?? null, staffId: input.staffId ?? null, stopped: input.stopped ?? false } });
    await buf.flush(tx);
    return ok(true);
  });
  if (!audited.ok) return audited;
  return ok({ csv, rows: kept.length, filename: `bulletins-${input.periodId ?? "tous"}.csv` });
}
