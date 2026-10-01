/**
 * Cas d'usage de facturation : créer / prévisualiser / émettre une facture (depuis un
 * barème ou à la main), répartir part famille / part financeur, générer l'échéancier,
 * annuler, créditer (avoir), marquer les retards, consulter.
 *
 * Verrouillage : toute écriture sur une facture prend `FOR UPDATE` sur elle d'abord.
 * Numérotation : le numéro `FAC-aaaa-nnnnnn` est attribué à l'ÉMISSION, dans la
 * transaction, juste avant l'écriture finale (compteur sans trou, cf. migration 0500).
 */
import { createHash } from "node:crypto";
import {
  err,
  ok,
  Money,
  type AppError,
  type CurrencyCode,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { addDays } from "../domain/dates";
import { applyDiscounts, DEFAULT_DISCOUNT_POLICY, type Discount } from "../domain/discount";
import { FinanceCode, conflict, notFound, validation } from "../domain/errors";
import { FinanceEvents } from "../domain/events";
import { resolveFeeSchedule, type FeeQuery, type FeeSchedule, type FeeScope } from "../domain/fee-schedule";
import { checkFundingConsistency } from "../domain/funding";
import {
  distributeCredit,
  generateInstallments,
  singleInstallment,
  type GeneratedInstallment,
  type InstallmentPlan,
  type PlanStep,
} from "../domain/installments";
import {
  applyAdjustments,
  buildInvoiceLines,
  canCancelInvoice,
  canIssueInvoice,
  computeInvoiceTotals,
  type InvoiceLine,
  type InvoiceLineInput,
} from "../domain/invoice";
import { formatDocumentNumber, numberingYear } from "../domain/numbering";
import { idempotencyConflict, validateIdempotencyKey } from "../domain/payment";
import { validateCreditNote } from "../domain/credit-note";
import { validateReason } from "../domain/refund";
import type { CreditNoteRecord, InvoiceDetail, InvoiceRecord } from "../domain/records";
import { sumMoney } from "../domain/money-utils";
import type { EnrollmentRef } from "../domain/refs";
import { splitFunding, type Scholarship } from "../domain/scholarship";
import { summarizeReceivables } from "../domain/reporting";
import type { FeeCategory, FundingType, IsoDate, PayerKind, Uuid } from "../domain/types";
import {
  addInstallmentCumuls,
  addInvoiceCumuls,
  cancelInvoiceRow,
  deleteInstallments,
  findOverdueCandidates,
  getInstallments,
  getInvoice,
  getInvoiceByIdempotencyKey,
  getInvoiceDetail,
  insertInstallments,
  insertInvoiceDiscounts,
  insertInvoiceDraft,
  insertInvoiceLines,
  listInvoices,
  listInvoicesByGroup,
  lockInvoices,
  markInvoiceIssued,
  updateInvoiceDueDate,
  type InvoiceListFilter,
  type NewInvoice,
} from "../infrastructure/billing-repository";
import {
  getDiscounts,
  getFee,
  getFeeByCode,
  getLearnerAccount,
  getPlan,
  getPlanByCode,
  listFeeSchedules,
  listScholarships,
} from "../infrastructure/catalog-repository";
import { insertCreditNote, listPayments, nextSequence } from "../infrastructure/payments-repository";
import { refreshInvoiceStatus, todayOf } from "./billing-core";
import { EventBuffer, inTx, lockIdempotencyKey, moneyPayload, type FinanceDeps } from "./deps";

// ---------------------------------------------------------------------------
// Construction d'un plan de facturation (lecture seule) puis persistance
// ---------------------------------------------------------------------------

export interface InstallmentSpec {
  planId?: Uuid | null;
  planCode?: string | null;
  steps?: PlanStep[];
  /** Date de référence des échéances relatives (défaut : aujourd'hui). */
  baseDate?: IsoDate;
}

interface BuildSpec {
  learnerId: Uuid;
  enrollment: EnrollmentRef | null;
  academicYear: string;
  groupKey: string | null;
  groupLabel: string | null;
  institutionId: Uuid | null;
  campusId: Uuid | null;
  lines: InvoiceLineInput[];
  discountIds: Uuid[];
  applyFunding: boolean;
  ignoreFunding: boolean;
  dueDate: IsoDate | null;
  installments: InstallmentSpec | null;
  /** Plan proposé par les barèmes (utilisé si `installments` n'en désigne aucun). */
  schedulePlanId: Uuid | null;
  currency: CurrencyCode;
  idempotencyKey: string | null;
  fingerprint: string | null;
}

interface PlannedInvoice {
  header: NewInvoice;
  lines: InvoiceLine[];
  discounts: Array<{ id: Uuid; discountId: Uuid; amount: Money }>;
  installments: GeneratedInstallment[];
  label: string;
}

async function resolvePlanSteps(
  tx: Tx,
  spec: InstallmentSpec | null,
  fallbackPlanId: Uuid | null,
  currency: CurrencyCode,
): Promise<Result<PlanStep[] | null, AppError>> {
  if (spec?.steps) return ok(spec.steps);
  let plan: InstallmentPlan | null = null;
  if (spec?.planId) plan = await getPlan(tx, spec.planId);
  else if (spec?.planCode) plan = await getPlanByCode(tx, spec.planCode.trim().toUpperCase());
  else if (fallbackPlanId) plan = await getPlan(tx, fallbackPlanId);
  const requested = spec?.planId || spec?.planCode;
  if (requested && !plan) return err(notFound(FinanceCode.NOT_FOUND, "Plan d'échéancier", String(requested)));
  if (!plan) return ok(null);
  if (!plan.active) return err(conflict(FinanceCode.PLAN_INVALID, "Ce plan d'échéancier est désactivé.", { planId: plan.id }));
  if (plan.currency !== currency) return err(validation(FinanceCode.CURRENCY_MISMATCH, "Devise du plan différente de celle de la facture.", "planId"));
  return ok([...plan.steps]);
}

function installmentsFor(
  total: Money,
  steps: PlanStep[] | null,
  baseDate: IsoDate,
  dueDate: IsoDate,
): Result<GeneratedInstallment[], AppError> {
  if (!steps) return ok(singleInstallment(total, dueDate));
  return generateInstallments(total, steps, baseDate);
}

async function planInvoices(deps: FinanceDeps, ctx: RequestContext, tx: Tx, spec: BuildSpec): Promise<Result<PlannedInvoice[], AppError>> {
  const today = todayOf(deps);
  const lines = buildInvoiceLines(spec.lines, deps.newId, spec.currency);
  if (!lines.ok) return lines;

  // Remises (sur le brut, ventilées par ligne).
  const discounts = spec.discountIds.length > 0 ? await getDiscounts(tx, spec.discountIds) : [];
  if (discounts.length !== new Set(spec.discountIds).size) {
    return err(notFound(FinanceCode.NOT_FOUND, "Remise", spec.discountIds.join(",")));
  }
  const discountResult = applyDiscounts(
    lines.value.map((l) => ({ id: l.id, category: l.category, gross: l.gross })),
    discounts as Discount[],
    { ...DEFAULT_DISCOUNT_POLICY, maxTotalBps: deps.config.maxDiscountBps },
  );
  if (!discountResult.ok) return discountResult;
  const discountByLine = new Map(discountResult.value.perLine.map((p) => [p.lineId, p.amount]));

  // Financement : part des financeurs / part de la famille.
  let scholarships: Scholarship[] = [];
  let fundingType: FundingType | null = null;
  const account = await getLearnerAccount(tx, spec.learnerId);
  fundingType = account?.fundingType ?? "PRIVATE";
  if (spec.applyFunding) {
    scholarships = await listScholarships(tx, { learnerId: spec.learnerId, academicYear: spec.academicYear });
    if (!spec.ignoreFunding) {
      const consistent = checkFundingConsistency({ fundingType }, scholarships, spec.academicYear);
      if (!consistent.ok) return consistent;
    }
  }
  const split = splitFunding(
    lines.value.map((l) => ({ id: l.id, category: l.category, amount: l.gross.subtract(discountByLine.get(l.id) ?? Money.zero(spec.currency)) })),
    spec.applyFunding ? scholarships : [],
  );
  if (!split.ok) return split;
  const fundedByLine = new Map(split.value.fundedPerLine.map((p) => [p.lineId, p.amount]));

  const adjusted = applyAdjustments(lines.value, discountByLine, fundedByLine);
  if (!adjusted.ok) return adjusted;
  const totals = computeInvoiceTotals(adjusted.value, spec.currency);

  const steps = await resolvePlanSteps(tx, spec.installments, spec.schedulePlanId, spec.currency);
  if (!steps.ok) return steps;
  const baseDate = spec.installments?.baseDate ?? today;
  const fallbackDue = spec.dueDate ?? addDays(today, 30);

  const relatedGroupId = deps.newId();
  const common = {
    learnerId: spec.learnerId,
    enrollmentId: spec.enrollment?.enrollmentId ?? null,
    academicYear: spec.academicYear,
    groupKey: spec.groupKey,
    groupLabel: spec.groupLabel,
    institutionId: spec.institutionId,
    campusId: spec.campusId,
    fundingType,
    relatedGroupId,
    currency: spec.currency,
    createdBy: ctx.userId,
  };

  const planned: PlannedInvoice[] = [];

  if (totals.total.isPositive()) {
    const inst = installmentsFor(totals.total, steps.value, baseDate, fallbackDue);
    if (!inst.ok) return inst;
    const dueDate = spec.dueDate ?? inst.value[inst.value.length - 1]!.dueDate;
    planned.push({
      header: {
        id: deps.newId(),
        ...common,
        payerKind: "LEARNER",
        payerRef: null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        scholarship: totals.scholarship,
        total: totals.total,
        dueDate,
        idempotencyKey: null,
        requestFingerprint: null,
      },
      lines: adjusted.value,
      discounts: discountResult.value.applied.map((a) => ({ id: deps.newId(), discountId: a.discountId, amount: a.amount })),
      installments: inst.value,
      label: "famille",
    });
  }

  // Une facture par financeur (part État, entreprise…), lignes reprises de la ventilation.
  for (const share of split.value.shares) {
    const byId = new Map(adjusted.value.map((l) => [l.id, l]));
    const funderLines: InvoiceLineInput[] = share.perLine.map((p) => {
      const original = byId.get(p.lineId)!;
      return {
        feeId: original.feeId,
        category: original.category as FeeCategory,
        description: `${original.description} — prise en charge ${share.funderName}`.slice(0, 300),
        quantity: 1,
        unitAmount: p.amount,
      };
    });
    const built = buildInvoiceLines(funderLines, deps.newId, spec.currency);
    if (!built.ok) return built;
    const t = computeInvoiceTotals(built.value, spec.currency);
    const dueDate = spec.dueDate ?? planned[0]?.header.dueDate ?? fallbackDue;
    planned.push({
      header: {
        id: deps.newId(),
        ...common,
        payerKind: "FUNDER",
        payerRef: share.scholarshipId,
        subtotal: t.subtotal,
        discount: t.discount,
        scholarship: t.scholarship,
        total: t.total,
        dueDate,
        idempotencyKey: null,
        requestFingerprint: null,
      },
      lines: built.value,
      discounts: [],
      installments: singleInstallment(t.total, dueDate, `Prise en charge ${share.funderName}`),
      label: share.funderName,
    });
  }

  if (planned.length === 0) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Le total à facturer est nul : aucune facture à émettre.", "lines"));
  }
  // La clé d'idempotence est portée par la première facture du groupe.
  planned[0] = {
    ...planned[0]!,
    header: { ...planned[0]!.header, idempotencyKey: spec.idempotencyKey, requestFingerprint: spec.fingerprint },
  };
  return ok(planned);
}

