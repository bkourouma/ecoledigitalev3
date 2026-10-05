/**
 * Importeur « inscriptions » (réponse métier O-13) : des élèves DÉJÀ présents dans la plateforme vers les classes d'une année
 * scolaire (l'année courante ou l'année qui s'ouvre : `DRAFT` / `OPEN`). Le fichier désigne l'élève par son matricule d'origine,
 * son matricule de la plateforme ou son numéro d'inscription, et la classe par son code.
 *
 * Contrairement à l'importeur « élèves » (qui crée la fiche et, en option, l'inscription), celui-ci ne crée AUCUNE fiche élève :
 * il inscrit. Écriture (port `enrollments`, `platform/adapters/imports-academic.ts`) : `academic.enrollStudent` — avec ses règles
 * (classe ouverte, une inscription de classe par année, capacité dure, financement et référence d'affectation, politique de
 * confirmation), son audit et ses événements.
 *
 * Une inscription existante n'est jamais modifiée : le même élève dans la même classe est « déjà inscrit » (ligne ignorée,
 * rejeu sans doublon) ; le même élève dans une autre classe de l'année est refusé (un transfert se fait dans `academic`).
 */
import { z } from "zod";
import { issue, type ImporterDef, type ImportIssue } from "../domain/types";
import { column, optionalText, requireUuidOption } from "./common";

export const enrollmentRowSchema = z.object({
  studentRef: z.string().trim().min(1).max(120),
  classCode: z.string().trim().min(1).max(60),
  fundingType: optionalText(60),
  assignmentReference: optionalText(100),
  enrolledOn: z.string().optional(),
});
export type EnrollmentRow = z.infer<typeof enrollmentRowSchema> & Record<string, unknown>;

export const ENROLLMENT_COLUMNS = [
  column("studentRef", "Matricule de l'élève", "text", {
    required: true,
    aliases: ["matricule", "matricule eleve", "matricule de l eleve", "n matricule", "numero matricule", "id eleve", "student id", "numero d inscription", "n inscription", "eleve", "matricule d origine"],
    description: "Matricule d'origine, matricule de la plateforme ou numéro d'inscription d'un élève déjà enregistré.",
    example: "2024-0001",
  }),
  column("classCode", "Classe (code)", "code", {
    required: true,
    aliases: ["classe", "code classe", "class", "classroom", "code de la classe", "classe d inscription", "classe code"],
    description: "Code de la classe d'inscription, dans l'année scolaire choisie.",
    example: "6EME_A",
  }),
  column("fundingType", "Financement (code)", "code", {
    aliases: ["financement", "mode de financement", "type de financement", "funding", "regime"],
    description: "Code du type de financement (ex. PRIVATE). Par défaut : le financement privé.",
    example: "PRIVATE",
  }),
  column("assignmentReference", "Référence d'affectation", "text", {
    aliases: ["reference affectation", "affectation", "numero d affectation", "assignment reference"],
    description: "Référence d'affectation (élèves affectés par l'État).",
    example: "",
  }),
  column("enrolledOn", "Date d'inscription", "date", {
    aliases: ["date inscription", "date d inscription", "inscrit le", "enrolled on", "enrollment date"],
    description: "JJ/MM/AAAA ou AAAA-MM-JJ. Par défaut : la date du jour.",
    example: "",
  }),
] as const;

export const enrollmentsImporter: ImporterDef<EnrollmentRow> = {
  key: "enrollments",
  label: "Inscriptions",
  description: "Inscrit des élèves déjà enregistrés dans les classes de l'année courante. Aucune fiche élève n'est créée ni modifiée.",
  sensitive: false,
  entityType: "enrollment",
  supportsUpdate: false,
  columns: ENROLLMENT_COLUMNS,
  options: [{ key: "academicYearId", label: "Année scolaire des inscriptions", required: true, help: "L'année courante (ou celle qui s'ouvre) : les classes du fichier sont cherchées dans cette année.", kind: "choice" }],
  importPermission: "imports.import.enrollments",
  targetPermissions: ["enrollment.create"],
  conditionalPermissions: [],
  schema: enrollmentRowSchema,
  rules(row): ImportIssue[] {
    // Aucune règle réglementaire ici : la date est seulement contrôlée pour sa vraisemblance, le reste relève d'`academic`.
    if (row.enrolledOn && row.enrolledOn < "1990-01-01") return [issue("enrolledOn", "imports.rule_violation", "La date d'inscription est invraisemblable (avant 1990).")];
    return [];
  },
  naturalKey(row, options) {
    return `enrollments|${String(options["academicYearId"] ?? "")}|${row.studentRef.trim().toUpperCase()}`;
  },
  validateOptions(options) {
    return requireUuidOption(options, "academicYearId", "Année scolaire");
  },
  extraPermissions() {
    return [];
  },
  sampleRows: [
    ["2024-0001", "6EME_A", "PRIVATE", "", ""],
    ["2024-0002", "6EME_A", "PRIVATE", "", ""],
    ["2024-0003", "6EME_B", "PRIVATE", "", ""],
  ],
};
