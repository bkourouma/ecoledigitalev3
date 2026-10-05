/**
 * Plugin Fastify du module finance — préfixe `/api/v1/finance`.
 *
 *   await app.register(financePlugin, { deps });                  // deps = createFinanceDeps({...})
 *
 * - Authentification : `request.ctx` (RequestContext) est posé EN AMONT (module iam /
 *   authentification historique). Aucune route ne s'exécute sans lui, hors webhooks.
 * - Autorisation : `requirePermission('finance.…')` du module `rbac` (injectable via
 *   `options.requirePermission` pour les tests ou un câblage particulier).
 * - Entitlements : `options.isFeatureEnabled(ctx, 'finance.online-payment' | …)` ; sans
 *   lui toutes les features sont considérées actives (socle CORE).
 * - Webhooks fournisseurs : `POST /webhooks/:provider/:tenantId`, PUBLIC (la signature fait
 *   foi), corps lu BRUT pour la vérification, traitement idempotent.
 * - Erreurs : `AppError` / Zod → `toErrorBody` ; jamais de message interne exposé.
 * - Idempotence : en-tête `Idempotency-Key` (ou champ `idempotencyKey` du corps).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import {
  ConflictError,
  ForbiddenError,
  Money,
  UnauthorizedError,
  ValidationError,
  toAppError,
  toErrorBody,
  type CurrencyCode,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import {
  financeAgedBalanceQuerySchema,
  financeAllocatePaymentBodySchema,
  financeApproveRefundBodySchema,
  financeCompleteRefundBodySchema,
  financeDecideResolutionBodySchema,
  financeListPendingPaymentsQuerySchema,
  financeListWebhookEventsQuerySchema,
  financeReplayWebhookEventBodySchema,
  financeListResolutionsQuerySchema,
  financeRequestResolutionBodySchema,
  financeCancelInvoiceBodySchema,
  financeCloseCashSessionBodySchema,
  financeCollectionsTrendQuerySchema,
  financeCreateCashRegisterBodySchema,
  financeCreateDiscountBodySchema,
  financeCreateFeeBodySchema,
  financeCreateFeeScheduleBodySchema,
  financeCreateInvoiceBodySchema,
  financeCreatePlanBodySchema,
  financeCreateScholarshipBodySchema,
  financeCreditNoteBodySchema,
  FINANCE_EXPORT_HEADERS,
  financeExportInvoicesQuerySchema,
  financeExportPaymentsQuerySchema,
  financeExportReceivablesQuerySchema,
  financeFamilyInitiatePaymentBodySchema,
  financeFamilyInstallmentsQuerySchema,
  financeFamilyInvoicesQuerySchema,
  financeFamilyItemParamsSchema,
  financeFamilyLearnerParamsSchema,
  financeFamilyPaymentsQuerySchema,
  financeFamilyReceiptsQuerySchema,
  financeFamilyStatementQuerySchema,
  financeGenerateInstallmentsBodySchema,
  financeIdParamsSchema,
  financeInitiateOnlinePaymentBodySchema,
  financeInvoiceFromScheduleBodySchema,
  financeLearnerParamsSchema,
  financeProviderParamsSchema,
  financeProviderStatusBodySchema,
  financeSaveProviderBodySchema,
  financeListCashSessionsQuerySchema,
  financeListFeesQuerySchema,
  financeListInvoicesQuerySchema,
  financeListPaymentsQuerySchema,
  financeListReceiptsQuerySchema,
  financeListRefundsQuerySchema,
  financeListSchedulesQuerySchema,
  financeOpenCashSessionBodySchema,
  financeReceivablesByLearnerQuerySchema,
  financeRecordPaymentBodySchema,
  financeRejectRefundBodySchema,
  financeReportQuerySchema,
  financeRequestRefundBodySchema,
  financeResolveFeeQuerySchema,
  financeScholarshipStatusBodySchema,
  financeSetFeeStatusBodySchema,
  financeSetFundingBodySchema,
  financeWebhookParamsSchema,
} from "@ecoledigitale/contracts/src/v2/finance";
import { getRequestCtx, requirePermission as rbacRequirePermission } from "../../rbac";
import { todayOf } from "../application/billing-core";
import { closeCashSession, createCashRegister, getCashSessionSummary, getMyOpenSession, listRegisters, listSessionPage, openCashSession } from "../application/cash";
import {
  changeScholarshipStatus,
  createDiscount,
  createFee,
  createFeeSchedule,
  createInstallmentPlan,
  createScholarship,
  getLearnerFunding,
  listDiscountCatalog,
  listFeeCatalog,
  listInstallmentPlans,
  listSchedules,
  resolveFeeAmount,
  setFeeStatus,
  setLearnerFunding,
} from "../application/catalog";
import { createFinanceDeps, type FinanceDeps } from "../application/deps";
import { getWebhookEventView, listWebhookEventsPage, replayFailedWebhookEvent } from "../application/webhook-admin";
import {
  exportInvoicesCsv,
  exportPaymentsCsv,
  exportReceivablesCsv,
  type CsvExport,
  type ExportDataset,
  type ExportOptions,
} from "../application/exports";
import {
  authorizeFamilyAccess,
  FAMILY_PERMISSIONS,
  getFamilyInvoice,
  getFamilyPayment,
  getFamilyReceipt,
  getFamilyStatement,
  initiateFamilyOnlinePayment,
  listFamilyInstallments,
  listFamilyInvoices,
  listFamilyPayments,
  listFamilyReceipts,
  listMyLearners,
  verifyFamilyPayment,
  type FamilyAccess,
  type FamilyAction,
  type PermissionProbe,
} from "../application/family";
import type { OfficialDocumentState } from "../application/ports/documents";
import { learnerNames } from "../application/learner-names";
import { getReceiptPdf } from "../application/receipt-document";
import { createFinancePortRegistry, type FinancePortRegistry, type FinancePortSet } from "../application/port-registry";
import { financeAuditAdapter } from "../infrastructure/audit-adapter";
import { createFinanceProviderRuntime, financeEnvironmentOf, reconciliationConfigFromEnv } from "../infrastructure/runtime";
import type { ModuleRuntime } from "../../../platform/runtime";
import {
  cancelInvoice,
  createInvoice,
  generateInstallmentPlan,
  getInvoiceById,
  getLearnerStatement,
  issueCreditNote,
  issueInvoice,
  issueInvoiceFromSchedule,
  listInvoicePage,
  previewInvoiceFromSchedule,
} from "../application/invoices";
import { handleProviderWebhook, initiateOnlinePayment, verifyPendingPayment } from "../application/online-payments";
import { clearProviderCredentials, listProviders, rotateProviderSecrets, saveProviderConfig, setProviderStatus, testProviderConnection } from "../application/provider-admin";
import {
  allocatePayment,
  getPaymentView,
  getReceiptById,
  getReceiptOfPayment,
  listPaymentPage,
  listReceiptPage,
  recordManualPayment,
} from "../application/payments";
import { approveRefund, completeRefund, getRefundById, listRefundPage, rejectRefund, requestRefund } from "../application/refunds";
import {
  approveManualResolution,
  listManualResolutions,
  listPendingReconciliations,
  rejectManualResolution,
  requestManualResolution,
} from "../application/manual-resolution";
import {
  getAgedBalance,
  getCollectionsTrend,
  getFinanceSummary,
  getReceivablesByGroup,
  getReceivablesByLearner,
} from "../application/reports";
import * as present from "./presenters";

export const FINANCE_ROUTES_PREFIX = "/api/v1/finance";

export interface FinancePluginOptions {
  deps: FinanceDeps;
  prefix?: string;
  /** Garde de permission (défaut : celle du module rbac). */
  requirePermission?: (permission: string) => preHandlerAsyncHookHandler;
  /**
   * Garde de route `requireFeature(key)` du module entitlements (preHandler Fastify) : appliquée aux routes de
   * paiement en ligne. Prime sur `isFeatureEnabled` pour ces routes (403 `entitlements.feature_not_available`).
   */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  /** Entitlements : `finance.online-payment`, `finance.installments`, `finance.state-assigned`. */
  isFeatureEnabled?: (ctx: RequestContext, featureKey: string) => Promise<boolean>;
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError(
    "Données invalides.",
    error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
  );
}

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** Montant d'entrée → Money (entier ou chaîne de chiffres, jamais de décimale). */
function moneyOf(amount: number | string, currency: CurrencyCode | undefined, fallback: CurrencyCode): Money {
  return typeof amount === "string" ? Money.fromString(amount, currency ?? fallback) : Money.of(amount, currency ?? fallback);
}

