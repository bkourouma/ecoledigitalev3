/**
 * Masquage des champs sensibles AVANT hash et stockage.
 *
 * Un journal d'audit est lu par beaucoup plus de monde que la table qu'il décrit et
 * ne peut pas être purgé : un secret qui y entre y reste. Trois filets :
 *   1. par NOM de clé (exact, après normalisation, ou par suffixe) ;
 *   2. par FORME de valeur (JWT, « Bearer … », clé privée PEM) ;
 *   3. par CONTENU (numéro de carte : suite de 13 à 19 chiffres valide au Luhn).
 * La liste est configurable (`createMasker`).
 */
import type { JsonValue } from "./types";

export const MASK = "[MASKED]";

export interface MaskingConfig {
  /** Noms de clés sensibles (comparés après normalisation : minuscules, sans `_ - . espace`). */
  keys: readonly string[];
  /** Suffixes de clé sensibles (après normalisation), ex. `token` couvre `accessToken`. */
  keySuffixes: readonly string[];
  /** Motifs de valeurs texte à masquer (le fragment qui correspond est remplacé). */
  valuePatterns: readonly RegExp[];
  /** Détecte les numéros de carte (Luhn) dans les textes. */
  detectCardNumbers: boolean;
  replacement: string;
}

export const DEFAULT_MASKING: MaskingConfig = Object.freeze({
  keys: [
    "password", "passwd", "pwd", "pass", "passwordhash", "newpassword", "oldpassword", "currentpassword",
    "confirmpassword", "motdepasse", "mdp",
    "secret", "clientsecret", "sharedsecret",
    "token", "accesstoken", "refreshtoken", "idtoken", "sessiontoken", "jeton",
    "apikey", "privatekey", "authorization", "cookie", "setcookie",
    "totp", "totpsecret", "mfasecret", "otp", "otpsecret", "otpauth", "backupcodes", "recoverycodes",
    "cardnumber", "cardno", "pan", "cvv", "cvc", "cvn", "cardcvv", "cardcvc",
    "iban", "rib", "accountnumber",
  ],
  keySuffixes: ["password", "passwd", "secret", "token", "apikey", "privatekey", "cardnumber", "motdepasse", "jeton"],
  valuePatterns: [
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  ],
  detectCardNumbers: true,
  replacement: MASK,
});

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[\s_.\-]/g, "");

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;

export interface Masker {
  readonly replacement: string;
  isSensitiveKey(key: string): boolean;
  /** Masque récursivement les valeurs d'un JSON (clés sensibles, motifs, numéros de carte). */
  maskValue(value: JsonValue): JsonValue;
  maskString(text: string): string;
}

export function createMasker(overrides: Partial<MaskingConfig> = {}): Masker {
  const cfg: MaskingConfig = { ...DEFAULT_MASKING, ...overrides };
  const keys = new Set(cfg.keys.map(normalizeKey));
  const suffixes = cfg.keySuffixes.map(normalizeKey).filter(Boolean);

  const isSensitiveKey = (key: string): boolean => {
    const k = normalizeKey(key);
    if (k === "") return false;
    if (keys.has(k)) return true;
    return suffixes.some((s) => k.endsWith(s));
  };

  const maskString = (text: string): string => {
    let out = text;
    for (const pattern of cfg.valuePatterns) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, cfg.replacement);
    }
    if (cfg.detectCardNumbers) {
      out = out.replace(CARD_CANDIDATE, (m) => {
        const digits = m.replace(/[ -]/g, "");
        return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? cfg.replacement : m;
      });
    }
    return out;
  };

  const maskValue = (value: JsonValue): JsonValue => {
    if (typeof value === "string") return maskString(value);
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(maskValue);
    const out: Record<string, JsonValue> = Object.create(null);
    for (const key of Object.keys(value)) {
      const v = (value as Record<string, JsonValue>)[key] as JsonValue;
      // `null` ne révèle rien : on le garde (un mot de passe « vidé » reste visible comme tel).
      out[key] = isSensitiveKey(key) && v !== null ? cfg.replacement : maskValue(v);
    }
    return out;
  };

  return { replacement: cfg.replacement, isSensitiveKey, maskValue, maskString };
}