async function persistInvoices(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  planned: PlannedInvoice[],
  issue: boolean,
): Promise<Result<InvoiceDetail[], AppError>> {
  const ids: Uuid[] = [];
  for (const p of planned) {
    await insertInvoiceDraft(tx, ctx.tenantId, p.header);
    await insertInvoiceLines(tx, ctx.tenantId, p.header.id, p.lines);
    await insertInvoiceDiscounts(tx, ctx.tenantId, p.header.id, p.discounts);
    await insertInstallments(
      tx,
      ctx.tenantId,
      p.header.id,
      p.installments.map((i) => ({ ...i, id: deps.newId() })),
    );
    ids.push(p.header.id);
  }
  if (issue) {
    for (const id of ids) {
      const r = await issueDraft(deps, ctx, tx, events, id);
      if (!r.ok) return r;
    }
  }
  const details: InvoiceDetail[] = [];
  for (const id of ids) details.push((await getInvoiceDetail(tx, id))!);
  for (const p of planned) {
    events.audit({
      action: "finance.invoice.created",
      resourceType: "invoice",
      resourceId: p.header.id,
      after: { learnerId: p.header.learnerId, total: p.header.total.amount, payerKind: p.header.payerKind, issued: issue },
    });
  }
  return ok(details);
}

/** Émet un brouillon : numéro, échéancier garanti, statut initial, événement. Facture verrouillée. */
async function issueDraft(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  invoiceId: Uuid,
): Promise<Result<InvoiceRecord, AppError>> {
  const invoice = await getInvoice(tx, invoiceId, { forUpdate: true });
  if (!invoice) return err(notFound(FinanceCode.INVOICE_NOT_FOUND, "Facture", invoiceId));
  const lineCount = (await tx.queryOne<{ n: string }>("SELECT count(*)::text AS n FROM finance.invoice_lines WHERE invoice_id = $1", [invoiceId]))!.n;
  const can = canIssueInvoice({ status: invoice.status, total: invoice.total, lineCount: Number(lineCount) });
  if (!can.ok) return can;

  let installments = await getInstallments(tx, invoiceId);
  if (installments.length === 0) {
    await insertInstallments(tx, ctx.tenantId, invoiceId, singleInstallment(invoice.total, invoice.dueDate).map((i) => ({ ...i, id: deps.newId() })));
    installments = await getInstallments(tx, invoiceId);
  }
  const lastDue = installments[installments.length - 1]!.dueDate;
  const year = numberingYear(deps.clock);
  const seq = await nextSequence(tx, "INVOICE", year);
  const number = formatDocumentNumber("INVOICE", year, seq);
  const issued = await markInvoiceIssued(tx, invoiceId, { number, year, seq, issuedAt: deps.clock.now(), dueDate: lastDue });
  const refreshed = await refreshInvoiceStatus(deps, tx, events, invoiceId);
  if (!refreshed.ok) return refreshed;

  events.add(
    FinanceEvents.INVOICE_ISSUED,
    {
      v: 1,
      invoiceId,
      number,
      learnerId: issued.learnerId,
      enrollmentId: issued.enrollmentId,
      payerKind: issued.payerKind,
      academicYear: issued.academicYear,
      total: moneyPayload(issued.total),
      dueDate: lastDue,
      fundingType: issued.fundingType,
    },
    { type: "invoice", id: invoiceId },
  );
  events.audit({
    action: "finance.invoice.issued",
    resourceType: "invoice",
    resourceId: invoiceId,
    after: { number, total: issued.total.amount },
  });
  return ok({ ...issued, status: refreshed.value.status });
}

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface InvoicesResult {
  invoices: InvoiceDetail[];
  replayed: boolean;
}

