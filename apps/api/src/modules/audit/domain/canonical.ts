/**
 * Normalisation JSON et sérialisation CANONIQUE (clés triées, sans espace).
 *
 * Le hash d'une entrée porte sur sa forme canonique : elle doit se retrouver à
 * l'identique après un aller-retour par `jsonb` (qui réordonne les clés et
 * normalise les nombres). `toJsonValue` impose donc, AVANT hash et insertion, une
 * forme déjà stable : types JSON purs, pas de `undefined`, pas de NUL (`\u0000`
 * est refusé par jsonb), bigint/Date/Set/Map convertis.
 */
import { createHash } from "node:crypto";
import type { JsonValue } from "./types";

export interface ToJsonOptions {
  maxDepth?: number;
  /** Plafond de clés par objet / éléments par tableau (anti-explosion). */
  maxEntries?: number;
}

const NUL = /\u0000/g;
const clean = (s: string): string => (s.includes("\u0000") ? s.replace(NUL, "") : s);

/**
 * Convertit n'importe quelle valeur en JSON pur. `undefined` (et fonctions/symboles)
 * sont omis dans les objets et deviennent `null` dans les tableaux, comme JSON.stringify.
 * Retourne `undefined` si la valeur racine n'est pas représentable.
 * Les objets produits n'ont pas de prototype : une clé `__proto__` reste une donnée.
 */
export function toJsonValue(input: unknown, options: ToJsonOptions = {}): JsonValue | undefined {
  const maxDepth = options.maxDepth ?? 16;
  const maxEntries = options.maxEntries ?? 2000;
  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number): JsonValue | undefined => {
    if (value === null) return null;
    switch (typeof value) {
      case "string":
        return clean(value);
      case "number":
        return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
      case "boolean":
        return value;
      case "bigint":
        return value.toString();
      case "undefined":
      case "function":
      case "symbol":
        return undefined;
      default:
        break;
    }

    const obj = value as object;
    if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
    if (obj instanceof Uint8Array) return `[binary ${obj.byteLength} bytes]`;
    if (depth >= maxDepth) return "[MaxDepth]";
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);
    try {
      if (obj instanceof Set) return walkArray([...obj], depth);
      if (obj instanceof Map) {
        const out: Record<string, JsonValue> = Object.create(null);
        let n = 0;
        for (const [k, v] of obj) {
          if (n++ >= maxEntries) break;
          const j = walk(v, depth + 1);
          if (j !== undefined) out[clean(String(k))] = j;
        }
        return out;
      }
      if (Array.isArray(obj)) return walkArray(obj, depth);

      const withToJson = obj as { toJSON?: () => unknown };
      if (typeof withToJson.toJSON === "function") {
        const replaced = withToJson.toJSON();
        if (replaced !== obj) return walk(replaced, depth + 1);
      }

      const out: Record<string, JsonValue> = Object.create(null);
      let n = 0;
      for (const key of Object.keys(obj)) {
        if (n++ >= maxEntries) break;
        const j = walk((obj as Record<string, unknown>)[key], depth + 1);
        if (j !== undefined) out[clean(key)] = j;
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  };

  const walkArray = (arr: unknown[], depth: number): JsonValue => {
    const out: JsonValue[] = [];
    const n = Math.min(arr.length, maxEntries);
    for (let i = 0; i < n; i++) out.push(walk(arr[i], depth + 1) ?? null);
    return out;
  };

  return walk(input, 0);
}

/** JSON canonique : objets à clés triées (ordre des unités UTF-16), sans espace. */
export function canonicalize(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, JsonValue>)[k] as JsonValue)}`).join(",")}}`;
}

export function byteLength(value: JsonValue): number {
  return Buffer.byteLength(canonicalize(value), "utf8");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Égalité profonde par forme canonique. */
export function jsonEquals(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return canonicalize(a) === canonicalize(b);
}
