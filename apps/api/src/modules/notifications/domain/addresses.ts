/**
 * Adresses de remise : normalisation (e-mail, numéro E.164), MASQUAGE (journal, logs : jamais d'adresse complète) et
 * empreinte (liste de suppression). Fonctions pures.
 */
import { createHash } from "node:crypto";
import type { NotifChannel } from "@ecoledigitale/contracts/src/v2/notifications";

const EMAIL_RE = /^[^@\s<>()\[\]\\,;:"]+@[^@\s<>()\[\]\\,;:"]+\.[^@\s<>()\[\]\\,;:"]{2,}$/;

/** E-mail normalisé (minuscules, sans espaces) ou `null` s'il est invalide (et sans retour à la ligne : pas d'injection d'en-tête). */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s.length > 320 || /[\r\n]/.test(s) || !EMAIL_RE.test(s)) return null;
  return s;
}

/**
 * Indicatifs dont le plan de numérotation GARDE le « 0 » initial dans le numéro international (Côte d'Ivoire depuis 2021 :
 * `+225 07 07 07 07 07`, 10 chiffres). Pour les autres pays, un « 0 » initial est un préfixe national qu'on retire
 * (`0707070707` au Sénégal -> `+221 707070707`). Donnée de plan de numérotation, pas une règle réglementaire du module.
 */
const KEEP_TRUNK_ZERO: ReadonlySet<string> = new Set(["225"]);

/**
 * Numéro normalisé au format E.164 (`+2250707070707`). `defaultDialCode` (sans `+`) complète un numéro national.
 * Reprend la normalisation du legacy (`wasender.ts`) — `00…` = `+…`, un numéro international `+…` est conservé — en
 * corrigeant le « 0 » initial selon le plan de numérotation du pays.
 */
export function normalizePhone(raw: string | null | undefined, defaultDialCode = "225"): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim().replace(/[\s().-]/g, "");
  if (!s) return null;
  let digits: string;
  if (s.startsWith("+")) digits = s.slice(1).replace(/[^0-9]/g, "");
  else if (s.startsWith("00")) digits = s.slice(2).replace(/[^0-9]/g, "");
  else {
    const national = s.replace(/[^0-9]/g, "");
    if (!national) return null;
    const cc = defaultDialCode.replace(/^\+/, "");
    if (national.startsWith(cc) && national.length >= cc.length + 8) digits = national; // indicatif déjà présent, sans « + »
    else if (KEEP_TRUNK_ZERO.has(cc)) digits = national.length === 10 && national.startsWith("0") ? `${cc}${national}` : national.length >= 11 ? national : ""; // 8 chiffres = ancien plan : préfixe inconnu, refusé
    else digits = national.length >= 8 ? `${cc}${national.replace(/^0+/, "")}` : "";
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** `awa.kone@gmail.com` -> `a***@gmail.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** `+2250707070734` -> `+225 ** ** ** 34` (3 premiers chiffres = indicatif, utile au support ; 2 derniers chiffres). */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/[^0-9]/g, "");
  if (digits.length < 8) return "***";
  return `+${digits.slice(0, 3)} ** ** ** ${digits.slice(-2)}`;
}

/** Masque l'adresse d'un canal ; compte (in-app, push) : identifiant tronqué. */
export function maskAddress(channel: NotifChannel, address: string | null): string {
  if (!address) return "—";
  if (channel === "EMAIL") return maskEmail(address);
  if (channel === "SMS" || channel === "WHATSAPP") return maskPhone(address);
  return `compte ${address.slice(0, 8)}…`;
}

/** Empreinte stable d'une adresse normalisée, salée par établissement (liste de suppression : on ne stocke pas l'adresse). */
export function addressHash(tenantId: string, channel: NotifChannel, normalizedAddress: string): string {
  return createHash("sha256").update(`${tenantId}|${channel}|${normalizedAddress}`).digest("hex");
}

/** Retire toute adresse e-mail ou numéro d'un texte d'erreur avant journalisation (jamais d'adresse complète dans les logs). */
export function scrubAddresses(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m.toLowerCase()))
    .replace(/\+\d[\d\s().-]{6,}\d|\b\d{9,15}\b/g, (m) => {
      const e = normalizePhone(m);
      return e ? maskPhone(e) : "***";
    });
}