async function replayGroup(tx: Tx, existing: InvoiceRecord): Promise<InvoiceDetail[]> {
  const group = existing.relatedGroupId ? await listInvoicesByGroup(tx, existing.relatedGroupId) : [existing];
  const out: InvoiceDetail[] = [];
  for (const inv of group) out.push((await getInvoiceDetail(tx, inv.id))!);
  return out;
}

// ---------------------------------------------------------------------------
// Facturation depuis le catalogue (barèmes)
// ---------------------------------------------------------------------------

export interface InvoiceFromScheduleInput {
  learnerId: Uuid;
  enrollmentId?: Uuid | null;
  /** Obligatoire sans inscription. */
  academicYear?: string;
  items: Array<{ feeId?: Uuid; feeCode?: string; quantity?: number; description?: string }>;
  /** Périmètre explicite (complète / remplace celui de l'inscription). */
  scope?: Partial<FeeScope>;
  groupKey?: string | null;
  groupLabel?: string | null;
  /** Date de référence des barèmes (défaut : aujourd'hui). */
  effectiveOn?: IsoDate;
  discountIds?: Uuid[];
  dueDate?: IsoDate;
  installments?: InstallmentSpec;
  /** Émettre tout de suite (défaut `true`) ou laisser en brouillon. */
  issue?: boolean;
  /** Facturer la famille pour la part d'un financeur manquant (déconseillé). */
  ignoreFunding?: boolean;
  idempotencyKey?: string;
}

