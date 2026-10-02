/**
 * academic -> stateassign : `EnrollmentPort` (inscription : élève, établissement, année, statut, financement, référence ; périodes
 * d'une année) et `EnrollmentFundingPort` (`changeEnrollmentFunding(STATE_ASSIGNED, référence)`).
 *
 * La référence d'affectation de l'inscription n'a qu'UNE source : le dossier VÉRIFIÉ de stateassign. L'écriture est faite par le cas
 * d'usage PUBLIC d'academic (aucun SQL, historique et événement `academic.enrollment.funding_changed` inclus) dans la transaction
 * de la vérification : un refus d'academic (inscription terminée, type de financement inconnu…) est renvoyé tel quel et annule la
 * vérification. Une inscription hors du périmètre du contexte, ou inconnue, est « absente » (jamais de fuite).
 */
import { changeEnrollmentFunding, getEnrollment, listAcademicPeriods, type AcademicDeps } from "../../modules/academic";
import type { EnrollmentFundingPort, EnrollmentPort } from "../../modules/stateassign";

export function createStateassignEnrollmentPort(academic: AcademicDeps): EnrollmentPort {
  return {
    async getEnrollment(ctx, enrollmentId) {
      const r = await getEnrollment(academic, ctx, enrollmentId);
      if (!r.ok) return null;
      const e = r.value;
      return {
        enrollmentId: e.id,
        studentId: e.studentId,
        institutionId: e.institutionId,
        academicYearId: e.academicYearId,
        status: e.status,
        fundingType: e.fundingType,
        assignmentReference: e.assignmentReference,
        classroomId: e.classroomId,
      };
    },
    async listPeriods(ctx, academicYearId) {
      const r = await listAcademicPeriods(academic, ctx, academicYearId);
      return r.ok ? r.value.map((p) => ({ id: p.id, label: p.label, startsOn: p.startsOn, endsOn: p.endsOn })) : [];
    },
  };
}

export function createStateassignFundingPort(academic: AcademicDeps): EnrollmentFundingPort {
  return {
    async setStateAssignedFunding(ctx, input) {
      const r = await changeEnrollmentFunding(academic, ctx, input.enrollmentId, {
        fundingType: "STATE_ASSIGNED",
        assignmentReference: input.reference,
        assignmentIssuedOn: input.issuedOn,
        funderLabel: input.funderLabel,
        reason: input.reason,
      });
      return r.ok ? { ok: true, value: true } : { ok: false, error: { code: r.error.code, message: r.error.message } };
    },
  };
}
