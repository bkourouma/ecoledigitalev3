/**
 * Configuration du service d'audit depuis l'environnement — partagée par l'API (plateforme v2) et le
 * worker (abonnés/jobs) afin que les DEUX processus écrivent la chaîne avec la MÊME clé HMAC.
 *
 *   AUDIT_HMAC_KEY             secret d'au moins 16 caractères (gestionnaire de secrets, jamais dans le dépôt)
 *   AUDIT_HMAC_KEY_ID          identifiant de la clé active (défaut `k1`), stocké avec chaque ligne
 *   AUDIT_HMAC_KEY_PREVIOUS    ancienne clé, conservée pour VÉRIFIER d'anciennes lignes après une rotation
 *   AUDIT_HMAC_KEY_PREVIOUS_ID identifiant de l'ancienne clé (défaut `k0`)
 *
 * Sans `AUDIT_HMAC_KEY`, le journal est chaîné en SHA-256 simple (détecte la corruption mais pas une
 * réécriture complète par quelqu'un qui peut écrire en base) : un avertissement est journalisé.
 */
import type { Logger } from "@ecoledigitale/kernel";
import type { AuditService, AuditServiceOptions } from "./application/audit-service";

export type AuditEnv = Readonly<Record<string, string | undefined>>;

export function auditHmacFromEnv(env: AuditEnv): AuditServiceOptions["hmac"] {
  const key = env.AUDIT_HMAC_KEY?.trim();
  if (!key) return null;
  const activeKeyId = env.AUDIT_HMAC_KEY_ID?.trim() || "k1";
  const keys: Record<string, string> = { [activeKeyId]: key };
  const previous = env.AUDIT_HMAC_KEY_PREVIOUS?.trim();
  if (previous) {
    const previousId = env.AUDIT_HMAC_KEY_PREVIOUS_ID?.trim() || "k0";
    if (previousId === activeKeyId) throw new Error("AUDIT_HMAC_KEY_PREVIOUS_ID doit différer de AUDIT_HMAC_KEY_ID.");
    keys[previousId] = previous;
  }
  return { activeKeyId, keys };
}

/** Configure le singleton d'audit (idempotent). Lève si la clé est présente mais trop courte. */
export function configureAuditFromEnv(
  audit: Pick<AuditService, "configure">,
  env: AuditEnv,
  options: { logger?: Pick<Logger, "warn" | "info">; clock?: AuditServiceOptions["clock"] } = {},
): void {
  const { logger } = options;
  const hmac = auditHmacFromEnv(env);
  audit.configure({ hmac, ...(options.clock ? { clock: options.clock } : {}) });
  if (!hmac) {
    logger?.warn(
      { audit: "sha256" },
      "AUDIT_HMAC_KEY absente : le journal d'audit est chaîné en SHA-256 simple (définissez une clé HMAC hors base en production).",
    );
  } else {
    logger?.info({ audit: "hmac-sha256", keyId: hmac.activeKeyId }, "audit : chaînage HMAC-SHA-256 actif");
  }
}