/**
 * Empreinte de la DEMANDE (entrée + périmètre de l'inscription), calculable sans lire le catalogue :
 * un rejeu avec la même clé est reconnu même si le catalogue a changé depuis, et une demande
 * différente avec la même clé est un conflit d'idempotence, pas une « frais introuvable ».
 */
function scheduleFingerprint(input: InvoiceFromScheduleInput, enrollment: EnrollmentRef | null): string {
  return sha({
    kind: "from-schedule",
    learnerId: input.learnerId,
    enrollmentId: input.enrollmentId ?? null,
    academicYear: (input.academicYear ?? enrollment?.academicYear ?? "").trim(),
    items: input.items,
    scope: {
      institutionId: input.scope?.institutionId ?? enrollment?.institutionId ?? null,
      campusId: input.scope?.campusId ?? enrollment?.campusId ?? null,
      levelKey: input.scope?.levelKey ?? enrollment?.levelKey ?? null,
      trackKey: input.scope?.trackKey ?? enrollment?.trackKey ?? null,
      learnerType: input.scope?.learnerType ?? enrollment?.learnerType ?? null,
    },
    groupKey: input.groupKey ?? null,
    groupLabel: input.groupLabel ?? null,
    effectiveOn: input.effectiveOn ?? null,
    discountIds: [...(input.discountIds ?? [])].sort(),
    dueDate: input.dueDate ?? null,
    installments: input.installments ?? null,
    issue: input.issue ?? true,
    ignoreFunding: input.ignoreFunding ?? false,
  });
}

