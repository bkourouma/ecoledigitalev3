/**
 * people -> finance : `GuardianshipPort` (fiche élève d'un compte, tuteur lié, enfants d'un tuteur), relus à CHAQUE requête
 * des routes famille `/finance/me/*`. Mêmes recherches que les portails notes / résultats / bulletins : le titulaire d'un
 * compte est résolu par `persons.identity_id` (liaison explicite), jamais par e-mail ; un compte sans fiche liée n'a aucun
 * droit « élève » ni « tuteur » (échec fermé).
 */
import type { GuardianshipPort } from "../../modules/finance";
import type { PeopleLookups } from "./people-lookups";

export function createFinanceGuardianshipPort(lookups: PeopleLookups): GuardianshipPort {
  return {
    studentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
    isGuardianOf: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId),
    childrenOf: (ctx, userId) => lookups.childrenOf(ctx, userId),
  };
}