function ctxOf(request: FastifyRequest): RequestContext {
  const ctx = getRequestCtx(request);
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const v = request.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export async function financePlugin(app: FastifyInstance, options: FinancePluginOptions): Promise<void> {
  const { deps } = options;
  const perm = options.requirePermission ?? ((p: string) => rbacRequirePermission(p));
  const currency = deps.config.defaultCurrency;
  const m = (amount: number | string, c?: CurrencyCode): Money => moneyOf(amount, c, currency);

  /**
   * Garde de route « permission PUIS feature » : avec la garde `requireFeature` du module entitlements, un
   * établissement qui n'a pas souscrit la feature reçoit 403 `entitlements.feature_not_available` (avec la
   * raison) AVANT toute lecture du corps. Sans cette garde (tests autonomes), le contrôle en ligne ci-dessous
   * s'applique avec `isFeatureEnabled`.
   */
  const withFeature = (permission: string, feature: string) => {
    const guards: preHandlerAsyncHookHandler[] = [perm(permission)];
    if (options.requireFeature) {
      const featureGuard = options.requireFeature(feature);
      // La garde ENVOIE elle-même le 403 et renvoie la réponse : un preHandler asynchrone doit la retourner.
      guards.push(async function featureGate(request, reply) {
        return featureGuard.call(request.server, request, reply);
      });
    }
    return guards;
  };

  /** Sonde de permission sans exception pour un simple refus (autre erreur : propagée). */
  const probeOf =
    (req: FastifyRequest, reply: FastifyReply): PermissionProbe =>
    async (permission) => {
      try {
        await perm(permission).call(app, req, reply);
        return true;
      } catch (e) {
        if (e instanceof ForbiddenError) return false;
        throw e;
      }
    };

  /**
   * Garde des routes famille : au moins UNE des deux permissions (`finance.child.<action>` ou `finance.self.<action>`) ;
   * puis, si `feature`, la garde d'entitlement. La propriété de l'apprenant est contrôlée dans le handler (`familyAccess`).
   */
  const familyGuard = (action: FamilyAction, feature?: string): preHandlerAsyncHookHandler[] => {
    const wanted = [FAMILY_PERMISSIONS.GUARDIAN[action], FAMILY_PERMISSIONS.SELF[action]];
    const guards: preHandlerAsyncHookHandler[] = [
      async function familyPermissionGate(request, reply) {
        let last: unknown;
        for (const p of wanted) {
          try {
            await perm(p).call(request.server, request, reply);
            return;
          } catch (e) {
            if (!(e instanceof ForbiddenError)) throw e;
            last = e;
          }
        }
        throw last ?? new ForbiddenError("Action non autorisée.");
      },
    ];
    if (feature && options.requireFeature) {
      const featureGuard = options.requireFeature(feature);
      guards.push(async function featureGate(request, reply) {
        return featureGuard.call(request.server, request, reply);
      });
    }
    return guards;
  };

  /** Autorise l'accès à l'apprenant du chemin (`:learnerId`) : propriété + permission du bon type, sinon 404 uniforme. */
  const familyAccess = async (req: FastifyRequest, reply: FastifyReply, action: FamilyAction): Promise<FamilyAccess> => {
    const { learnerId } = parse(financeFamilyLearnerParamsSchema, req.params);
    return unwrapOrThrow(await authorizeFamilyAccess(deps, ctxOf(req), learnerId, action, probeOf(req, reply)));
  };

  const requireFeature = async (ctx: RequestContext, feature: string): Promise<void> => {
    if (options.isFeatureEnabled && !(await options.isFeatureEnabled(ctx, feature))) {
      throw new ForbiddenError("Cette fonctionnalité n'est pas incluse dans l'offre de l'établissement.", {
        code: "finance.feature_disabled",
        details: { feature },
      });
    }
  };

  const idempotencyKeyOf = (request: FastifyRequest, bodyKey: string | undefined): string | undefined =>
    bodyKey ?? headerValue(request, "idempotency-key");

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "finance : erreur inattendue");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  await app.register(
    async (scope) => {
      scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));

      // ----- Catalogue : frais, barèmes, plans, remises ------------------------------------
      scope.get("/fees", { preHandler: perm("finance.fee.read") }, async (req) => {
        const q = parse(financeListFeesQuerySchema, req.query);
        const fees = unwrapOrThrow(await listFeeCatalog(deps, ctxOf(req), { ...(q.category ? { category: q.category } : {}), activeOnly: q.activeOnly ?? false }));
        return { items: fees.map(present.feeDto) };
      });
      scope.post("/fees", { preHandler: perm("finance.fee.manage") }, async (req, reply) => {
        const b = parse(financeCreateFeeBodySchema, req.body);
        const fee = unwrapOrThrow(await createFee(deps, ctxOf(req), b));
        return reply.status(201).send(present.feeDto(fee));
      });
      scope.patch("/fees/:id/status", { preHandler: perm("finance.fee.manage") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeSetFeeStatusBodySchema, req.body);
        return present.feeDto(unwrapOrThrow(await setFeeStatus(deps, ctxOf(req), { feeId: id, active: b.active })));
      });

      scope.get("/fee-schedules", { preHandler: perm("finance.fee.read") }, async (req) => {
        const q = parse(financeListSchedulesQuerySchema, req.query);
        const items = unwrapOrThrow(await listSchedules(deps, ctxOf(req), { ...(q.feeId ? { feeId: q.feeId } : {}), ...(q.academicYear ? { academicYear: q.academicYear } : {}), activeOnly: q.activeOnly ?? false }));
        return { items: items.map(present.scheduleDto) };
      });
      scope.post("/fee-schedules", { preHandler: perm("finance.fee.manage") }, async (req, reply) => {
        const b = parse(financeCreateFeeScheduleBodySchema, req.body);
        const s = unwrapOrThrow(
          await createFeeSchedule(deps, ctxOf(req), {
            feeId: b.feeId,
            academicYear: b.academicYear,
            amount: m(b.amount, b.currency),
            effectiveFrom: b.effectiveFrom,
            ...(b.effectiveTo ? { effectiveTo: b.effectiveTo } : {}),
            ...(b.planId ? { planId: b.planId } : {}),
            scope: {
              institutionId: b.institutionId ?? null,
              campusId: b.campusId ?? null,
              levelKey: b.levelKey ?? null,
              trackKey: b.trackKey ?? null,
              learnerType: b.learnerType ?? null,
            },
          }),
        );
        return reply.status(201).send(present.scheduleDto(s));
      });
      scope.get("/fee-schedules/resolve", { preHandler: perm("finance.fee.read") }, async (req) => {
        const q = parse(financeResolveFeeQuerySchema, req.query);
        const s = unwrapOrThrow(
          await resolveFeeAmount(deps, ctxOf(req), {
            feeId: q.feeId,
            academicYear: q.academicYear,
            onDate: q.onDate ?? todayOf(deps),
            institutionId: q.institutionId ?? null,
            campusId: q.campusId ?? null,
            levelKey: q.levelKey ?? null,
            trackKey: q.trackKey ?? null,
            learnerType: q.learnerType ?? null,
          }),
        );
        return present.scheduleDto(s);
      });

      scope.get("/installment-plans", { preHandler: perm("finance.fee.read") }, async (req) => ({
        items: unwrapOrThrow(await listInstallmentPlans(deps, ctxOf(req))).map(present.planDto),
      }));
      scope.post("/installment-plans", { preHandler: perm("finance.fee.manage") }, async (req, reply) => {
        const ctx = ctxOf(req);
        await requireFeature(ctx, "finance.installments");
        const b = parse(financeCreatePlanBodySchema, req.body);
        const cur = b.currency ?? currency;
        const plan = unwrapOrThrow(
          await createInstallmentPlan(deps, ctx, {
            code: b.code,
            name: b.name,
            currency: cur,
            steps: b.steps.map((s) => ({
              label: s.label,
              share: s.share.kind === "FIXED" ? { kind: "FIXED" as const, amount: m(s.share.amount, cur) } : { kind: "WEIGHT" as const, weight: s.share.weight },
              due: s.due,
            })),
          }),
        );
        return reply.status(201).send(present.planDto(plan));
      });

      scope.get("/discounts", { preHandler: perm("finance.fee.read") }, async (req) => ({
        items: unwrapOrThrow(await listDiscountCatalog(deps, ctxOf(req))).map(present.discountDto),
      }));
      scope.post("/discounts", { preHandler: perm("finance.fee.manage") }, async (req, reply) => {
        const b = parse(financeCreateDiscountBodySchema, req.body);
        const cur = b.currency ?? currency;
        const d = unwrapOrThrow(
          await createDiscount(deps, ctxOf(req), {
            code: b.code,
            name: b.name,
            kind: b.kind,
            ...(b.bps !== undefined ? { bps: b.bps } : {}),
            ...(b.amount !== undefined ? { amount: m(b.amount, cur) } : {}),
            ...(b.capAmount !== undefined ? { capAmount: m(b.capAmount, cur) } : {}),
            ...(b.categories ? { categories: b.categories } : {}),
            ...(b.stackable !== undefined ? { stackable: b.stackable } : {}),
          }),
        );
        return reply.status(201).send(present.discountDto(d));
      });

      // ----- Apprenants : financement, bourses, relevé ----------------------------------------
      scope.get("/learners/:learnerId/funding", { preHandler: perm("finance.invoice.read") }, async (req) => {
        const { learnerId } = parse(financeLearnerParamsSchema, req.params);
        return present.learnerFundingDto(unwrapOrThrow(await getLearnerFunding(deps, ctxOf(req), learnerId)));
      });
      scope.put("/learners/:learnerId/funding", { preHandler: perm("finance.fee.manage") }, async (req) => {
        const ctx = ctxOf(req);
        const { learnerId } = parse(financeLearnerParamsSchema, req.params);
        const b = parse(financeSetFundingBodySchema, req.body);
        if (b.fundingType === "STATE_ASSIGNED") await requireFeature(ctx, "finance.state-assigned");
        const account = unwrapOrThrow(await setLearnerFunding(deps, ctx, { learnerId, fundingType: b.fundingType, ...(b.assignmentRef ? { assignmentRef: b.assignmentRef } : {}) }));
        return { ...account };
      });
      scope.get("/learners/:learnerId/statement", { preHandler: perm("finance.invoice.read") }, async (req) => {
        const { learnerId } = parse(financeLearnerParamsSchema, req.params);
        const q = parse(financeReportQuerySchema, req.query);
        return present.learnerStatementDto(
          unwrapOrThrow(await getLearnerStatement(deps, ctxOf(req), { learnerId, ...(q.academicYear ? { academicYear: q.academicYear } : {}), ...(q.currency ? { currency: q.currency } : {}) })),
        );
      });
      scope.post("/scholarships", { preHandler: perm("finance.fee.manage") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const b = parse(financeCreateScholarshipBodySchema, req.body);
        if (b.funderKind === "STATE") await requireFeature(ctx, "finance.state-assigned");
        const cur = b.currency ?? currency;
        const s = unwrapOrThrow(
          await createScholarship(deps, ctx, {
            learnerId: b.learnerId,
            academicYear: b.academicYear,
            funderKind: b.funderKind,
            funderName: b.funderName,
            ...(b.reference ? { reference: b.reference } : {}),
            coverage: b.coverage.kind === "PERCENT" ? { kind: "PERCENT", bps: b.coverage.bps } : { kind: "FIXED", amount: m(b.coverage.amount, cur) },
            ...(b.capAmount !== undefined ? { capAmount: m(b.capAmount, cur) } : {}),
            ...(b.categories ? { categories: b.categories } : {}),
            ...(b.priority !== undefined ? { priority: b.priority } : {}),
          }),
        );
        return reply.status(201).send(present.scholarshipDto({ ...s, status: "ACTIVE" }));
      });
      scope.patch("/scholarships/:id/status", { preHandler: perm("finance.fee.manage") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeScholarshipStatusBodySchema, req.body);
        unwrapOrThrow(await changeScholarshipStatus(deps, ctxOf(req), { scholarshipId: id, status: b.status }));
        return { id, status: b.status };
      });

      // ----- Factures -------------------------------------------------------------------------
      scope.get("/invoices", { preHandler: perm("finance.invoice.read") }, async (req) => {
        const q = parse(financeListInvoicesQuerySchema, req.query);
        const page = unwrapOrThrow(
          await listInvoicePage(deps, ctxOf(req), {
            limit: q.limit,
            offset: q.offset,
            ...(q.learnerId ? { learnerId: q.learnerId } : {}),
            ...(q.academicYear ? { academicYear: q.academicYear } : {}),
            ...(q.status ? { status: q.status } : {}),
            ...(q.groupKey ? { groupKey: q.groupKey } : {}),
            ...(q.payerKind ? { payerKind: q.payerKind } : {}),
          }),
        );
        return { items: page.items.map(present.invoiceSummaryDto), total: page.total };
      });
      scope.get("/invoices/:id", { preHandler: perm("finance.invoice.read") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        return present.invoiceDetailDto(unwrapOrThrow(await getInvoiceById(deps, ctxOf(req), id)), todayOf(deps));
      });
      scope.post("/invoices", { preHandler: perm("finance.invoice.create") }, async (req, reply) => {
        const b = parse(financeCreateInvoiceBodySchema, req.body);
        const cur = b.currency ?? currency;
        const key = idempotencyKeyOf(req, b.idempotencyKey);
        const result = unwrapOrThrow(
          await createInvoice(deps, ctxOf(req), {
            learnerId: b.learnerId,
            ...(b.enrollmentId ? { enrollmentId: b.enrollmentId } : {}),
            ...(b.academicYear ? { academicYear: b.academicYear } : {}),
            lines: b.lines.map((l) => ({
              ...(l.feeId ? { feeId: l.feeId } : {}),
              ...(l.sourceRef ? { sourceRef: l.sourceRef } : {}),
              category: l.category,
              description: l.description,
              ...(l.quantity ? { quantity: l.quantity } : {}),
              unitAmount: m(l.unitAmount, cur),
            })),
            ...(b.groupKey ? { groupKey: b.groupKey } : {}),
            ...(b.groupLabel ? { groupLabel: b.groupLabel } : {}),
            ...(b.discountIds ? { discountIds: b.discountIds } : {}),
            ...(b.applyFunding !== undefined ? { applyFunding: b.applyFunding } : {}),
            ...(b.dueDate ? { dueDate: b.dueDate } : {}),
            ...(b.installments ? { installments: toInstallmentSpec(b.installments, cur, m) } : {}),
            ...(b.issue !== undefined ? { issue: b.issue } : {}),
            ...(key ? { idempotencyKey: key } : {}),
          }),
        );
        return reply.status(result.replayed ? 200 : 201).send(invoicesResultDto(result, deps));
      });
      scope.post("/invoices/from-schedule", { preHandler: perm("finance.invoice.create") }, async (req, reply) => {
        const b = parse(financeInvoiceFromScheduleBodySchema, req.body);
        const key = idempotencyKeyOf(req, b.idempotencyKey);
        const result = unwrapOrThrow(await issueInvoiceFromSchedule(deps, ctxOf(req), fromScheduleInput(b, key, currency, m)));
        return reply.status(result.replayed ? 200 : 201).send(invoicesResultDto(result, deps));
      });
      scope.post("/invoices/from-schedule/preview", { preHandler: perm("finance.invoice.read") }, async (req) => {
        const b = parse(financeInvoiceFromScheduleBodySchema, req.body);
        return present.invoicePreviewDto(unwrapOrThrow(await previewInvoiceFromSchedule(deps, ctxOf(req), fromScheduleInput(b, undefined, currency, m))));
      });
      scope.post("/invoices/:id/issue", { preHandler: perm("finance.invoice.create") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        return present.invoiceDetailDto(unwrapOrThrow(await issueInvoice(deps, ctxOf(req), { invoiceId: id })), todayOf(deps));
      });
      scope.post("/invoices/:id/cancel", { preHandler: perm("finance.invoice.cancel") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeCancelInvoiceBodySchema, req.body);
        return present.invoiceDetailDto(unwrapOrThrow(await cancelInvoice(deps, ctxOf(req), { invoiceId: id, reason: b.reason })), todayOf(deps));
      });
      scope.post("/invoices/:id/installments", { preHandler: perm("finance.invoice.create") }, async (req) => {
        const ctx = ctxOf(req);
        await requireFeature(ctx, "finance.installments");
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeGenerateInstallmentsBodySchema, req.body);
        const spec = toInstallmentSpec(b, currency, m);
        return present.invoiceDetailDto(unwrapOrThrow(await generateInstallmentPlan(deps, ctx, { invoiceId: id, ...spec })), todayOf(deps));
      });
      scope.post("/invoices/:id/credit-notes", { preHandler: perm("finance.invoice.cancel") }, async (req, reply) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeCreditNoteBodySchema, req.body);
        const r = unwrapOrThrow(await issueCreditNote(deps, ctxOf(req), { invoiceId: id, amount: m(b.amount, b.currency), reason: b.reason }));
        return reply.status(201).send({ creditNote: present.creditNoteDto(r.creditNote), invoice: present.invoiceDetailDto(r.invoice, todayOf(deps)) });
      });

      // ----- Rapprochement : paiements en attente et résolutions manuelles (quatre yeux) -------------
      // Lecture : `finance.payment.read`. Résolution : `finance.payment.reconcile` (SENSIBLE, MFA) ; l'approbateur est
      // une AUTRE personne que le demandeur (contrôlé par le cas d'usage). « Vérifier maintenant » reste `POST /payments/:id/verify`.
      scope.get("/payments/pending", { preHandler: perm("finance.payment.read") }, async (req) => {
        const q = parse(financeListPendingPaymentsQuerySchema, req.query);
        const page = unwrapOrThrow(
          await listPendingReconciliations(deps, ctxOf(req), {
            limit: q.limit,
            offset: q.offset,
            ...(q.flagged !== undefined ? { flagged: q.flagged } : {}),
            ...(q.provider ? { provider: q.provider } : {}),
            ...(q.olderThanMinutes !== undefined ? { olderThan: new Date(deps.clock.now().getTime() - q.olderThanMinutes * 60_000) } : {}),
          }),
        );
        return { items: page.items.map(present.pendingPaymentDto), total: page.total };
      });
      // ----- Webhooks en échec : lecture (`finance.webhook.read`) et rejeu sûr (`finance.webhook.replay`, SENSIBLE) -------
      // Jamais de charge brute ni de secret dans les réponses ; le rejeu interroge le fournisseur (aucune issue imposée).
      scope.get("/webhook-events", { preHandler: perm("finance.webhook.read") }, async (req) => {
        const q = parse(financeListWebhookEventsQuerySchema, req.query);
        const page = unwrapOrThrow(
          await listWebhookEventsPage(deps, ctxOf(req), {
            status: q.status,
            limit: q.limit,
            offset: q.offset,
            ...(q.provider ? { provider: q.provider } : {}),
            ...(q.paymentId ? { paymentId: q.paymentId } : {}),
          }),
        );
        return { items: page.items.map(present.webhookEventDto), total: page.total };
      });
      scope.get("/webhook-events/:id", { preHandler: perm("finance.webhook.read") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        return present.webhookEventDto(unwrapOrThrow(await getWebhookEventView(deps, ctxOf(req), id)));
      });
      scope.post("/webhook-events/:id/replay", { preHandler: perm("finance.webhook.replay") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeReplayWebhookEventBodySchema, req.body ?? {});
        const r = unwrapOrThrow(await replayFailedWebhookEvent(deps, ctxOf(req), { id, ...(b.note ? { note: b.note } : {}) }));
        return { replayed: r.replayed, resolved: r.resolved, event: present.webhookEventDto(r.event), paymentStatus: r.paymentStatus };
      });
      scope.get("/resolutions", { preHandler: perm("finance.payment.read") }, async (req) => {
        const q = parse(financeListResolutionsQuerySchema, req.query);
        const items = unwrapOrThrow(
          await listManualResolutions(deps, ctxOf(req), {
            limit: q.limit,
            offset: q.offset,
            ...(q.status ? { status: q.status } : {}),
            ...(q.paymentId ? { paymentId: q.paymentId } : {}),
            ...(q.refundId ? { refundId: q.refundId } : {}),
          }),
        );
        return { items: items.map(present.resolutionDto) };
      });
      scope.post("/resolutions", { preHandler: perm("finance.payment.reconcile") }, async (req, reply) => {
        const b = parse(financeRequestResolutionBodySchema, req.body);
        const row = unwrapOrThrow(
          await requestManualResolution(deps, ctxOf(req), {
            ...(b.paymentId ? { paymentId: b.paymentId } : {}),
            ...(b.refundId ? { refundId: b.refundId } : {}),
            outcome: b.outcome,
            reason: b.reason,
            evidenceRef: b.evidenceRef,
          }),
        );
        return reply.status(201).send(present.resolutionDto(row));
      });
      scope.post("/resolutions/:id/approve", { preHandler: perm("finance.payment.reconcile") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeDecideResolutionBodySchema, req.body);
        return present.resolutionDto(unwrapOrThrow(await approveManualResolution(deps, ctxOf(req), { resolutionId: id, ...(b.note ? { note: b.note } : {}) })));
      });
      scope.post("/resolutions/:id/reject", { preHandler: perm("finance.payment.reconcile") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeDecideResolutionBodySchema, req.body);
        return present.resolutionDto(unwrapOrThrow(await rejectManualResolution(deps, ctxOf(req), { resolutionId: id, ...(b.note ? { note: b.note } : {}) })));
      });

      // ----- Paiements ------------------------------------------------------------------------
      scope.get("/payments", { preHandler: perm("finance.payment.read") }, async (req) => {
        const q = parse(financeListPaymentsQuerySchema, req.query);
        const page = unwrapOrThrow(
          await listPaymentPage(deps, ctxOf(req), {
            limit: q.limit,
            offset: q.offset,
            ...(q.learnerId ? { learnerId: q.learnerId } : {}),
            ...(q.status ? { status: q.status } : {}),
            ...(q.method ? { method: q.method } : {}),
            ...(q.from ? { from: q.from } : {}),
            ...(q.to ? { to: q.to } : {}),
          }),
        );
        return { items: page.items.map(present.paymentDto), total: page.total };
      });
      scope.get("/payments/:id", { preHandler: perm("finance.payment.read") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        return present.paymentViewDto(unwrapOrThrow(await getPaymentView(deps, ctxOf(req), id)));
      });
      scope.post("/payments", { preHandler: perm("finance.payment.create") }, async (req, reply) => {
        const b = parse(financeRecordPaymentBodySchema, req.body);
        const key = idempotencyKeyOf(req, b.idempotencyKey);
        if (!key) throw ValidationError.field("idempotencyKey", "Une clé d'idempotence est obligatoire (en-tête Idempotency-Key).", "finance.invalid_input");
        const cur = b.currency ?? currency;
        const view = unwrapOrThrow(
          await recordManualPayment(deps, ctxOf(req), {
            idempotencyKey: key,
            learnerId: b.learnerId,
            ...(b.enrollmentId ? { enrollmentId: b.enrollmentId } : {}),
            amount: m(b.amount, cur),
            method: b.method,
            ...(b.reference ? { reference: b.reference } : {}),
            ...(b.payerName ? { payerName: b.payerName } : {}),
            ...(b.payerKind ? { payerKind: b.payerKind } : {}),
            ...(b.payerRef ? { payerRef: b.payerRef } : {}),
            ...(b.allocation ? { allocation: toAllocationSpec(b.allocation, cur, m) } : {}),
            ...(b.receivedAt ? { receivedAt: new Date(b.receivedAt) } : {}),
          }),
        );
        return reply.status(view.replayed ? 200 : 201).send(present.paymentViewDto(view));
      });
      scope.post("/payments/online", { preHandler: withFeature("finance.payment.create", "finance.online-payment") }, async (req, reply) => {
        const ctx = ctxOf(req);
        await requireFeature(ctx, "finance.online-payment");
        const b = parse(financeInitiateOnlinePaymentBodySchema, req.body);
        const key = idempotencyKeyOf(req, b.idempotencyKey);
        if (!key) throw ValidationError.field("idempotencyKey", "Une clé d'idempotence est obligatoire (en-tête Idempotency-Key).", "finance.invalid_input");
        const view = unwrapOrThrow(
          await initiateOnlinePayment(deps, ctx, {
            idempotencyKey: key,
            learnerId: b.learnerId,
            ...(b.enrollmentId ? { enrollmentId: b.enrollmentId } : {}),
            amount: m(b.amount, b.currency),
            provider: b.provider,
            ...(b.invoiceId ? { invoiceId: b.invoiceId } : {}),
            ...(b.payer ? { payer: stripUndefined(b.payer) } : {}),
            ...(b.returnUrl ? { returnUrl: b.returnUrl } : {}),
            ...(b.description ? { description: b.description } : {}),
            ...(b.metadata ? { metadata: b.metadata } : {}),
          }),
        );
        return reply.status(view.replayed ? 200 : 201).send(present.onlinePaymentDto(view));
      });
      scope.post("/payments/:id/verify", { preHandler: withFeature("finance.payment.create", "finance.online-payment") }, async (req) => {
        const ctx = ctxOf(req);
        await requireFeature(ctx, "finance.online-payment");
        const { id } = parse(financeIdParamsSchema, req.params);
        return present.paymentViewDto(unwrapOrThrow(await verifyPendingPayment(deps, ctx, { paymentId: id })));
      });
      scope.post("/payments/:id/allocations", { preHandler: perm("finance.payment.create") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeAllocatePaymentBodySchema, req.body);
        const view = unwrapOrThrow(await allocatePayment(deps, ctxOf(req), { paymentId: id, allocation: toAllocationSpec(b.allocation, currency, m) as never }));
        return present.paymentViewDto(view);
      });
      scope.post("/payments/:id/refunds", { preHandler: perm("finance.payment.refund") }, async (req, reply) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeRequestRefundBodySchema, req.body);
        const key = idempotencyKeyOf(req, b.idempotencyKey);
        const refund = unwrapOrThrow(
          await requestRefund(deps, ctxOf(req), { paymentId: id, amount: m(b.amount, b.currency), reason: b.reason, ...(key ? { idempotencyKey: key } : {}) }),
        );
        return reply.status(201).send(present.refundDto(refund));
      });

      // ----- Remboursements -------------------------------------------------------------------
      scope.get("/refunds", { preHandler: perm("finance.payment.read") }, async (req) => {
        const q = parse(financeListRefundsQuerySchema, req.query);
        const items = unwrapOrThrow(
          await listRefundPage(deps, ctxOf(req), { limit: q.limit, offset: q.offset, ...(q.paymentId ? { paymentId: q.paymentId } : {}), ...(q.status ? { status: q.status } : {}) }),
        );
        return { items: items.map(present.refundDto) };
      });
      scope.get("/refunds/:id", { preHandler: perm("finance.payment.read") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        return present.refundDto(unwrapOrThrow(await getRefundById(deps, ctxOf(req), id)));
      });
      scope.post("/refunds/:id/approve", { preHandler: perm("finance.payment.refund") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeApproveRefundBodySchema, req.body);
        return present.refundDto(
          unwrapOrThrow(
            await approveRefund(deps, ctxOf(req), {
              refundId: id,
              ...(b.complete !== undefined ? { complete: b.complete } : {}),
              ...(b.manual ? { manual: stripUndefined(b.manual) as { reference: string; note?: string } } : {}),
            }),
          ),
        );
      });
      scope.post("/refunds/:id/complete", { preHandler: perm("finance.payment.refund") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeCompleteRefundBodySchema, req.body);
        return present.refundDto(
          unwrapOrThrow(await completeRefund(deps, ctxOf(req), { refundId: id, ...(b.manual ? { manual: stripUndefined(b.manual) as { reference: string; note?: string } } : {}) })),
        );
      });
      scope.post("/refunds/:id/reject", { preHandler: perm("finance.payment.refund") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeRejectRefundBodySchema, req.body);
        return present.refundDto(unwrapOrThrow(await rejectRefund(deps, ctxOf(req), { refundId: id, reason: b.reason })));
      });

      // ----- Reçus ----------------------------------------------------------------------------
      scope.get("/receipts", { preHandler: perm("finance.receipt.read") }, async (req) => {
        const q = parse(financeListReceiptsQuerySchema, req.query);
        const page = unwrapOrThrow(await listReceiptPage(deps, ctxOf(req), { limit: q.limit, offset: q.offset, ...(q.learnerId ? { learnerId: q.learnerId } : {}) }));
        return { items: page.items.map(present.receiptDto), total: page.total };
      });
      scope.get("/receipts/:id", { preHandler: perm("finance.receipt.read") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        return present.receiptDto(unwrapOrThrow(await getReceiptById(deps, ctxOf(req), id)));
      });
      scope.get("/receipts/:id/pdf", { preHandler: perm("finance.receipt.read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const { id } = parse(financeIdParamsSchema, req.params);
        const receipt = unwrapOrThrow(await getReceiptById(deps, ctx, id));
        return sendDocument(reply, unwrapOrThrow(await getReceiptPdf(deps, ctx, receipt, "STAFF")));
      });
      scope.get("/payments/:id/receipt", { preHandler: perm("finance.receipt.read") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        return present.receiptDto(unwrapOrThrow(await getReceiptOfPayment(deps, ctxOf(req), id)));
      });

      // ----- Vues FAMILLE : parent (`finance.child.*`) et élève (`finance.self.*`) ---------------------------------
      // Deux couches : permission RBAC (au moins une des deux) PUIS propriété relue côté serveur (lien de tutelle /
      // identité de l'élève). Hors périmètre, TOUJOURS la même 404 `finance.not_found`.
      scope.get("/me/learners", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const items = unwrapOrThrow(await listMyLearners(deps, ctx, probeOf(req, reply)));
        const names = await learnerNames(deps, ctx, items.map((i) => i.learnerId));
        return { items: items.map((i) => present.familyLearnerDto(i, names)) };
      });
      scope.get("/me/learners/:learnerId/statement", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const access = await familyAccess(req, reply, "read");
        const q = parse(financeFamilyStatementQuerySchema, req.query);
        return present.familyStatementDto(unwrapOrThrow(await getFamilyStatement(deps, ctx, access, { ...(q.academicYear ? { academicYear: q.academicYear } : {}), ...(q.currency ? { currency: q.currency } : {}) })));
      });
      scope.get("/me/learners/:learnerId/invoices", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const access = await familyAccess(req, reply, "read");
        const q = parse(financeFamilyInvoicesQuerySchema, req.query);
        const page = unwrapOrThrow(await listFamilyInvoices(deps, ctx, access, { limit: q.limit, offset: q.offset, ...(q.academicYear ? { academicYear: q.academicYear } : {}), ...(q.status ? { status: q.status } : {}) }));
        return { items: page.items.map(present.familyInvoiceSummaryDto), total: page.total };
      });
      scope.get("/me/learners/:learnerId/invoices/:id", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const access = await familyAccess(req, reply, "read");
        const { id } = parse(financeFamilyItemParamsSchema, req.params);
        return present.familyInvoiceDetailDto(unwrapOrThrow(await getFamilyInvoice(deps, ctx, access, id)), todayOf(deps));
      });
      scope.get("/me/learners/:learnerId/installments", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const access = await familyAccess(req, reply, "read");
        const q = parse(financeFamilyInstallmentsQuerySchema, req.query);
        const rows = unwrapOrThrow(await listFamilyInstallments(deps, ctx, access, { openOnly: q.open === true }));
        const today = todayOf(deps);
        return { items: rows.map((r) => present.familyInstallmentDto(r, today)) };
      });
      scope.get("/me/learners/:learnerId/payments", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const access = await familyAccess(req, reply, "read");
        const q = parse(financeFamilyPaymentsQuerySchema, req.query);
        const page = unwrapOrThrow(await listFamilyPayments(deps, ctx, access, { limit: q.limit, offset: q.offset, ...(q.status ? { status: q.status } : {}) }));
        return { items: page.items.map(present.familyPaymentDto), total: page.total };
      });
      scope.get("/me/learners/:learnerId/payments/:id", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const access = await familyAccess(req, reply, "read");
        const { id } = parse(financeFamilyItemParamsSchema, req.params);
        return present.familyPaymentViewDto(unwrapOrThrow(await getFamilyPayment(deps, ctx, access, id)));
      });
      scope.get("/me/learners/:learnerId/receipts", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const access = await familyAccess(req, reply, "read");
        const q = parse(financeFamilyReceiptsQuerySchema, req.query);
        const page = unwrapOrThrow(await listFamilyReceipts(deps, ctx, access, { limit: q.limit, offset: q.offset }));
        return { items: page.items.map(present.receiptDto), total: page.total };
      });
      scope.get("/me/learners/:learnerId/receipts/:id", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const access = await familyAccess(req, reply, "read");
        const { id } = parse(financeFamilyItemParamsSchema, req.params);
        return present.receiptDto(unwrapOrThrow(await getFamilyReceipt(deps, ctx, access, id)));
      });
      scope.get("/me/learners/:learnerId/receipts/:id/pdf", { preHandler: familyGuard("read") }, async (req, reply) => {
        const ctx = ctxOf(req);
        const access = await familyAccess(req, reply, "read");
        const { id } = parse(financeFamilyItemParamsSchema, req.params);
        const receipt = unwrapOrThrow(await getFamilyReceipt(deps, ctx, access, id));
        return sendDocument(reply, unwrapOrThrow(await getReceiptPdf(deps, ctx, receipt, access.relation === "SELF" ? "SELF" : "GUARDIAN")));
      });
      scope.post("/me/learners/:learnerId/payments/online", { preHandler: familyGuard("pay", "finance.online-payment") }, async (req, reply) => {
        const ctx = ctxOf(req);
        await requireFeature(ctx, "finance.online-payment");
        const access = await familyAccess(req, reply, "pay");
        const b = parse(financeFamilyInitiatePaymentBodySchema, req.body);
        const key = idempotencyKeyOf(req, b.idempotencyKey);
        if (!key) throw ValidationError.field("idempotencyKey", "Une clé d'idempotence est obligatoire (en-tête Idempotency-Key).", "finance.invalid_input");
        const view = unwrapOrThrow(
          await initiateFamilyOnlinePayment(deps, ctx, access, {
            idempotencyKey: key,
            invoiceId: b.invoiceId,
            amount: m(b.amount, b.currency),
            provider: b.provider,
            ...(b.payer ? { payer: stripUndefined(b.payer) } : {}),
            ...(b.returnUrl ? { returnUrl: b.returnUrl } : {}),
            ...(b.description ? { description: b.description } : {}),
          }),
        );
        return reply.status(view.replayed ? 200 : 201).send(present.familyOnlinePaymentDto(view));
      });
      scope.post("/me/learners/:learnerId/payments/:id/verify", { preHandler: familyGuard("pay", "finance.online-payment") }, async (req, reply) => {
        const ctx = ctxOf(req);
        await requireFeature(ctx, "finance.online-payment");
        const access = await familyAccess(req, reply, "pay");
        const { id } = parse(financeFamilyItemParamsSchema, req.params);
        return present.familyPaymentViewDto(unwrapOrThrow(await verifyFamilyPayment(deps, ctx, access, id)));
      });

      // ----- Caisses --------------------------------------------------------------------------
      scope.get("/cash-registers", { preHandler: perm("finance.cashregister.open") }, async (req) => ({
        items: unwrapOrThrow(await listRegisters(deps, ctxOf(req))).map(present.cashRegisterDto),
      }));
      scope.post("/cash-registers", { preHandler: perm("finance.fee.manage") }, async (req, reply) => {
        const b = parse(financeCreateCashRegisterBodySchema, req.body);
        const r = unwrapOrThrow(await createCashRegister(deps, ctxOf(req), { code: b.code, name: b.name, ...(b.campusId ? { campusId: b.campusId } : {}) }));
        return reply.status(201).send(present.cashRegisterDto(r));
      });
      scope.post("/cash-registers/:id/sessions", { preHandler: perm("finance.cashregister.open") }, async (req, reply) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeOpenCashSessionBodySchema, req.body);
        const s = unwrapOrThrow(await openCashSession(deps, ctxOf(req), { registerId: id, openingFloat: m(b.openingFloat, b.currency) }));
        return reply.status(201).send(present.cashSessionDto(s));
      });
      scope.get("/cash-sessions", { preHandler: perm("finance.cashregister.open") }, async (req) => {
        const q = parse(financeListCashSessionsQuerySchema, req.query);
        const items = unwrapOrThrow(
          await listSessionPage(deps, ctxOf(req), {
            limit: q.limit,
            offset: q.offset,
            ...(q.registerId ? { registerId: q.registerId } : {}),
            ...(q.cashierId ? { cashierId: q.cashierId } : {}),
            ...(q.status ? { status: q.status } : {}),
          }),
        );
        return { items: items.map(present.cashSessionDto) };
      });
      scope.get("/cash-sessions/mine", { preHandler: perm("finance.cashregister.open") }, async (req) => {
        const s = unwrapOrThrow(await getMyOpenSession(deps, ctxOf(req)));
        return { session: s ? present.cashSessionDto(s) : null };
      });
      scope.get("/cash-sessions/:id", { preHandler: perm("finance.cashregister.open") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        return present.cashSessionSummaryDto(unwrapOrThrow(await getCashSessionSummary(deps, ctxOf(req), id)));
      });
      scope.post("/cash-sessions/:id/close", { preHandler: perm("finance.cashregister.close") }, async (req) => {
        const { id } = parse(financeIdParamsSchema, req.params);
        const b = parse(financeCloseCashSessionBodySchema, req.body);
        return present.cashSessionSummaryDto(
          unwrapOrThrow(await closeCashSession(deps, ctxOf(req), { sessionId: id, countedAmount: m(b.countedAmount, b.currency), ...(b.note ? { note: b.note } : {}) })),
        );
      });

      // ----- Exports CSV serveur (jeu complet jusqu'au plafond ; troncature signalée) -----------------------------
      const registerExport = <S extends ZodTypeAny>(
        dataset: ExportDataset,
        permission: string,
        schema: S,
        file: string,
        run: (ctx: RequestContext, filter: never, options: ExportOptions) => Promise<Result<CsvExport>>,
      ): void => {
        scope.get(`/exports/${dataset}`, { preHandler: perm(permission) }, async (req, reply) => {
          const ctx = ctxOf(req);
          const filter = stripUndefined(parse(schema, req.query) as Record<string, unknown>) as never;
          const out = unwrapOrThrow(await run(ctx, filter, {}));
          const names = Object.values(FINANCE_EXPORT_HEADERS);
          return reply
            .header("Content-Type", "text/csv; charset=utf-8")
            .header("Content-Disposition", `attachment; filename="${file}-${todayOf(deps)}.csv"`)
            .header("Cache-Control", "no-store")
            .header(FINANCE_EXPORT_HEADERS.truncated, String(out.truncated))
            .header(FINANCE_EXPORT_HEADERS.rowCount, String(out.rowCount))
            .header(FINANCE_EXPORT_HEADERS.totalCount, String(out.totalCount))
            .header(FINANCE_EXPORT_HEADERS.maxRows, String(out.maxRows))
            .header("Access-Control-Expose-Headers", ["content-disposition", ...names].join(", "))
            .send(out.csv);
        });
        scope.get(`/exports/${dataset}/meta`, { preHandler: perm(permission) }, async (req) => {
          const ctx = ctxOf(req);
          const filter = stripUndefined(parse(schema, req.query) as Record<string, unknown>) as never;
          const { csv: _csv, ...meta } = unwrapOrThrow(await run(ctx, filter, { metaOnly: true }));
          return meta;
        });
      };
      registerExport("invoices", "finance.invoice.read", financeExportInvoicesQuerySchema, "factures", (ctx, f, o) => exportInvoicesCsv(deps, ctx, f, o));
      registerExport("payments", "finance.payment.read", financeExportPaymentsQuerySchema, "paiements", (ctx, f, o) => exportPaymentsCsv(deps, ctx, f, o));
      registerExport("receivables", "finance.report.read", financeExportReceivablesQuerySchema, "creances", (ctx, f, o) => exportReceivablesCsv(deps, ctx, f, o));

      // ----- Fournisseurs de paiement : configuration par tenant (permission SENSIBLE) ---------------
      const manageProviders = perm("finance.provider.manage");
      scope.get("/providers", { preHandler: manageProviders }, async (req) => present.providerListDto(unwrapOrThrow(await listProviders(deps, ctxOf(req)))));
      // `rotate-secrets` est déclarée AVANT `/providers/:provider/...` : jamais confondue avec un nom de fournisseur.
      scope.post("/providers/rotate-secrets", { preHandler: manageProviders }, async (req) => {
        const r = unwrapOrThrow(await rotateProviderSecrets(deps, ctxOf(req)));
        return { rotated: r.rotated, keyId: r.keyId };
      });
      scope.put("/providers/:provider", { preHandler: manageProviders }, async (req) => {
        const { provider } = parse(financeProviderParamsSchema, req.params);
        const b = parse(financeSaveProviderBodySchema, req.body);
        return present.providerDto(
          unwrapOrThrow(
            await saveProviderConfig(deps, ctxOf(req), {
              provider,
              ...(b.mode ? { mode: b.mode } : {}),
              ...(b.settings ? { settings: b.settings } : {}),
              ...(b.secrets ? { secrets: b.secrets } : {}),
              ...(b.clearSecrets ? { clearSecrets: b.clearSecrets } : {}),
              ...(b.regenerateWebhookSecret ? { regenerateWebhookSecret: true } : {}),
            }),
          ),
        );
      });
      scope.patch("/providers/:provider/status", { preHandler: manageProviders }, async (req) => {
        const { provider } = parse(financeProviderParamsSchema, req.params);
        const b = parse(financeProviderStatusBodySchema, req.body);
        return present.providerDto(unwrapOrThrow(await setProviderStatus(deps, ctxOf(req), { provider, enabled: b.enabled })));
      });
      scope.post("/providers/:provider/test", { preHandler: manageProviders }, async (req) => {
        const { provider } = parse(financeProviderParamsSchema, req.params);
        const r = unwrapOrThrow(await testProviderConnection(deps, ctxOf(req), { provider }));
        return { ok: r.ok, code: r.code, at: r.at.toISOString() };
      });
      scope.delete("/providers/:provider/credentials", { preHandler: manageProviders }, async (req) => {
        const { provider } = parse(financeProviderParamsSchema, req.params);
        return present.providerDto(unwrapOrThrow(await clearProviderCredentials(deps, ctxOf(req), { provider })));
      });

      // ----- Reporting ------------------------------------------------------------------------
      scope.get("/reports/summary", { preHandler: perm("finance.report.read") }, async (req) =>
        present.summaryDto(unwrapOrThrow(await getFinanceSummary(deps, ctxOf(req), reportFilter(parse(financeReportQuerySchema, req.query))))),
      );
      scope.get("/reports/receivables-by-group", { preHandler: perm("finance.report.read") }, async (req) => ({
        items: unwrapOrThrow(await getReceivablesByGroup(deps, ctxOf(req), reportFilter(parse(financeReportQuerySchema, req.query)))).map(present.receivableRowDto),
      }));
      scope.get("/reports/receivables-by-learner", { preHandler: perm("finance.report.read") }, async (req) => {
        const q = parse(financeReceivablesByLearnerQuerySchema, req.query);
        const page = unwrapOrThrow(
          await getReceivablesByLearner(deps, ctxOf(req), { ...reportFilter(q), limit: q.limit, offset: q.offset, ...(q.onlyOutstanding !== undefined ? { onlyOutstanding: q.onlyOutstanding } : {}) }),
        );
        const names = await learnerNames(deps, ctxOf(req), page.items.map((r) => r.learnerId));
        return { items: page.items.map((r) => present.learnerReceivableRowDto(r, names)), total: page.total };
      });
      scope.get("/reports/collections-trend", { preHandler: perm("finance.report.read") }, async (req) => {
        const q = parse(financeCollectionsTrendQuerySchema, req.query);
        const points = unwrapOrThrow(
          await getCollectionsTrend(deps, ctxOf(req), { from: q.from, to: q.to, ...(q.granularity ? { granularity: q.granularity } : {}), ...(q.currency ? { currency: q.currency } : {}) }),
        );
        return { items: points.map(present.trendPointDto) };
      });
      scope.get("/reports/aged-balance", { preHandler: perm("finance.report.read") }, async (req) => {
        const q = parse(financeAgedBalanceQuerySchema, req.query);
        return present.agedBalanceDto(unwrapOrThrow(await getAgedBalance(deps, ctxOf(req), { ...reportFilter(q), ...(q.byLearner ? { byLearner: q.byLearner } : {}) })));
      });
    },
    { prefix: options.prefix ?? FINANCE_ROUTES_PREFIX },
  );

  // ----- Webhooks fournisseurs (publics, corps brut) --------------------------------------------
  await app.register(
    async (hooks) => {
      hooks.setErrorHandler((error, request, reply) => handleError(error, request, reply));
      // Le corps JSON est conservé BRUT : la signature se vérifie sur les octets reçus.
      hooks.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 262_144 }, (_req, body, done) => done(null, body));
      // CinetPay notifie en `application/x-www-form-urlencoded` ; l'adaptateur relit le corps BRUT.
      hooks.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 262_144 }, (_req, body, done) => done(null, body));
      // POST (Wave, Orange, CinetPay, TresorPay) et PUT (rappel MTN MoMo).
      hooks.route({
        method: ["POST", "PUT"],
        url: "/webhooks/:provider/:tenantId",
        config: { public: true },
        handler: async (req, reply) => {
          const { provider, tenantId } = parse(financeWebhookParamsSchema, req.params);
          const rawBody = typeof req.body === "string" ? req.body : "";
          const query: Record<string, string> = {};
          for (const [k, v] of Object.entries((req.query ?? {}) as Record<string, unknown>)) if (typeof v === "string") query[k] = v;
          const result = unwrapOrThrow(
            await handleProviderWebhook(deps, {
              tenantId,
              provider,
              rawBody,
              headers: req.headers as Record<string, string | string[] | undefined>,
              query,
              requestId: String(req.id),
            }),
          );
          return reply.status(200).send({ status: result.status, replayed: result.replayed, paymentId: result.paymentId });
        },
      });
      // Pas de GET : le garde-fou d'assemblage (phase 1, D3b) interdit toute route publique répondant favorablement sans
      // identifiants. Si CinetPay sondait l'URL de notification par un GET, il faudrait l'y déclarer explicitement (Q-PAY-27).
    },
    { prefix: options.prefix ?? FINANCE_ROUTES_PREFIX },
  );
}

