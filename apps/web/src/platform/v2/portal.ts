"use client";

/**
 * Hooks des portails famille (parent, élève) : libellés, finance (`/finance/me/*`), bulletins d'un enfant, documents du supérieur.
 * Rien n'est calculé ici ni dans les écrans : les montants, moyennes et états sont ceux de l'API ; le périmètre (SES enfants, soi-même)
 * est appliqué par chaque module à chaque requête (lien de tutelle relu, 404 uniforme hors périmètre).
 *
 * Un « sujet » désigne qui l'on regarde : `me` (l'élève lui-même) ou `child` (un enfant lié au parent).
 */

import { z } from "zod";
import { academicFamilyLabelsDtoSchema, type AcademicFamilyLabelsDto } from "@ecoledigitale/contracts/v2/academic";
import {
  financeFamilyInitiatePaymentBodySchema,
  financeFamilyInstallmentDtoSchema,
  financeFamilyInvoiceDetailDtoSchema,
  financeFamilyInvoiceSummaryDtoSchema,
  financeFamilyLearnersDtoSchema,
  financeFamilyOnlinePaymentDtoSchema,
  financeFamilyPaymentDtoSchema,
  financeFamilyPaymentViewDtoSchema,
  financeFamilyStatementDtoSchema,
  financeReceiptDtoSchema,
  type FinanceFamilyInitiatePaymentBody,
} from "@ecoledigitale/contracts/v2/finance";
import { assessPublishedGradesPageDtoSchema } from "@ecoledigitale/contracts/v2/assess";
import { higherDocumentDtoSchema, higherPathwayDtoSchema } from "@ecoledigitale/contracts/v2/higher";
import { reportcardsReportCardPageDtoSchema } from "@ecoledigitale/contracts/v2/reportcards";
import { platformHooks as hooks } from "@/platform/api/default-client";
import { useApiAction } from "./actions";
import { REPORTCARDS_BASE } from "./reportcards";
import { useChildResults, useMyResults } from "./results";

export type FamilySubject = { kind: "me"; studentId?: string } | { kind: "child"; id: string };

/** Identifiant d'apprenant (finance) du sujet : l'enfant, ou le dossier de l'élève quand il est connu. */
export const learnerIdOf = (s: FamilySubject): string | null => (s.kind === "child" ? s.id : (s.studentId ?? null));

export const subjectKey = (s: FamilySubject | null): string => (s === null ? "none" : s.kind === "me" ? "me" : `child:${s.id}`);
const prefix = (s: FamilySubject): string => (s.kind === "me" ? "me" : `children/${s.id}`);

type Query = Record<string, string | number | boolean | undefined>;
const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

// ---------------------------------------------------------------------------
// Libellés (classes, périodes, matières)
// ---------------------------------------------------------------------------

