/**
 * Importeur « élèves » : identité, sexe, naissance, matricule d'origine, n° national, contacts, adresse ; en option, une
 * inscription dans une classe avec son financement.
 *
 * Écriture (port `students`, branché par `platform/adapters/imports-people.ts`) : `people.createStudent` (idempotent par
 * `externalRef`), `people.updateStudent`, `academic.enrollStudent`. Aucune règle de numérotation ici : le matricule de la
 * plateforme est attribué par `people` ; la colonne « matricule d'origine » est la référence EXTERNE du fichier.
 */
import { z } from "zod";
import { keyPart } from "../domain/text";
import { issue, type ImporterDef, type ImportIssue } from "../domain/types";
import { column, optionalText, plausibleBirthDate, sexSchema } from "./common";

export const studentRowSchema = z.object({
  externalRef: optionalText(100),
  lastName: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(120),
  sex: sexSchema,
  birthDate: z.string().optional(),
  birthPlace: optionalText(160),
  nationality: z.string().regex(/^[A-Z]{2}$/, "code pays à deux lettres attendu (ex. CI)").optional(),
  nationalStudentId: optionalText(60),
  birthCertificateNumber: optionalText(80),
  email: z.string().max(320).optional(),
  phone: z.string().max(40).optional(),
  phoneAlt: z.string().max(40).optional(),
  addressLine: optionalText(300),
  city: optionalText(120),
  residence: optionalText(200),
  classCode: optionalText(60),
  fundingType: optionalText(60),
  assignmentReference: optionalText(100),
});
export type StudentRow = z.infer<typeof studentRowSchema> & Record<string, unknown>;

export const STUDENT_COLUMNS = [
  column("externalRef", "Matricule d'origine", "text", {
    aliases: ["matricule", "n matricule", "numero matricule", "matricule eleve", "matricule d origine", "id eleve", "identifiant", "code eleve", "student id", "registration number", "reference"],
    description: "Identifiant de l'élève dans votre ancien système. Il rend l'import rejouable sans doublon.",
    example: "2024-0012",
  }),
  column("lastName", "Nom", "text", { required: true, aliases: ["nom", "nom de famille", "nom eleve", "last name", "family name", "surname"], description: "Nom de famille.", example: "KONE" }),
  column("firstName", "Prénoms", "text", { required: true, aliases: ["prenom", "prenoms", "first name", "given name", "firstname"], description: "Prénoms.", example: "Aminata" }),
  column("sex", "Sexe", "text", { required: true, aliases: ["sexe", "genre", "sex", "gender"], description: "M ou F (masculin, féminin, garçon, fille).", example: "F" }),
  column("birthDate", "Date de naissance", "date", { aliases: ["date naissance", "naissance", "ne le", "nee le", "date of birth", "birth date", "dob"], description: "JJ/MM/AAAA ou AAAA-MM-JJ.", example: "03/04/2012" }),
  column("birthPlace", "Lieu de naissance", "text", { aliases: ["lieu naissance", "ne a", "nee a", "place of birth", "birth place"], description: "Ville ou localité de naissance.", example: "Abidjan" }),
  column("nationality", "Nationalité (code pays)", "code", { aliases: ["nationalite", "pays", "nationality", "code pays"], description: "Code pays à deux lettres (ISO 3166-1).", example: "CI" }),
  column("nationalStudentId", "N° national", "text", { aliases: ["numero national", "n national", "id national", "matricule national", "numero mena", "national id"], description: "Identifiant national de l'élève, s'il existe.", example: "20120403-AB12" }),
  column("birthCertificateNumber", "N° acte de naissance", "text", { aliases: ["acte de naissance", "numero acte naissance", "extrait de naissance", "birth certificate"], description: "Numéro de l'acte de naissance.", example: "123/2012" }),
  column("email", "E-mail", "email", { aliases: ["email", "e mail", "courriel", "adresse e mail", "mail"], description: "Adresse e-mail de l'élève.", example: "" }),
  column("phone", "Téléphone", "phone", { aliases: ["telephone", "tel", "mobile", "portable", "phone", "contact", "numero de telephone"], description: "Téléphone de l'élève.", example: "07 01 02 03 04" }),
  column("phoneAlt", "Téléphone secondaire", "phone", { aliases: ["telephone 2", "tel 2", "telephone secondaire", "autre telephone", "phone 2"], description: "Second numéro.", example: "" }),
  column("addressLine", "Adresse", "text", { aliases: ["adresse", "address", "rue", "domicile"], description: "Adresse postale.", example: "Cocody, Riviera 2" }),
  column("city", "Ville", "text", { aliases: ["ville", "commune", "city"], description: "Ville de résidence.", example: "Abidjan" }),
  column("residence", "Résidence", "text", { aliases: ["residence", "quartier", "localite", "lieu de residence"], description: "Quartier ou résidence.", example: "Riviera 2" }),
  column("classCode", "Classe (code)", "code", { aliases: ["classe", "code classe", "class", "classroom", "niveau classe"], description: "Code de la classe d'inscription (option : inscrit l'élève).", example: "6EME_A" }),
  column("fundingType", "Financement (code)", "code", { aliases: ["financement", "mode de financement", "type de financement", "funding", "regime", "statut"], description: "Code du type de financement de l'inscription (ex. PRIVATE).", example: "PRIVATE" }),
  column("assignmentReference", "Référence d'affectation", "text", { aliases: ["reference affectation", "affectation", "numero d affectation", "assignment reference"], description: "Référence d'affectation (élèves affectés par l'État).", example: "" }),
] as const;

