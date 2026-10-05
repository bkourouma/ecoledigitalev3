/**
 * Quotas de stockage PAR PLAN (réponse métier Q-05) : 5 Gio (base) / 50 Gio (palier `documents.storage.extended`) / 250 Gio
 * (palier `documents.storage.large`). Le palier découle des features accordées au tenant par ses entitlements (plan, pack,
 * surcharge) : le plus haut palier accordé gagne. Un établissement ne peut que RESSERRER ce quota (`settings.storage_quota_bytes`).
 *
 * Les valeurs d'environnement `DOCUMENTS_QUOTA_BASE_BYTES|_EXTENDED_BYTES|_LARGE_BYTES` (entiers positifs, en octets) permettent
 * à l'exploitation d'ajuster un déploiement sans modifier le code ; une valeur absente ou invalide retombe sur ces défauts.
 * Domaine pur : aucun accès base ni réseau.
 */
export const GIB = 1024 * 1024 * 1024;

export type QuotaTier = "base" | "extended" | "large";

/** Quota par défaut de chaque palier, en octets (5 / 50 / 250 Gio). */
export const PLAN_QUOTA_DEFAULT_BYTES: Readonly<Record<QuotaTier, number>> = Object.freeze({ base: 5 * GIB, extended: 50 * GIB, large: 250 * GIB });

/** Features qui ouvrent les paliers supérieurs (déclarées par le manifeste). */
export const QUOTA_FEATURE_KEYS = Object.freeze({ extended: "documents.storage.extended", large: "documents.storage.large" });

const ENV_KEYS: Readonly<Record<QuotaTier, string>> = Object.freeze({
  base: "DOCUMENTS_QUOTA_BASE_BYTES",
  extended: "DOCUMENTS_QUOTA_EXTENDED_BYTES",
  large: "DOCUMENTS_QUOTA_LARGE_BYTES",
});

/** Palier le plus haut accordé. */
export function quotaTierFor(features: { readonly extended: boolean; readonly large: boolean }): QuotaTier {
  if (features.large) return "large";
  if (features.extended) return "extended";
  return "base";
}

/** Quota en octets d'un palier : environnement (entier positif sûr) sinon défaut. */
export function planQuotaBytes(tier: QuotaTier, env: Readonly<Record<string, string | undefined>> = {}): number {
  const n = Number(env[ENV_KEYS[tier]]);
  return Number.isSafeInteger(n) && n > 0 ? n : PLAN_QUOTA_DEFAULT_BYTES[tier];
}