/** Délai suggéré avant de redemander un PDF dont le rendu est en cours (secondes). */
const DOCUMENT_RETRY_AFTER_SECONDS = 3;

/** PDF prêt : 200 + pièce jointe, jamais mis en cache ; en cours : 202 + `Retry-After` ; rendu définitivement échoué : 409. */
function sendDocument(reply: FastifyReply, state: OfficialDocumentState) {
  if (state.status === "RENDERED" && state.bytes) {
    return reply
      .status(200)
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${state.fileName}"`)
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Document-Verification-Code", state.verificationCode)
      .send(Buffer.from(state.bytes));
  }
  if (state.status === "FAILED") {
    throw new ConflictError("Le rendu du document a échoué ; réessayez dans quelques instants.", { code: "finance.document_render_failed" });
  }
  return reply.status(202).header("Retry-After", String(DOCUMENT_RETRY_AFTER_SECONDS)).send({ status: state.status, retryAfterSeconds: DOCUMENT_RETRY_AFTER_SECONDS });
}

function maybeFastifyValidation(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    const e = error as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: "finance.payload_too_large" });
    if (e.statusCode === 415 || e.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return new ValidationError("Type de contenu non pris en charge (JSON attendu).", [], { code: "finance.unsupported_media_type" });
    }
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "finance.bad_request" });
  }
  return error;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

