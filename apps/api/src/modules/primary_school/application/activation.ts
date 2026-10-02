/**
 * Garde « classe du primaire active ⇒ titulaire » (US2, AC2.2) : implémentation de la règle du pack, destinée au port
 * `ClassroomActivationGuard` d'`academic` (demande de changement 004) que la plateforme branche par un adaptateur
 * (`platform/adapters/academic-primary.ts`). Tant que ce port n'existe pas côté `academic`, la garde est exposée ici et testée seule.
 *
 *  - classe du cycle PRESCHOOL / PRIMARY sans titulaire (`HOMEROOM` actif) et `require_homeroom_for_activation = true` (défaut) :
 *    refus `primary_school.homeroom_required` ;
 *  - établissement qui a désactivé la règle : la classe s'active, la dérogation est AUDITÉE ;
 *  - classe d'un autre cycle : sans objet.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PrimaryCode, conflict, notFound } from "../domain/errors";
import type { Uuid } from "../domain/types";
import { EventBuffer, inTx, type PrimarySchoolDeps } from "./deps";
import { settingsOf } from "./settings";

/** Cycles du pack Primary (codes de cycle d'`academic`, pas des libellés). */
const PRIMARY_CYCLES: ReadonlySet<string> = new Set(["PRESCHOOL", "PRIMARY"]);

export interface ActivationCheck {
  /** La règle s'applique à cette classe (cycle du pack Primary). */
  applies: boolean;
  /** La classe a un titulaire actif. */
  hasHomeroom: boolean;
  /** Règle désactivée par l'établissement alors que la classe n'a pas de titulaire : dérogation assumée et auditée. */
  overridden: boolean;
}

export async function checkHomeroomForActivation(deps: PrimarySchoolDeps, ctx: RequestContext, input: { classroomId: Uuid }): Promise<Result<ActivationCheck, AppError>> {
  const classroom = await deps.ports.classrooms.getClassroom(ctx, input.classroomId);
  if (!classroom) return err(notFound(PrimaryCode.CLASSROOM_NOT_FOUND, "Classe", input.classroomId));
  if (!classroom.educationLevelCode || !PRIMARY_CYCLES.has(classroom.educationLevelCode)) return ok({ applies: false, hasHomeroom: false, overridden: false });
  const hasHomeroom = await deps.ports.teaching.hasHomeroom(ctx, classroom.id);
  if (hasHomeroom) return ok({ applies: true, hasHomeroom: true, overridden: false });
  return inTx(deps, ctx, async (tx) => {
    const settings = await settingsOf(tx, classroom.institutionId);
    if (settings.requireHomeroomForActivation) {
      return err(conflict(PrimaryCode.HOMEROOM_REQUIRED, "Une classe du primaire ne s'active qu'avec un instituteur titulaire : affectez-en un d'abord.", { classroomId: classroom.id }));
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "primary_school.activation.homeroom_waived", resourceType: "classroom", resourceId: classroom.id, metadata: { institutionId: classroom.institutionId }, sensitive: true });
    await events.flush(tx);
    return ok<ActivationCheck>({ applies: true, hasHomeroom: false, overridden: true });
  });
}
