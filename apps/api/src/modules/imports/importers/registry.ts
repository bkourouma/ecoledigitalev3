/**
 * Registre des importeurs : UN fichier par importeur, enregistrés ici. Ajouter un importeur = écrire son fichier,
 * l'ajouter à ce registre et à `IMPORTER_KEYS` des contrats, déclarer sa permission `imports.import.<clé>` dans le
 * manifeste et brancher son port (`application/ports.ts`, `platform/adapters/`).
 */
import type { ImporterKey } from "@ecoledigitale/contracts/src/v2/imports";
import type { ImporterDef } from "../domain/types";
import { classroomsImporter } from "./classrooms";
import { curriculumImporter } from "./curriculum";
import { enrollmentsImporter } from "./enrollments";
import { gradesImporter, gradesOwnImporter } from "./grades";
import { guardiansImporter } from "./guardians";
import { openingBalancesImporter } from "./opening-balances";
import { staffImporter } from "./staff";
import { studentsImporter } from "./students";

export const IMPORTERS: Readonly<Record<ImporterKey, ImporterDef<any>>> = Object.freeze({
  students: studentsImporter,
  guardians: guardiansImporter,
  staff: staffImporter,
  classrooms: classroomsImporter,
  curriculum: curriculumImporter,
  grades: gradesImporter,
  grades_own: gradesOwnImporter,
  enrollments: enrollmentsImporter,
  opening_balances: openingBalancesImporter,
});

export function getImporter(key: string): ImporterDef<any> {
  const importer = (IMPORTERS as Record<string, ImporterDef<any> | undefined>)[key];
  if (!importer) throw new Error(`Importeur inconnu : ${key}`);
  return importer;
}

export function findImporter(key: string): ImporterDef<any> | undefined {
  return (IMPORTERS as Record<string, ImporterDef<any> | undefined>)[key];
}

export const IMPORTER_LIST: readonly ImporterDef<any>[] = Object.freeze(Object.values(IMPORTERS));
