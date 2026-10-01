# Module `audit` — journal d'audit append-only, partitionné, chaîné

Socle (pack `CORE`). Schéma Postgres `audit`, migrations `0300-0399`. Conforme à `docs/architecture/module-conventions.md`.

## Utiliser l'audit depuis un autre module

```ts
import { audit } from "../audit";                       // seul point d'import autorisé

// 1. Écriture explicite, DANS la transaction métier (tx = Tx de TenantDb.run)
await audit.record(tx, {
  action: "grade.published",        // entité.verbe, minuscules
  entity: "grade", entityId: gradeId,
  before, after,                    // masqués automatiquement, diff calculé
  reason: "correction après recours", severity: "warning",
});

// 2. Capture automatique avant/après autour d'une mutation
await audit.withAudit(tx, {
  action: "role.updated", entity: "role", entityId: id,
  snapshot: (t) => loadRole(t, id),
}, () => updateRole(tx, id, patch));
```

* Tenant, acteur, `requestId` viennent du `RequestContext` de la transaction ; `ip`, `user_agent`, `device` de la portée HTTP (`auditRequestMetaPlugin`), NULL hors requête.
* **Appelez `record` EN DERNIER** dans la transaction (voir « Concurrence »).
* Acteur explicite : `{ type: "impersonation", id: <utilisateur imité>, impersonatedBy: <super-admin> }`.
* Test d'architecture pour votre module : `import { testing } from "../audit"` →
  `await testing.expectAudited(pool, tenantId, "grade.published", () => publishGrade(...))` et
  `testing.expectAuditRolledBack(...)` (échec ⇒ aucune trace : preuve d'atomicité).

## API publique (`index.ts`)

| Export | Rôle |
|---|---|
| `audit.record(tx, entry)` / `audit.withAudit(tx, meta, fn)` | écriture dans la transaction courante |
| `audit.recordPlatform(tx, entry)` | journal de plateforme (événements sans tenant), via `SystemDb.run` |
| `audit.verifyChain(tx, tenantId, range)` / `verifyPlatformChain` | contrôle d'intégrité (par `seq` ou période) |
| `audit.configure({ hmac, masking, clock, maxFieldBytes })` | câblage au démarrage |
| `AUDIT_EVENT_SUBSCRIPTIONS`, `consumeAuditEvent(deps, event)` | abonnements pour le futur registre du worker |
| `ensureAuditPartitions(systemDb, months)` | job : crée les partitions à l'avance |
| `detachExpiredAuditPartitions(systemDb, audit, { dryRun })`, `setRetentionMonths`, `getRetentionMonths` | rétention |
| `auditHttpPlugin`, `auditRequestMetaPlugin` | plugins Fastify |
| `testing.expectAudited`, `testing.expectAuditRolledBack` | tests d'architecture |

HTTP (préfixe `/api/v1/audit`, **lecture seule**, aucune route POST/PUT/PATCH/DELETE) :
`GET /logs` (filtres acteur, entité, action — préfixe `role.*` —, période, sévérité ; curseur), `GET /logs/:id`,
`GET /logs/export` (CSV, période ≤ 31 j, ≤ 10 000 lignes, lui-même journalisé), `GET /verify`.
Permissions : `audit.read`, `audit.export` (sensible).

## Modèle de données

* `audit.audit_log` — **partitionnée par mois** (`RANGE (occurred_at)`, UTC). Colonnes : `tenant_id, seq, occurred_at, actor_type (user|system|superAdmin|impersonation), actor_id, impersonated_by, action, entity, entity_id, before, after, diff, metadata, ip, user_agent, device, request_id, reason, severity, hash_alg, key_id, prev_hash, hash`. PK `(tenant_id, occurred_at, id)`.
* `audit.chain_heads` — dernier `seq`/`hash` par tenant (avancée par trigger uniquement).
* `audit.platform_audit_log` / `platform_chain_head` — événements **sans tenant** (table globale hors RLS, allowlist d'isolation, lue/écrite via `SystemDb` seulement).
* `audit.retention_policies` — rétention par tenant (défaut 60 mois, plancher 12, CHECK + garde SQL).
* `audit_archive` (schéma) — destination des partitions détachées ; aucun droit pour `app_user`.

### Masquage (avant hash et stockage)
Par nom de clé (mots de passe, jetons, secrets TOTP, codes de secours, numéros de carte, CVV, clés d'API…, exact ou par suffixe), par forme de valeur (JWT, `Bearer …`, clés privées PEM) et par contenu (suite de 13 à 19 chiffres valide au Luhn). Configurable (`audit.configure({ masking })`). Le **diff est calculé sur les valeurs brutes** puis masqué : « le mot de passe a changé » reste visible sans révéler la valeur. Un champ trop volumineux (> 64 Ko) est remplacé par `{_truncated, _bytes, _sha256}`, jamais perdu en silence.

## Chaînage, concurrence, partitions

**Chaînage.** Par tenant : `seq` sans trou, `prev_hash` = hash de la ligne précédente (`000…0` au départ), `hash` = SHA-256 — ou HMAC-SHA-256 si une clé est configurée — du JSON canonique (clés triées) de tous les champs métier + position dans la chaîne + algorithme (format `ed-audit/v1`, `recorded_at` exclu). Le calcul est applicatif (la base ne peut pas canonicaliser) ; la **structure** est imposée en base par un trigger `BEFORE INSERT` (`seq = tête+1`, `prev_hash = hash de tête`, SQLSTATE `AU002`) et la tête n'est avancée que par un trigger `SECURITY DEFINER` (`app_user` n'a aucun droit d'écriture dessus ; elle ne peut qu'avancer de +1, `AU003`).

**Concurrence (choix).** Verrou advisory **transactionnel** par tenant (`pg_advisory_xact_lock(hash(tenant))`) plutôt que `SELECT … FOR UPDATE` sur la tête : relâché automatiquement au commit/rollback, aucun droit `UPDATE` requis, et il ne bloque que les autres écritures d'audit du *même* tenant (testé : un tenant ne retarde pas un autre). Le verrou est pris dans un énoncé séparé de la lecture de la tête (en `READ COMMITTED`, une lecture dans le même énoncé verrait une tête périmée). Coût : il est tenu jusqu'à la fin de la transaction métier → **appeler `record` en dernier** ; sinon risque d'attente, voire de deadlock (détecté par Postgres). Non prévu pour `REPEATABLE READ`/`SERIALIZABLE` : la tête lue peut être périmée et le trigger de garde lève `AU002` plutôt que d'écrire une chaîne incohérente.

**Partitions.** `audit.ensure_partitions(ahead, back)` / `ensureAuditPartitions(systemDb, months)` : idempotentes, sûres en parallèle, **sans verrou exclusif sur le parent** (table autonome + `ATTACH PARTITION`). 12 mois d'avance sont créés par la migration ; planifiez le job (ex. quotidien, `months = 3` suffit). Filet : si une partition manque, `record` la crée (`audit.ensure_partition_for`, bornée à −10 ans / +5 ans) au lieu de faire échouer l'opération métier.

**RLS sur table partitionnée.** `kernel.enable_tenant_rls` fonctionne sur le parent (`relkind = 'p'`) : la policy du parent s'applique aux accès *via le parent*, ce qui est le seul chemin applicatif. Les policies ne sont **pas héritées** par les partitions : `audit.create_partition` applique donc aussi `enable_tenant_rls` à chaque partition, et aucun `GRANT` n'est donné sur les partitions (accès direct refusé). Les deux protections sont testées (y compris l'accès direct après un `GRANT` volontaire).

## Rétention et archivage

Défaut 5 ans, **jamais moins de 12 mois** (CHECK `retention_policies_floor` + plancher dans `audit.detach_expired_partitions`). L'expiration ne supprime aucune ligne : `detachExpiredAuditPartitions` (simulation par défaut) **détache** les partitions mensuelles échues et les déplace dans `audit_archive`, où le trigger d'ajout seul est reposé explicitement (le `DETACH` supprime les triggers de ligne hérités — constaté par test). Les partitions étant communes à tous les tenants, une partition n'est détachée que lorsque la rétention **la plus longue** de tous les tenants est échue : un tenant à rétention courte voit donc ses données conservées jusqu'à cette échéance (limite connue). Le `DROP` définitif d'une partition archivée est une opération d'exploitation (après `pg_dump` vérifié), jamais faite par l'application. Après archivage, `verifyChain` traite le premier maillon restant comme **ancre de confiance** (`anchor: "trusted-anchor"`).

## Modèle de menace

**Ce que le chaînage garantit** (détection, pas prévention) :

* modification du contenu d'une ligne (`hash_mismatch`), suppression ou insertion au milieu (`seq_gap`, `prev_hash_mismatch`), début de chaîne falsifié (`genesis_mismatch`), suppression de la queue (`head_mismatch`, via la tête), ré-ordonnancement ;
* avec une clé HMAC inconnue de l'attaquant : toute réécriture est détectée, y compris la réécriture complète en SHA-256 (avec `requireHmac`, `weak_hash`) ;
* un développeur ou un compte applicatif (`app_user`) ne peut ni modifier, ni supprimer, ni tronquer le journal, ni forger une tête (droits + triggers) ; le propriétaire de la table et les superusers sont aussi bloqués par les triggers tant qu'ils ne les désactivent pas explicitement — geste qui, lui, ne laisse pas de trace dans le journal : seul le contrôle du chaînage (hash, liens, tête) le rend détectable.

**Ce qu'il ne garantit pas :**

* **Un attaquant qui peut écrire dans la base ET désactiver les triggers (superuser, `session_replication_role = replica`) peut réécrire toute la chaîne** si elle n'est protégée que par SHA-256 (il recalcule tous les hash et la tête) — c'est testé et assumé. Parades : (1) activer le **HMAC** avec une clé hors base (gestionnaire de secrets) ; (2) **ancrer la tête** à l'extérieur (export périodique de `chain_heads` / résultat de `verify` vers un stockage WORM ou un tiers) — seul moyen de détecter une réécriture complète par quelqu'un qui détient aussi la clé HMAC ;
* la vérité du contenu : le journal prouve *ce qui a été enregistré*, pas que l'application a enregistré *tout* ce qu'elle aurait dû (d'où `expectAudited` dans les tests des modules) ;
* la confidentialité : le masquage est une liste de motifs ; une donnée sensible sous un nom de champ inattendu n'est pas masquée — complétez `masking.keys` pour vos modules ;
* l'effacement (RGPD) : le journal est immuable ; les données personnelles y sont limitées au strict nécessaire (identifiants, pas de contenu) ; toute pseudonymisation passe par une opération d'exploitation documentée, pas par l'application ;
* la précision du temps : `occurred_at` vient de l'horloge applicative (ou de l'événement rejoué) ; `seq` fait foi pour l'ordre ;
* `ip` / `device` : valeurs déclaratives (IP fiable seulement avec `trustProxy` correctement réglé ; User-Agent forgeable) ;
* la disponibilité : un tenant très bavard sérialise ses propres écritures d'audit (verrou par tenant) ;
* les lignes HMAC ne se vérifient pas sans la clé (`key_unavailable`, jamais « valide » par défaut) ; perte de clé = perte de vérifiabilité du contenu (le chaînage reste contrôlable).

## Événements consommés

`iam.impersonation.started` (critique), `iam.login.failed`, `iam.session.revoked`, `rbac.role.changed`, `rbac.assignment.changed`, `tenancy.*`, `entitlements.*`, `iam.mfa.*`, `iam.password.*`, `iam.membership.*` (les trois derniers ajoutés à l'assemblage : activer ou réinitialiser la MFA ne laissait aucune trace) — handlers **purs** `(event) => AuditEntry | null` (`domain/events.ts`), lus de façon défensive. L'entrée reprend l'`id` et l'`occurredAt` de l'événement : la clé primaire fait le dédoublonnage (livraison « au moins une fois »). Un événement sans tenant exploitable (vide, UUID nul, absent) va au journal de plateforme via `SystemDb.run`.

## Intégration (assemblée — voir `docs/architecture/platform-assembly.md`)

* `apps/api/package.json` : dépendances `@ecoledigitale/kernel`, `@ecoledigitale/database` (workspace) ; `tsconfig` : `paths` vers `packages/kernel/src`, `packages/database/src` et `@ecoledigitale/worker/sdk` (le module a son propre `tsconfig.json` de vérification — **et c'est lui qu'esbuild lit** pour embarquer `subscribers.ts` / `jobs.ts` dans le bundle du worker).
* Numéros de migration : plage `0300-0399` réservée à `audit` (les versions sont globales à tous les dossiers) ; baseline `0001-0003` requise (`kernel.tenants`, `kernel.enable_tenant_rls`).
* HTTP : `http/plugin.ts` exporte par défaut `(app, runtime)` (routes sans préfixe : le registre applique `/api/v1/audit`) ; `auditPlugin` / `auditHttpPlugin` restent exportés avec leurs options. `contextOf` = `runtime.resolveContext`, `requirePermission` = garde du rbac. La portée `ip/user-agent` (`auditRequestMetaPlugin`) est posée à la racine par la plateforme.
* HMAC : `configureAuditFromEnv` (`config.ts`) lit `AUDIT_HMAC_KEY` (+ `_ID`, `_PREVIOUS`, `_PREVIOUS_ID`) ; appelé par l'API **et** par les abonnés / jobs du worker pour que les deux processus écrivent la chaîne avec la même clé.
* Worker : `subscribers.ts` (un abonné par entrée de `AUDIT_EVENT_SUBSCRIPTIONS` ; `tenancy.*` devient `tenancy.**`) et `jobs.ts` (`audit.ensure-partitions` quotidien ; `audit.detach-expired-partitions` mensuel, **simulation** sauf `AUDIT_DETACH_MODE=apply`).
* Mapping depuis les ports des autres modules : tenancy / entitlements passent `audit.record` tel quel ; rbac (`entityType` → `entity` `role` / `role_assignment`) et finance (`resourceType` → `entity`, `sensitive` → `severity`) via un adaptateur du module ; la console plateforme écrit dans le journal de plateforme (`recordPlatform`).
* Donnée personnelle : le contact du fondateur (`adminContact`) de `tenancy.tenant.provisioned` n'est **pas** recopié dans le journal immuable.
* Test d'isolation : `allowlist: auditIsolationAllowlist`, `fixtures: auditIsolationFixtures` (`modules/isolation-allowlist.audit.ts`) ; les partitions et `chain_heads` y sont « structure seule » par conception (pas de droit d'insertion pour `app_user`).
* `utils/audit-log.ts` (legacy, `console.log` seulement) et `plugins/super-admin-audit.ts` sont remplacés par ce module en Phase 1/2.

## Tests

```
# unitaires (intégration ignorée sans base)
pnpm exec vitest run --config apps/api/src/modules/audit/vitest.config.ts
# avec Postgres jetable (Docker)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/audit/vitest.config.ts
# types
apps/api/node_modules/.bin/tsc -p apps/api/src/modules/audit/tsconfig.json
```
Les tests sont sous `test/` (hors du `testMatch` jest d'`apps/api`).