async function prepareFromSchedule(
  deps: FinanceDeps,
  tx: Tx,
  input: InvoiceFromScheduleInput,
  enrollment: EnrollmentRef | null,
): Promise<Result<BuildSpec, AppError>> {
  const academicYear = (input.academicYear ?? enrollment?.academicYear ?? "").trim();
  if (!academicYear) return err(validation(FinanceCode.INVALID_INPUT, "Année scolaire requise (ou inscription).", "academicYear"));
  if (input.items.length === 0) return err(validation(FinanceCode.INVALID_INPUT, "Au moins un frais à facturer.", "items"));
  const onDate = input.effectiveOn ?? todayOf(deps);

  const scope: FeeScope = {
    institutionId: input.scope?.institutionId ?? enrollment?.institutionId ?? null,
    campusId: input.scope?.campusId ?? enrollment?.campusId ?? null,
    levelKey: input.scope?.levelKey ?? enrollment?.levelKey ?? null,
    trackKey: input.scope?.trackKey ?? enrollment?.trackKey ?? null,
    learnerType: input.scope?.learnerType ?? enrollment?.learnerType ?? null,
  };

  const lines: InvoiceLineInput[] = [];
  const planIds = new Set<Uuid>();
  let currency: CurrencyCode | null = null;
  for (const [i, item] of input.items.entries()) {
    const fee = item.feeId ? await getFee(tx, item.feeId) : item.feeCode ? await getFeeByCode(tx, item.feeCode.trim().toUpperCase()) : null;
    if (!fee) return err(notFound(FinanceCode.NOT_FOUND, "Frais", item.feeId ?? item.feeCode ?? String(i)));
    if (!fee.active) return err(conflict(FinanceCode.INVALID_INPUT, `Le frais ${fee.code} est désactivé.`, { feeId: fee.id }));
    const query: FeeQuery = { feeId: fee.id, academicYear, onDate, ...scope };
    const schedule: Result<FeeSchedule, AppError> = resolveFeeSchedule(
      await listFeeSchedules(tx, { feeId: fee.id, academicYear, activeOnly: true }),
      query,
    );
    if (!schedule.ok) return schedule;
    if (currency && schedule.value.amount.currency !== currency) {
      return err(validation(FinanceCode.CURRENCY_MISMATCH, "Les frais d'une facture doivent avoir la même devise.", ["items", i]));
    }
    currency = schedule.value.amount.currency;
    if (schedule.value.planId) planIds.add(schedule.value.planId);
    lines.push({
      feeId: fee.id,
      category: fee.category,
      description: item.description?.trim() || fee.name,
      quantity: item.quantity ?? 1,
      unitAmount: schedule.value.amount,
    });
  }

  const fingerprint = scheduleFingerprint(input, enrollment);

  return ok({
    learnerId: input.learnerId,
    enrollment,
    academicYear,
    groupKey: input.groupKey ?? enrollment?.groupKey ?? null,
    groupLabel: input.groupLabel ?? enrollment?.groupLabel ?? null,
    institutionId: scope.institutionId,
    campusId: scope.campusId,
    lines,
    discountIds: input.discountIds ?? [],
    applyFunding: true,
    ignoreFunding: input.ignoreFunding ?? false,
    dueDate: input.dueDate ?? null,
    installments: input.installments ?? null,
    schedulePlanId: planIds.size === 1 ? [...planIds][0]! : null,
    currency: currency ?? deps.config.defaultCurrency,
    idempotencyKey: input.idempotencyKey ?? null,
    fingerprint,
  });
}

async function loadEnrollment(
  deps: FinanceDeps,
  ctx: RequestContext,
  learnerId: Uuid,
  enrollmentId: Uuid | null | undefined,
): Promise<Result<EnrollmentRef | null, AppError>> {
  const learner = await deps.learners.getLearner(ctx, learnerId);
  if (!learner) return err(notFound(FinanceCode.LEARNER_NOT_FOUND, "Apprenant", learnerId));
  if (!enrollmentId) return ok(null);
  const enrollment = await deps.enrollments.getEnrollment(ctx, enrollmentId);
  if (!enrollment) return err(notFound(FinanceCode.ENROLLMENT_NOT_FOUND, "Inscription", enrollmentId));
  if (enrollment.learnerId !== learnerId) {
    return err(conflict(FinanceCode.ENROLLMENT_NOT_FOUND, "Cette inscription n'appartient pas à l'apprenant indiqué.", { enrollmentId, learnerId }));
  }
  return ok(enrollment);
}

/** Émet (ou crée en brouillon) la/les factures d'un apprenant d'après les barèmes. Idempotent par `idempotencyKey`. */
export async function issueInvoiceFromSchedule(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: InvoiceFromScheduleInput,
): Promise<Result<InvoicesResult, AppError>> {
  if (input.idempotencyKey !== undefined) {
    const k = validateIdempotencyKey(input.idempotencyKey);
    if (!k.ok) return k;
  }
  const enrollment = await loadEnrollment(deps, ctx, input.learnerId, input.enrollmentId);
  if (!enrollment.ok) return enrollment;
  return inTx<InvoicesResult>(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    if (input.idempotencyKey) {
      await lockIdempotencyKey(tx, ctx, "invoice", input.idempotencyKey);
      const existing = await getInvoiceByIdempotencyKey(tx, input.idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== scheduleFingerprint(input, enrollment.value)) return err(idempotencyConflict(input.idempotencyKey));
        return ok({ invoices: await replayGroup(tx, existing), replayed: true });
      }
    }
    const spec = await prepareFromSchedule(deps, tx, input, enrollment.value);
    if (!spec.ok) return spec;
    const planned = await planInvoices(deps, ctx, tx, spec.value);
    if (!planned.ok) return planned;
    const details = await persistInvoices(deps, ctx, tx, events, planned.value, input.issue ?? true);
    if (!details.ok) return details;
    await events.flush(tx);
    return ok({ invoices: details.value, replayed: false });
  });
}

/** Simulation : ce que donnerait `issueInvoiceFromSchedule`, sans rien écrire. */
export interface InvoicePreview {
  invoices: Array<{
    payerKind: PayerKind;
    payerRef: string | null;
    label: string;
    lines: InvoiceLine[];
    subtotal: Money;
    discount: Money;
    scholarship: Money;
    total: Money;
    installments: GeneratedInstallment[];
    dueDate: IsoDate;
  }>;
}

