/**
 * Annuaires publiés pour les autres modules, structurellement conformes à leurs ports :
 *  - `LearnerDirectory` de `finance` (`getLearner(ctx, learnerId) -> { learnerId, displayName, registrationNumber } | null`) ;
 *  - `StudentDirectory` d'`academic` (`getStudent(ctx, studentId) -> { studentId, status, displayName, studentNumber, sequenceNumber }`).
 * Aucune donnée sensible : jamais de date de naissance, de téléphone ni d'identifiant national.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { displayName } from "../domain/normalize";
import { getStudentRow } from "../infrastructure/students-repo";
import type { PeopleDeps } from "./deps";

/** Forme attendue par le port `LearnerDirectory` du module finance. */
export interface LearnerRefShape {
  readonly learnerId: string;
  readonly displayName: string;
  readonly registrationNumber: string;
}
export interface LearnerDirectoryPort {
  getLearner(ctx: RequestContext, learnerId: string): Promise<LearnerRefShape | null>;
}

/** Forme attendue par le port `StudentDirectory` du module academic. */
export interface StudentRefShape {
  readonly studentId: string;
  readonly status: string;
  readonly displayName: string;
  readonly studentNumber: string;
  readonly sequenceNumber: number;
}
export interface StudentDirectoryPort {
  getStudent(ctx: RequestContext, studentId: string): Promise<StudentRefShape | null>;
}

/** `displayName` = « NOM Prénom » ; `registrationNumber` = matricule interne. `null` si l'élève n'existe pas (dans ce tenant). */
export function createLearnerDirectory(deps: Pick<PeopleDeps, "db">): LearnerDirectoryPort {
  return {
    async getLearner(ctx, learnerId) {
      const row = await deps.db.run(ctx, (tx) => getStudentRow(tx, ctx.tenantId, learnerId), { readOnly: true });
      return row ? { learnerId: row.studentId, displayName: displayName(row.lastName, row.firstName), registrationNumber: row.studentNumber } : null;
    },
  };
}

export function createStudentDirectory(deps: Pick<PeopleDeps, "db">): StudentDirectoryPort {
  return {
    async getStudent(ctx, studentId) {
      const row = await deps.db.run(ctx, (tx) => getStudentRow(tx, ctx.tenantId, studentId), { readOnly: true });
      return row ? { studentId: row.studentId, status: row.status, displayName: displayName(row.lastName, row.firstName), studentNumber: row.studentNumber, sequenceNumber: row.sequenceNumber } : null;
    },
  };
}
