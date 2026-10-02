/**
 * people / academic -> finance : `LearnerDirectory` (apprenant du tenant, matricule) et `EnrollmentDirectory`
 * (inscription : année, classe, niveau, programme, financement, numéro d'inscription).
 *
 * Les deux fabriques sont publiées par les modules fournisseurs et vérifiées à la compilation contre les ports de finance ;
 * cette paire ne fait que les brancher. Sans elles, finance acceptait tout UUID d'apprenant et refusait toute inscription.
 */
import { createEnrollmentDirectory, type AcademicDeps } from "../../modules/academic";
import type { EnrollmentDirectory, LearnerDirectory } from "../../modules/finance";
import { createLearnerDirectory, getDisplayNamesOfStudents, type PeopleDeps } from "../../modules/people";

export function createFinanceLearnerDirectory(people: PeopleDeps): LearnerDirectory {
  // `getLearnerNames` : « NOM Prénom » de N apprenants en UNE lecture (listes, exports) ; réponse minimale, aucun contrôle de
  // périmètre ici (finance contrôle déjà l'accès à la liste), identifiants invisibles (autre tenant) absents.
  return { ...createLearnerDirectory(people), getLearnerNames: (ctx, ids) => getDisplayNamesOfStudents(people, ctx, ids) };
}

export function createFinanceEnrollmentDirectory(academic: AcademicDeps): EnrollmentDirectory {
  return createEnrollmentDirectory(academic);
}
