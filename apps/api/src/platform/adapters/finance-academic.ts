/**
 * finance -> academic : confirmation AUTOMATIQUE de l'inscription après paiement des frais d'inscription (DÉCISION MÉTIER
 * validée le 2026-10-01, `specs/v2/DECISIONS-METIER.md`).
 *
 *  - `InvoiceFactsReader`  : apprenant, inscription visée et lignes (catégorie, objet source) d'une facture soldée — repli
 *                            de lecture du consommateur `finance.invoice.paid` (la charge de l'événement est aussi
 *                            enrichie par finance : `enrollmentId`, `containsRegistrationFee`, `sourceRefs`) ;
 *  - `RegistrationFeeProbe`: des frais d'inscription sont-ils DUS pour cette inscription ? `false` = aucun barème
 *                            applicable (confirmation immédiate, correction 0127 du legacy), `null` = inconnu (inscription
 *                            en attente).
 *
 * Le périmètre du barème est celui de l'annuaire d'inscriptions de finance : année (code), niveau (code), programme (code),
 * type de financement.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Clock } from "@ecoledigitale/kernel";
import { getAcademicYear, getClassroomFacts, getEnrollment, getProgram, type AcademicDeps, type EnrollmentBilling, type InvoiceFactsReader, type RegistrationFeeProbe } from "../../modules/academic";
import { getInvoiceFacts, isRegistrationFeeDue, issueInvoiceFromSchedule, listFeeCatalog, type FinanceDeps } from "../../modules/finance";

export function createAcademicInvoiceFactsReader(finance: FinanceDeps): InvoiceFactsReader {
  return {
    async getInvoiceFacts(ctx: RequestContext, invoiceId) {
      const r = await getInvoiceFacts(finance, ctx, invoiceId);
      if (!r.ok || !r.value) return null;
      return { invoiceId: r.value.invoiceId, learnerId: r.value.learnerId, enrollmentId: r.value.enrollmentId, lines: r.value.lines.map((l) => ({ category: l.category, sourceRef: l.sourceRef })) };
    },
  };
}

export function createAcademicRegistrationFeeProbe(finance: FinanceDeps, academic: AcademicDeps, clock: Clock): RegistrationFeeProbe {
  return {
    async registrationFeeDue(ctx: RequestContext, input) {
      const classroom = await getClassroomFacts(academic, ctx, input.classroomId);
      const year = await getAcademicYear(academic, ctx, input.academicYearId);
      const program = await getProgram(academic, ctx, input.programId);
      if (!classroom.ok || !year.ok || !program.ok) return null;
      const r = await isRegistrationFeeDue(finance, ctx, {
        academicYear: year.value.code,
        institutionId: input.institutionId,
        campusId: classroom.value.campusId,
        levelKey: classroom.value.gradeLevelCode,
        trackKey: program.value.code,
        learnerType: input.fundingType,
        onDate: clock.now().toISOString().slice(0, 10),
      });
      return r.ok ? r.value : null;
    },
  };
}

/**
 * Facture les frais d'inscription (catégorie `REGISTRATION`) d'une inscription saisie à la main ou en ligne (L-60), avec la même
 * règle que l'admission : sans barème applicable, aucune facture. Idempotent par inscription.
 */
export function createAcademicEnrollmentBilling(finance: FinanceDeps, academic: AcademicDeps, clock: Clock): EnrollmentBilling {
  return {
    async invoiceRegistrationFees(ctx: RequestContext, input) {
      const enrollment = await getEnrollment(academic, ctx, input.enrollmentId);
      if (!enrollment.ok) throw enrollment.error;
      const facts = await getClassroomFacts(academic, ctx, enrollment.value.classroomId);
      const year = await getAcademicYear(academic, ctx, enrollment.value.academicYearId);
      if (!facts.ok || !year.ok) throw new Error("contexte de l'inscription illisible");
      const program = await getProgram(academic, ctx, facts.value.programId);
      if (!program.ok) throw program.error;
      const due = await isRegistrationFeeDue(finance, ctx, {
        academicYear: year.value.code,
        institutionId: enrollment.value.institutionId,
        campusId: facts.value.campusId,
        levelKey: facts.value.gradeLevelCode,
        trackKey: program.value.code,
        learnerType: enrollment.value.fundingType,
        onDate: clock.now().toISOString().slice(0, 10),
      });
      if (!due.ok) throw due.error;
      if (due.value !== true) return; // aucun barème applicable (ou inconnu) : rien à facturer
      const fees = await listFeeCatalog(finance, ctx, { activeOnly: true, category: "REGISTRATION" });
      if (!fees.ok) throw fees.error;
      const issued = await issueInvoiceFromSchedule(finance, ctx, {
        learnerId: input.studentId,
        enrollmentId: input.enrollmentId,
        items: fees.value.map((f) => ({ feeId: f.id })),
        idempotencyKey: `enrollment-registration-${input.enrollmentId}`,
      });
      if (!issued.ok) throw issued.error;
    },
  };
}
