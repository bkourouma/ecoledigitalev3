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
