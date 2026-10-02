/**
 * Importeur « classes » : code, nom, programme, niveau, effectif, dates, pour UNE année scolaire d'un établissement
 * (options). Le programme et le niveau sont désignés par leur code ; le port les résout dans les référentiels d'`academic`.
 *
 * Écriture (port `classrooms`, `platform/adapters/imports-academic.ts`) : `academic.createClassroom`, `academic.updateClassroom`.
 */
import { z } from "zod";
import { issue, type ImporterDef, type ImportIssue } from "../domain/types";
import { column, requireUuidOption } from "./common";

export const classroomRowSchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  programCode: z.string().trim().min(1).max(60),
  gradeLevelCode: z.string().trim().min(1).max(60),
  capacity: z.number().int().min(1).max(10_000).optional(),
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
});
export type ClassroomRow = z.infer<typeof classroomRowSchema> & Record<string, unknown>;

export const CLASSROOM_COLUMNS = [
  column("code", "Code de la classe", "code", { required: true, aliases: ["code", "code classe", "classe code", "identifiant", "class code", "code de la classe"], description: "Code unique de la classe dans l'année (lettres, chiffres, « _ », « . », « - »).", example: "6EME_A" }),
  column("name", "Nom de la classe", "text", { required: true, aliases: ["nom", "nom classe", "libelle", "intitule", "classe", "name", "class name", "nom de la classe"], description: "Libellé affiché.", example: "6ème A" }),
  column("programCode", "Programme (code)", "code", { required: true, aliases: ["programme", "code programme", "filiere", "serie", "cycle", "program", "formation"], description: "Code du programme d'études (référentiel de l'établissement).", example: "COLLEGE" }),
  column("gradeLevelCode", "Niveau (code)", "code", { required: true, aliases: ["niveau", "code niveau", "grade", "level", "grade level", "niveau d etudes"], description: "Code du niveau scolaire.", example: "6EME" }),
  column("capacity", "Effectif maximal", "integer", { aliases: ["effectif", "capacite", "effectif max", "effectif maximal", "capacity", "places"], description: "Nombre de places.", example: "45" }),
  column("startsOn", "Début", "date", { aliases: ["debut", "date debut", "date de debut", "starts on", "start date", "rentree"], description: "Date de début de la classe (facultatif).", example: "" }),
  column("endsOn", "Fin", "date", { aliases: ["fin", "date fin", "date de fin", "ends on", "end date"], description: "Date de fin de la classe (facultatif).", example: "" }),
] as const;

export const classroomsImporter: ImporterDef<ClassroomRow> = {
  key: "classrooms",
  label: "Classes",
  description: "Classes d'une année scolaire : code, nom, programme, niveau, effectif.",
  sensitive: false,
  entityType: "classroom",
  supportsUpdate: true,
  columns: CLASSROOM_COLUMNS,
  options: [
    { key: "institutionId", label: "Établissement", required: true, help: "Établissement qui reçoit les classes.", kind: "choice" },
    { key: "academicYearId", label: "Année scolaire", required: true, help: "Année scolaire des classes importées.", kind: "choice" },
  ],
  importPermission: "imports.import.classrooms",
  targetPermissions: ["academic.classroom.manage"],
  conditionalPermissions: [],
  schema: classroomRowSchema,
  rules(row): ImportIssue[] {
    const out: ImportIssue[] = [];
    if (row.startsOn && row.endsOn && row.endsOn < row.startsOn) out.push(issue("endsOn", "imports.rule_violation", "La date de fin précède la date de début."));
    return out;
  },
  naturalKey(row, options) {
    return `classrooms|${String(options["institutionId"] ?? "")}|${String(options["academicYearId"] ?? "")}|${row.code}`;
  },
  validateOptions(options) {
    return [...requireUuidOption(options, "institutionId", "Établissement"), ...requireUuidOption(options, "academicYearId", "Année scolaire")];
  },
  extraPermissions() {
    return [];
  },
  sampleRows: [
    ["6EME_A", "6ème A", "COLLEGE", "6EME", "45", "", ""],
    ["6EME_B", "6ème B", "COLLEGE", "6EME", "45", "", ""],
  ],
};
