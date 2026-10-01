/** Rapports : ventilation à trois postes (T18), masse salariale par période et statut, lignes d'export. */
import type { Tx } from "@ecoledigitale/database";
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type { HourSourceKind, IsoDate, PayslipStatus, Uuid } from "../domain/types";
import type { Row } from "./rows";

export interface BreakdownFilter {
  periodId?: Uuid | undefined;
  academicYearId?: Uuid | undefined;
  staffId?: Uuid | undefined;
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
}

export interface BreakdownRow {
  readonly status: PayslipStatus;
  readonly payslips: number;
  readonly total: Money;
  readonly attendance: Money;
  readonly session: Money;
  readonly outOfHours: Money;
}

function where(f: BreakdownFilter, params: unknown[]): string {
  const clauses: string[] = [];
  const push = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.periodId) clauses.push(`b.period_id = ${push(f.periodId)}`);
  if (f.staffId) clauses.push(`b.staff_id = ${push(f.staffId)}`);
  if (f.academicYearId) clauses.push(`per.academic_year_id = ${push(f.academicYearId)}`);
  if (f.from) clauses.push(`per.end_date >= ${push(f.from)}::date`);
  if (f.to) clauses.push(`per.start_date <= ${push(f.to)}::date`);
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

/** Σ présences + Σ séances + hors-heures = total, pour chaque statut (invariant T18, prouvé par les tests). */
export async function breakdownByStatus(tx: Tx, f: BreakdownFilter, currency: CurrencyCode): Promise<BreakdownRow[]> {
  const params: unknown[] = [];
  const clause = where(f, params);
  const rows = await tx.many<Row>(
    `SELECT b.status, count(*)::int AS payslips, sum(b.total_amount)::text AS total, sum(b.attendance_amount)::text AS attendance,
            sum(b.session_amount)::text AS session, sum(b.out_of_hours_amount)::text AS out_of_hours
       FROM payroll.v_payslip_breakdown b JOIN payroll.pay_periods per ON per.id = b.period_id AND per.tenant_id = b.tenant_id
       ${clause} GROUP BY b.status ORDER BY b.status`,
    params,
  );
  return rows.map((r) => ({
    status: r.status,
    payslips: Number(r.payslips),
    total: Money.fromString(r.total, currency),
    attendance: Money.fromString(r.attendance, currency),
    session: Money.fromString(r.session, currency),
    outOfHours: Money.fromString(r.out_of_hours, currency),
  }));
}

export interface MassRow {
  readonly periodId: Uuid;
  readonly periodName: string;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly academicYearId: Uuid;
  readonly status: PayslipStatus;
  readonly payslips: number;
  readonly total: Money;
}

/** Masse salariale par période ET statut (les annulés et contestés sont montrés à part par l'appelant). */
export async function massByPeriodStatus(tx: Tx, f: { academicYearId?: Uuid | undefined; periodId?: Uuid | undefined }, currency: CurrencyCode): Promise<MassRow[]> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (f.academicYearId) {
    params.push(f.academicYearId);
    clauses.push(`per.academic_year_id = $${params.length}`);
  }
  if (f.periodId) {
    params.push(f.periodId);
    clauses.push(`per.id = $${params.length}`);
  }
  const rows = await tx.many<Row>(
    `SELECT per.id AS period_id, per.name, to_char(per.start_date, 'YYYY-MM-DD') AS start_date, to_char(per.end_date, 'YYYY-MM-DD') AS end_date, per.academic_year_id,
            p.status, count(*)::int AS payslips, sum(p.total_amount)::text AS total
       FROM payroll.payslips p JOIN payroll.pay_periods per ON per.id = p.period_id AND per.tenant_id = p.tenant_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      GROUP BY per.id, p.status ORDER BY per.start_date DESC, per.id, p.status`,
    params,
  );
  return rows.map((r) => ({
    periodId: r.period_id,
    periodName: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    academicYearId: r.academic_year_id,
    status: r.status,
    payslips: Number(r.payslips),
    total: Money.fromString(r.total, currency),
  }));
}

export interface SourceTotals {
  readonly kind: HourSourceKind;
  readonly minutes: number;
  readonly amount: Money;
}

/** Minutes et montants des lignes par origine, sur un périmètre (rapport par enseignant / période). */
export async function totalsBySource(tx: Tx, f: BreakdownFilter & { statuses?: readonly PayslipStatus[] | undefined }, currency: CurrencyCode): Promise<SourceTotals[]> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const push = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.periodId) clauses.push(`p.period_id = ${push(f.periodId)}`);
  if (f.staffId) clauses.push(`p.staff_id = ${push(f.staffId)}`);
  if (f.academicYearId) clauses.push(`per.academic_year_id = ${push(f.academicYearId)}`);
  if (f.statuses && f.statuses.length) clauses.push(`p.status = ANY(${push([...f.statuses])}::text[])`);
  const rows = await tx.many<Row>(
    `SELECT l.source_kind, sum(l.minutes)::int AS minutes, sum(l.amount)::text AS amount
       FROM payroll.payslip_lines l JOIN payroll.payslips p ON p.id = l.payslip_id AND p.tenant_id = l.tenant_id
       JOIN payroll.pay_periods per ON per.id = p.period_id AND per.tenant_id = p.tenant_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} GROUP BY l.source_kind ORDER BY l.source_kind`,
    params,
  );
  return rows.map((r) => ({ kind: r.source_kind, minutes: Number(r.minutes), amount: Money.fromString(r.amount, currency) }));
}

