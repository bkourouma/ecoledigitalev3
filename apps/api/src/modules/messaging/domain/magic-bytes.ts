/**
 * Détection du type RÉEL d'une pièce jointe par octets magiques. Le type MIME déclaré par le client n'est JAMAIS
 * cru (le legacy acceptait n'importe quel fichier, sans limite de type). Types supportés : PDF, JPEG, PNG, WebP.
 */
export type AttachmentType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

export function detectMimeType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"; // RIFF....WEBP
  return null;
}

/** Extension de fichier cohérente avec le type détecté (nom de stockage ; le nom d'origine reste informatif). */
export const extensionFor = (mime: AttachmentType): string =>
  mime === "application/pdf" ? "pdf" : mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";

/** Nom de fichier conservé pour affichage : sans chemin ni caractère de contrôle, 255 caractères max. */
export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return base.slice(0, 255) || "piece-jointe";
}
