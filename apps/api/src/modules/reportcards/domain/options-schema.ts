/**
 * Validation des OPTIONS d'un gabarit par le schéma du gabarit (`platform_templates.options_schema`, spec 013 AC5.2).
 *
 * Sous-ensemble volontairement minimal de JSON Schema (aucune dépendance), suffisant pour des options de présentation :
 *   { "type": "object", "properties": { … }, "required": [..], "additionalProperties": false }
 *   propriété : { "type": "boolean" | "string" | "integer" | "array",
 *                 "enum": [...], "default": ..., "minimum", "maximum", "maxLength", "items": { "type": "string", "enum": [...] },
 *                 "maxItems" }
 * Toute clé inconnue est refusée (`additionalProperties` vaut `false` par défaut) et les valeurs par défaut sont appliquées :
 * les options RÉSOLUES, complètes et typées, sont copiées dans le snapshot (le rendu ne dépend donc d'aucun défaut du code).
 */
export type OptionValue = string | number | boolean | string[] | null;
export type ResolvedOptions = Record<string, OptionValue>;

export interface OptionsProblem {
  readonly path: string;
  readonly message: string;
}

interface PropertySchema {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  items?: { type?: string; enum?: unknown[]; maxLength?: number };
}

interface ObjectSchema {
  type?: string;
  properties?: Record<string, PropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Vérifie que le schéma lui-même est dans le sous-ensemble supporté (à la publication du gabarit). */
export function validateOptionsSchema(schema: unknown): OptionsProblem[] {
  const problems: OptionsProblem[] = [];
  if (!schema || typeof schema !== "object" || (schema as ObjectSchema).type !== "object") {
    return [{ path: "", message: "le schéma d'options doit être de type object" }];
  }
  const s = schema as ObjectSchema;
  for (const [key, p] of Object.entries(s.properties ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)) problems.push({ path: key, message: "nom d'option invalide" });
    if (!p || !["boolean", "string", "integer", "array"].includes(String(p.type))) problems.push({ path: key, message: "type d'option non supporté" });
    if (p?.default !== undefined) {
      const issue = checkValue(p, p.default, key);
      if (issue) problems.push({ path: key, message: `valeur par défaut invalide : ${issue}` });
    }
  }
  return problems;
}

function checkValue(p: PropertySchema, value: unknown, path: string): string | null {
  switch (p.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "booléen attendu";
    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) return "entier attendu";
      if (p.minimum !== undefined && value < p.minimum) return `≥ ${p.minimum} attendu`;
      if (p.maximum !== undefined && value > p.maximum) return `≤ ${p.maximum} attendu`;
      return p.enum && !p.enum.includes(value) ? "valeur hors liste" : null;
    case "string":
      if (typeof value !== "string") return "chaîne attendue";
      if (value.length > (p.maxLength ?? 200)) return `${p.maxLength ?? 200} caractères maximum`;
      if (/[\u0000-\u001f\u007f<>]/.test(value)) return "caractères interdits";
      return p.enum && !p.enum.includes(value) ? "valeur hors liste" : null;
    case "array": {
      if (!Array.isArray(value)) return "liste attendue";
      if (value.length > (p.maxItems ?? 30)) return `${p.maxItems ?? 30} éléments maximum`;
      for (const [i, item] of value.entries()) {
        if (typeof item !== "string" || item.length > (p.items?.maxLength ?? 80) || /[\u0000-\u001f\u007f<>]/.test(item)) return `élément ${i} invalide`;
        if (p.items?.enum && !p.items.enum.includes(item)) return `élément ${i} hors liste`;
      }
      return null;
    }
    default:
      return `type non supporté (${path})`;
  }
}

/** Valide `options` et renvoie les options RÉSOLUES (défauts appliqués) ou la liste des problèmes. */
export function resolveOptions(schema: unknown, options: unknown): { ok: true; value: ResolvedOptions } | { ok: false; problems: OptionsProblem[] } {
  const schemaProblems = validateOptionsSchema(schema);
  if (schemaProblems.length) return { ok: false, problems: schemaProblems };
  const s = schema as ObjectSchema;
  const problems: OptionsProblem[] = [];
  const input = options === undefined || options === null ? {} : options;
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, problems: [{ path: "", message: "objet d'options attendu" }] };
  const given = input as Record<string, unknown>;
  const props = s.properties ?? {};
  if (s.additionalProperties !== true) {
    for (const key of Object.keys(given)) if (!Object.prototype.hasOwnProperty.call(props, key)) problems.push({ path: key, message: "option inconnue" });
  }
  const value: ResolvedOptions = {};
  for (const [key, p] of Object.entries(props)) {
    const supplied = Object.prototype.hasOwnProperty.call(given, key) ? given[key] : undefined;
    if (supplied === undefined) {
      if (s.required?.includes(key) && p.default === undefined) problems.push({ path: key, message: "option obligatoire" });
      value[key] = (p.default as OptionValue | undefined) ?? null;
      continue;
    }
    const issue = checkValue(p, supplied, key);
    if (issue) problems.push({ path: key, message: issue });
    else value[key] = supplied as OptionValue;
  }
  return problems.length ? { ok: false, problems } : { ok: true, value };
}