function reportFilter(q: z.infer<typeof financeReportQuerySchema>) {
  return {
    ...(q.academicYear ? { academicYear: q.academicYear } : {}),
    ...(q.campusId ? { campusId: q.campusId } : {}),
    ...(q.groupKey ? { groupKey: q.groupKey } : {}),
    ...(q.asOf ? { asOf: q.asOf } : {}),
    ...(q.currency ? { currency: q.currency } : {}),
  };
}

type MoneyFn = (amount: number | string, c?: CurrencyCode) => Money;

function toInstallmentSpec(
  spec: z.infer<typeof financeGenerateInstallmentsBodySchema>,
  currency: CurrencyCode,
  m: MoneyFn,
) {
  return {
    ...(spec.planId ? { planId: spec.planId } : {}),
    ...(spec.planCode ? { planCode: spec.planCode } : {}),
    ...(spec.baseDate ? { baseDate: spec.baseDate } : {}),
    ...(spec.steps
      ? {
          steps: spec.steps.map((s) => ({
            label: s.label,
            share: s.share.kind === "FIXED" ? { kind: "FIXED" as const, amount: m(s.share.amount, currency) } : { kind: "WEIGHT" as const, weight: s.share.weight },
            due: s.due,
          })),
        }
      : {}),
  };
}