export async function previewInvoiceFromSchedule(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: InvoiceFromScheduleInput,
): Promise<Result<InvoicePreview, AppError>> {
  const enrollment = await loadEnrollment(deps, ctx, input.learnerId, input.enrollmentId);
  if (!enrollment.ok) return enrollment;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const spec = await prepareFromSchedule(deps, tx, { ...input, idempotencyKey: undefined }, enrollment.value);
      if (!spec.ok) return spec;
      const planned = await planInvoices(deps, ctx, tx, spec.value);
      if (!planned.ok) return planned;
      return ok({
        invoices: planned.value.map((p) => ({
          payerKind: p.header.payerKind,
          payerRef: p.header.payerRef,
          label: p.label,
          lines: p.lines,
          subtotal: p.header.subtotal,
          discount: p.header.discount,
          scholarship: p.header.scholarship,
          total: p.header.total,
          installments: p.installments,
          dueDate: p.header.dueDate,
        })),
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Facture manuelle
// ---------------------------------------------------------------------------

export interface CreateInvoiceInput {
  learnerId: Uuid;
  enrollmentId?: Uuid | null;
  academicYear?: string;
  lines: InvoiceLineInput[];
  groupKey?: string | null;
  groupLabel?: string | null;
  discountIds?: Uuid[];
  /** Appliquer les bourses de l'apprenant (défaut `false` pour une saisie manuelle). */
  applyFunding?: boolean;
  dueDate?: IsoDate;
  installments?: InstallmentSpec;
  issue?: boolean;
  idempotencyKey?: string;
}

export async function createInvoice(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: CreateInvoiceInput,
): Promise<Result<InvoicesResult, AppError>> {
  if (input.idempotencyKey !== undefined) {
    const k = validateIdempotencyKey(input.idempotencyKey);
    if (!k.ok) return k;
  }
  const enrollment = await loadEnrollment(deps, ctx, input.learnerId, input.enrollmentId);
  if (!enrollment.ok) return enrollment;
  const academicYear = (input.academicYear ?? enrollment.value?.academicYear ?? "").trim();
  if (!academicYear) return err(validation(FinanceCode.INVALID_INPUT, "Année scolaire requise (ou inscription).", "academicYear"));
  const currency = input.lines[0]?.unitAmount.currency ?? deps.config.defaultCurrency;
  const fingerprint = sha({
    kind: "manual",
    learnerId: input.learnerId,
    enrollmentId: input.enrollmentId ?? null,
    academicYear,
    lines: input.lines.map((l) => [l.feeId ?? null, l.category, l.description, l.quantity ?? 1, l.unitAmount.amount]),
    discountIds: [...(input.discountIds ?? [])].sort(),
    dueDate: input.dueDate ?? null,
    installments: input.installments ?? null,
    applyFunding: input.applyFunding ?? false,
    issue: input.issue ?? false,
  });
  return inTx<InvoicesResult>(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    if (input.idempotencyKey) {
      await lockIdempotencyKey(tx, ctx, "invoice", input.idempotencyKey);
      const existing = await getInvoiceByIdempotencyKey(tx, input.idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) return err(idempotencyConflict(input.idempotencyKey));
        return ok({ invoices: await replayGroup(tx, existing), replayed: true });
      }
    }
    const planned = await planInvoices(deps, ctx, tx, {
      learnerId: input.learnerId,
      enrollment: enrollment.value,
      academicYear,
      groupKey: input.groupKey ?? enrollment.value?.groupKey ?? null,
      groupLabel: input.groupLabel ?? enrollment.value?.groupLabel ?? null,
      institutionId: enrollment.value?.institutionId ?? null,
      campusId: enrollment.value?.campusId ?? null,
      lines: input.lines,
      discountIds: input.discountIds ?? [],
      applyFunding: input.applyFunding ?? false,
      ignoreFunding: false,
      dueDate: input.dueDate ?? null,
      installments: input.installments ?? null,
      schedulePlanId: null,
      currency,
      idempotencyKey: input.idempotencyKey ?? null,
      fingerprint,
    });
    if (!planned.ok) return planned;
    const details = await persistInvoices(deps, ctx, tx, events, planned.value, input.issue ?? false);
    if (!details.ok) return details;
    await events.flush(tx);
    return ok({ invoices: details.value, replayed: false });
  });
}

// ---------------------------------------------------------------------------
// Émission d'un brouillon, annulation, échéancier, avoir
// ---------------------------------------------------------------------------

export async function issueInvoice(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { invoiceId: Uuid },
): Promise<Result<InvoiceDetail, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const locked = await lockInvoices(tx, [input.invoiceId]);
    if (locked.length === 0) return err(notFound(FinanceCode.INVOICE_NOT_FOUND, "Facture", input.invoiceId));
    const issued = await issueDraft(deps, ctx, tx, events, input.invoiceId);
    if (!issued.ok) return issued;
    await events.flush(tx);
    return ok((await getInvoiceDetail(tx, input.invoiceId))!);
  });
}

