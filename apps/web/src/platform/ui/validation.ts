/**
 * Validation de formulaire avec les schémas Zod des contrats (`packages/contracts/src/v2/*`) : la MÊME définition que
 * l'API, donc aucun écart de règle de forme. Les règles métier (doublon, éligibilité, capacité…) restent à l'API.
 */

import type { ZodTypeAny, z } from "zod";
import { ApiError } from "@/platform/api/errors";

export type FieldErrors = Record<string, string>;

/** Chemin `["person","sex"]` -> `"person.sex"`. */
export function pathKey(path: ReadonlyArray<string | number>): string {
  return path.map(String).join(".");
}

export function zodIssuesToErrors(issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = pathKey(issue.path);
    // Une seule erreur par champ (la première, la plus précise).
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

export type Validated<S extends ZodTypeAny> = { ok: true; data: z.output<S> } | { ok: false; errors: FieldErrors };

export function validateWith<S extends ZodTypeAny>(schema: S, value: unknown): Validated<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, errors: zodIssuesToErrors(parsed.error.issues) };
}

/** Erreurs de champ renvoyées par l'API (`details.issues: [{ path, message }]`). Vide si l'erreur n'en porte pas. */
export function apiErrorToFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  const details = error.details;
  if (details === null || typeof details !== "object") return {};
  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return {};
  const clean: Array<{ path: Array<string | number>; message: string }> = [];
  for (const raw of issues) {
    if (raw === null || typeof raw !== "object") continue;
    const { path, message } = raw as { path?: unknown; message?: unknown };
    if (typeof message !== "string") continue;
    const p = Array.isArray(path) ? path.filter((x): x is string | number => typeof x === "string" || typeof x === "number") : typeof path === "string" ? [path] : [];
    clean.push({ path: p, message });
  }
  return zodIssuesToErrors(clean);
}

/** Retire les champs vides d'un objet de saisie (`""` -> absent) pour respecter les schémas `strict()` des contrats. */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === "" || v === undefined || v === null) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Variante pour les PATCH : `""` -> `null` (efface un champ facultatif), `undefined` -> inchangé. */
export function nullifyEmpty<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[k] = v === "" ? null : v;
  }
  return out;
}