function toAllocationSpec(a: z.infer<typeof financeRecordPaymentBodySchema>["allocation"] & object, currency: CurrencyCode, m: MoneyFn) {
  if (a.mode === "AUTO") return { mode: "AUTO" as const, ...(a.order ? { order: a.order } : {}), ...(a.invoiceIds ? { invoiceIds: a.invoiceIds } : {}) };
  if (a.mode === "MANUAL") {
    return { mode: "MANUAL" as const, items: a.items.map((i) => ({ installmentId: i.installmentId, amount: m(i.amount, currency), ...(i.lineId ? { lineId: i.lineId } : {}) })) };
  }
  return { mode: "NONE" as const };
}

function fromScheduleInput(
  b: z.infer<typeof financeInvoiceFromScheduleBodySchema>,
  key: string | undefined,
  currency: CurrencyCode,
  m: MoneyFn,
) {
  return {
    learnerId: b.learnerId,
    ...(b.enrollmentId ? { enrollmentId: b.enrollmentId } : {}),
    ...(b.academicYear ? { academicYear: b.academicYear } : {}),
    items: b.items.map((i) => ({
      ...(i.feeId ? { feeId: i.feeId } : {}),
      ...(i.feeCode ? { feeCode: i.feeCode } : {}),
      ...(i.quantity ? { quantity: i.quantity } : {}),
      ...(i.description ? { description: i.description } : {}),
    })),
    ...(b.scope ? { scope: stripUndefined(b.scope) } : {}),
    ...(b.groupKey ? { groupKey: b.groupKey } : {}),
    ...(b.groupLabel ? { groupLabel: b.groupLabel } : {}),
    ...(b.effectiveOn ? { effectiveOn: b.effectiveOn } : {}),
    ...(b.discountIds ? { discountIds: b.discountIds } : {}),
    ...(b.dueDate ? { dueDate: b.dueDate } : {}),
    ...(b.installments ? { installments: toInstallmentSpec(b.installments, currency, m) } : {}),
    ...(b.issue !== undefined ? { issue: b.issue } : {}),
    ...(b.ignoreFunding !== undefined ? { ignoreFunding: b.ignoreFunding } : {}),
    ...(key ? { idempotencyKey: key } : {}),
  };
}