/** Nombre de bulletins annulés par enseignant (archivés) — vue d'ensemble / historique. */
export async function cancelledCountByStaff(tx: Tx, staffIds: readonly Uuid[]): Promise<Map<Uuid, number>> {
  if (staffIds.length === 0) return new Map();
  const rows = await tx.many<Row>("SELECT staff_id, count(*)::int AS n FROM payroll.payslips WHERE status = 'CANCELLED' AND staff_id = ANY($1::uuid[]) GROUP BY staff_id", [[...staffIds]]);
  return new Map(rows.map((r) => [r.staff_id as string, Number(r.n)]));
}

export interface ExportRow {
  readonly periodName: string;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly staffId: Uuid;
  readonly payslipId: Uuid;
  readonly status: PayslipStatus;
  readonly salary: Money;
  readonly regularHours: Money;
  readonly overtime: Money;
  readonly bonus: Money;
  readonly deduction: Money;
  readonly total: Money;
  readonly attendance: Money;
  readonly session: Money;
  readonly outOfHours: Money;
  readonly currency: string;
  readonly approvedAt: Date | null;
  readonly approvedByName: string | null;
  readonly paidAt: Date | null;
  readonly paidByName: string | null;
  readonly paymentMethod: string | null;
  readonly paymentReference: string | null;
}

export interface ExportFilter extends BreakdownFilter {
  statuses?: readonly PayslipStatus[] | undefined;
  stopped?: boolean | undefined;
  limit: number;
}

/** Lignes d'export : une par bulletin, avec la ventilation à trois postes (même source que les écrans). */
export async function exportRows(tx: Tx, f: ExportFilter, currency: CurrencyCode): Promise<ExportRow[]> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const push = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.periodId) clauses.push(`p.period_id = ${push(f.periodId)}`);
  if (f.staffId) clauses.push(`p.staff_id = ${push(f.staffId)}`);
  if (f.academicYearId) clauses.push(`per.academic_year_id = ${push(f.academicYearId)}`);
  if (f.from) clauses.push(`per.end_date >= ${push(f.from)}::date`);
  if (f.to) clauses.push(`per.start_date <= ${push(f.to)}::date`);
  if (f.statuses && f.statuses.length) clauses.push(`p.status = ANY(${push([...f.statuses])}::text[])`);
  if (f.stopped) clauses.push("p.status IN ('APPROVED', 'DISPUTED', 'PAID')");
  const rows = await tx.many<Row>(
    `SELECT per.name AS period_name, to_char(per.start_date, 'YYYY-MM-DD') AS start_date, to_char(per.end_date, 'YYYY-MM-DD') AS end_date,
            p.staff_id, p.id AS payslip_id, p.status, p.salary_amount::text AS salary, (p.base_amount - p.salary_amount)::text AS regular_hours,
            p.overtime_amount::text AS overtime, p.bonus_amount::text AS bonus, p.deduction_amount::text AS deduction, p.total_amount::text AS total,
            b.attendance_amount::text AS attendance, b.session_amount::text AS session, b.out_of_hours_amount::text AS out_of_hours, p.currency,
            p.approved_at, p.approved_by_name, p.paid_at, p.paid_by_name, p.payment_method, p.payment_reference
       FROM payroll.payslips p
       JOIN payroll.pay_periods per ON per.id = p.period_id AND per.tenant_id = p.tenant_id
       JOIN payroll.v_payslip_breakdown b ON b.payslip_id = p.id AND b.tenant_id = p.tenant_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY per.start_date DESC, p.staff_id, p.id LIMIT ${push(f.limit)}`,
    params,
  );
  const m = (s: string) => Money.fromString(s, currency);
  return rows.map((r) => ({
    periodName: r.period_name,
    startDate: r.start_date,
    endDate: r.end_date,
    staffId: r.staff_id,
    payslipId: r.payslip_id,
    status: r.status,
    salary: m(r.salary),
    regularHours: m(r.regular_hours),
    overtime: m(r.overtime),
    bonus: m(r.bonus),
    deduction: m(r.deduction),
    total: m(r.total),
    attendance: m(r.attendance),
    session: m(r.session),
    outOfHours: m(r.out_of_hours),
    currency: r.currency,
    approvedAt: r.approved_at ?? null,
    approvedByName: r.approved_by_name ?? null,
    paidAt: r.paid_at ?? null,
    paidByName: r.paid_by_name ?? null,
    paymentMethod: r.payment_method ?? null,
    paymentReference: r.payment_reference ?? null,
  }));
}