export async function cancelInvoice(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { invoiceId: Uuid; reason: string },
): Promise<Result<InvoiceDetail, AppError>> {
  const reason = validateReason(input.reason);
  if (!reason.ok) return reason;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const [invoice] = await lockInvoices(tx, [input.invoiceId]);
    if (!invoice) return err(notFound(FinanceCode.INVOICE_NOT_FOUND, "Facture", input.invoiceId));
    const can = canCancelInvoice({ status: invoice.status, amounts: { total: invoice.total, paid: invoice.paid, credited: invoice.credited } });
    if (!can.ok) return can;
    await cancelInvoiceRow(tx, invoice.id, reason.value, deps.clock.now());
    events.add(
      FinanceEvents.INVOICE_CANCELLED,
      { v: 1, invoiceId: invoice.id, number: invoice.number, learnerId: invoice.learnerId, reason: reason.value },
      { type: "invoice", id: invoice.id },
    );
    events.audit({
      action: "finance.invoice.cancelled",
      resourceType: "invoice",
      resourceId: invoice.id,
      before: { status: invoice.status },
      after: { status: "CANCELLED", reason: reason.value },
      sensitive: true,
    });
    await events.flush(tx);
    return ok((await getInvoiceDetail(tx, invoice.id))!);
  });
}

/**
 * Remplace l'échéancier d'une facture (brouillon, ou émise sans aucun encaissement ni avoir)
 * par un plan type ou des étapes explicites. La somme des échéances égale le total, au franc près.
 */
export async function generateInstallmentPlan(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { invoiceId: Uuid } & InstallmentSpec,
): Promise<Result<InvoiceDetail, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const [invoice] = await lockInvoices(tx, [input.invoiceId]);
    if (!invoice) return err(notFound(FinanceCode.INVOICE_NOT_FOUND, "Facture", input.invoiceId));
    const lockedOk =
      invoice.status === "DRAFT" ||
      (["ISSUED", "OVERDUE"].includes(invoice.status) && invoice.paid.isZero() && invoice.credited.isZero());
    if (!lockedOk) {
      return err(
        conflict(FinanceCode.INSTALLMENTS_LOCKED, "L'échéancier d'une facture encaissée ou créditée ne peut plus être remplacé.", {
          status: invoice.status,
        }),
      );
    }
    const steps = await resolvePlanSteps(tx, input, null, invoice.currency);
    if (!steps.ok) return steps;
    if (!steps.value) return err(validation(FinanceCode.PLAN_INVALID, "Indiquez un plan (planId, planCode) ou des étapes.", "planId"));
    const generated = generateInstallments(invoice.total, steps.value, input.baseDate ?? todayOf(deps));
    if (!generated.ok) return generated;
    await deleteInstallments(tx, invoice.id);
    await insertInstallments(tx, ctx.tenantId, invoice.id, generated.value.map((i) => ({ ...i, id: deps.newId() })));
    await updateInvoiceDueDate(tx, invoice.id, generated.value[generated.value.length - 1]!.dueDate);
    if (invoice.status !== "DRAFT") {
      const r = await refreshInvoiceStatus(deps, tx, events, invoice.id);
      if (!r.ok) return r;
    }
    events.audit({
      action: "finance.invoice.installments_generated",
      resourceType: "invoice",
      resourceId: invoice.id,
      after: { installments: generated.value.map((i) => ({ seq: i.seq, dueDate: i.dueDate, amount: i.amount.amount })) },
    });
    await events.flush(tx);
    return ok((await getInvoiceDetail(tx, invoice.id))!);
  });
}

export interface IssueCreditNoteInput {
  invoiceId: Uuid;
  amount: Money;
  reason: string;
}