export function useFamilyLabelsQuery(subject: FamilySubject | null) {
  return hooks.useApiQuery(["academic", "family-labels", subjectKey(subject)], `/api/v1/academic/${subject ? (subject.kind === "me" ? "me/labels" : `children/${subject.id}/labels`) : "me/labels"}`, {
    schema: academicFamilyLabelsDtoSchema,
    enabled: subject !== null,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export interface LabelLookup {
  /** Nom de la classe, ou `null` s'il n'est pas (encore) connu. */
  classroom(id: string | null | undefined): string | null;
  /** Libellé de la période (« Semestre 1 »), ou `null`. */
  period(id: string | null | undefined): string | null;
  /** Libellé de la matière / de l'UE / de l'ECUE, ou `null`. */
  node(id: string | null | undefined): string | null;
  /** Nœud complet (code, coefficient, crédits, parent), ou `null`. */
  nodeInfo(id: string | null | undefined): AcademicFamilyLabelsDto["nodes"][number] | null;
  isLoading: boolean;
}

export function labelLookupOf(data: AcademicFamilyLabelsDto | undefined, isLoading: boolean): LabelLookup {
  const classrooms = new Map((data?.classrooms ?? []).map((c) => [c.id, c.name]));
  const periods = new Map((data?.periods ?? []).map((p) => [p.id, p.label]));
  const nodes = new Map((data?.nodes ?? []).map((n) => [n.id, n]));
  return {
    classroom: (id) => (id ? (classrooms.get(id) ?? null) : null),
    period: (id) => (id ? (periods.get(id) ?? null) : null),
    node: (id) => (id ? (nodes.get(id)?.label ?? null) : null),
    nodeInfo: (id) => (id ? (nodes.get(id) ?? null) : null),
    isLoading,
  };
}

/** Annuaire d'affichage des portails : un libellé quand l'API en fournit un, sinon `null` (l'écran masque la mention). */
export function useFamilyLabels(subject: FamilySubject | null): LabelLookup {
  const q = useFamilyLabelsQuery(subject);
  return labelLookupOf(q.data, q.isFetching);
}

// ---------------------------------------------------------------------------
// Notes publiées et résultats (lecture famille : seules les notes PUBLIÉES, seuls les résultats FINAUX)
// ---------------------------------------------------------------------------

/** Notes publiées de l'élève (lui-même ou un enfant lié), paginées par curseur. */
export function useFamilyGrades(subject: FamilySubject | null, options: { academicPeriodId?: string } = {}) {
  return hooks.useApiInfiniteQuery(["assess", "family", "grades", subjectKey(subject), options.academicPeriodId ?? null], `/api/v1/assess/${subject ? (subject.kind === "me" ? "me/grades" : `children/${subject.id}/grades`) : "me/grades"}`, {
    schema: assessPublishedGradesPageDtoSchema,
    query: { limit: 100, ...(options.academicPeriodId ? { academicPeriodId: options.academicPeriodId } : {}) },
    getNextCursor: (page) => page.nextCursor,
    enabled: subject !== null,
    retry: false,
  });
}

/** Résultats FINAUX (périodes et année) de l'élève ou d'un enfant lié ; refus de l'API (403 hors tutelle, fonction éteinte) remontés tels quels. */
export function useFamilyResults(subject: FamilySubject | null) {
  const mine = useMyResults(subject?.kind === "me");
  const child = useChildResults(subject?.kind === "child" ? subject.id : null);
  return subject?.kind === "me" ? mine : child;
}

// ---------------------------------------------------------------------------
// Bulletins d'un enfant, documents du supérieur
// ---------------------------------------------------------------------------

export function useChildReportCards(studentId: string | null) {
  return hooks.useApiInfiniteQuery(["reportcards", "family", "child", studentId], `${REPORTCARDS_BASE}/children/${studentId}/report-cards`, {
    schema: reportcardsReportCardPageDtoSchema,
    query: { limit: 50 },
    getNextCursor: (page) => page.nextCursor,
    enabled: studentId !== null,
  });
}

export function useFamilyHigherDocuments(subject: FamilySubject | null) {
  return hooks.useApiQuery(["higher", "family", "documents", subjectKey(subject)], `/api/v1/higher/${subject ? prefix(subject) : "me"}/documents`, {
    schema: itemsOf(higherDocumentDtoSchema),
    select: (d) => d.items,
    enabled: subject !== null,
    retry: false,
  });
}

export function useFamilyPathway(subject: FamilySubject | null) {
  return hooks.useApiQuery(["higher", "family", "pathway", subjectKey(subject)], `/api/v1/higher/${subject ? prefix(subject) : "me"}/pathway`, { schema: higherPathwayDtoSchema, enabled: subject !== null, retry: false });
}

// ---------------------------------------------------------------------------
// Finance famille : `/api/v1/finance/me/*` (parent : `finance.child.*`, élève : `finance.self.*`)
// ---------------------------------------------------------------------------

export const FAMILY_FINANCE_BASE = "/api/v1/finance/me";
const FAMILY_KEY = ["finance", "family"] as const;

const invoicesPageSchema = z.object({ items: z.array(financeFamilyInvoiceSummaryDtoSchema), total: z.number().int() });
const paymentsPageSchema = z.object({ items: z.array(financeFamilyPaymentDtoSchema), total: z.number().int() });
const receiptsPageSchema = z.object({ items: z.array(financeReceiptDtoSchema), total: z.number().int() });

/** Apprenants que l'utilisateur peut suivre côté finance (ses enfants liés, ou lui-même) : liste faisant foi côté finance. */
export function useFamilyLearners(enabled = true) {
  return hooks.useApiQuery([...FAMILY_KEY, "learners"], `${FAMILY_FINANCE_BASE}/learners`, { schema: financeFamilyLearnersDtoSchema, select: (d) => d.items, enabled, retry: false });
}

export function useFamilyStatement(learnerId: string | null, query: { academicYear?: string } = {}) {
  return hooks.useApiQuery([...FAMILY_KEY, "statement", learnerId, query.academicYear ?? null], `${FAMILY_FINANCE_BASE}/learners/${learnerId}/statement`, {
    schema: financeFamilyStatementDtoSchema,
    query: query as Query,
    enabled: learnerId !== null,
    retry: false,
  });
}

export function useFamilyInvoices(learnerId: string | null, query: { limit?: number; offset?: number; status?: string } = {}) {
  return hooks.useApiQuery([...FAMILY_KEY, "invoices", learnerId, query.status ?? null, query.offset ?? 0], `${FAMILY_FINANCE_BASE}/learners/${learnerId}/invoices`, {
    schema: invoicesPageSchema,
    query: query as Query,
    enabled: learnerId !== null,
    retry: false,
  });
}

export function useFamilyInvoice(learnerId: string | null, id: string | null) {
  return hooks.useApiQuery([...FAMILY_KEY, "invoice", learnerId, id], `${FAMILY_FINANCE_BASE}/learners/${learnerId}/invoices/${id}`, {
    schema: financeFamilyInvoiceDetailDtoSchema,
    enabled: learnerId !== null && id !== null,
    retry: false,
  });
}

export function useFamilyInstallments(learnerId: string | null, query: { open?: boolean } = {}) {
  return hooks.useApiQuery([...FAMILY_KEY, "installments", learnerId, query.open ?? false], `${FAMILY_FINANCE_BASE}/learners/${learnerId}/installments`, {
    schema: itemsOf(financeFamilyInstallmentDtoSchema),
    select: (d) => d.items,
    query: query.open ? { open: true } : undefined,
    enabled: learnerId !== null,
    retry: false,
  });
}

export function useFamilyPayments(learnerId: string | null, query: { limit?: number; offset?: number } = {}) {
  return hooks.useApiQuery([...FAMILY_KEY, "payments", learnerId, query.offset ?? 0], `${FAMILY_FINANCE_BASE}/learners/${learnerId}/payments`, {
    schema: paymentsPageSchema,
    query: query as Query,
    enabled: learnerId !== null,
    retry: false,
  });
}

export function useFamilyPayment(learnerId: string | null, id: string | null) {
  return hooks.useApiQuery([...FAMILY_KEY, "payment", learnerId, id], `${FAMILY_FINANCE_BASE}/learners/${learnerId}/payments/${id}`, {
    schema: financeFamilyPaymentViewDtoSchema,
    enabled: learnerId !== null && id !== null,
    retry: false,
  });
}

export function useFamilyReceipts(learnerId: string | null, query: { limit?: number; offset?: number } = {}) {
  return hooks.useApiQuery([...FAMILY_KEY, "receipts", learnerId, query.offset ?? 0], `${FAMILY_FINANCE_BASE}/learners/${learnerId}/receipts`, {
    schema: receiptsPageSchema,
    query: query as Query,
    enabled: learnerId !== null,
    retry: false,
  });
}

export function useFamilyReceipt(learnerId: string | null, id: string | null) {
  return hooks.useApiQuery([...FAMILY_KEY, "receipt", learnerId, id], `${FAMILY_FINANCE_BASE}/learners/${learnerId}/receipts/${id}`, {
    schema: financeReceiptDtoSchema,
    enabled: learnerId !== null && id !== null,
    retry: false,
  });
}

export const familyReceiptPdfPath = (learnerId: string, id: string): string => `${FAMILY_FINANCE_BASE}/learners/${learnerId}/receipts/${id}/pdf`;

/**
 * Paiement en ligne initié par la famille. La facture visée est OBLIGATOIRE et le montant ne peut pas dépasser son reste dû
 * (contrôlé par l'API avant tout appel fournisseur). Clé d'idempotence : en-tête ET corps ; propre au compte côté serveur.
 */
export function useInitiateFamilyPayment() {
  return useApiAction({
    path: (v: { learnerId: string; body: FinanceFamilyInitiatePaymentBody; key: string }) => `${FAMILY_FINANCE_BASE}/learners/${v.learnerId}/payments/online`,
    body: (v) => ({ ...v.body, idempotencyKey: v.key }),
    idempotencyKey: (v) => v.key,
    schema: financeFamilyOnlinePaymentDtoSchema,
    invalidate: [FAMILY_KEY],
  });
}

/** Vérification auprès du fournisseur d'un paiement en attente de l'apprenant lié (suivi de statut). */
export function useVerifyFamilyPayment() {
  return useApiAction({
    path: (v: { learnerId: string; id: string }) => `${FAMILY_FINANCE_BASE}/learners/${v.learnerId}/payments/${v.id}/verify`,
    schema: financeFamilyPaymentViewDtoSchema,
    invalidate: [FAMILY_KEY],
  });
}

export { financeFamilyInitiatePaymentBodySchema };

// ---------------------------------------------------------------------------
// Coordonnées de la personne connectée (jamais l'identité) : élève, tuteur, personnel
// ---------------------------------------------------------------------------

export type OwnContactKind = "student" | "guardian" | "staff";

/**
 * Modification de SES coordonnées : `PATCH /people/me/student|guardian|staff` (permissions `student.self.update`,
 * `student.child.update`, `staff.own.update`). Seuls e-mail, téléphones et adresse sont modifiables ; le corps est validé par le contrat.
 */
export function useUpdateOwnContact(kind: OwnContactKind) {
  return useApiAction({
    method: "PATCH",
    path: `/api/v1/people/me/${kind}`,
    body: (v: Record<string, string | null>) => (kind === "staff" ? { contact: v } : v),
    invalidate: [["people", "me"], ["people", "children"]],
  });
}
