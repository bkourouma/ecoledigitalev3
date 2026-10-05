/**
 * Accès SQL au catalogue : frais, barèmes, plans d'échéancier, remises, comptes
 * d'apprenants, bourses. Toutes les fonctions reçoivent le `Tx` d'un `TenantDb.run` :
 * la RLS (`app.tenant_id`) isole les tenants ; `tenant_id` est néanmoins renseigné
 * explicitement à l'insertion (colonne NOT NULL, policy WITH CHECK).
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { Discount } from "../domain/discount";
import type { Fee } from "../domain/fee";
import type { FeeSchedule } from "../domain/fee-schedule";
import type { LearnerAccount } from "../domain/funding";
import type { InstallmentPlan, PlanStep } from "../domain/installments";
import type { Scholarship } from "../domain/scholarship";
import type { FeeCategory, FundingType, FunderKind, ScholarshipStatus, ShareBasis } from "../domain/types";
import { money, moneyOrNull } from "./rows";

// --- Frais -------------------------------------------------------------------

const FEE_COLS = "id, code, name, category, description, currency, active";

const feeOf = (r: any): Fee => ({
  id: r.id,
  code: r.code,
  name: r.name,
  category: r.category,
  description: r.description,
  currency: r.currency,
  active: r.active,
});

export async function insertFee(tx: Tx, tenantId: string, fee: Omit<Fee, "active">): Promise<Fee> {
  const row = await tx.queryOne(
    `INSERT INTO finance.fees (id, tenant_id, code, name, category, description, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${FEE_COLS}`,
    [fee.id, tenantId, fee.code, fee.name, fee.category, fee.description, fee.currency],
  );
  return feeOf(row);
}

export async function getFee(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<Fee | null> {
  const row = await tx.queryOne(`SELECT ${FEE_COLS} FROM finance.fees WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return row ? feeOf(row) : null;
}

export async function getFeeByCode(tx: Tx, code: string): Promise<Fee | null> {
  const row = await tx.queryOne(`SELECT ${FEE_COLS} FROM finance.fees WHERE code = $1`, [code]);
  return row ? feeOf(row) : null;
}

export async function listFees(tx: Tx, options: { activeOnly?: boolean; category?: FeeCategory } = {}): Promise<Fee[]> {
  const rows = await tx.many(
    `SELECT ${FEE_COLS} FROM finance.fees
      WHERE ($1::boolean IS NOT TRUE OR active) AND ($2::text IS NULL OR category = $2)
      ORDER BY category, code`,
    [options.activeOnly ?? false, options.category ?? null],
  );
  return rows.map(feeOf);
}

export async function setFeeActive(tx: Tx, id: string, active: boolean): Promise<void> {
  await tx.query("UPDATE finance.fees SET active = $2, updated_at = now() WHERE id = $1", [id, active]);
}

// --- Barèmes -----------------------------------------------------------------

const SCHEDULE_COLS = `id, fee_id, academic_year, institution_id, campus_id, level_key, track_key, learner_type,
  amount::text AS amount, currency, effective_from::text AS effective_from, effective_to::text AS effective_to,
  plan_id, active`;

const scheduleOf = (r: any): FeeSchedule => ({
  id: r.id,
  feeId: r.fee_id,
  academicYear: r.academic_year,
  scope: {
    institutionId: r.institution_id,
    campusId: r.campus_id,
    levelKey: r.level_key,
    trackKey: r.track_key,
    learnerType: r.learner_type,
  },
  amount: money(r.amount, r.currency),
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  planId: r.plan_id,
  active: r.active,
});

export async function insertFeeSchedule(
  tx: Tx,
  tenantId: string,
  s: Omit<FeeSchedule, "active">,
): Promise<FeeSchedule> {
  const row = await tx.queryOne(
    `INSERT INTO finance.fee_schedules
       (id, tenant_id, fee_id, academic_year, institution_id, campus_id, level_key, track_key, learner_type,
        amount, currency, effective_from, effective_to, plan_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${SCHEDULE_COLS}`,
    [
      s.id,
      tenantId,
      s.feeId,
      s.academicYear,
      s.scope.institutionId,
      s.scope.campusId,
      s.scope.levelKey,
      s.scope.trackKey,
      s.scope.learnerType,
      s.amount.amount,
      s.amount.currency,
      s.effectiveFrom,
      s.effectiveTo,
      s.planId,
    ],
  );
  return scheduleOf(row);
}

export async function listFeeSchedules(
  tx: Tx,
  filter: { feeId?: string; academicYear?: string; activeOnly?: boolean } = {},
): Promise<FeeSchedule[]> {
  const rows = await tx.many(
    `SELECT ${SCHEDULE_COLS} FROM finance.fee_schedules
      WHERE ($1::uuid IS NULL OR fee_id = $1)
        AND ($2::text IS NULL OR academic_year = $2)
        AND ($3::boolean IS NOT TRUE OR active)
      ORDER BY academic_year, effective_from, id`,
    [filter.feeId ?? null, filter.academicYear ?? null, filter.activeOnly ?? false],
  );
  return rows.map(scheduleOf);
}

export async function deactivateFeeSchedule(tx: Tx, id: string): Promise<void> {
  await tx.query("UPDATE finance.fee_schedules SET active = false, updated_at = now() WHERE id = $1", [id]);
}

// --- Plans d'échéancier ------------------------------------------------------

type StepJson =
  | { label: string; kind: "FIXED"; amount: number; due: PlanStep["due"] }
  | { label: string; kind: "WEIGHT"; weight: number; due: PlanStep["due"] };

export function stepsToJson(steps: ReadonlyArray<PlanStep>): StepJson[] {
  return steps.map((s) =>
    s.share.kind === "FIXED"
      ? { label: s.label, kind: "FIXED", amount: s.share.amount.amount, due: s.due }
      : { label: s.label, kind: "WEIGHT", weight: s.share.weight, due: s.due },
  );
}

export function stepsFromJson(json: unknown, currency: CurrencyCode): PlanStep[] {
  const arr = (typeof json === "string" ? JSON.parse(json) : json) as StepJson[];
  return arr.map((s) => ({
    label: s.label,
    due: s.due,
    share: s.kind === "FIXED" ? { kind: "FIXED", amount: Money.of(s.amount, currency) } : { kind: "WEIGHT", weight: s.weight },
  }));
}

const planOf = (r: any): InstallmentPlan => ({
  id: r.id,
  code: r.code,
  name: r.name,
  currency: r.currency,
  steps: stepsFromJson(r.steps, r.currency),
  active: r.active,
});

export async function insertPlan(
  tx: Tx,
  tenantId: string,
  plan: Omit<InstallmentPlan, "active">,
): Promise<InstallmentPlan> {
  const row = await tx.queryOne(
    `INSERT INTO finance.installment_plans (id, tenant_id, code, name, currency, steps)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id, code, name, currency, steps, active`,
    [plan.id, tenantId, plan.code, plan.name, plan.currency, JSON.stringify(stepsToJson(plan.steps))],
  );
  return planOf(row);
}

export async function getPlan(tx: Tx, id: string): Promise<InstallmentPlan | null> {
  const row = await tx.queryOne("SELECT id, code, name, currency, steps, active FROM finance.installment_plans WHERE id = $1", [id]);
  return row ? planOf(row) : null;
}

export async function getPlanByCode(tx: Tx, code: string): Promise<InstallmentPlan | null> {
  const row = await tx.queryOne("SELECT id, code, name, currency, steps, active FROM finance.installment_plans WHERE code = $1", [code]);
  return row ? planOf(row) : null;
}

export async function listPlans(tx: Tx): Promise<InstallmentPlan[]> {
  const rows = await tx.many("SELECT id, code, name, currency, steps, active FROM finance.installment_plans ORDER BY code");
  return rows.map(planOf);
}

// --- Remises -----------------------------------------------------------------

const DISCOUNT_COLS = "id, code, name, kind, bps, amount::text AS amount, cap_amount::text AS cap_amount, currency, categories, stackable, active";

const discountOf = (r: any): Discount => ({
  id: r.id,
  code: r.code,
  name: r.name,
  kind: r.kind,
  bps: r.bps,
  amount: moneyOrNull(r.amount, r.currency),
  capAmount: moneyOrNull(r.cap_amount, r.currency),
  categories: r.categories,
  stackable: r.stackable,
  active: r.active,
});

export async function insertDiscount(
  tx: Tx,
  tenantId: string,
  d: Omit<Discount, "active">,
  currency: CurrencyCode,
): Promise<Discount> {
  const row = await tx.queryOne(
    `INSERT INTO finance.discounts (id, tenant_id, code, name, kind, bps, amount, cap_amount, currency, categories, stackable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${DISCOUNT_COLS}`,
    [
      d.id,
      tenantId,
      d.code,
      d.name,
      d.kind,
      d.bps,
      d.amount?.amount ?? null,
      d.capAmount?.amount ?? null,
      currency,
      d.categories ? [...d.categories] : null,
      d.stackable,
    ],
  );
  return discountOf(row);
}

export async function getDiscounts(tx: Tx, ids: readonly string[]): Promise<Discount[]> {
  if (ids.length === 0) return [];
  const rows = await tx.many(`SELECT ${DISCOUNT_COLS} FROM finance.discounts WHERE id = ANY($1::uuid[])`, [ids]);
  return rows.map(discountOf);
}

export async function listDiscounts(tx: Tx): Promise<Discount[]> {
  const rows = await tx.many(`SELECT ${DISCOUNT_COLS} FROM finance.discounts ORDER BY code`);
  return rows.map(discountOf);
}

// --- Comptes d'apprenants et bourses ----------------------------------------

const accountOf = (r: any): LearnerAccount => ({
  learnerId: r.learner_id,
  fundingType: r.funding_type as FundingType,
  assignmentRef: r.assignment_ref,
  additionalFundingTypes: (r.additional_funding_types ?? []) as FundingType[],
});

export async function getLearnerAccount(tx: Tx, learnerId: string): Promise<LearnerAccount | null> {
  const row = await tx.queryOne("SELECT learner_id, funding_type, assignment_ref, additional_funding_types FROM finance.learner_accounts WHERE learner_id = $1", [learnerId]);
  return row ? accountOf(row) : null;
}

export async function upsertLearnerAccount(
  tx: Tx,
  tenantId: string,
  id: string,
  account: LearnerAccount,
): Promise<LearnerAccount> {
  const row = await tx.queryOne(
    `INSERT INTO finance.learner_accounts (id, tenant_id, learner_id, funding_type, assignment_ref, additional_funding_types)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, learner_id)
     DO UPDATE SET funding_type = EXCLUDED.funding_type, assignment_ref = EXCLUDED.assignment_ref, additional_funding_types = EXCLUDED.additional_funding_types, updated_at = now()
     RETURNING learner_id, funding_type, assignment_ref, additional_funding_types`,
    [id, tenantId, account.learnerId, account.fundingType, account.assignmentRef, [...(account.additionalFundingTypes ?? [])]],
  );
  return accountOf(row);
}

const SCHOLARSHIP_COLS = `id, learner_id, academic_year, funder_kind, funder_name, reference, coverage_kind, coverage_bps,
  coverage_amount::text AS coverage_amount, cap_amount::text AS cap_amount, currency, categories, status, priority, share_basis`;

const scholarshipOf = (r: any): Scholarship => ({
  id: r.id,
  learnerId: r.learner_id,
  academicYear: r.academic_year,
  funderKind: r.funder_kind as FunderKind,
  funderName: r.funder_name,
  reference: r.reference,
  coverage:
    r.coverage_kind === "PERCENT"
      ? { kind: "PERCENT", bps: r.coverage_bps }
      : { kind: "FIXED", amount: money(r.coverage_amount, r.currency) },
  capAmount: moneyOrNull(r.cap_amount, r.currency),
  categories: r.categories as FeeCategory[] | null,
  status: r.status as ScholarshipStatus,
  priority: r.priority,
  shareBasis: r.share_basis as ShareBasis,
});

export async function insertScholarship(
  tx: Tx,
  tenantId: string,
  s: Omit<Scholarship, "status">,
  currency: CurrencyCode,
): Promise<Scholarship> {
  const row = await tx.queryOne(
    `INSERT INTO finance.scholarships
       (id, tenant_id, learner_id, academic_year, funder_kind, funder_name, reference, coverage_kind, coverage_bps,
        coverage_amount, cap_amount, currency, categories, priority, share_basis)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${SCHOLARSHIP_COLS}`,
    [
      s.id,
      tenantId,
      s.learnerId,
      s.academicYear,
      s.funderKind,
      s.funderName,
      s.reference,
      s.coverage.kind,
      s.coverage.kind === "PERCENT" ? s.coverage.bps : null,
      s.coverage.kind === "FIXED" ? s.coverage.amount.amount : null,
      s.capAmount?.amount ?? null,
      currency,
      s.categories ? [...s.categories] : null,
      s.priority,
      s.shareBasis ?? "REMAINING",
    ],
  );
  return scholarshipOf(row);
}

export async function listScholarships(
  tx: Tx,
  filter: { learnerId: string; academicYear?: string },
): Promise<Scholarship[]> {
  const rows = await tx.many(
    `SELECT ${SCHOLARSHIP_COLS} FROM finance.scholarships
      WHERE learner_id = $1 AND ($2::text IS NULL OR academic_year = $2)
      ORDER BY priority, id`,
    [filter.learnerId, filter.academicYear ?? null],
  );
  return rows.map(scholarshipOf);
}

export async function setScholarshipStatus(tx: Tx, id: string, status: ScholarshipStatus): Promise<boolean> {
  const res = await tx.query("UPDATE finance.scholarships SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
  return res.rowCount > 0;
}
