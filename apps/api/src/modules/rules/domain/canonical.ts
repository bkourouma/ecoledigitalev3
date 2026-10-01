/**
 * JSON canonique et empreintes SHA-256 (déterministes, indépendants de l'ordre des clés).
 *
 * Règles : clés d'objet triées (ordre des unités de code), aucune espace, chaînes Unicode normalisées NFC,
 * `undefined` omis, `-0` écrit `0`, nombres écrits par leur plus courte représentation décimale. Les entiers
 * et décimaux d'une règle (paramètres bornés) sont donc stables d'une exécution — et d'un aller-retour jsonb — à l'autre.
 */
import { createHash } from "node:crypto";

export type CanonicalValue = null | boolean | number | string | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue | undefined };

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) throw new TypeError("Nombre non fini : non sérialisable en JSON canonique.");
  if (Object.is(n, -0)) return "0";
  return String(n);
}

export function canonicalJson(value: CanonicalValue | undefined): string {
  if (value === undefined || value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return canonicalNumber(value);
    case "string":
      return JSON.stringify(value.normalize("NFC"));
    default:
      break;
  }
  if (Array.isArray(value)) return `[${(value as readonly CanonicalValue[]).map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as { readonly [key: string]: CanonicalValue | undefined };
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k.normalize("NFC"))}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
