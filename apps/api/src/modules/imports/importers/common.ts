/**
 * Briques communes des importeurs : définition de colonnes, énumérations tolérantes (sexe, oui/non), empreintes de clé.
 * Domaine pur : aucun import d'infrastructure.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ImportColumnType } from "@ecoledigitale/contracts/src/v2/imports";
import { stripAccents } from "../domain/text";
import type { ColumnDef, ImportOptions } from "../domain/types";
import { issue } from "../domain/types";

export interface ColumnOptions {
  readonly required?: boolean;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly example: string;
  readonly amount?: boolean;
}

export function column(key: string, label: string, type: ImportColumnType, options: ColumnOptions): ColumnDef {
  return { key, label, type, required: options.required ?? false, aliases: options.aliases, description: options.description, example: options.example, ...(options.amount ? { amount: true } : {}) };
}

/** Valeur de sexe tolérante (M / F, masculin, féminin, garçon, fille, homme, femme). */
export const sexSchema = z.string().transform((value, ctx): "M" | "F" => {
  const n = stripAccents(value).toLowerCase().trim();
  if (["m", "h", "masculin", "homme", "garcon", "male", "boy", "masc"].includes(n)) return "M";
  if (["f", "feminin", "femme", "fille", "female", "girl", "fem"].includes(n)) return "F";
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "valeur non reconnue (attendu M ou F)" });
  return z.NEVER;
});

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
export { optionalText };

/** Empreinte courte et stable d'une chaîne (références externes dérivées d'une clé naturelle). */
export function shortHash(value: string, length = 24): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

/** Option obligatoire de type UUID (liste de choix) : problème si absente ou mal formée. */
export function requireUuidOption(options: ImportOptions, key: string, label: string) {
  const v = options[key];
  if (typeof v !== "string" || v === "") return [issue(key, "imports.options_invalid", `L'option « ${label} » est obligatoire.`)];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return [issue(key, "imports.options_invalid", `L'option « ${label} » est invalide.`)];
  return [];
}

/** Date de naissance vraisemblable : pas dans le futur, pas avant 1920 (le plafond d'âge relève du module cible). */
export function plausibleBirthDate(birthDate: string | undefined, column: string, today: string) {
  if (!birthDate) return [];
  if (birthDate > today) return [issue(column, "imports.rule_violation", "La date de naissance est dans le futur.")];
  if (birthDate < "1920-01-01") return [issue(column, "imports.rule_violation", "La date de naissance est invraisemblable (avant 1920).")];
  return [];
}
