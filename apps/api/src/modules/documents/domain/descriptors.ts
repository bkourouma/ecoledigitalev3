/**
 * Descripteurs d'un document — FONCTIONS PURES : texte de recherche (normalisé ensuite par SQL), contrôle de cohérence
 * type / propriétaire, normalisation des listes.
 */
import type { DocumentKind, DocumentOwnerType } from "./types";

export const SEARCH_TEXT_MAX = 4000;

/** Texte à indexer : titre, description, étiquettes, nom du fichier courant, VALEURS texte des métadonnées. */
export function buildSearchText(input: {
  title: string;
  description?: string | null;
  tags?: readonly string[];
  fileName?: string | null;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}): string {
  const parts: string[] = [input.title];
  if (input.description) parts.push(input.description);
  if (input.tags?.length) parts.push(input.tags.join(" "));
  if (input.fileName) parts.push(input.fileName);
  if (input.metadata) for (const v of Object.values(input.metadata)) if (typeof v === "string" || typeof v === "number") parts.push(String(v));
  return parts.join(" ").slice(0, SEARCH_TEXT_MAX);
}

export type OwnerCoherence = { ok: true } | { ok: false; code: "owner_required" | "owner_not_allowed"; message: string };

/** Un document `STUDENT` exige un élève, `TEACHER` un membre du personnel ; `NONE` n'a pas d'identifiant. */
export function checkOwnerCoherence(kind: DocumentKind, ownerType: DocumentOwnerType, ownerId: string | null | undefined): OwnerCoherence {
  if (kind === "STUDENT" && ownerType !== "STUDENT") return { ok: false, code: "owner_required", message: "Un document d'élève doit désigner un élève." };
  if (kind === "TEACHER" && ownerType !== "STAFF") return { ok: false, code: "owner_required", message: "Un document du personnel doit désigner un membre du personnel." };
  if (ownerType === "NONE" && ownerId) return { ok: false, code: "owner_not_allowed", message: "Un document sans propriétaire ne porte pas d'identifiant de propriétaire." };
  if (ownerType !== "NONE" && !ownerId) return { ok: false, code: "owner_required", message: "Le propriétaire du document est obligatoire." };
  return { ok: true };
}

/** Étiquettes dédoublonnées (sans casse), ordre conservé. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const trimmed = t.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/** Seuils d'alerte dédoublonnés, décroissants. */
export function normalizeAlertDays(days: readonly number[] | null | undefined): number[] | null {
  if (!days || days.length === 0) return null;
  return [...new Set(days)].sort((a, b) => b - a);
}

/** Clé de stockage d'une version : une clé PAR version, jamais partagée (voir data-model §2). */
export function versionStorageKey(tenantId: string, documentId: string, versionNo: number, sha256: string): string {
  return `documents/${tenantId}/${documentId}/${versionNo}-${sha256.slice(0, 12)}`;
}

export function quarantineStorageKey(tenantId: string, quarantineId: string): string {
  return `documents/${tenantId}/quarantine/${quarantineId}`;
}

export function renditionStorageKey(tenantId: string, documentId: string, versionNo: number, sha256: string): string {
  return `documents/${tenantId}/renditions/${documentId}-${versionNo}-${sha256.slice(0, 12)}.pdf`;
}
