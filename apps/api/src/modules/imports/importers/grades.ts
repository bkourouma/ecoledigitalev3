/**
 * Importeur « notes » : les notes d'UNE évaluation (option), une ligne par élève : une note, ou un code d'absence
 * (`ABS` absent non justifié, `ABJ` absent justifié, `DISP` dispensé). L'import ne calcule JAMAIS rien : pas de moyenne,
 * pas d'arrondi, pas de conversion de barème ; la note est transmise telle quelle à `assess`, qui contrôle le barème et
 * le nombre de décimales, et dont les événements déclenchent seuls les recalculs de `results`.
 *
 * L'élève est désigné par son matricule d'origine, son matricule de la plateforme ou, à défaut, son numéro d'inscription.
 *
 * Écriture (port `grades`, `platform/adapters/imports-assess.ts`) : `assess.saveGrades`.
 */
import { z } from "zod";
import { parseDecimal } from "../domain/coerce";
import { type ImporterDef, type ImportIssue } from "../domain/types";
import { column, optionalText, requireUuidOption } from "./common";

export const GRADE_CODES = { ABS: "ABSENT_UNEXCUSED", ABJ: "ABSENT_EXCUSED", DISP: "EXEMPT" } as const;
export type GradeEntryStatus = "ENTERED" | (typeof GRADE_CODES)[keyof typeof GRADE_CODES];

export interface GradeEntry {
  status: GradeEntryStatus;
  /** Chaîne décimale canonique, uniquement pour `ENTERED`. */
  score?: string;
}

const entrySchema = z.string().transform((value, ctx): GradeEntry => {
  const v = value.trim().toUpperCase().replace(/\./g, "");
  if (v === "ABS" || v === "ABJ" || v === "DISP") return { status: GRADE_CODES[v] };
  const parsed = parseDecimal(value, { maxDecimals: 4 });
  if (!parsed.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "une note numérique (ex. 14,5) ou un code ABS, ABJ, DISP est attendu" });
    return z.NEVER;
  }
  return { status: "ENTERED", score: parsed.value };
});

export const gradeRowSchema = z.object({
  studentRef: z.string().trim().min(1).max(120),
  entry: entrySchema,
  comment: optionalText(500),
});
export type GradeRow = z.infer<typeof gradeRowSchema> & Record<string, unknown>;

export const GRADE_COLUMNS = [
  column("studentRef", "Matricule de l'élève", "text", {
    required: true,
    aliases: ["matricule", "matricule eleve", "matricule de l eleve", "n matricule", "numero matricule", "id eleve", "student id", "numero d inscription", "n inscription", "eleve"],
    description: "Matricule d'origine, matricule de la plateforme ou numéro d'inscription de l'élève.",
    example: "2024-0001",
  }),
  column("entry", "Note ou code", "text", {
    required: true,
    aliases: ["note", "notes", "resultat", "score", "mark", "grade", "note sur 20", "valeur", "note ou code"],
    description: "La note telle que saisie (ex. 14,5) ou un code : ABS (absent), ABJ (absent justifié), DISP (dispensé).",
    example: "14,5",
  }),
  column("comment", "Observation", "text", { aliases: ["observation", "commentaire", "appreciation", "remarque", "comment", "remarques"], description: "Commentaire de l'enseignant (500 caractères).", example: "" }),
] as const;

export const gradesImporter: ImporterDef<GradeRow> = {
  key: "grades",
  label: "Notes",
  description: "Notes d'une évaluation par élève, avec les codes ABS, ABJ, DISP. Aucun calcul.",
  sensitive: false,
  entityType: "grade",
  supportsUpdate: true,
  columns: GRADE_COLUMNS,
  options: [{ key: "assessmentId", label: "Évaluation", required: true, help: "Évaluation en brouillon dont on importe les notes.", kind: "choice" }],
  importPermission: "imports.import.grades",
  targetPermissions: ["grade.enter", "assessment.manage"],
  conditionalPermissions: [],
  schema: gradeRowSchema,
  rules(): ImportIssue[] {
    return [];
  },
  naturalKey(row, options) {
    return `grades|${String(options["assessmentId"] ?? "")}|${row.studentRef.trim().toUpperCase()}`;
  },
  validateOptions(options) {
    return requireUuidOption(options, "assessmentId", "Évaluation");
  },
  extraPermissions() {
    return [];
  },
  sampleRows: [
    ["2024-0001", "14,5", ""],
    ["2024-0002", "ABS", "Absent le jour du devoir"],
    ["2024-0003", "9", ""],
  ],
};

/**
 * Importeur « notes de mes classes » (réponse métier O-02) : le MÊME fichier et les MÊMES règles que « notes », ouvert aux
 * ENSEIGNANTS pour leurs seules évaluations. Il n'exige pas `assessment.manage` (qui ouvre toutes les évaluations) mais
 * `grade.enter` + `imports.import.grades_own`, et le port (`scope: "OWN"`) travaille SANS capacité étendue : `assess` vérifie alors,
 * à chaque lecture et à chaque écriture, que l'auteur est l'enseignant de l'évaluation ET encore affecté à cette matière dans cette
 * classe (`assess.not_assigned` sinon). Le périmètre est donc vérifié côté serveur, par l'affectation d'enseignement, jamais par
 * un paramètre du client. Les notes arrivent dans les mêmes évaluations en brouillon et suivent le même circuit de validation.
 */
export const gradesOwnImporter: ImporterDef<GradeRow> = {
  ...gradesImporter,
  key: "grades_own",
  label: "Notes de mes classes",
  description: "Notes d'une de vos évaluations (matières et classes où vous enseignez), avec les codes ABS, ABJ, DISP. Aucun calcul.",
  importPermission: "imports.import.grades_own",
  targetPermissions: ["grade.enter"],
};
