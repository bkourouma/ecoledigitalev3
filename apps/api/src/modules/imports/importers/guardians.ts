/**
 * Importeur « parents / tuteurs et liens » : un tuteur (identité, contacts, profession) et son lien avec UN élève
 * (référencé par son matricule d'origine), avec la relation et les drapeaux du lien. Un tuteur de plusieurs enfants
 * apparaît sur plusieurs lignes : il n'est créé qu'une fois (référence `guardians|person|…`), chaque ligne crée un lien.
 *
 * Écriture (port `guardians`, `platform/adapters/imports-people.ts`) : `people.createGuardian`, `people.linkGuardian`.
 */
import { z } from "zod";
import { digitsOnly, keyPart } from "../domain/text";
import { issue, type ImporterDef, type ImportIssue } from "../domain/types";
import { column, optionalText, sexSchema } from "./common";

export const guardianRowSchema = z.object({
  studentRef: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(120),
  sex: sexSchema.optional(),
  phone: z.string().max(40).optional(),
  phoneAlt: z.string().max(40).optional(),
  email: z.string().max(320).optional(),
  addressLine: optionalText(300),
  city: optionalText(120),
  occupation: optionalText(160),
  employer: optionalText(160),
  relationship: z.string().trim().min(1).max(60),
  isPrimaryContact: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
  isFinancialResponsible: z.boolean().optional(),
  hasLegalCustody: z.boolean().optional(),
  canPickup: z.boolean().optional(),
  portalAccess: z.boolean().optional(),
});
export type GuardianRow = z.infer<typeof guardianRowSchema> & Record<string, unknown>;

/** Identité stable d'un tuteur dans le fichier : nom + (téléphone, sinon e-mail). Les époux ne fusionnent donc jamais. */
export function guardianIdentityKey(row: Pick<GuardianRow, "lastName" | "firstName" | "phone" | "email">): string {
  const contact = row.phone ? `tel:${digitsOnly(row.phone)}` : row.email ? `mail:${row.email.toLowerCase()}` : "";
  return `${keyPart(row.lastName)} ${keyPart(row.firstName)}|${contact}`;
}

export const GUARDIAN_COLUMNS = [
  column("studentRef", "Matricule de l'élève", "text", {
    required: true,
    aliases: ["matricule eleve", "matricule de l eleve", "matricule enfant", "matricule de l enfant", "eleve", "student id", "matricule", "id eleve", "reference eleve"],
    description: "Matricule d'origine (ou numéro d'élève) de l'enfant, tel qu'importé avec les élèves.",
    example: "2024-0001",
  }),
  column("lastName", "Nom du tuteur", "text", { required: true, aliases: ["nom", "nom tuteur", "nom du parent", "nom parent", "nom du tuteur", "last name", "surname"], description: "Nom de famille du tuteur.", example: "KONE" }),
  column("firstName", "Prénoms du tuteur", "text", { required: true, aliases: ["prenom", "prenoms", "prenom tuteur", "prenom du parent", "prenoms du tuteur", "first name"], description: "Prénoms du tuteur.", example: "Mariam" }),
  column("sex", "Sexe du tuteur", "text", { aliases: ["sexe", "genre", "sex", "sexe tuteur"], description: "M ou F.", example: "F" }),
  column("phone", "Téléphone", "phone", { aliases: ["telephone", "tel", "mobile", "portable", "phone", "contact", "telephone tuteur"], description: "Téléphone principal du tuteur.", example: "07 01 02 03 04" }),
  column("phoneAlt", "Téléphone secondaire", "phone", { aliases: ["telephone 2", "tel 2", "autre telephone", "telephone secondaire", "phone 2"], description: "Second numéro.", example: "" }),
  column("email", "E-mail", "email", { aliases: ["email", "e mail", "courriel", "adresse e mail", "mail"], description: "Adresse e-mail du tuteur.", example: "" }),
  column("addressLine", "Adresse", "text", { aliases: ["adresse", "address", "domicile"], description: "Adresse postale.", example: "Cocody, Riviera 2" }),
  column("city", "Ville", "text", { aliases: ["ville", "commune", "city"], description: "Ville.", example: "Abidjan" }),
  column("occupation", "Profession", "text", { aliases: ["profession", "metier", "occupation", "job"], description: "Profession du tuteur.", example: "Commerçante" }),
  column("employer", "Employeur", "text", { aliases: ["employeur", "lieu de travail", "societe", "employer", "entreprise"], description: "Employeur ou lieu de travail.", example: "" }),
  column("relationship", "Lien de parenté", "text", { required: true, aliases: ["lien", "lien de parente", "parente", "relation", "qualite", "relationship", "lien avec l eleve"], description: "Code ou libellé du lien (ex. MERE, PERE, TUTEUR) tel que paramétré dans l'établissement.", example: "MERE" }),
  column("isPrimaryContact", "Contact principal", "boolean", { aliases: ["contact principal", "principal", "primary contact", "tuteur principal"], description: "oui / non : contact principal de l'élève (un seul).", example: "oui" }),
  column("isEmergencyContact", "Contact d'urgence", "boolean", { aliases: ["contact urgence", "urgence", "contact d urgence", "emergency"], description: "oui / non.", example: "oui" }),
  column("isFinancialResponsible", "Répondant financier", "boolean", { aliases: ["repondant financier", "responsable financier", "payeur", "financial responsible", "paie la scolarite"], description: "oui / non.", example: "oui" }),
  column("hasLegalCustody", "Autorité parentale", "boolean", { aliases: ["autorite parentale", "tutelle legale", "garde", "custody", "autorite"], description: "oui / non.", example: "oui" }),
  column("canPickup", "Autorisé à récupérer l'enfant", "boolean", { aliases: ["autorise a recuperer", "recuperer l enfant", "peut recuperer", "pickup", "autorisation de sortie"], description: "oui / non.", example: "oui" }),
  column("portalAccess", "Accès au portail", "boolean", { aliases: ["acces portail", "portail", "portal access", "acces parent"], description: "oui / non : accès au suivi en ligne.", example: "non" }),
] as const;

