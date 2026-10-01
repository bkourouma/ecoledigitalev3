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
import { getAcademicYear, getClassroomFacts, getProgram, type AcademicDeps, type InvoiceFactsReader, type RegistrationFeeProbe } from "../../modules/academic";
import { getInvoiceFacts, isRegistrationFeeDue, type FinanceDeps } from "../../modules/finance";

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
      const [classroom, year, program] = await Promise.all([
        getClassroomFacts(academic, ctx, input.classroomId),
        getAcademicYear(academic, ctx, input.academicYearId),
        getProgram(academic, ctx, input.programId),
      ]);
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
