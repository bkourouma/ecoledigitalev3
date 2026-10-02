/**
 * Utilitaires de texte purs : normalisation, aperçu, clé de fil direct, rendu des gabarits, curseurs de pagination.
 */
import { ValidationError } from "@ecoledigitale/kernel";

/** Minuscules, sans accents, espaces réduits (aligné sur `messaging.normalize_search` de la base pour les comparaisons). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const PREVIEW_LENGTH = 160;

/** Aperçu d'un message pour la liste des fils : espaces réduits, 160 caractères au plus. */
export function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= PREVIEW_LENGTH ? flat : `${flat.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`;
}

/**
 * Clé de dédoublonnage d'un fil DIRECT : « <id mineur>:<id majeur>:<élève|->:<objet normalisé> ».
 * Même paire, même élève concerné, même objet ⇒ même fil.
 */
export function directKey(a: string, b: string, aboutStudentId: string | null, subject: string | null): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `${lo}:${hi}:${aboutStudentId ?? "-"}:${normalizeText(subject ?? "").slice(0, 200)}`;
}

/** Clé du fil d'alertes système d'un destinataire. */
export const systemKey = (userId: string): string => `system:${userId}`;

/** Remplace `{{variable}}` par sa valeur (texte brut) ; une variable inconnue est remplacée par une chaîne vide. */
export function renderTemplate(template: string, vars: Readonly<Record<string, string | number | null | undefined>>): string {
  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_m, name: string) => {
    const v = vars[name];
    return v === null || v === undefined ? "" : String(v);
  });
}

/** Variables citées par un gabarit. */
export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)].map((m) => m[1]!))];
}

// ---------------------------------------------------------------------------
// Curseurs (pagination par clé : jamais d'OFFSET)
// ---------------------------------------------------------------------------

export interface Cursor {
  /** Instant ISO ou entier selon la liste. */
  readonly t: string;
  readonly id: string;
  /** Épinglage (annonces). */
  readonly p?: boolean;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.t === "string" && typeof parsed.id === "string" && parsed.t.length <= 64 && /^[0-9a-f-]{36}$/.test(parsed.id)) {
      return { t: parsed.t, id: parsed.id, ...(typeof parsed.p === "boolean" ? { p: parsed.p } : {}) };
    }
  } catch {
    /* tombe sur l'erreur ci-dessous */
  }
  throw new ValidationError("Curseur de pagination invalide.", [{ path: ["cursor"], message: "Curseur invalide.", code: "messaging.invalid_input" }], { code: "messaging.invalid_input" });
}
