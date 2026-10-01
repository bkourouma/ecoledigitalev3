/**
 * JSON canonique et hash d'un snapshot (spec 013 §5, data-model §5).
 *
 *   enveloppe = { "snapshot": <snapshot>, "explain": <explain> }
 *   canonique = clés triées par ORDRE D'OCTETS UTF-8, aucun espace, chaînes normalisées NFC,
 *               nombres = entiers sûrs seulement (les décimaux exacts sont des CHAÎNES), booléens, null
 *   hash      = SHA-256 hexadécimal de l'UTF-8 de la forme canonique
 *
 * Miroir exact de `reportcards.canonical_json` (SQL, migration 1303) : le déclencheur d'insertion recalcule le hash en base
 * et refuse toute divergence. Les VECTEURS de `test/unit/canonical.test.ts` sont rejoués contre la fonction SQL dans
 * `test/integration/guards.integration.test.ts` (R5 du plan : aucune dérive possible entre les deux implémentations).
 *
 * Pur : aucune dépendance autre que `node:crypto`.
 */
import { createHash } from "node:crypto";

export class CanonicalizationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} (chemin : ${path || "racine"})`);
    this.name = "CanonicalizationError";
  }
}

/** Compare deux chaînes par ordre d'octets UTF-8 (≠ ordre des unités UTF-16 pour les caractères hors BMP). */
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function quote(value: string): string {
  // JSON.stringify échappe `"`, `\`, les contrôles (< 0x20) en minuscules, et les demi-paires isolées : identique à to_jsonb(text)::text.
  return JSON.stringify(value.normalize("NFC"));
}

/** Forme canonique d'une valeur JSON. Lève `CanonicalizationError` pour un flottant, `undefined`, NaN, une fonction, etc. */
export function canonicalJson(value: unknown, path = ""): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return quote(value);
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        throw new CanonicalizationError(`Nombre non entier ou hors plage sûre (${String(value)}) : écrivez les décimaux exacts en chaîne`, path);
      }
      return String(value);
    }
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => canonicalJson(v, `${path}[${i}]`)).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError("Objet non JSON (instance de classe)", path);
      }
      const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.normalize("NFC"), v, k] as const);
      entries.sort((a, b) => compareUtf8(a[0], b[0]));
      for (let i = 1; i < entries.length; i += 1) {
        if (entries[i]![0] === entries[i - 1]![0]) throw new CanonicalizationError(`Clé dupliquée après normalisation NFC (${entries[i]![0]})`, path);
      }
      return `{${entries.map(([k, v, raw]) => `${quote(k)}:${canonicalJson(v, path ? `${path}.${raw}` : raw)}`).join(",")}}`;
    }
    default:
      throw new CanonicalizationError(`Type non sérialisable (${typeof value})`, path);
  }
}

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Hash d'un snapshot : SHA-256 de l'enveloppe canonique `{ snapshot, explain }`. */
export function snapshotHash(snapshot: unknown, explain: unknown): string {
  return sha256Hex(Buffer.from(canonicalJson({ snapshot, explain }), "utf8"));
}
