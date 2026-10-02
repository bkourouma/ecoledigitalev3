/**
 * admissions -> finance : `RegistrationFeeService` — facture des frais d'inscription (ligne de catégorie `REGISTRATION`) à
 * l'acceptation de l'offre, idempotente par clé (identifiant de l'offre), et annulation en compensation.
 *
 * Écriture EXCLUSIVEMENT par l'API publique de `finance` : `isRegistrationFeeDue` (aucun barème applicable = `false` : AUCUNE
 * facture, `academic` confirme l'inscription immédiatement), `listFeeCatalog`, `issueInvoiceFromSchedule`, `cancelInvoice`. Le
 * périmètre du barème est celui de l'inscription (année, niveau, programme, type de financement), comme pour la sonde d'`academic`.
 * Aucun montant n'est saisi ici (spec 014).
 *
 * Échec FERMÉ : barème indéterminé (`null`) ou facturation impossible = erreur, la saga est annulée (aucune acceptation sans facturation).
 */
import { portUnavailable, type RegistrationFeeService } from "../../modules/admissions";
import { getAcademicYear, getClassroomFacts, getEnrollment, getProgram } from "../../modules/academic";
import { cancelInvoice, isRegistrationFeeDue, issueInvoiceFromSchedule, listFeeCatalog } from "../../modules/finance";
import { unwrapPort, type AdmissionsWriteEnv } from "./admissions-support";

export function createAdmissionsRegistrationFees(env: AdmissionsWriteEnv): RegistrationFeeService {
  return {
    async issueRegistrationInvoice(ctx, input) {
      const enrollment = unwrapPort(await getEnrollment(env.academic, ctx, input.enrollmentId));
      const facts = unwrapPort(await getClassroomFacts(env.academic, ctx, enrollment.classroomId));
      const year = unwrapPort(await getAcademicYear(env.academic, ctx, enrollment.academicYearId));
      const program = unwrapPort(await getProgram(env.academic, ctx, facts.programId));
      const due = unwrapPort(
        await isRegistrationFeeDue(env.finance, ctx, {
          academicYear: year.code,
          institutionId: enrollment.institutionId,
          campusId: facts.campusId,
          levelKey: facts.gradeLevelCode,
          trackKey: program.code,
          learnerType: enrollment.fundingType,
          onDate: env.kit.clock.now().toISOString().slice(0, 10),
        }),
      );
      if (due === false) return { invoiceId: null };
      if (due === null) throw portUnavailable("finance", "barème des frais d'inscription indéterminé : isRegistrationFeeDue doit répondre vrai ou faux");
      const fees = unwrapPort(await listFeeCatalog(env.finance, ctx, { activeOnly: true, category: "REGISTRATION" }));
      const issued = unwrapPort(
        await issueInvoiceFromSchedule(env.finance, ctx, {
          learnerId: input.studentId,
          enrollmentId: input.enrollmentId,
          items: fees.map((f) => ({ feeId: f.id })),
          idempotencyKey: input.idempotencyKey,
        }),
      );
      const first = issued.invoices[0];
      if (!first) throw portUnavailable("finance", "issueInvoiceFromSchedule doit renvoyer au moins une facture");
      return { invoiceId: first.invoice.id };
    },
    async cancelInvoice(ctx, invoiceId, reason) {
      unwrapPort(await cancelInvoice(env.finance, ctx, { invoiceId, reason }));
    },
  };
}
