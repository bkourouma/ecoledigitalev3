/**
 * Tables GLOBALES (hors RLS) du module `iam`, à ajouter à la liste blanche du test
 * d'isolation générique (`assertTenantIsolation({ allowlist })`) avec leur justification.
 * Voir docs/adr/ADR-008-identite-et-sessions.md (§ « Lire les accès avant tout contexte tenant »).
 *
 * Règle (ADR-002 §5) : une table sans `tenant_id` + RLS n'est admise que si elle
 * est ici, une par une, avec la raison pour laquelle elle ne PEUT pas porter de tenant.
 * Les tables de tenant du module (`iam.memberships`, `iam.sessions`,
 * `iam.refresh_tokens`, `iam.login_challenges`) ne figurent PAS ici : elles passent le test.
 */
export interface IsolationAllowlistEntry {
  /** `schema.table` */
  table: string;
  /** Pourquoi cette table ne peut pas être sous RLS de tenant, et ce qui limite le risque. */
  justification: string;
}

export const IAM_ISOLATION_ALLOWLIST: readonly IsolationAllowlistEntry[] = Object.freeze([
  {
    table: "iam.identities",
    justification:
      "Une personne = UNE identité globale (e-mail unique à l'échelle de la plateforme) : elle précède tout tenant, sinon un parent " +
      "inscrit dans deux établissements aurait deux comptes. Contient e-mail, hash de mot de passe, secret TOTP CHIFFRÉ (AES-GCM, clé hors base). " +
      "Aucune donnée métier de tenant. Droits minimaux : pas de DELETE, UPDATE par colonnes ; accessible uniquement par le schéma iam (ADR-006).",
  },
  {
    table: "iam.identity_tenants",
    justification:
      "Annuaire minimal (identity_id, tenant_id) servant UNIQUEMENT à répondre « dans quels tenants cette identité a-t-elle un accès ? » avant " +
      "qu'un contexte tenant n'existe (login, switch-tenant). Aucune autre colonne (ni statut ni rôle : l'autorité reste iam.memberships sous RLS). " +
      "Lecture seule pour l'application ; alimentée par le trigger SECURITY DEFINER iam.sync_identity_tenants depuis iam.memberships.",
  },
  {
    table: "iam.mfa_recovery_codes",
    justification:
      "Codes de secours rattachés à l'identité globale (la MFA est un attribut de la personne, pas d'un tenant). Uniquement des empreintes HMAC " +
      "(clé serveur hors base), usage unique atomique.",
  },
  {
    table: "iam.password_reset_tokens",
    justification:
      "Réinitialisation / invitation : le porteur du lien n'a pas encore de session ni de tenant (flux anonyme). Uniquement des empreintes HMAC " +
      "de jetons de 256 bits, expiration courte, usage unique atomique.",
  },
]);

/** Format attendu par `assertTenantIsolation({ allowlist })`. */
export const IAM_ISOLATION_ALLOWLIST_TABLES: readonly string[] = IAM_ISOLATION_ALLOWLIST.map((e) => e.table);

export default IAM_ISOLATION_ALLOWLIST;
