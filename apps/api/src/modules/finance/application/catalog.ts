/**
 * Cas d'usage du catalogue : frais, barèmes, plans d'échéancier, remises, financement
 * des apprenants, bourses.
 */
import { err, ok, type AppError, type Money, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { validateDiscountDraft, type Discount, type DiscountDraft } from "../domain/discount";
import { FinanceCode, conflict, notFound, validation } from "../domain/errors";
import { validateFeeDraft, type Fee, type FeeDraft } from "../domain/fee";
import {
  resolveFeeSchedule,
  validateFeeScheduleDraft,
  type FeeQuery,
  type FeeSchedule,
  type FeeScope,
} from "../domain/fee-schedule";
import { validateFundingType, type LearnerAccount } from "../domain/funding";
import { assertIsoDate } from "../domain/dates";
import { validatePlanSteps, type InstallmentPlan, type PlanStep } from "../domain/installments";
import { validateScholarshipDraft, type Scholarship, type ScholarshipDraft } from "../domain/scholarship";
import type { FeeCategory, IsoDate, ScholarshipStatus, Uuid } from "../domain/types";
import { SCHOLARSHIP_STATUSES } from "../domain/types";
import {
  deactivateFeeSchedule,
  getFee,
  getFeeByCode,
  getLearnerAccount,
  insertDiscount,
  insertFee,
  insertFeeSchedule,
  insertPlan,
  insertScholarship,
  listDiscounts,
  listFeeSchedules,
  listFees,
  listPlans,
  listScholarships,
  setFeeActive,
  setScholarshipStatus,
  upsertLearnerAccount,
  getPlan,
} from "../infrastructure/catalog-repository";
import { audit, inTx, insertOrConflict, type FinanceDeps } from "./deps";

// --- Frais -------------------------------------------------------------------

export async function createFee(deps: FinanceDeps, ctx: RequestContext, input: FeeDraft): Promise<Result<Fee, AppError>> {
  const draft = validateFeeDraft({ currency: deps.config.defaultCurrency, ...input });
  if (!draft.ok) return draft;
  return inTx(deps, ctx, async (tx) => {
    if (await getFeeByCode(tx, draft.value.code)) {
      return err(conflict(FinanceCode.INVALID_INPUT, `Le code de frais "${draft.value.code}" existe déjà.`, { code: draft.value.code }));
    }
    const inserted = await insertOrConflict(
      tx,
      (sp) => insertFee(sp, ctx.tenantId, { id: deps.newId(), ...draft.value }),
      () => conflict(FinanceCode.INVALID_INPUT, `Le code de frais "${draft.value.code}" existe déjà.`, { code: draft.value.code }),
    );
    if (!inserted.ok) return inserted;
    const fee = inserted.value;
    await audit(deps, tx, ctx, { action: "finance.fee.created", resourceType: "fee", resourceId: fee.id, after: fee });
    return ok(fee);
  });
}

export async function listFeeCatalog(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: { activeOnly?: boolean; category?: FeeCategory } = {},
): Promise<Result<Fee[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listFees(tx, filter)), { readOnly: true });
}

export async function setFeeStatus(deps: FinanceDeps, ctx: RequestContext, input: { feeId: Uuid; active: boolean }): Promise<Result<Fee, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const fee = await getFee(tx, input.feeId);
    if (!fee) return err(notFound(FinanceCode.NOT_FOUND, "Frais", input.feeId));
    await setFeeActive(tx, input.feeId, input.active);
    await audit(deps, tx, ctx, {
      action: input.active ? "finance.fee.activated" : "finance.fee.deactivated",
      resourceType: "fee",
      resourceId: input.feeId,
    });
    return ok({ ...fee, active: input.active });
  });
}

// --- Barèmes -----------------------------------------------------------------

export interface CreateFeeScheduleInput {
  feeId: Uuid;
  academicYear: string;
  scope?: Partial<FeeScope>;
  amount: Money;
  effectiveFrom: IsoDate;
  effectiveTo?: IsoDate | null;
  planId?: Uuid | null;
}

