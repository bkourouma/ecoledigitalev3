/**
 * people -> results : `GuardianshipPort` (lien élève ↔ compte et tutelle, relus à CHAQUE lecture famille) et
 * `ActorNamePort` (nom figé des acteurs d'une décision ; membre du personnel auteur d'une appréciation).
 */
import type { ResultsActorNamePort, ResultsGuardianshipPort } from "../../modules/results";
import type { PeopleLookups } from "./people-lookups";

export function createResultsGuardianshipPort(lookups: PeopleLookups): ResultsGuardianshipPort {
  return { studentIdForUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId), isGuardianOf: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId) };
}

/** Nom figé d'un acteur : jamais vide (un compte sans fiche ni e-mail connu s'écrit « Utilisateur »). */
export function createResultsActorNamePort(lookups: PeopleLookups): ResultsActorNamePort {
  return {
    async nameOf(ctx, userId) {
      return (await lookups.displayNameOfUser(ctx, userId)) ?? "Utilisateur";
    },
    staffIdForUser: (ctx, userId) => lookups.staffIdForUser(ctx, userId),
  };
}
