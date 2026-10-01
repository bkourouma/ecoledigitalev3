/**
 * Allowlist du test d'isolation multi-tenant pour le module `audit`
 * (`assertTenantIsolation({ allowlist, fixtures, schemas })`, packages/database).
 *
 * Tables du schéma `audit` qui ne sont PAS des tables de tenant, avec la justification.
 * Les tables de tenant (`audit.audit_log` et ses partitions, `audit.chain_heads`,
 * `audit.retention_policies`) ne sont PAS ici : elles doivent passer le test complet.
 */
export const AUDIT_ISOLATION_ALLOWLIST: ReadonlyArray<{ table: string; reason: string }> = Object.freeze([
  {
    table: "audit.platform_audit_log",
    reason:
      "Journal de PLATEFORME : événements sans tenant (ex. échec de connexion d'un compte inconnu). " +
      "Aucune colonne tenant_id par construction. Écrit et lu uniquement via SystemDb, jamais par une route de tenant. " +
      "Append-only (trigger) et chaîné comme le journal de tenant.",
  },
  {
    table: "audit.platform_chain_head",
    reason: "Tête de chaîne du journal de plateforme (ligne unique, avancée par trigger SECURITY DEFINER).",
  },
]);

/** Format `schema.table` attendu par `assertTenantIsolation({ allowlist })`. */
export const auditIsolationAllowlist: readonly string[] = AUDIT_ISOLATION_ALLOWLIST.map((e) => e.table);

/**
 * Valeurs minimales pour que le test d'isolation fabrique une ligne dans `audit.audit_log` :
 * le trigger de chaînage exige seq = 1 et prev_hash = empreinte d'origine pour un tenant
 * vierge. (`tenant_id` est géré par le test.)
 */
export const auditIsolationFixtures: Record<string, Record<string, unknown>> = {
  "audit.audit_log": {
    seq: 1,
    occurred_at: () => new Date().toISOString(),
    actor_type: "system",
    action: "isolation.checked",
    entity: "isolation",
    hash_alg: "sha256",
    prev_hash: "0".repeat(64),
    hash: "1".repeat(64),
  },
  "audit.chain_heads": { last_seq: 1, last_hash: "1".repeat(64) },
};

export default AUDIT_ISOLATION_ALLOWLIST;