export async function createFeeSchedule(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: CreateFeeScheduleInput,
): Promise<Result<FeeSchedule, AppError>> {
  try {
    assertIsoDate(input.effectiveFrom, "effectiveFrom");
    if (input.effectiveTo) assertIsoDate(input.effectiveTo, "effectiveTo");
  } catch {
    return err(validation(FinanceCode.INVALID_INPUT, "Date d'effet invalide.", "effectiveFrom"));
  }
  return inTx(deps, ctx, async (tx) => {
    // Verrou du frais : deux créations concurrentes de barèmes ne peuvent pas se chevaucher.
    const fee = await getFee(tx, input.feeId, { forUpdate: true });
    if (!fee) return err(notFound(FinanceCode.NOT_FOUND, "Frais", input.feeId));
    if (input.amount.currency !== fee.currency) {
      return err(validation(FinanceCode.CURRENCY_MISMATCH, "La devise du barème diffère de celle du frais.", "amount"));
    }
    if (input.planId) {
      const plan = await getPlan(tx, input.planId);
      if (!plan) return err(notFound(FinanceCode.NOT_FOUND, "Plan d'échéancier", input.planId));
    }
    const existing = await listFeeSchedules(tx, { feeId: input.feeId, academicYear: input.academicYear.trim(), activeOnly: true });
    const draft = validateFeeScheduleDraft(input, existing);
    if (!draft.ok) return draft;
    const schedule = await insertFeeSchedule(tx, ctx.tenantId, { id: deps.newId(), ...draft.value });
    await audit(deps, tx, ctx, { action: "finance.fee_schedule.created", resourceType: "fee_schedule", resourceId: schedule.id, after: schedule });
    return ok(schedule);
  });
}

export async function listSchedules(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: { feeId?: Uuid; academicYear?: string; activeOnly?: boolean } = {},
): Promise<Result<FeeSchedule[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listFeeSchedules(tx, filter)), { readOnly: true });
}

export async function deactivateSchedule(deps: FinanceDeps, ctx: RequestContext, scheduleId: Uuid): Promise<Result<true, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const all = await listFeeSchedules(tx, {});
    if (!all.some((s) => s.id === scheduleId)) return err(notFound(FinanceCode.NOT_FOUND, "Barème", scheduleId));
    await deactivateFeeSchedule(tx, scheduleId);
    await audit(deps, tx, ctx, { action: "finance.fee_schedule.deactivated", resourceType: "fee_schedule", resourceId: scheduleId });
    return ok(true as const);
  });
}

/** Montant applicable d'un frais pour un périmètre et une date (sans rien écrire). */
export async function resolveFeeAmount(
  deps: FinanceDeps,
  ctx: RequestContext,
  query: FeeQuery,
): Promise<Result<FeeSchedule, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => resolveFeeSchedule(await listFeeSchedules(tx, { feeId: query.feeId, academicYear: query.academicYear, activeOnly: true }), query),
    { readOnly: true },
  );
}

// --- Plans d'échéancier ------------------------------------------------------

export interface CreateInstallmentPlanInput {
  code: string;
  name: string;
  currency?: InstallmentPlan["currency"];
  steps: PlanStep[];
}

export async function createInstallmentPlan(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: CreateInstallmentPlanInput,
): Promise<Result<InstallmentPlan, AppError>> {
  const code = (input.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) return err(validation(FinanceCode.INVALID_INPUT, "Code de plan invalide.", "code"));
  const name = (input.name ?? "").trim();
  if (!name) return err(validation(FinanceCode.INVALID_INPUT, "Libellé du plan requis.", "name"));
  const currency = input.currency ?? deps.config.defaultCurrency;
  const steps = validatePlanSteps(input.steps, currency);
  if (!steps.ok) return steps;
  return inTx(deps, ctx, async (tx) => {
    const inserted = await insertOrConflict(
      tx,
      (sp) => insertPlan(sp, ctx.tenantId, { id: deps.newId(), code, name, currency, steps: steps.value }),
      () => conflict(FinanceCode.INVALID_INPUT, `Le code de plan "${code}" existe déjà.`, { code }),
    );
    if (!inserted.ok) return inserted;
    const plan = inserted.value;
    await audit(deps, tx, ctx, { action: "finance.installment_plan.created", resourceType: "installment_plan", resourceId: plan.id });
    return ok(plan);
  });
}

export async function listInstallmentPlans(deps: FinanceDeps, ctx: RequestContext): Promise<Result<InstallmentPlan[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listPlans(tx)), { readOnly: true });
}

// --- Remises -----------------------------------------------------------------

