/**
 * Éléments partagés par le rendu et l'aperçu : URL de vérification + QR, lecture des images (logo, emblème, signatures)
 * depuis `StoragePort` et injection en data URI (R-RC-08). Un objet référencé mais absent du stockage fait ÉCHOUER le rendu
 * (jamais de document imprimé sans logo en silence, spec §13).
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import type { RenderAssets } from "../domain/document-html";
import { ReportcardsCode, internal } from "../domain/errors";
import { encodeQr, qrToSvg } from "../domain/qr";
import type { VerificationInfo } from "../domain/render-context";
import type { ReportcardSnapshot } from "../domain/types";
import type { ReportcardsDeps } from "./deps";

export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/** Type d'image reconnu par ses premiers octets (PNG, JPEG, GIF, WebP) ; jamais par l'extension ni le type annoncé. */
export function detectImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export const verificationUrl = (baseUrl: string, code: string): string => `${baseUrl.replace(/\/+$/, "")}/v/${code}`;

/** URL + QR du document. `null` pour un document provisoire (non vérifiable) ou sans domaine de vérification configuré. */
export function buildVerificationInfo(deps: ReportcardsDeps, code: string, provisional: boolean): VerificationInfo | null {
  if (provisional) return null;
  const base = deps.config.verificationBaseUrl;
  if (!base) return null;
  const url = verificationUrl(base, code);
  return { code, url, qrSvg: qrToSvg(encodeQr(url)) };
}

async function toDataUri(deps: ReportcardsDeps, key: string, what: string): Promise<Result<string, AppError>> {
  const object = await deps.ports.storage.get(key);
  if (!object) return err(internal(`Un fichier référencé par le document est introuvable dans le stockage (${what}).`, ReportcardsCode.ASSET_MISSING, { what }));
  if (object.bytes.length > MAX_ASSET_BYTES) return err(internal(`Le fichier ${what} dépasse la taille autorisée.`, ReportcardsCode.ASSET_MISSING, { what }));
  const mime = detectImageMime(object.bytes);
  if (!mime) return err(internal(`Le fichier ${what} n'est pas une image PNG, JPEG, GIF ou WebP.`, ReportcardsCode.ASSET_MISSING, { what }));
  return ok(`data:${mime};base64,${Buffer.from(object.bytes).toString("base64")}`);
}

/** Logo et emblème d'une identité d'établissement (documents officiels d'autres modules : pas de signataires). */
export async function loadInstitutionAssets(deps: ReportcardsDeps, input: { logoKey: string | null; emblemKey: string | null }): Promise<Result<RenderAssets, AppError>> {
  let logo: string | null = null;
  let emblem: string | null = null;
  if (input.logoKey) {
    const r = await toDataUri(deps, input.logoKey, "logo");
    if (!r.ok) return r;
    logo = r.value;
  }
  if (input.emblemKey) {
    const r = await toDataUri(deps, input.emblemKey, "emblème");
    if (!r.ok) return r;
    emblem = r.value;
  }
  return ok({ logo, emblem, signatures: {} });
}

export async function loadRenderAssets(deps: ReportcardsDeps, snapshot: ReportcardSnapshot): Promise<Result<RenderAssets, AppError>> {
  let logo: string | null = null;
  let emblem: string | null = null;
  const signatures: Record<string, string> = {};
  if (snapshot.institution.logoKey) {
    const r = await toDataUri(deps, snapshot.institution.logoKey, "logo");
    if (!r.ok) return r;
    logo = r.value;
  }
  if (snapshot.institution.emblemKey) {
    const r = await toDataUri(deps, snapshot.institution.emblemKey, "emblème");
    if (!r.ok) return r;
    emblem = r.value;
  }
  for (const s of snapshot.signatories) {
    if (!s.signatureKey) continue;
    const r = await toDataUri(deps, s.signatureKey, `signature (${s.slotLabel})`);
    if (!r.ok) return r;
    signatures[s.slot] = r.value;
  }
  return ok({ logo, emblem, signatures });
}
