/**
 * Importeur « matières et curriculum » : noeuds d'une version de curriculum en BROUILLON (type, code, libellé, matière,
 * coefficient, crédits, période, volumes horaires). Un noeud peut désigner son parent par son code : le parent doit
 * figurer plus haut dans le fichier ou exister déjà dans la version.
 *
 * Coefficients et crédits sont repris TELS QUELS (chaînes décimales) : l'import ne calcule rien, les règles de
 * calcul appartiennent aux RuleSets du moteur de règles.
 *
 * Écriture (port `curriculum`, `platform/adapters/imports-academic.ts`) : `academic.createSubject` (si la matière est
 * inconnue), `academic.addCurriculumNode`, `academic.updateCurriculumNode`.
 */
import { z } from "zod";
import { issue, type ImporterDef, type ImportIssue } from "../domain/types";
import { column, optionalText, requireUuidOption } from "./common";

const decimal = z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, "nombre positif attendu");

export const curriculumRowSchema = z.object({
  code: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(160),
  nodeTypeCode: z.string().trim().min(1).max(60),
  parentCode: optionalText(60),
  subjectCode: optionalText(60),
  gradeLevelCode: optionalText(60),
  coefficient: decimal.optional(),
  credits: decimal.optional(),
  periodTypeCode: optionalText(60),
  periodOrdinal: z.number().int().min(1).max(99).optional(),
  ordinal: z.number().int().min(0).max(100_000).optional(),
  isMandatory: z.boolean().optional(),
  hoursTotal: decimal.optional(),
});
export type CurriculumRow = z.infer<typeof curriculumRowSchema> & Record<string, unknown>;

export const CURRICULUM_COLUMNS = [
  column("code", "Code du noeud", "code", { required: true, aliases: ["code", "code noeud", "code ue", "code matiere", "code ecue", "id", "identifiant", "code du noeud"], description: "Code unique du noeud dans la version (matière, UE, ECUE, semestre...).", example: "MATHS" }),
  column("label", "Libellé", "text", { required: true, aliases: ["libelle", "intitule", "nom", "matiere", "designation", "label", "name", "titre"], description: "Intitulé affiché.", example: "Mathématiques" }),
  column("nodeTypeCode", "Type de noeud (code)", "code", { required: true, aliases: ["type", "type noeud", "type de noeud", "nature", "node type", "categorie noeud"], description: "Code du type de noeud défini par le programme (ex. SUBJECT, UE, ECUE, PERIOD).", example: "SUBJECT" }),
  column("parentCode", "Code du parent", "code", { aliases: ["parent", "code parent", "ue", "rattache a", "parent code", "semestre"], description: "Code du noeud parent (facultatif) ; il doit être déclaré plus haut.", example: "" }),
  column("subjectCode", "Code de la matière", "code", { aliases: ["code matiere", "matiere code", "subject", "subject code", "discipline"], description: "Code de la matière du référentiel ; créée à partir du libellé si elle n'existe pas encore.", example: "MATHS" }),
  column("gradeLevelCode", "Niveau (code)", "code", { aliases: ["niveau", "code niveau", "grade level", "classe niveau", "niveau scolaire"], description: "Code du niveau scolaire (exigé par un noeud de type niveau).", example: "" }),
  column("coefficient", "Coefficient", "decimal", { aliases: ["coefficient", "coef", "coeff", "poids", "weight"], description: "Coefficient (nombre positif).", example: "4" }),
  column("credits", "Crédits", "decimal", { aliases: ["credits", "credit", "ects", "nombre de credits"], description: "Crédits (nombre positif).", example: "" }),
  column("periodTypeCode", "Type de période (code)", "code", { aliases: ["type periode", "type de periode", "periode type", "period type"], description: "Code du type de période (ex. SEMESTER, TRIMESTER).", example: "" }),
  column("periodOrdinal", "N° de période", "integer", { aliases: ["numero periode", "n periode", "rang periode", "periode", "semestre numero", "period ordinal"], description: "Rang de la période (1, 2, 3...).", example: "" }),
  column("ordinal", "Ordre d'affichage", "integer", { aliases: ["ordre", "rang", "position", "ordinal", "ordre d affichage"], description: "Ordre parmi les noeuds frères.", example: "1" }),
  column("isMandatory", "Obligatoire", "boolean", { aliases: ["obligatoire", "mandatory", "required", "matiere obligatoire"], description: "oui / non.", example: "oui" }),
  column("hoursTotal", "Volume horaire total", "decimal", { aliases: ["volume horaire", "heures", "volume horaire total", "total heures", "hours", "vh"], description: "Heures au total.", example: "120" }),
] as const;

export const curriculumImporter: ImporterDef<CurriculumRow> = {
  key: "curriculum",
  label: "Matières et curriculum",
  description: "Noeuds de curriculum d'une version en brouillon : matières, UE, coefficients, crédits.",
  sensitive: false,
  entityType: "curriculum_node",
  supportsUpdate: true,
  columns: CURRICULUM_COLUMNS,
  options: [{ key: "curriculumVersionId", label: "Version de curriculum (brouillon)", required: true, help: "Version en brouillon qui reçoit les noeuds.", kind: "choice" }],
  importPermission: "imports.import.curriculum",
  targetPermissions: ["curriculum.manage"],
  conditionalPermissions: [{ permission: "academic.program.manage", when: "Colonne « Code de la matière » associée (création de matières)" }],
  schema: curriculumRowSchema,
  rules(row): ImportIssue[] {
    const out: ImportIssue[] = [];
    if (row.parentCode && row.parentCode === row.code) out.push(issue("parentCode", "imports.rule_violation", "Un noeud ne peut pas être son propre parent."));
    if (row.periodTypeCode && row.periodOrdinal === undefined) out.push(issue("periodOrdinal", "imports.required", "Le n° de période est obligatoire avec un type de période."));
    return out;
  },
  naturalKey(row, options) {
    return `curriculum|${String(options["curriculumVersionId"] ?? "")}|${row.code}`;
  },
  dependsOnKeys(row, options) {
    return row.parentCode ? [`curriculum|${String(options["curriculumVersionId"] ?? "")}|${row.parentCode}`] : [];
  },
  validateOptions(options) {
    return requireUuidOption(options, "curriculumVersionId", "Version de curriculum");
  },
  extraPermissions({ mappedColumns }) {
    return mappedColumns.has("subjectCode") ? ["academic.program.manage"] : [];
  },
  sampleRows: [
    ["MATHS", "Mathématiques", "SUBJECT", "", "MATHS", "", "4", "", "", "", "1", "oui", "120"],
    ["FRANC", "Français", "SUBJECT", "", "FRANC", "", "4", "", "", "", "2", "oui", "120"],
  ],
};
