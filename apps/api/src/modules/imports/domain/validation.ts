/**
 * Validation d'une ligne (pure) : coercion par type de colonne -> schéma Zod de l'importeur -> règles métier -> clé
 * naturelle ; puis détection des doublons DANS le fichier. Aucune lecture de la base ici : les vérifications contre
 * l'existant relèvent du port de l'importeur (`port.plan`).
 */
import type { ZodIssue } from "zod";
import { coerceByType } from "./coerce";
import { hasErrors, issue, type ColumnDef, type ImportIssue, type ImporterDef, type ImportOptions, type RowValues, type RuleEnv } from "./types";

export interface RowValidation {
  /** Valeurs typées (présentes même en cas d'avertissement ; `null` si une erreur empêche de les construire). */
  readonly values: RowValues | null;
  readonly naturalKey: string | null;
  readonly issues: ImportIssue[];
}

const labelOf = (columns: readonly ColumnDef[], key: string): string => columns.find((c) => c.key === key)?.label ?? key;

function zodIssueToImportIssue(columns: readonly ColumnDef[], z: ZodIssue): ImportIssue {
  const field = typeof z.path[0] === "string" ? z.path[0] : null;
  const label = field ? labelOf(columns, field) : "la ligne";
  if (z.code === "invalid_enum_value") {
    const options = (z.options as unknown[]).map(String).join(", ");
    return issue(field, "imports.invalid_choice", `Valeur non reconnue pour « ${label} » (attendu : ${options}).`);
  }
  if (z.code === "too_big" && z.type === "string") return issue(field, "imports.invalid_value", `« ${label} » est trop long (${String(z.maximum)} caractères au plus).`);
  if (z.code === "too_small" && z.type === "string") return issue(field, "imports.required", `Le champ « ${label} » est obligatoire.`);
  if (z.code === "invalid_type" && z.received === "undefined") return issue(field, "imports.required", `Le champ « ${label} » est obligatoire.`);
  return issue(field, "imports.invalid_value", z.message && z.message !== "Invalid" ? `« ${label} » : ${z.message}` : `Valeur invalide pour « ${label} ».`);
}

/** Valide une ligne déjà passée par le mapping (`cells` : champ cible -> texte, vides omis). */
export function validateRow(importer: ImporterDef, cells: Readonly<Record<string, string>>, options: ImportOptions, env: RuleEnv): RowValidation {
  const issues: ImportIssue[] = [];
  const coerced: Record<string, unknown> = {};

  for (const col of importer.columns) {
    const raw = cells[col.key];
    if (raw === undefined || raw === "") {
      if (col.required) issues.push(issue(col.key, "imports.required", `Le champ « ${col.label} » est obligatoire.`));
      continue;
    }
    if (raw.length > 2000) {
      issues.push(issue(col.key, "imports.cell_too_long", `La valeur de « ${col.label} » dépasse 2 000 caractères.`));
      continue;
    }
    const c = coerceByType(col.type, raw, col.amount ? { amount: true } : {});
    if (c.ok) coerced[col.key] = c.value;
    else issues.push(issue(col.key, c.code, `${col.label} : ${c.message}`));
  }
  if (hasErrors(issues)) return { values: null, naturalKey: null, issues };

  const parsed = importer.schema.safeParse(coerced);
  if (!parsed.success) {
    for (const z of parsed.error.issues) issues.push(zodIssueToImportIssue(importer.columns, z));
    return { values: null, naturalKey: null, issues };
  }
  const values = parsed.data as RowValues;
  issues.push(...importer.rules(values, options, env));
  const key = importer.naturalKey(values, options);
  return { values: hasErrors(issues) ? null : values, naturalKey: key === null ? null : key.slice(0, 500), issues };
}

/**
 * Doublons dans le fichier : la PREMIÈRE ligne d'une clé reste valide, les suivantes sont refusées. Renvoie
 * `rowNo -> numéro de la première ligne portant la même clé`.
 */
export function findDuplicateRows(rows: ReadonlyArray<{ rowNo: number; naturalKey: string | null }>): Map<number, number> {
  const first = new Map<string, number>();
  const duplicates = new Map<number, number>();
  for (const r of rows) {
    if (r.naturalKey === null) continue;
    const seen = first.get(r.naturalKey);
    if (seen === undefined) first.set(r.naturalKey, r.rowNo);
    else duplicates.set(r.rowNo, seen);
  }
  return duplicates;
}

export const duplicateInFileIssue = (firstRowNo: number): ImportIssue =>
  issue(null, "imports.duplicate_in_file", `Cette ligne répète la ligne ${firstRowNo} du fichier (même identifiant) : elle est ignorée.`);
