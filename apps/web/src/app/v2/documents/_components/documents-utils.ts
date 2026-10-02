import type { DocumentConfidentiality, DocumentExpiryState } from "@ecoledigitale/contracts/v2/documents";
import type { Tone } from "@/platform/ui/PageHeader";

/** Lire des documents : personnel (tous niveaux), gestion, parent, élève, personnel pour son propre dossier. */
export const VIEW_PERMISSIONS = [
  "documents.read",
  "documents.read.restricted",
  "documents.read.confidential",
  "documents.manage",
  "documents.child.read",
  "documents.self.read",
  "documents.own.read",
] as const;

export const expiryTone = (state: DocumentExpiryState): Tone => (state === "EXPIRED" ? "danger" : state === "EXPIRING" ? "warning" : state === "VALID" ? "success" : "neutral");

export const confidentialityTone = (c: DocumentConfidentiality): Tone => (c === "CONFIDENTIAL" ? "danger" : c === "RESTRICTED" ? "warning" : "neutral");

/** Tags saisis en texte libre : séparés par des virgules, dédoublonnés, 20 au plus. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
  }
  return out.slice(0, 20);
}

/** Seuils d'alerte saisis (« 30, 7, 1 ») : entiers de 0 à 365, dédoublonnés, décroissants. `null` si vide ou invalide. */
export function parseAlertDays(text: string): number[] | null {
  const numbers = text
    .split(/[,\s;]+/)
    .filter((s) => s !== "")
    .map((s) => Number(s));
  if (numbers.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) return null;
  return [...new Set(numbers)].sort((a, b) => b - a).slice(0, 10);
}

const MIB = 1024 * 1024;
export const bytesToMiB = (bytes: number): string => String(Math.round((bytes / MIB) * 10) / 10).replace(".", ",");
export const mibToBytes = (text: string): number | null => {
  const n = Number(text.replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * MIB) : null;
};

/** Démarre le téléchargement d'une URL signée (en-tête `attachment` côté stockage : la page ne bouge pas). */
export function startDownload(url: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
