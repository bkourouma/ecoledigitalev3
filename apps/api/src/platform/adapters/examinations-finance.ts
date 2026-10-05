/**
 * examinations -> finance : `ExamFeesPort` — frais d'examen INTÉGRÉS à l'inscription du candidat (décision métier Q-E13).
 *
 * Passe EXCLUSIVEMENT par l'API publique de `finance` (jamais de SQL croisé) :
 *   - `listFeeCatalog` (catégorie EXAMS, frais actifs) pour paramétrer le barème de l'établissement ;
 *   - `issueInvoiceFromSchedule` pour facturer un ÉLÈVE : l'apprenant et son inscription fixent le périmètre des barèmes de `finance`
 *     (les montants restent ceux de `finance` ; ce module n'en invente aucun) ; IDEMPOTENT par la clé fournie ;
 *   - `getInvoiceById` pour relire en direct le statut de la facture et l'encaissé ;
 *   - `cancelInvoice` pour la désinscription : une facture ENCAISSÉE n'est jamais annulée (`hasPayments`) ; le remboursement est
 *     manuel (Q-PAY-32).
 *
 * Un candidat LIBRE n'a pas de compte famille : `finance` ne facture que des apprenants, l'adaptateur répond `MANUAL_REQUIRED` (la
 * facture à son nom ou à celui de son tuteur est à établir par la comptabilité) et ne transmet AUCUNE donnée personnelle.
 *
 * Écriture avec le VRAI audit de `finance` (dépendances d'écriture dédiées) ; l'appel est fait APRÈS la validation de l'inscription,
 * dans la transaction propre de `finance`.
 */
import { err, ok } from "@ecoledigitale/kernel";
import { cancelInvoice, createFinanceDeps, financeAuditAdapter, getInvoiceById, issueInvoiceFromSchedule, listFeeCatalog, type FinanceDeps, type FinancePortSet } from "../../modules/finance";
import { portUnavailable, type ExamFeesPort, type ExamInvoiceStatus } from "../../modules/examinations";
import type { RuntimeAuditPort } from "../runtime";
import type { AdapterKit } from "./kit";

type AuditRecorder = Pick<RuntimeAuditPort, "record">;
const noAudit: AuditRecorder = { async record() {} };

/** Dépendances d'ÉCRITURE de `finance` (vrai audit, vrais annuaires d'apprenants et d'inscriptions branchés par la plateforme). */
export function createExaminationsFinanceDeps(kit: AdapterKit, ports: () => Partial<FinancePortSet>, audit: AuditRecorder = noAudit): FinanceDeps {
  return createFinanceDeps({ db: kit.tenantDb, clock: kit.clock, logger: kit.logger, audit: financeAuditAdapter(audit), portsProvider: ports });
}

const INVOICE_STATUSES: readonly string[] = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED", "CREDITED"];

export function createExaminationsFees(finance: FinanceDeps): ExamFeesPort {
  return {
    async listCatalog(ctx) {
      const r = await listFeeCatalog(finance, ctx, { activeOnly: true, category: "EXAMS" });
      if (!r.ok) return r;
      return ok(r.value.map((f) => ({ feeId: f.id, code: f.code, label: f.name, currency: String(f.currency), active: f.active })));
    },

    async issueInvoice(ctx, input) {
      if (input.payer.kind === "EXTERNAL") return ok({ mode: "MANUAL_REQUIRED", reason: "NO_LEARNER_ACCOUNT" });
      const issued = await issueInvoiceFromSchedule(finance, ctx, {
        learnerId: input.payer.studentId,
        ...(input.payer.enrollmentId ? { enrollmentId: input.payer.enrollmentId } : {}),
        items: input.feeIds.map((feeId) => ({ feeId })),
        idempotencyKey: input.idempotencyKey,
      });
      if (!issued.ok) return issued;
      const first = issued.value.invoices[0];
      if (!first) return err(portUnavailable("finance", "issueInvoiceFromSchedule doit rendre au moins une facture"));
      // La facture de la FAMILLE est celle suivie ; une part prise en charge par un financeur est une facture sœur de `finance`.
      const family = issued.value.invoices.find((i) => i.invoice.payerKind === "LEARNER") ?? first;
      return ok({
        mode: "INVOICED",
        invoiceId: family.invoice.id,
        invoiceNumber: family.invoice.number,
        currency: String(family.invoice.currency),
        totalMinor: family.invoice.total.amount,
        lines: family.lines.map((l) => ({ feeId: l.feeId, label: l.description, amountMinor: l.total.amount })),
      });
    },

    async getInvoiceState(ctx, invoiceId) {
      const r = await getInvoiceById(finance, ctx, invoiceId);
      if (!r.ok) return r.error.code === "finance.invoice_not_found" ? ok(null) : r;
      const i = r.value.invoice;
      const status = INVOICE_STATUSES.includes(i.status) ? (i.status as ExamInvoiceStatus) : "ISSUED";
      return ok({ invoiceId: i.id, number: i.number, status, currency: String(i.currency), totalMinor: i.total.amount, paidMinor: i.paid.amount });
    },

    async cancelInvoice(ctx, input) {
      const current = await getInvoiceById(finance, ctx, input.invoiceId);
      if (!current.ok) return current;
      const i = current.value.invoice;
      if (i.status === "CANCELLED") return ok({ cancelled: true, hasPayments: false });
      // Une facture encaissée (ou créditée) ne s'annule jamais ici : remboursement manuel (Q-PAY-32).
      if (i.paid.isPositive() || i.credited.isPositive()) return ok({ cancelled: false, hasPayments: true });
      const r = await cancelInvoice(finance, ctx, { invoiceId: input.invoiceId, reason: input.reason });
      if (!r.ok) return r;
      return ok({ cancelled: true, hasPayments: false });
    },
  };
}
