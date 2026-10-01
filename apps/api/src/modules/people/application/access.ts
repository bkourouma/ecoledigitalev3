/**
 * Contrôle d'accès FIN aux dossiers d'élèves : au-delà de la permission RBAC (qui dit « peut consulter des élèves »), ce
 * module décide DE QUELS élèves :
 *
 *  - `student.read` / `student.list`  : tous les élèves du tenant (secrétariat, direction) ;
 *  - `student.class.read`             : seulement les élèves des classes où l'on est AFFECTÉ aujourd'hui (enseignant),
 *                                       via l'annuaire d'inscriptions injecté (par défaut la projection du module) ;
 *  - `student.child.read`             : seulement SES enfants (`isGuardianOfStudent`) — voir `guardians.ts` ;
 *  - `student.self.read`              : seulement son propre dossier.
 *
 * `PermissionProbe` interroge le RBAC sans lever (la couche HTTP l'implémente avec `requirePermission`) : les cas d'usage
 * restent indépendants de Fastify. Un élève hors périmètre est renvoyé comme INTROUVABLE (404, jamais 403) : l'existence
 * d'un dossier n'est pas divulguée.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { CLASS_ACCESS_ROLES } from "../domain/assignments";
import { PeopleErrors } from "../domain/errors";
import { listClassroomIdsOfStaff } from "../infrastructure/teaching-repo";
import { findStaffByIdentity } from "../infrastructure/staff-repo";
import { todayOf, type PeopleDeps } from "./deps";
import type { StudentScope } from "./students";
import type { AccessLevel } from "./views";

/** Vrai si l'acteur détient la permission (jamais d'exception pour un simple refus). */
export type PermissionProbe = (permission: string) => Promise<boolean>;

/** Classes (UUID) où l'identité courante est affectée aujourd'hui ; vide si elle n'a pas de fiche de personnel active. */
export async function classroomsOfCurrentStaff(deps: PeopleDeps, ctx: RequestContext): Promise<string[]> {
  if (!ctx.userId) return [];
  const userId = ctx.userId;
  const today = todayOf(deps);
  return deps.db.run(
    ctx,
    async (tx) => {
      const staff = await findStaffByIdentity(tx, ctx.tenantId, userId);
      if (!staff || (staff.status !== "ACTIVE" && staff.status !== "ON_LEAVE")) return [];
      return listClassroomIdsOfStaff(tx, ctx.tenantId, staff.staffId, today, CLASS_ACCESS_ROLES);
    },
    { readOnly: true },
  );
}

/** L'enseignant courant a-t-il cet élève dans une de SES classes ? */
export async function staffCanReadStudent(deps: PeopleDeps, ctx: RequestContext, studentId: string): Promise<boolean> {
  const classrooms = await classroomsOfCurrentStaff(deps, ctx);
  if (classrooms.length === 0) return false;
  const studentClassrooms = await deps.enrollments.listClassroomIdsOfStudent(ctx, studentId, { onDate: todayOf(deps) });
  return studentClassrooms.some((c) => classrooms.includes(c));
}

/** Niveau d'accès à une fiche d'élève, ou `NotFound` (hors périmètre) / `Forbidden` (aucune permission de lecture). */
export async function resolveStudentAudience(deps: PeopleDeps, ctx: RequestContext, studentId: string, can: PermissionProbe): Promise<Result<AccessLevel, AppError>> {
  if (await can("student.read")) return ok("FULL");
  if (await can("student.class.read")) {
    return (await staffCanReadStudent(deps, ctx, studentId)) ? ok("CLASS") : err(PeopleErrors.studentNotFound());
  }
  return err(PeopleErrors.forbidden());
}

/** Périmètre d'une liste d'élèves selon les permissions de l'acteur. */
export async function resolveStudentListScope(deps: PeopleDeps, ctx: RequestContext, can: PermissionProbe): Promise<Result<StudentScope, AppError>> {
  if (await can("student.list")) return ok({ kind: "ALL" });
  if (await can("student.class.read")) {
    const classrooms = await classroomsOfCurrentStaff(deps, ctx);
    if (classrooms.length === 0) return ok({ kind: "IDS", ids: [] });
    const ids = await deps.enrollments.listStudentIdsOfClassrooms(ctx, classrooms, { onDate: todayOf(deps) });
    return ok({ kind: "IDS", ids });
  }
  return err(PeopleErrors.forbidden());
}