export async function createDiscount(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: DiscountDraft,
): Promise<Result<Discount, AppError>> {
  const draft = validateDiscountDraft(input);
  if (!draft.ok) return draft;
  const currency = draft.value.amount?.currency ?? draft.value.capAmount?.currency ?? deps.config.defaultCurrency;
  return inTx(deps, ctx, async (tx) => {
    const inserted = await insertOrConflict(
      tx,
      (sp) => insertDiscount(sp, ctx.tenantId, { id: deps.newId(), ...draft.value }, currency),
      () => conflict(FinanceCode.INVALID_INPUT, `Le code de remise "${draft.value.code}" existe déjà.`, { code: draft.value.code }),
    );
    if (!inserted.ok) return inserted;
    const d = inserted.value;
    await audit(deps, tx, ctx, { action: "finance.discount.created", resourceType: "discount", resourceId: d.id });
    return ok(d);
  });
}

export async function listDiscountCatalog(deps: FinanceDeps, ctx: RequestContext): Promise<Result<Discount[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listDiscounts(tx)), { readOnly: true });
}

// --- Financement des apprenants ----------------------------------------------

export async function setLearnerFunding(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { learnerId: Uuid; fundingType: string; assignmentRef?: string | null },
): Promise<Result<LearnerAccount, AppError>> {
  const fundingType = validateFundingType(input.fundingType);
  if (!fundingType.ok) return fundingType;
  const learner = await deps.learners.getLearner(ctx, input.learnerId);
  if (!learner) return err(notFound(FinanceCode.LEARNER_NOT_FOUND, "Apprenant", input.learnerId));
  return inTx(deps, ctx, async (tx) => {
    const before = await getLearnerAccount(tx, input.learnerId);
    const account = await upsertLearnerAccount(tx, ctx.tenantId, deps.newId(), {
      learnerId: input.learnerId,
      fundingType: fundingType.value,
      assignmentRef: input.assignmentRef?.trim() || null,
    });
    await audit(deps, tx, ctx, {
      action: "finance.learner_account.funding_changed",
      resourceType: "learner_account",
      resourceId: input.learnerId,
      before,
      after: account,
    });
    return ok(account);
  });
}

export async function getLearnerFunding(
  deps: FinanceDeps,
  ctx: RequestContext,
  learnerId: Uuid,
): Promise<Result<{ account: LearnerAccount; scholarships: Scholarship[] }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const account = (await getLearnerAccount(tx, learnerId)) ?? { learnerId, fundingType: "PRIVATE" as const, assignmentRef: null };
      return ok({ account, scholarships: await listScholarships(tx, { learnerId }) });
    },
    { readOnly: true },
  );
}

export async function createScholarship(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: ScholarshipDraft,
): Promise<Result<Scholarship, AppError>> {
  const draft = validateScholarshipDraft(input);
  if (!draft.ok) return draft;
  const learner = await deps.learners.getLearner(ctx, input.learnerId);
  if (!learner) return err(notFound(FinanceCode.LEARNER_NOT_FOUND, "Apprenant", input.learnerId));
  const currency =
    (draft.value.coverage.kind === "FIXED" ? draft.value.coverage.amount.currency : undefined) ??
    draft.value.capAmount?.currency ??
    deps.config.defaultCurrency;
  return inTx(deps, ctx, async (tx) => {
    const s = await insertScholarship(tx, ctx.tenantId, { id: deps.newId(), ...draft.value }, currency);
    await audit(deps, tx, ctx, { action: "finance.scholarship.created", resourceType: "scholarship", resourceId: s.id, after: s, sensitive: true });
    return ok(s);
  });
}

export async function changeScholarshipStatus(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { scholarshipId: Uuid; status: ScholarshipStatus },
): Promise<Result<true, AppError>> {
  if (!(SCHOLARSHIP_STATUSES as readonly string[]).includes(input.status)) {
    return err(validation(FinanceCode.INVALID_INPUT, "Statut de bourse inconnu.", "status"));
  }
  return inTx(deps, ctx, async (tx) => {
    const changed = await setScholarshipStatus(tx, input.scholarshipId, input.status);
    if (!changed) return err(notFound(FinanceCode.NOT_FOUND, "Bourse", input.scholarshipId));
    await audit(deps, tx, ctx, {
      action: "finance.scholarship.status_changed",
      resourceType: "scholarship",
      resourceId: input.scholarshipId,
      after: { status: input.status },
      sensitive: true,
    });
    return ok(true as const);
  });
}
