/**
 * Empreintes canoniques (SHA-256) : JSON à clés triées, sans espace. Mêmes entrées ⇒ même empreinte, quel que soit
 * l'ordre d'insertion des clés. Utilisées pour `inputs_hash`, `outputs_hash` et le hash de clôture.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

export const hashOf = (value: unknown): string => sha256Hex(canonicalJson(value));

/** Hash de clôture : SHA-256 des `outputs_hash` TRIÉS (l'ordre des élèves n'y change rien). */
export function closureHashOf(outputsHashes: readonly string[]): string {
  return sha256Hex([...outputsHashes].sort().join("\n"));
}