function invoicesResultDto(result: { invoices: Parameters<typeof present.invoiceDetailDto>[0][]; replayed: boolean }, deps: FinanceDeps) {
  const today = todayOf(deps);
  return { replayed: result.replayed, invoices: result.invoices.map((d) => present.invoiceDetailDto(d, today)) };
}

/** `FINANCE_EXPORT_MAX_ROWS` : plafond de lignes d'un export CSV (entier de 1 à 500 000 ; sinon défaut 50 000). */
function exportMaxRowsOf(env: Readonly<Record<string, string | undefined>>): { exportMaxRows?: number } {
  const n = Number(env.FINANCE_EXPORT_MAX_ROWS);
  return Number.isInteger(n) && n >= 1 && n <= 500_000 ? { exportMaxRows: n } : {};
}

export { financeEnvironmentOf };

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports de finance (posé par `setup`, renseigné par `registerFinancePorts`). */
    financePorts: FinancePortRegistry;
  }
}

/** Décore la RACINE avec le registre de ports (visible des adaptateurs de plateforme, quel que soit l'ordre de chargement). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("financePorts")) app.decorate("financePorts", createFinancePortRegistry());
}

/** À appeler par la plateforme (adaptateurs) : annuaires `learners` (people) et `enrollments` (academic). */
export function registerFinancePorts(app: FastifyInstance, ports: Partial<FinancePortSet>): void {
  if (!app.hasDecorator("financePorts")) app.decorate("financePorts", createFinancePortRegistry());
  app.financePorts.register(ports);
}

