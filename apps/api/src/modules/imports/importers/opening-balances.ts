/**
 * Importeur « soldes financiers d'ouverture » : factures de reprise (montant dû à l'ouverture) et avoirs de reprise
 * (réduction d'une facture de reprise). Montants ENTIERS en francs CFA (XOF) : `1500,5` est refusé, jamais arrondi.
 *
 * Importeur SENSIBLE : la MFA est exigée au lancement (`imports.import.opening_balances` est une permission sensible),
 * chaque import est audité. Les documents financiers sont immuables : la politique « mettre à jour » n'existe pas ; un
 * rejeu du même fichier est neutre (clé d'idempotence de la facture + référence d'idempotence de l'import).
 *
 * Écriture (port `openingBalances`, `platform/adapters/imports-finance.ts`) : `finance.createInvoice` (avec émission),
 * `finance.issueCreditNote`.
 */
import { z } from "zod";
import { issue, type ImporterDef, type ImportIssue } from "../domain/types";
import { column, optionalText } from "./common";

export const BALANCE_KINDS = ["INVOICE", "CREDIT_NOTE"] as const;

const kindSchema = z.string().transform((value, ctx): (typeof BALANCE_KINDS)[number] => {
  const n = value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (["facture", "invoice", "f", "dette", "debit", "solde"].includes(n)) return "INVOICE";
  if (["avoir", "credit note", "credit", "a", "avoir de reprise"].includes(n)) return "CREDIT_NOTE";
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "valeur non reconnue (attendu FACTURE ou AVOIR)" });
  return z.NEVER;
});

export const balanceRowSchema = z.object({
  reference: z.string().trim().min(1).max(100),
  studentRef: z.string().trim().min(1).max(120),
  kind: kindSchema.optional(),
  amount: z.number().int().min(1).max(2_000_000_000),
  description: optionalText(300),
  academicYear: optionalText(20),
  dueDate: z.string().optional(),
  invoiceRef: optionalText(100),
  reason: optionalText(300),
});
export type BalanceRow = z.infer<typeof balanceRowSchema> & Record<string, unknown>;

export const BALANCE_COLUMNS = [
  column("reference", "Référence", "text", { required: true, aliases: ["reference", "ref", "numero", "numero de reprise", "n piece", "piece", "id", "reference de reprise"], description: "Référence UNIQUE de la ligne (elle rend l'import rejouable sans doublon).", example: "REPRISE-2025-0001" }),
  column("studentRef", "Matricule de l'élève", "text", { required: true, aliases: ["matricule", "matricule eleve", "matricule de l eleve", "n matricule", "id eleve", "eleve", "student id"], description: "Matricule d'origine ou matricule de la plateforme de l'élève.", example: "2024-0001" }),
  column("kind", "Type", "text", { aliases: ["type", "nature", "type de ligne", "facture ou avoir", "kind", "sens"], description: "FACTURE (montant dû, par défaut) ou AVOIR (réduction d'une facture de reprise).", example: "FACTURE" }),
  column("amount", "Montant (FCFA)", "integer", { required: true, amount: true, aliases: ["montant", "solde", "montant du", "reste a payer", "amount", "total", "montant fcfa", "montant xof", "montant en fcfa", "reliquat"], description: "Montant entier en francs CFA, sans décimale ni symbole.", example: "150000" }),
  column("description", "Libellé", "text", { aliases: ["libelle", "description", "designation", "motif", "objet", "label"], description: "Libellé de la ligne (défaut : « Reprise du solde d'ouverture »).", example: "Solde scolarité 2024-2025" }),
  column("academicYear", "Année scolaire", "text", { aliases: ["annee scolaire", "annee", "exercice", "academic year", "year", "campagne"], description: "Année scolaire de la facture (ex. 2024-2025) ; par défaut, celle de l'option.", example: "2024-2025" }),
  column("dueDate", "Échéance", "date", { aliases: ["echeance", "date d echeance", "date limite", "due date", "a payer avant le"], description: "Date d'échéance (facultatif).", example: "31/12/2025" }),
  column("invoiceRef", "Facture visée (avoir)", "text", { aliases: ["facture visee", "facture", "reference facture", "facture d origine", "facture concernee", "invoice ref", "avoir sur"], description: "Pour un AVOIR : la référence de la facture de reprise à réduire.", example: "" }),
  column("reason", "Motif de l'avoir", "text", { aliases: ["motif avoir", "raison", "reason", "cause", "motif de l avoir"], description: "Pour un AVOIR : motif de la réduction.", example: "" }),
] as const;

export const openingBalancesImporter: ImporterDef<BalanceRow> = {
  key: "opening_balances",
  label: "Soldes financiers d'ouverture",
  description: "Factures et avoirs de reprise, montants entiers en FCFA. MFA exigée pour lancer l'import.",
  sensitive: true,
  entityType: "opening_balance",
  supportsUpdate: false,
  columns: BALANCE_COLUMNS,
  options: [{ key: "academicYear", label: "Année scolaire par défaut des factures (ex. 2024-2025)", required: true, help: "Utilisée quand la colonne « Année scolaire » est absente ou vide.", kind: "text" }],
  importPermission: "imports.import.opening_balances",
  targetPermissions: ["finance.invoice.create"],
  conditionalPermissions: [],
  schema: balanceRowSchema,
  rules(row): ImportIssue[] {
    const out: ImportIssue[] = [];
    const kind = row.kind ?? "INVOICE";
    if (kind === "CREDIT_NOTE") {
      if (!row.invoiceRef) out.push(issue("invoiceRef", "imports.required", "Un avoir doit viser une facture de reprise (colonne « Facture visée »)."));
      if (!row.reason) out.push(issue("reason", "imports.required", "Un avoir exige un motif."));
      if (row.invoiceRef && row.invoiceRef === row.reference) out.push(issue("invoiceRef", "imports.rule_violation", "Un avoir ne peut pas viser sa propre référence."));
    } else if (row.invoiceRef) {
      out.push(issue("invoiceRef", "imports.rule_violation", "« Facture visée » n'a de sens que pour un avoir : valeur ignorée.", "WARNING"));
    }
    return out;
  },
  naturalKey(row) {
    return `opening_balances|${row.reference.trim().toUpperCase()}`;
  },
  relatedKeys(row) {
    return (row.kind ?? "INVOICE") === "CREDIT_NOTE" && row.invoiceRef ? [`opening_balances|${row.invoiceRef.trim().toUpperCase()}`] : [];
  },
  dependsOnKeys(row) {
    return (row.kind ?? "INVOICE") === "CREDIT_NOTE" && row.invoiceRef ? [`opening_balances|${row.invoiceRef.trim().toUpperCase()}`] : [];
  },
  validateOptions(options) {
    const y = options["academicYear"];
    if (typeof y !== "string" || !/^\d{4}([-/]\d{2,4})?$/.test(y.trim())) return [issue("academicYear", "imports.options_invalid", "L'année scolaire par défaut est obligatoire (ex. 2024-2025).")];
    return [];
  },
  extraPermissions() {
    return [];
  },
  sampleRows: [
    ["REPRISE-2025-0001", "2024-0001", "FACTURE", "150000", "Solde scolarité 2024-2025", "2024-2025", "31/12/2025", "", ""],
    ["REPRISE-2025-0002", "2024-0002", "FACTURE", "85000", "Solde scolarité 2024-2025", "2024-2025", "31/12/2025", "", ""],
    ["REPRISE-2025-0003", "2024-0002", "AVOIR", "10000", "Remise accordée", "2024-2025", "", "REPRISE-2025-0002", "Remise fratrie"],
  ],
};