export async function issueCreditNote(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: IssueCreditNoteInput,
): Promise<Result<{ creditNote: CreditNoteRecord; invoice: InvoiceDetail }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const [invoice] = await lockInvoices(tx, [input.invoiceId]);
    if (!invoice) return err(notFound(FinanceCode.INVOICE_NOT_FOUND, "Facture", input.invoiceId));
    const check = validateCreditNote({
      invoice: { status: invoice.status, amounts: { total: invoice.total, paid: invoice.paid, credited: invoice.credited } },
      amount: input.amount,
      reason: input.reason,
    });
    if (!check.ok) return check;
    const installments = await getInstallments(tx, invoice.id);
    const applications = distributeCredit(installments, input.amount);
    if (!applications.ok) return applications;

    for (const a of applications.value) await addInstallmentCumuls(tx, a.installmentId, { credited: a.amount });
    await addInvoiceCumuls(tx, invoice.id, { credited: input.amount });

    const year = numberingYear(deps.clock);
    const seq = await nextSequence(tx, "CREDIT_NOTE", year);
    const number = formatDocumentNumber("CREDIT_NOTE", year, seq);
    const creditNote = await insertCreditNote(tx, ctx.tenantId, {
      id: deps.newId(),
      number,
      year,
      seq,
      invoiceId: invoice.id,
      learnerId: invoice.learnerId,
      amount: input.amount,
      reason: check.value.reason,
      applications: applications.value.map((a) => ({ installmentId: a.installmentId, amount: a.amount.amount })),
      issuedAt: deps.clock.now(),
      issuedBy: ctx.userId,
    });
    const refreshed = await refreshInvoiceStatus(deps, tx, events, invoice.id);
    if (!refreshed.ok) return refreshed;
    events.add(
      FinanceEvents.CREDIT_NOTE_ISSUED,
      {
        v: 1,
        creditNoteId: creditNote.id,
        number,
        invoiceId: invoice.id,
        learnerId: invoice.learnerId,
        amount: moneyPayload(input.amount),
        reason: check.value.reason,
      },
      { type: "credit_note", id: creditNote.id },
    );
    events.audit({
      action: "finance.credit_note.issued",
      resourceType: "credit_note",
      resourceId: creditNote.id,
      after: { number, invoiceId: invoice.id, amount: input.amount.amount },
      sensitive: true,
    });
    await events.flush(tx);
    return ok({ creditNote, invoice: (await getInvoiceDetail(tx, invoice.id))! });
  });
}

// ---------------------------------------------------------------------------
// Retards (job planifié, un tenant à la fois)
// ---------------------------------------------------------------------------

/**
 * Passe en OVERDUE les factures dont une échéance est échue avec un reste dû et publie
 * `finance.invoice.overdue` (une fois par transition). Idempotent : une facture déjà
 * OVERDUE n'est pas retraitée. À lancer par tenant (`SystemDb.forEachTenant`).
 */
export async function markOverdueInvoices(
  deps: FinanceDeps,
  ctx: RequestContext,
  options: { limit?: number } = {},
): Promise<Result<{ processed: number; invoiceIds: Uuid[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const candidates = await findOverdueCandidates(tx, todayOf(deps), options.limit ?? 500);
    const changed: Uuid[] = [];
    for (const c of candidates) {
      const r = await refreshInvoiceStatus(deps, tx, events, c.id);
      if (!r.ok) return r;
      if (r.value.status !== c.status) changed.push(c.id);
    }
    await events.flush(tx);
    return ok({ processed: candidates.length, invoiceIds: changed });
  });
}

// ---------------------------------------------------------------------------
// Consultation
// ---------------------------------------------------------------------------

export async function getInvoiceById(deps: FinanceDeps, ctx: RequestContext, invoiceId: Uuid): Promise<Result<InvoiceDetail, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const detail = await getInvoiceDetail(tx, invoiceId);
      return detail ? ok(detail) : err(notFound(FinanceCode.INVOICE_NOT_FOUND, "Facture", invoiceId));
    },
    { readOnly: true },
  );
}

export async function listInvoicePage(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: Partial<InvoiceListFilter> = {},
): Promise<Result<{ items: InvoiceRecord[]; total: number }, AppError>> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return inTx(deps, ctx, async (tx) => ok(await listInvoices(tx, { ...filter, limit, offset: filter.offset ?? 0 })), { readOnly: true });
}

export interface LearnerStatement {
  learnerId: Uuid;
  currency: CurrencyCode;
  invoices: InvoiceRecord[];
  payments: Awaited<ReturnType<typeof listPayments>>["items"];
  totals: {
    billed: Money;
    credited: Money;
    collected: Money;
    outstanding: Money;
    unallocatedPayments: Money;
  };
}

/** Relevé d'un apprenant : factures émises, paiements, soldes. */
export async function getLearnerStatement(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { learnerId: Uuid; academicYear?: string; currency?: CurrencyCode },
): Promise<Result<LearnerStatement, AppError>> {
  const currency = input.currency ?? deps.config.defaultCurrency;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const invoices = (await listInvoices(tx, { learnerId: input.learnerId, academicYear: input.academicYear, limit: 500, offset: 0 })).items.filter(
        (i) => i.currency === currency,
      );
      const payments = (await listPayments(tx, { learnerId: input.learnerId, limit: 500, offset: 0 })).items.filter((p) => p.amount.currency === currency);
      const s = summarizeReceivables(
        invoices.map((i) => ({ status: i.status, total: i.total, paid: i.paid, credited: i.credited })),
        currency,
      );
      const unallocated = sumMoney(
        payments.filter((p) => p.status === "CONFIRMED").map((p) => p.amount.subtract(p.allocated).subtract(p.refunded)),
        currency,
      );
      return ok({
        learnerId: input.learnerId,
        currency,
        invoices,
        payments,
        totals: { billed: s.billed, credited: s.credited, collected: s.collected, outstanding: s.outstanding, unallocatedPayments: unallocated },
      });
    },
    { readOnly: true },
  );
}
