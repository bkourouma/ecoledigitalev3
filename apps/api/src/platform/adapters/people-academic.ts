/**
 * people -> academic : `StudentDirectory` (valider l'apprenant à l'inscription, numéro d'ordre, compte ↔ dossier),
 * `GuardianshipPort` (tutelle revérifiée à chaque lecture) et `OfferingReadinessGuard` (un responsable d'enseignement pour
 * chaque nœud obligatoire avant l'ouverture d'une offre).
 */
import { err, ok } from "@ecoledigitale/kernel";
import {
  createOfferingReadinessGuard,
  createStudentDirectory,
  isGuardianOfStudent,
  resolveStudentForIdentity,
  type PeopleDeps,
} from "../../modules/people";
import type {
  GuardianshipPort as AcademicGuardianshipPort,
  OfferingReadinessGuard as AcademicOfferingReadinessGuard,
  StudentDirectory as AcademicStudentDirectory,
} from "../../modules/academic";

export function createAcademicStudentDirectory(people: PeopleDeps): AcademicStudentDirectory {
  const directory = createStudentDirectory(people);
  return {
    async getStudent(ctx, studentId) {
      const s = await directory.getStudent(ctx, studentId);
      return s ? { studentId: s.studentId, status: s.status, displayName: s.displayName, studentNumber: s.studentNumber, sequenceNumber: s.sequenceNumber } : null;
    },
    async findStudentByUserId(ctx, userId) {
      const studentId = await resolveStudentForIdentity(people, ctx, userId);
      return studentId ? { studentId } : null;
    },
  };
}

export function createAcademicGuardianship(people: PeopleDeps): AcademicGuardianshipPort {
  return { isGuardianOfStudent: (ctx, userId, studentId) => isGuardianOfStudent(people, ctx, userId, studentId) };
}

/**
 * `people` doit connaître `academic` (port `AcademicQuery`) pour résoudre l'offre : `peopleWithAcademic` est construit avec
 * l'adaptateur `academic -> people`. Les nœuds sans responsable sont rendus sous forme de libellés pour le message de refus.
 */
export function createAcademicOfferingReadiness(peopleWithAcademic: PeopleDeps): AcademicOfferingReadinessGuard {
  const guard = createOfferingReadinessGuard(peopleWithAcademic);
  return {
    async check(ctx, offeringId) {
      const r = await guard.check(ctx, offeringId);
      if (r.ok) return ok(undefined);
      const missing = r.error.missing;
      // Une garde indisponible (échec fermé) ou une offre inconnue n'est PAS « prête » : l'erreur est portée par le libellé.
      return err({ missing: missing && missing.length > 0 ? missing.map((m) => m.label ?? m.curriculumNodeId) : [r.error.message] });
    },
  };
}