export const studentsImporter: ImporterDef<StudentRow> = {
  key: "students",
  label: "Élèves",
  description: "Identité, matricule d'origine, naissance, contacts ; inscription et financement en option.",
  sensitive: false,
  entityType: "student",
  supportsUpdate: true,
  columns: STUDENT_COLUMNS,
  options: [
    {
      key: "academicYearId",
      label: "Année scolaire des inscriptions",
      required: false,
      help: "Nécessaire seulement si la colonne « Classe » est utilisée. Par défaut : l'année courante.",
      kind: "choice",
    },
    {
      key: "duplicatePolicy",
      label: "Doublons probables (même nom et même naissance)",
      required: false,
      help: "Refuser : la ligne est signalée. Confirmer : l'élève est créé malgré tout (motif tracé dans l'audit).",
      kind: "choice",
      choices: [
        { value: "REJECT", label: "Refuser (recommandé)" },
        { value: "ACKNOWLEDGE", label: "Créer malgré le doublon" },
      ],
    },
  ],
  importPermission: "imports.import.students",
  targetPermissions: ["student.create"],
  conditionalPermissions: [
    { permission: "student.update", when: "Politique « mettre à jour les élèves existants »" },
    { permission: "enrollment.create", when: "Colonne « Classe » associée" },
  ],
  schema: studentRowSchema,
  rules(row, _options, env): ImportIssue[] {
    const out: ImportIssue[] = plausibleBirthDate(row.birthDate, "birthDate", env.today);
    if (!row.externalRef && !row.nationalStudentId) {
      out.push(issue("externalRef", "imports.rule_violation", "Aucun matricule d'origine : les doublons ne seront détectés que par le nom et la date de naissance.", "WARNING"));
    }
    if (row.assignmentReference && !row.fundingType) out.push(issue("fundingType", "imports.rule_violation", "Une référence d'affectation est donnée sans type de financement.", "WARNING"));
    return out;
  },
  naturalKey(row) {
    if (row.externalRef) return `students|ref|${row.externalRef.trim().toUpperCase()}`;
    if (row.nationalStudentId) return `students|nat|${row.nationalStudentId.trim().toUpperCase()}`;
    return `students|name|${keyPart(row.lastName)}|${keyPart(row.firstName)}|${row.birthDate ?? ""}`;
  },
  validateOptions(options) {
    const out: ImportIssue[] = [];
    const policy = options["duplicatePolicy"];
    if (policy !== undefined && policy !== "REJECT" && policy !== "ACKNOWLEDGE") out.push(issue("duplicatePolicy", "imports.options_invalid", "Politique de doublons inconnue."));
    return out;
  },
  extraPermissions({ mappedColumns, onExisting }) {
    const extra: string[] = [];
    if (onExisting === "UPDATE") extra.push("student.update");
    if (mappedColumns.has("classCode")) extra.push("enrollment.create");
    return extra;
  },
  sampleRows: [
    ["2024-0001", "KONE", "Aminata", "F", "03/04/2012", "Abidjan", "CI", "", "", "", "07 01 02 03 04", "", "Cocody, Riviera 2", "Abidjan", "Riviera 2", "6EME_A", "PRIVATE", ""],
    ["2024-0002", "TRAORE", "Ibrahim", "M", "21/11/2011", "Bouaké", "CI", "", "", "", "", "", "Bouaké, quartier Commerce", "Bouaké", "", "6EME_A", "PRIVATE", ""],
  ],
};
