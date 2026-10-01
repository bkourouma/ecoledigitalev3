import { z } from 'zod';
import { RuleSchemaError } from './errors';
import { BUILTIN_FUNCTION_NAMES } from './function-names';
import type { Ty } from './types';

/**
 * Schéma des données accessibles à une règle : variables nommées et
 * « recherches » (lookups) invoquées comme des fonctions, p. ex.
 * `period("S1").average`.
 *
 * Forme JSON (stockable en base) :
 *   {
 *     "variables": { "devoirs": "number?", "ecues": { "list": { "object": { "note": "number?", "credits": "number" } } } },
 *     "lookups":   { "period": { "keys": ["S1", "S2"], "value": { "object": { "average": "number?" } } } }
 *   }
 */

export const ScalarTypeSpecSchema = z.enum(['number', 'number?', 'string', 'string?', 'boolean', 'boolean?']);
export type ScalarTypeSpec = z.infer<typeof ScalarTypeSpecSchema>;

export type TypeSpec =
  | ScalarTypeSpec
  | { list: TypeSpec; nullable?: boolean | undefined }
  | { object: Record<string, TypeSpec>; nullable?: boolean | undefined };

export const TypeSpecSchema: z.ZodType<TypeSpec> = z.lazy(() =>
  z.union([
    ScalarTypeSpecSchema,
    z.object({ list: TypeSpecSchema, nullable: z.boolean().optional() }).strict(),
    z.object({ object: z.record(TypeSpecSchema), nullable: z.boolean().optional() }).strict(),
  ]),
);

export const LookupSpecSchema = z
  .object({
    /** Clés autorisées. Si absent, toute clé texte est acceptée (vérifiée à l'évaluation). */
    keys: z.array(z.string().min(1)).max(500).optional(),
    value: TypeSpecSchema,
  })
  .strict();
export type LookupSpec = z.infer<typeof LookupSpecSchema>;

export const RuleSchemaSpecSchema = z
  .object({
    variables: z.record(TypeSpecSchema),
    lookups: z.record(LookupSpecSchema).optional(),
  })
  .strict();
export type RuleSchemaSpec = z.infer<typeof RuleSchemaSpecSchema>;

export interface ResolvedLookup {
  readonly keys: readonly string[] | undefined;
  readonly value: Ty;
}

export interface ResolvedSchema {
  readonly variables: Readonly<Record<string, Ty>>;
  readonly lookups: Readonly<Record<string, ResolvedLookup>>;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_WORDS = new Set(['true', 'false', 'null']);
/** Noms qui désignent des membres de Object.prototype : jamais déclarables. */
const FORBIDDEN_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
]);
const MAX_TYPE_DEPTH = 8;
const MAX_FIELDS = 200;

/** Un identifiant est-il utilisable comme nom de variable, de champ ou de recherche ? */
export function isDeclarableName(name: string): boolean {
  return IDENT.test(name) && !RESERVED_WORDS.has(name) && !FORBIDDEN_NAMES.has(name) && !name.startsWith('__');
}

function fail(path: string, message: string): never {
  throw new RuleSchemaError({
    code: 'SCHEMA_INVALIDE',
    phase: 'schema',
    message: `Schéma de données invalide (${path}) : ${message}`,
  });
}

function checkName(path: string, name: string): void {
  if (!IDENT.test(name)) fail(path, `« ${name} » n'est pas un identifiant valide (lettres, chiffres, _ ; ne commence pas par un chiffre).`);
  if (RESERVED_WORDS.has(name)) fail(path, `« ${name} » est un mot réservé.`);
  if (FORBIDDEN_NAMES.has(name) || name.startsWith('__')) {
    fail(path, `le nom « ${name} » est interdit (il désigne un membre interne de JavaScript).`);
  }
}

function toTy(spec: TypeSpec, path: string, depth: number): Ty {
  if (depth > MAX_TYPE_DEPTH) fail(path, `imbrication de types trop profonde (maximum ${MAX_TYPE_DEPTH}).`);
  if (typeof spec === 'string') {
    const nullable = spec.endsWith('?');
    const base = (nullable ? spec.slice(0, -1) : spec) as 'number' | 'string' | 'boolean';
    return { k: base, nullable };
  }
  if ('list' in spec) {
    return { k: 'list', item: toTy(spec.list, `${path}.list`, depth + 1), nullable: spec.nullable === true };
  }
  const entries = Object.entries(spec.object);
  if (entries.length > MAX_FIELDS) fail(path, `trop de champs (maximum ${MAX_FIELDS}).`);
  const fields: Record<string, Ty> = Object.create(null) as Record<string, Ty>;
  for (const [name, child] of entries) {
    checkName(`${path}.object.${name}`, name);
    fields[name] = toTy(child, `${path}.object.${name}`, depth + 1);
  }
  return { k: 'object', fields, nullable: spec.nullable === true };
}

/**
 * Zod ignore silencieusement la clé « __proto__ » : on la détecte donc AVANT,
 * pour rejeter bruyamment un schéma qui chercherait à la déclarer.
 */
function rejectProtoKeys(value: unknown, path: string, depth: number): void {
  if (value === null || typeof value !== 'object' || depth > 2 * MAX_TYPE_DEPTH + 6) return;
  if (Object.hasOwn(value, '__proto__')) {
    fail(path, 'le nom « __proto__ » est interdit (il désigne un membre interne de JavaScript).');
  }
  for (const [k, v] of Object.entries(value)) rejectProtoKeys(v, `${path}.${k}`, depth + 1);
}

/** Valide le schéma (Zod + règles de noms) et le convertit en types internes. */
export function resolveSchema(input: unknown): ResolvedSchema {
  rejectProtoKeys(input, '(racine)', 0);
  const parsed = RuleSchemaSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail(issue ? issue.path.join('.') || '(racine)' : '(racine)', issue ? issue.message : 'structure inattendue.');
  }
  const spec = parsed.data;
  const variables: Record<string, Ty> = Object.create(null) as Record<string, Ty>;
  for (const [name, t] of Object.entries(spec.variables)) {
    checkName(`variables.${name}`, name);
    variables[name] = toTy(t, `variables.${name}`, 0);
  }
  const lookups: Record<string, ResolvedLookup> = Object.create(null) as Record<string, ResolvedLookup>;
  for (const [name, l] of Object.entries(spec.lookups ?? {})) {
    checkName(`lookups.${name}`, name);
    if (BUILTIN_FUNCTION_NAMES.has(name)) {
      fail(`lookups.${name}`, `« ${name} » est déjà le nom d'une fonction de la bibliothèque.`);
    }
    lookups[name] = { keys: l.keys, value: toTy(l.value, `lookups.${name}.value`, 0) };
  }
  return { variables, lookups };
}