/**
 * Contrat d'assemblage uniforme (`platform/runtime.ts`) : `(app, runtime)`, routes sans préfixe (le registre
 * applique `/api/v1/finance`). Le webhook `POST /webhooks/:provider/:tenantId` est déclaré `public` : il ne
 * porte aucun jeton, la signature fait foi (voir README).
 *
 * Variables : `FINANCE_ENV` (development|test|staging|production, défaut dérivé de NODE_ENV, sinon production —
 * aucune simulation), `FINANCE_WEBHOOK_BASE_URL`, `FINANCE_PROVIDER_<NOM>_<CLÉ>` (configuration des fournisseurs).
 */
export default async function financeModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("financePorts")) app.decorate("financePorts", createFinancePortRegistry());
  const audit = financeAuditAdapter(runtime.auditPort);
  // Registre, coffre (clé maître d'environnement ; absente ⇒ indisponible, jamais de clair) et configuration par tenant :
  // MÊME assemblage que le worker (rapprochement des paiements en attente).
  const { environment, secrets, providers, tenantConfig } = createFinanceProviderRuntime({
    db: runtime.tenantDb,
    clock: runtime.clock,
    logger: runtime.logger,
    env: runtime.env,
    audit,
  });
  const deps = createFinanceDeps({
    portsProvider: () => app.financePorts.current,
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit,
    logger: runtime.logger,
    providers,
    secrets,
    providerConfigChanged: (tenantId, provider) => tenantConfig.invalidate(tenantId, provider || undefined),
    config: {
      environment,
      webhookBaseUrl: runtime.env.FINANCE_WEBHOOK_BASE_URL?.trim() || null,
      ...exportMaxRowsOf(runtime.env),
      providerRefundAutoExecution: runtime.env.FINANCE_PROVIDER_REFUND_AUTO?.trim().toLowerCase() === "true",
      reconciliation: reconciliationConfigFromEnv(runtime.env),
    },
  });
  await app.register(financePlugin, {
    deps,
    prefix: "",
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    isFeatureEnabled: (ctx, featureKey) => runtime.entitlements.isFeatureEnabled(ctx, featureKey),
  });
}
