/**
 * Reproductibilité : empreintes déterministes des entrées et des sorties d'une évaluation (AC4.2).
 *
 * `inputs_hash` = SHA-256 du JSON canonique du contexte (clés triées, nombres en chaînes décimales NORMALISÉES
 * d'après le TYPE déclaré par le schéma d'entrée, donc `12`, `12.0` et `"12.00"` donnent la même empreinte ;
 * seuls les champs déclarés comptent). `outputs_hash` = SHA-256 du JSON canonique `{ type, value }` (nombre =
 * chaîne décimale exacte). Mêmes (version, hash de définition, version du moteur, inputs_hash) ⇒ même `outputs_hash`.
 */
import { Decimal, type EvalContext, type RuleSchemaSpec, type TypeSpec } from "../engine";
import { canonicalJson, sha256Hex, type CanonicalValue } from "./canonical";

const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function numberText(raw: unknown): CanonicalValue {
  if (raw === undefined || raw === null) return null;
  try {
    if (typeof raw === "number") return Number.isFinite(raw) ? new Decimal(String(raw)).toString() : String(raw);
    if (typeof raw === "bigint") return raw.toString();
    if (typeof raw === "string" && DECIMAL_TEXT.test(raw.trim())) return new Decimal(raw.trim()).toString();
    if (raw instanceof Decimal) return raw.toString();
  } catch {
    /* donnée non numérique : l'évaluation échouera avec un diagnostic ; on garde une trace stable */
  }
  return `invalid:${typeof raw}`;
}

function canonicalizeByType(raw: unknown, spec: TypeSpec): CanonicalValue {
  if (raw === undefined || raw === null) return null;
  if (typeof spec === "string") {
    const base = spec.endsWith("?") ? spec.slice(0, -1) : spec;
    if (base === "number") return numberText(raw);
    if (base === "boolean") return typeof raw === "boolean" ? raw : `invalid:${typeof raw}`;
    return typeof raw === "string" ? raw : `invalid:${typeof raw}`;
  }
  if ("list" in spec) {
    return Array.isArray(raw) ? (raw as readonly unknown[]).map((item) => canonicalizeByType(item, spec.list)) : `invalid:${typeof raw}`;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return `invalid:${typeof raw}`;
  const obj = raw as Record<string, unknown>;
  const out: Record<string, CanonicalValue> = {};
  for (const name of Object.keys(spec.object).sort()) {
    out[name] = canonicalizeByType(Object.hasOwn(obj, name) ? obj[name] : undefined, spec.object[name] as TypeSpec);
  }
  return out;
}

/** Charge utile canonique des entrées d'une évaluation (ce qui est hashé). */
export function inputsPayload(
  ruleKey: string,
  schema: RuleSchemaSpec,
  context: EvalContext,
  overrides: Readonly<Record<string, number | string | boolean>> = {},
): CanonicalValue {
  const variables: Record<string, CanonicalValue> = {};
  for (const name of Object.keys(schema.variables).sort()) {
    if (name === "params") continue; // les paramètres viennent de la définition ; seules les surcharges comptent
    variables[name] = canonicalizeByType(context.variables?.[name], schema.variables[name] as TypeSpec);
  }
  const lookups: Record<string, CanonicalValue> = {};
  for (const name of Object.keys(schema.lookups ?? {}).sort()) {
    const spec = (schema.lookups ?? {})[name];
    const data = context.lookups?.[name];
    if (!spec || !data) continue;
    const entries: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(data).sort()) entries[key] = canonicalizeByType(data[key], spec.value);
    lookups[name] = entries;
  }
  const sortedOverrides: Record<string, CanonicalValue> = {};
  for (const k of Object.keys(overrides).sort()) {
    const v = overrides[k] as number | string | boolean;
    sortedOverrides[k] = typeof v === "number" ? numberText(v) : v;
  }
  return { rule: ruleKey, variables, lookups, overrides: sortedOverrides };
}

export function computeInputsHash(
  ruleKey: string,
  schema: RuleSchemaSpec,
  context: EvalContext,
  overrides: Readonly<Record<string, number | string | boolean>> = {},
): string {
  return sha256Hex(canonicalJson(inputsPayload(ruleKey, schema, context, overrides)));
}

export function computeOutputsHash(type: "number" | "string" | "boolean" | "null", json: string | boolean | null): string {
  return sha256Hex(canonicalJson({ type, value: type === "number" && typeof json === "string" ? new Decimal(json).toString() : json }));
}