export const guardiansImporter: ImporterDef<GuardianRow> = {
  key: "guardians",
  label: "Parents et tuteurs",
  description: "Tuteurs et leurs liens avec les élèves (un tuteur de plusieurs enfants n'est créé qu'une fois).",
  sensitive: false,
  entityType: "guardian_link",
  supportsUpdate: true,
  columns: GUARDIAN_COLUMNS,
  options: [
    {
      key: "duplicatePolicy",
      label: "Doublons probables (même nom, même téléphone)",
      required: false,
      help: "Refuser : la ligne est signalée. Confirmer : le tuteur est créé malgré tout.",
      kind: "choice",
      choices: [
        { value: "REJECT", label: "Refuser (recommandé)" },
        { value: "ACKNOWLEDGE", label: "Créer malgré le doublon" },
      ],
    },
  ],
  importPermission: "imports.import.guardians",
  targetPermissions: ["guardian.manage"],
  conditionalPermissions: [],
  schema: guardianRowSchema,
  rules(row): ImportIssue[] {
    const out: ImportIssue[] = [];
    if (!row.phone && !row.email) out.push(issue("phone", "imports.rule_violation", "Ni téléphone ni e-mail : le tuteur ne sera pas joignable.", "WARNING"));
    return out;
  },
  naturalKey(row) {
    return `guardians|link|${guardianIdentityKey(row)}|${row.studentRef.trim().toUpperCase()}`;
  },
  relatedKeys(row) {
    return [`guardians|person|${guardianIdentityKey(row)}`];
  },
  validateOptions(options) {
    const policy = options["duplicatePolicy"];
    return policy !== undefined && policy !== "REJECT" && policy !== "ACKNOWLEDGE" ? [issue("duplicatePolicy", "imports.options_invalid", "Politique de doublons inconnue.")] : [];
  },
  extraPermissions() {
    return [];
  },
  sampleRows: [
    ["2024-0001", "KONE", "Mariam", "F", "07 01 02 03 04", "", "mariam.kone@exemple.ci", "Cocody, Riviera 2", "Abidjan", "Commerçante", "", "MERE", "oui", "oui", "oui", "oui", "oui", "non"],
    ["2024-0002", "TRAORE", "Seydou", "M", "05 11 22 33 44", "", "", "Bouaké", "Bouaké", "Enseignant", "", "PERE", "oui", "oui", "oui", "oui", "oui", "non"],
  ],
};
