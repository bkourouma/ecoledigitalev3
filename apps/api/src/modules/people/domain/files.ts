/**
 * Contrôle des fichiers téléversés (photo) par OCTETS MAGIQUES, jamais par l'extension ni le type MIME déclaré
 * (spec 008 AC7.2 / R13). Fonctions PURES.
 */

export type ImageKind = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_EXTENSIONS: Readonly<Record<ImageKind, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Type réel d'une image d'après ses premiers octets, ou `null` (ni JPEG, ni PNG, ni WebP). */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 //   P
  ) {
    return "image/webp";
  }
  return null;
}

/** Clé de stockage objet de la photo : `tenants/{tenantId}/people/students/{studentId}/photo` (R13). */
export function studentPhotoKey(tenantId: string, studentId: string): string {
  return `tenants/${tenantId}/people/students/${studentId}/photo`;
}

// ---------------------------------------------------------------------------
// Pièces de l'élève (PDF et images) : même principe — le type RÉEL vient des octets, jamais de l'extension déclarée.
// ---------------------------------------------------------------------------

export type DocumentKind = ImageKind | "application/pdf";

export const DOCUMENT_EXTENSIONS: Readonly<Record<DocumentKind, string>> = { ...IMAGE_EXTENSIONS, "application/pdf": "pdf" };

/** Type réel d'une pièce (PDF, JPEG, PNG, WebP) d'après ses premiers octets, ou `null` : tout le reste est REFUSÉ (HTML, SVG, exécutables, archives…). */
export function sniffDocument(bytes: Uint8Array): DocumentKind | null {
  // `%PDF-` en tête de fichier : un fichier qui ne commence pas par là est suspect.
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  return sniffImage(bytes);
}

/** Clé de stockage objet d'une pièce : `tenants/{tenantId}/people/students/{studentId}/documents/{documentId}` (jamais le nom du fichier). */
export function studentDocumentKey(tenantId: string, studentId: string, documentId: string): string {
  return `tenants/${tenantId}/people/students/${studentId}/documents/${documentId}`;
}

/**
 * Nom d'affichage sûr : sans chemin ni caractère de contrôle, au plus 200 caractères, avec l'extension qui correspond au type
 * RÉEL du fichier (un `.exe` déposé comme PDF n'est pas affiché `.exe`).
 */
export function safeDocumentFileName(raw: string, kind: DocumentKind): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  const expected = DOCUMENT_EXTENSIONS[kind];
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim() || "document";
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  const accepted = kind === "image/jpeg" ? ["jpg", "jpeg"] : [expected];
  const name = accepted.includes(ext) ? `${stem}.${ext}` : `${stem}.${expected}`;
  return name.length <= 200 ? name : `${stem.slice(0, 200 - expected.length - 1)}.${expected}`;
}

const dayNumber = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;

/** État d'échéance dérivé : jamais stocké (la date du jour vient de l'horloge injectée). `warnDays` : préavis du tenant (null = pas d'état « bientôt »). */
export function documentExpiryState(expiresOn: string | null, today: string, warnDays: number | null): { state: "NO_EXPIRY" | "VALID" | "EXPIRING" | "EXPIRED"; daysLeft: number | null } {
  if (expiresOn === null) return { state: "NO_EXPIRY", daysLeft: null };
  const days = Math.round(dayNumber(expiresOn) - dayNumber(today));
  if (days < 0) return { state: "EXPIRED", daysLeft: days };
  if (warnDays !== null && days <= warnDays) return { state: "EXPIRING", daysLeft: days };
  return { state: "VALID", daysLeft: days };
}
