/**
 * Snapshots immuables des documents officiels : forme canonique et empreinte SHA-256.
 *
 * Le même snapshot produit toujours la même empreinte (clés triées, `undefined` écarté) : 013 scelle et rend à partir
 * de cette empreinte (R-HIG-12, AC7.6). Aucune donnée volatile (heure d'impression) n'entre dans l'empreinte.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new RangeError("Nombre non fini dans un snapshot.");
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = sortKeys(v);
  }
  return out;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function snapshotHash(snapshot: unknown): string {
  return sha256Hex(canonicalJson(snapshot));
}
