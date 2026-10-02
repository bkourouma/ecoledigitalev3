/**
 * Contrôle d'accès CONTEXTUEL (qui voit quelle classe, quel élève). Les routes sont gardées par permission (rbac) ; ce fichier
 * ajoute le LIEN : un instituteur n'accède qu'à ses classes (404 sinon : aucune fuite d'existence), un parent qu'à ses enfants.
 * Aucun rôle codé en dur : « toutes les classes » est la capacité `primary.class.read_all`.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PrimaryCode, forbidden, notFound, validation } from "../domain/errors";
import type { CallerCaps, Uuid } from "../domain/types";
import type { ClassroomInfo } from "./ports";
import type { PrimarySchoolDeps } from "./deps";

export interface ClassAccess {
  readonly classroom: ClassroomInfo;
  /** Fiche de personnel du compte (peut être `null` pour la direction). */
  readonly staffId: Uuid | null;
}

export async function requireClassAccess(deps: PrimarySchoolDeps, ctx: RequestContext, classroomId: Uuid, caps: CallerCaps): Promise<Result<ClassAccess, AppError>> {
  const classroom = await deps.ports.classrooms.getClassroom(ctx, classroomId);
  if (!classroom) return err(notFound(PrimaryCode.CLASSROOM_NOT_FOUND, "Classe", classroomId));
  const staffId = ctx.userId ? await deps.ports.teaching.staffIdForUser(ctx, ctx.userId) : null;
  if (caps.allClasses) return ok({ classroom, staffId });
  if (!staffId || !(await deps.ports.teaching.isAssigned(ctx, staffId, classroomId))) {
    return err(notFound(PrimaryCode.CLASSROOM_NOT_FOUND, "Classe", classroomId));
  }
  return ok({ classroom, staffId });
}

/** Le compte agit pour un élève : l'élève lui-même ou l'un de ses tuteurs ; sinon 404. */
export async function requireFamilyStudent(deps: PrimarySchoolDeps, ctx: RequestContext, studentId: Uuid | null): Promise<Result<Uuid, AppError>> {
  if (!ctx.userId) return err(forbidden("Un utilisateur authentifié est requis."));
  if (studentId === null) {
    const own = await deps.ports.guardianship.studentIdForUser(ctx, ctx.userId);
    return own ? ok(own) : err(notFound(PrimaryCode.NO_STUDENT_PROFILE, "Élève", "moi"));
  }
  if (await deps.ports.guardianship.isGuardianOf(ctx, ctx.userId, studentId)) return ok(studentId);
  const own = await deps.ports.guardianship.studentIdForUser(ctx, ctx.userId);
  if (own === studentId) return ok(studentId);
  return err(notFound(PrimaryCode.NOT_GUARDIAN, "Élève", studentId));
}

/** Établissement visé : paramètre explicite, établissement du contexte, ou l'unique établissement du tenant. */
export async function resolveInstitution(deps: PrimarySchoolDeps, ctx: RequestContext, explicit?: Uuid | undefined): Promise<Result<Uuid, AppError>> {
  const candidate = explicit ?? ctx.institutionId;
  if (candidate) return ok(candidate);
  const list = await deps.ports.classrooms.listInstitutions(ctx);
  if (list.length === 1) return ok((list[0] as { id: Uuid }).id);
  return err(validation(PrimaryCode.INSTITUTION_REQUIRED, "Précisez l'établissement (institutionId).", "institutionId"));
}
