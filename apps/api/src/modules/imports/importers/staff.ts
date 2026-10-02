/**
 * Importeur « enseignants et personnel » : identité, catégorie (enseignant, éducateur, administratif...), poste, date
 * d'embauche. Ni tarif ni salaire (hors périmètre de `people`, voir la paie).
 *
 * Écriture (port `staff`, `platform/adapters/imports-people.ts`) : `people.createStaff` (idempotent par `externalRef`),
 * `people.updateStaff`.
 */
import { z } from "zod";
import { keyPart } from "../domain/text";
import { issue, type ImporterDef, type ImportIssue } from "../domain/types";
import { column, optionalText, plausibleBirthDate, sexSchema } from "./common";

export const staffRowSchema = z.object({
  externalRef: optionalText(100),
  lastName: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(120),
  sex: sexSchema.optional(),
  birthDate: z.string().optional(),
  birthPlace: optionalText(160),
  nationality: z.string().regex(/^[A-Z]{2}$/, "code pays à deux lettres attendu (ex. CI)").optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(40).optional(),
  addressLine: optionalText(300),
  city: optionalText(120),
  categoryCode: z.string().trim().min(1).max(60),
  jobTitle: optionalText(160),
  hiredOn: z.string().optional(),
});
export type StaffRow = z.infer<typeof staffRowSchema> & Record<string, unknown>;

export const STAFF_COLUMNS = [
  column("externalRef", "Matricule d'origine", "text", {
    aliases: ["matricule", "n matricule", "numero matricule", "matricule enseignant", "matricule agent", "matricule d origine", "id", "identifiant", "reference"],
    description: "Identifiant de l'agent dans votre ancien système (rend l'import rejouable).",
    example: "ENS-014",
  }),
  column("lastName", "Nom", "text", { required: true, aliases: ["nom", "nom de famille", "nom enseignant", "nom agent", "last name", "surname"], description: "Nom de famille.", example: "YAO" }),
  column("firstName", "Prénoms", "text", { required: true, aliases: ["prenom", "prenoms", "first name", "given name"], description: "Prénoms.", example: "Kouadio" }),
  column("sex", "Sexe", "text", { aliases: ["sexe", "genre", "sex", "gender"], description: "M ou F.", example: "M" }),
  column("birthDate", "Date de naissance", "date", { aliases: ["date naissance", "naissance", "ne le", "nee le", "date of birth", "dob"], description: "JJ/MM/AAAA ou AAAA-MM-JJ.", example: "15/08/1985" }),
  column("birthPlace", "Lieu de naissance", "text", { aliases: ["lieu naissance", "ne a", "nee a", "place of birth"], description: "Lieu de naissance.", example: "Yamoussoukro" }),
  column("nationality", "Nationalité (code pays)", "code", { aliases: ["nationalite", "pays", "nationality", "code pays"], description: "Code pays à deux lettres.", example: "CI" }),
  column("email", "E-mail", "email", { aliases: ["email", "e mail", "courriel", "adresse e mail", "mail"], description: "Adresse e-mail professionnelle ou personnelle.", example: "k.yao@exemple.ci" }),
  column("phone", "Téléphone", "phone", { aliases: ["telephone", "tel", "mobile", "portable", "phone", "contact"], description: "Téléphone.", example: "07 22 33 44 55" }),
  column("addressLine", "Adresse", "text", { aliases: ["adresse", "address", "domicile"], description: "Adresse postale.", example: "Yopougon, Niangon" }),
  column("city", "Ville", "text", { aliases: ["ville", "commune", "city"], description: "Ville.", example: "Abidjan" }),
  column("categoryCode", "Catégorie", "text", { required: true, aliases: ["categorie", "categorie de personnel", "type de personnel", "fonction", "statut", "category", "role", "profil"], description: "Code ou libellé de la catégorie (ex. ENSEIGNANT) tel que paramétré dans l'établissement.", example: "ENSEIGNANT" }),
  column("jobTitle", "Poste", "text", { aliases: ["poste", "intitule du poste", "titre", "job title", "emploi", "matiere enseignee", "discipline"], description: "Intitulé du poste ou discipline.", example: "Professeur de mathématiques" }),
  column("hiredOn", "Date d'embauche", "date", { aliases: ["date embauche", "embauche", "date de recrutement", "recrute le", "date d entree", "hired on", "hire date"], description: "JJ/MM/AAAA ou AAAA-MM-JJ.", example: "01/09/2015" }),
] as const;

export const staffImporter: ImporterDef<StaffRow> = {
  key: "staff",
  label: "Enseignants et personnel",
  description: "Fiches du personnel : identité, catégorie, poste, embauche.",
  sensitive: false,
  entityType: "staff",
  supportsUpdate: true,
  columns: STAFF_COLUMNS,
  options: [
    {
      key: "duplicatePolicy",
      label: "Doublons probables (même nom et même naissance)",
      required: false,
      help: "Refuser : la ligne est signalée. Confirmer : la fiche est créée malgré tout.",
      kind: "choice",
      choices: [
        { value: "REJECT", label: "Refuser (recommandé)" },
        { value: "ACKNOWLEDGE", label: "Créer malgré le doublon" },
      ],
    },
  ],
  importPermission: "imports.import.staff",
  targetPermissions: ["staff.create"],
  conditionalPermissions: [{ permission: "staff.update", when: "Politique « mettre à jour le personnel existant »" }],
  schema: staffRowSchema,
  rules(row, _options, env): ImportIssue[] {
    const out: ImportIssue[] = plausibleBirthDate(row.birthDate, "birthDate", env.today);
    if (row.hiredOn && row.hiredOn > env.today) out.push(issue("hiredOn", "imports.rule_violation", "La date d'embauche est dans le futur.", "WARNING"));
    if (row.birthDate && row.hiredOn && row.hiredOn < row.birthDate) out.push(issue("hiredOn", "imports.rule_violation", "La date d'embauche précède la date de naissance."));
    return out;
  },
  naturalKey(row) {
    if (row.externalRef) return `staff|ref|${row.externalRef.trim().toUpperCase()}`;
    if (row.email) return `staff|mail|${row.email.toLowerCase()}`;
    return `staff|name|${keyPart(row.lastName)}|${keyPart(row.firstName)}|${row.birthDate ?? ""}`;
  },
  validateOptions(options) {
    const policy = options["duplicatePolicy"];
    return policy !== undefined && policy !== "REJECT" && policy !== "ACKNOWLEDGE" ? [issue("duplicatePolicy", "imports.options_invalid", "Politique de doublons inconnue.")] : [];
  },
  extraPermissions({ onExisting }) {
    return onExisting === "UPDATE" ? ["staff.update"] : [];
  },
  sampleRows: [
    ["ENS-001", "YAO", "Kouadio", "M", "15/08/1985", "Yamoussoukro", "CI", "k.yao@exemple.ci", "07 22 33 44 55", "Yopougon, Niangon", "Abidjan", "ENSEIGNANT", "Professeur de mathématiques", "01/09/2015"],
    ["ENS-002", "BAMBA", "Fatoumata", "F", "02/02/1990", "Daloa", "CI", "f.bamba@exemple.ci", "05 66 77 88 99", "", "Daloa", "ENSEIGNANT", "Professeur de français", "01/09/2018"],
  ],
};
