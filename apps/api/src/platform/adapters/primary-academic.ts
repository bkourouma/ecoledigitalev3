/**
 * primary_school -> academic : `ClassroomActivationGuard` — « classe du primaire active => titulaire » (spec 005 US2, AC2.2).
 *
 * `academic` appelle ce garde APRÈS ses propres contrôles (curriculum publié) dans la transaction d'activation ; un refus annule
 * l'activation et porte le CODE du garde (`primary_school.homeroom_required`). La règle (`checkHomeroomForActivation`) reste dans
 * `primary_school` : cycle PRESCHOOL / PRIMARY seulement, dérogation de l'établissement auditée. Une classe d'un autre cycle n'est
 * jamais refusée. Un échec technique de lecture n'est PAS un « autorisé » : il remonte (la requête échoue, rien n'est activé).
 */
import { err, ok, type Result } from "@ecoledigitale/kernel";
import type { ClassroomActivationGuard, ClassroomActivationRefusal } from "../../modules/academic";
import { checkHomeroomForActivation, PrimaryCode, type PrimarySchoolDeps } from "../../modules/primary_school";

export function createAcademicClassroomActivationGuard(primary: PrimarySchoolDeps): ClassroomActivationGuard {
  return {
    async check(ctx, classroomId): Promise<Result<void, ClassroomActivationRefusal>> {
      const r = await checkHomeroomForActivation(primary, ctx, { classroomId });
      if (r.ok) return ok(undefined);
      // Refus MÉTIER du pack : conflit portant le code du garde. Toute autre erreur est technique : on la propage.
      if (r.error.code === PrimaryCode.HOMEROOM_REQUIRED) return err({ code: r.error.code, reason: r.error.message, details: { classroomId } });
      throw r.error;
    },
  };
}
