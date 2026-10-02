/**
 * people -> reportcards : `GuardianshipPort` (fiche élève d'un compte ; tuteur lié, relu à CHAQUE lecture ; enfants d'un tuteur).
 * iam -> reportcards : `UserDirectoryPort` (nom affichable de l'émetteur, figé dans le snapshot) — nom de la personne liée au
 * compte, sinon la partie locale de l'e-mail du compte (jamais le domaine).
 */
import type { GuardianshipPort as ReportcardsGuardianshipPort, UserDirectoryPort } from "../../modules/reportcards";
import type { PeopleLookups } from "./people-lookups";

export function createReportcardsGuardianshipPort(lookups: PeopleLookups): ReportcardsGuardianshipPort {
  return {
    studentIdOfUser: (ctx, userId) => lookups.studentIdForUser(ctx, userId),
    isGuardianOf: (ctx, userId, studentId) => lookups.isGuardianOf(ctx, userId, studentId),
    listChildren: (ctx, userId) => lookups.childrenOf(ctx, userId),
  };
}

export function createReportcardsUserDirectory(lookups: PeopleLookups): UserDirectoryPort {
  return { displayName: (ctx, userId) => lookups.displayNameOfUser(ctx, userId) };
}
