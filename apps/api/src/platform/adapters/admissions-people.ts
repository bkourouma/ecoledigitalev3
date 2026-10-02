/**
 * admissions -> people : `StudentRegistry` (doublons avec score, dossier permanent de l'élève INACTIF avec matricule sans trou,
 * tuteurs et liens, activation à la confirmation) et `ActorDirectory` (nom figé dans une décision).
 *
 * Écriture EXCLUSIVEMENT par l'API publique de `people` (`createStudent`, `createGuardian`, `linkGuardian`,
 * `changeStudentStatus`, `findDuplicateStudents`, `getStudent`) : règles (sexe obligatoire, matricule gapless, unicités),
 * audit et événements de `people` s'appliquent. Idempotent par `externalRef` (identifiant de l'offre).
 *
 * Interface attendue de `people` (demande 008 de la spec 007 §16) : `createStudent({ initialStatus: "INACTIVE" })`. TANT QU'ELLE
 * N'EXISTE PAS, ce port crée l'élève puis le passe à `INACTIVE` par `changeStudentStatus` DANS LA MÊME TRANSACTION (la fiche n'est
 * jamais visible `ACTIVE` d'un autre processus) ; si le statut final n'est pas `INACTIVE`, il ÉCHOUE FERMÉ
 * (`admissions.port_unavailable`).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { portUnavailable, type ActorDirectory, type StudentDuplicate, type StudentRegistry } from "../../modules/admissions";
import { changeStudentStatus, createGuardian, createStudent, findDuplicateStudents, getDisplayNamesOfIdentities, getStudent, linkGuardian, listRelationshipTypes } from "../../modules/people";
import { unwrapPort, type AdmissionsWriteEnv } from "./admissions-support";

const SCORE_BY_MATCH: Readonly<Record<string, number>> = { EXACT: 100, NEAR: 80, EMAIL: 70, PHONE: 60, NAME_ONLY: 50 };
const ACK_REASON = "Rapprochement traité par les admissions (doublon tranché ou toléré par la politique de l'établissement).";

export function createAdmissionsStudentRegistry(env: AdmissionsWriteEnv): StudentRegistry {
  return {
    async findDuplicateStudents(ctx, draft) {
      const rows = unwrapPort(await findDuplicateStudents(env.people, ctx, draft));
      const out: StudentDuplicate[] = [];
      for (const r of rows) {
        if (!r.studentId) continue;
        out.push({ studentId: r.studentId, score: SCORE_BY_MATCH[r.match] ?? 50, reasons: [r.match] });
      }
      return out;
    },
    async studentExists(ctx, studentId) {
      const r = await getStudent(env.people, ctx, studentId);
      return r.ok;
    },
    async createStudent(ctx, student) {
      const outcome = unwrapPort(
        await createStudent(env.people, ctx, {
          person: {
            lastName: student.lastName,
            firstName: student.firstName,
            sex: student.gender === "FEMALE" ? "F" : "M",
            birthDate: student.birthDate,
            ...(student.birthPlace ? { birthPlace: student.birthPlace } : {}),
            ...(student.nationality ? { nationality: student.nationality } : {}),
          },
          externalRef: student.externalRef,
          acknowledgeDuplicate: true,
          duplicateReason: ACK_REASON,
        }),
      );
      if (outcome.kind !== "created") throw portUnavailable("people", "createStudent doit créer le dossier (kind = created)");
      let status: string = outcome.student.status;
      if (status !== "INACTIVE") {
        unwrapPort(await changeStudentStatus(env.people, ctx, outcome.student.id, { status: "INACTIVE", reasonText: "Inscription en attente de confirmation (admissions)" }));
        const check = unwrapPort(await getStudent(env.people, ctx, outcome.student.id));
        status = check.status;
        if (status !== "INACTIVE") throw portUnavailable("people", "createStudent({ initialStatus: 'INACTIVE' }) ou changeStudentStatus ACTIVE -> INACTIVE");
      }
      return { studentId: outcome.student.id, studentNumber: outcome.student.studentNumber, status };
    },
    async createGuardian(ctx, guardian) {
      const out = unwrapPort(
        await createGuardian(env.people, ctx, {
          person: {
            lastName: guardian.lastName,
            firstName: guardian.firstName,
            ...(guardian.phone ? { phone: guardian.phone } : {}),
            ...(guardian.email ? { email: guardian.email } : {}),
          },
          ...(guardian.profession ? { occupation: guardian.profession } : {}),
          acknowledgeDuplicate: true,
          duplicateReason: ACK_REASON,
        }),
      );
      return { guardianId: out.guardian.id };
    },
    async linkGuardian(ctx, link) {
      unwrapPort(
        await linkGuardian(env.people, ctx, link.studentId, {
          guardianId: link.guardianId,
          relationshipCode: link.relationshipCode,
          isPrimaryContact: link.isPrimaryContact,
          isFinancialResponsible: link.isFinancialResponsible,
          hasLegalCustody: link.hasLegalCustody,
        }),
      );
    },
    async changeStudentStatus(ctx, studentId, status, reason) {
      const current = unwrapPort(await getStudent(env.people, ctx, studentId));
      if (current.status === status) return; // idempotent : déjà dans l'état voulu
      unwrapPort(await changeStudentStatus(env.people, ctx, studentId, { status, reasonText: reason }));
    },
  };
}

export function createAdmissionsActorDirectory(env: AdmissionsWriteEnv): ActorDirectory {
  return {
    async displayName(ctx: RequestContext, userId) {
      const names = await getDisplayNamesOfIdentities(env.people, ctx, [userId]);
      return names.get(userId) ?? null;
    },
  };
}

/** Types de lien de parenté du tenant (codes acceptés par `linkGuardian`), pour le catalogue. */
export async function relationshipTypesOf(env: AdmissionsWriteEnv, ctx: RequestContext): Promise<Array<{ code: string; label: string }>> {
  const r = unwrapPort(await listRelationshipTypes(env.people, ctx));
  return r.filter((t) => t.active).map((t) => ({ code: t.code, label: t.label }));
}
