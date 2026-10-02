/**
 * finance -> stateassign : `FinancePort` — la facturation de l'élève affecté lue dans `finance` pour le rapprochement.
 *
 *  - part de l'ÉTAT : factures émises, non annulées, dont le payeur est un FINANCEUR (`payerKind = FUNDER`) lié à une bourse de
 *    nature `STATE` de l'élève pour l'année ; si le dossier est déjà lié à une bourse, seules ses factures comptent ;
 *  - part de la FAMILLE : factures émises, non annulées, payeur `LEARNER` — elles ne portent QUE la part parent (finance sépare la
 *    part du financeur à l'émission : la somme des parts est le total net, au franc près) ;
 *  - versements REÇUS de l'État : paiements confirmés du financeur (lecture seule : jamais copiés dans stateassign) ;
 *  - l'année de finance est un CODE : il vient de l'inscription d'academic (`createEnrollmentDirectory`).
 * Lectures seules, appels SÉQUENTIELS (ils partagent la connexion de la transaction de l'appelant). Aucun SQL, aucun import du legacy.
 */
import { createEnrollmentDirectory, type AcademicDeps } from "../../modules/academic";
import { getLearnerFunding, listInvoicePage, listPaymentPage, type FinanceDeps } from "../../modules/finance";
import { portUnavailable, type FinancePort, type FundingInvoiceFacts } from "../../modules/stateassign";

export function createStateassignFinancePort(finance: FinanceDeps, academic: AcademicDeps): FinancePort {
  const directory = createEnrollmentDirectory(academic);
  return {
    async getStateFundingBilling(ctx, query) {
      const ref = await directory.getEnrollment(ctx, query.enrollmentId);
      if (!ref) throw portUnavailable("academic");
      const year = ref.academicYear;

      const funding = await getLearnerFunding(finance, ctx, query.studentId);
      if (!funding.ok) throw funding.error;
      const stateScholarships = funding.value.scholarships.filter((s) => s.funderKind === "STATE" && s.academicYear === year);
      const stateIds = new Set(stateScholarships.map((s) => s.id));
      const wanted = query.scholarshipId ? new Set([query.scholarshipId]) : stateIds;

      const invoices = await listInvoicePage(finance, ctx, { learnerId: query.studentId, academicYear: year, issuedOnly: true, limit: 200 });
      if (!invoices.ok) throw invoices.error;
      const live = invoices.value.items.filter(
        (i) => i.status !== "CANCELLED" && i.status !== "DRAFT" && (i.enrollmentId === null || i.enrollmentId === query.enrollmentId),
      );
      const facts = (i: (typeof live)[number], scholarshipId: string | null): FundingInvoiceFacts => ({
        invoiceId: i.id,
        number: i.number,
        status: i.status,
        total: i.total,
        paid: i.paid,
        credited: i.credited,
        dueDate: i.dueDate,
        scholarshipId,
      });
      const stateInvoices = live.filter((i) => i.payerKind === "FUNDER" && i.payerRef !== null && wanted.has(i.payerRef)).map((i) => facts(i, i.payerRef));
      const parentInvoices = live.filter((i) => i.payerKind === "LEARNER").map((i) => facts(i, null));

      const payments = await listPaymentPage(finance, ctx, { learnerId: query.studentId, status: "CONFIRMED", payerKind: "FUNDER", limit: 200 });
      if (!payments.ok) throw payments.error;
      const statePayments = payments.value.items
        .filter((p) => p.payerRef === null || stateIds.has(p.payerRef) || wanted.has(p.payerRef))
        .map((p) => ({ paymentId: p.id, receivedAt: p.confirmedAt ?? p.receivedAt, amount: p.amount, allocated: p.allocated, reference: p.reference }));

      return {
        currency: stateInvoices[0]?.total.currency ?? parentInvoices[0]?.total.currency ?? finance.config.defaultCurrency,
        stateInvoices,
        parentInvoices,
        statePayments,
        scholarshipIds: stateScholarships.filter((s) => s.status === "ACTIVE").map((s) => s.id),
      };
    },
  };
}
