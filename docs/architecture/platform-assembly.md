# Assemblage de la plateforme v2

Ce document décrit comment les modules `tenancy`, `entitlements`, `iam`, `rbac`, `audit`, `finance`, le module `platform` (console des opérateurs) et `apps/worker` sont **assemblés** dans l'API, sans casser le legacy. Il complète `module-conventions.md` (normatif pour écrire un module) ; ici, on décrit ce qui se passe **entre** les modules.

Preuve exécutable : `apps/api/test/phase1/` — en particulier `exit-criteria.integration.test.ts` (test de sortie de phase 1 du plan §4), lancé par `pnpm test:phase1` (Postgres + Redis éphémères dans Docker) et, en CI, par le job bloquant `v2-modules`. Le parcours complet d'une **année scolaire simulée** (provisionnement HIGHER -> inscription confirmée par événement -> appels -> notes -> résultats `rules` -> bulletins signés -> diplôme -> paie -> audit -> isolation -> accès parent) est dans `apps/api/test/phase2/` (`pnpm test:phase2`, job bloquant `phase2`) ; voir `phase2-exit.md` (journal des défauts et limites).

## 1. Flux d'une requête

```
Client ── HTTP ──▶ Fastify (apps/api/src/index.ts)
  │
  │  onRequest   rls-context (legacy)  ·  audit request-meta (ip, user-agent → AsyncLocalStorage)
  │              v2-auth ........ jeton IAM v2 (en-tête typ at+jwt|imp+jwt) sur une route de module non publique :
  │                               signature + session + révocation + époque + accès/tenant actifs (1 requête SQL)
  │                               → request.ctx, request.iamAuth, request.v2Authenticated
  │  preHandler  tenant-context (legacy) → auth-middleware (legacy)
  │                               ↳ ne s'applique PAS si route `config.public` OU request.v2Authenticated
  │              super-admin-audit (legacy) → v2-context : request.ctx dérivé du legacy SI aucun ctx n'est posé
  ▼
  Contexte encapsulé du module  /api/v1/<clé>    (registre)
  │  setErrorHandler(kernel → JSON stable)  ·  garde « request.ctx présent » (401 sauf config.public)
  ▼
  preHandler de route : requirePermission (rbac, périmètre de la cible) → requireFeature (entitlements)
  ▼
  handler → use case → TenantDb.run(ctx)   BEGIN · SET LOCAL app.tenant_id · SQL (RLS app_user)
                          ├─ audit.record(tx)      ┐ même transaction :
                          └─ PgOutboxWriter(tx)    ┘ pas de donnée sans trace, pas d'événement fantôme
  COMMIT ─▶ kernel.domain_events (published_at NULL) ──NOTIFY──▶ apps/worker
  │
  ▼  apps/worker
  relais d'outbox (FOR UPDATE SKIP LOCKED) ─▶ BullMQ `domain-events` ─▶ routeur par motif ─▶ abonnés
       audit.*  rbac.*  entitlements.*   (idempotents ; échecs → reprises → dead-letter)
       rbac/entitlements `invalidate-*` ─▶ Redis pub/sub `<WORKER_QUEUE_PREFIX>:event-fanout`
  ▼
  chaque instance de l'API (platform/event-fanout.ts) ─▶ bus en mémoire ─▶ caches de droits RBAC / entitlements
```

Deux chemins d'audit coexistent **volontairement** : l'écriture directe `audit.record(tx)` dans la transaction du use case (atomique : `tenancy.tenant.provision`, `rbac.role.created`, `finance.payment.completed`…) et la consommation asynchrone des événements par le module audit (`tenant.provisioned`, `mfa.enabled`, `role.changed`…, y compris ce que le legacy ou iam ne journalisent pas directement). Les actions ont des noms distincts ; aucune n'est un doublon exact.

## 2. Ordre de démarrage (`registerV2Platform`, `platform/v2-bootstrap.ts`)

Sans `V2_DATABASE_URL`, rien n'est chargé (les paquets v2 ne sont même pas importés) : l'API legacy démarre comme avant.

1. **Manifestes** découverts (`modules/*/manifest.ts`), validés (clés, dépendances, cycles, doublons) et politique de rattrapage lue — *avant* toute connexion ; une valeur invalide refuse le démarrage.
2. **Pool v2** (`v2-context`) : refuse un rôle superuser / `BYPASSRLS` / membre de `migrator` / non membre de `app_user`. Pose `app.v2` et `request.ctx`.
3. **`kernel.tenants`** alimentée depuis `public.tenants` (`tenant-sync`, mêmes UUID).
4. **Runtime** (`v2-runtime.ts`) → `app.v2Runtime` ; portée `ip/user-agent` de l'audit ; relevé des routes publiques (`onRoute`) ; hook `v2-auth`.
5. **Catalogues** : `syncRbac` (permissions + rôles système des tenants actifs), `syncFeatureCatalog(manifests)` — seulement si les modules `rbac` / `entitlements` sont présents.
6. **Modules** (`registerModules`) dans l'ordre topologique des `dependsOn` (aujourd'hui : audit, tenancy, entitlements, rbac, finance, iam, platform). Pour chaque module : `setup(app, runtime)` à la **racine**, puis `default(app, runtime)` dans un contexte encapsulé préfixé `/api/v1/<clé>`.
6b. **Adaptateurs de ports entre modules** (`platform/adapters`, `wireApiPorts`) : construits sur les dépendances de lecture des modules fournisseurs, enregistrés dans les registres de ports par application Fastify (`app.academicPorts`, `app.financePorts`…). Résolution paresseuse : l'ordre de chargement n'a pas d'importance. `skipAdapters: true` (tests ciblés) laisse les modules en échec fermé. Voir §11.
7. **Caches** : abonnement Redis (`REDIS_URL`) aux événements relayés par le worker → invalidation des caches RBAC et entitlements des autres instances.
8. **Rattrapage des tenants legacy** (§6) puis hook de rattrapage à la création d'un tenant legacy.

L'ordre de chargement des modules n'est **pas** porteur de sens : ce que les modules partagent (`app.rbac`, `app.entitlements`, `app.iam`) est posé à la racine par `setup` et résolu **à la requête**.

## 3. Contrat de plugin uniforme (`platform/runtime.ts`)

```ts
// modules/<clé>/http/plugin.ts
export function setup?(app, runtime)   // facultatif — instance RACINE : décorateurs partagés
export default async function (app, runtime: ModuleRuntime)   // routes SANS préfixe
```

Avant l'assemblage, le registre appelait `scope.register(plugin)` sans option : tenancy, entitlements, rbac, finance posaient en plus **leur propre préfixe** (`/api/v1/tenancy/api/v1/tenancy/…`) et leurs décorateurs (`fastify.rbac`, `fastify.entitlements`) tombaient dans le contexte encapsulé du module, invisibles des autres (`requirePermission` répondait 500 `rbac.not_configured`). Les `named exports` historiques (`tenancyPlugin`, `rbacPlugin`, `financePlugin`, `registerIam`, `auditHttpPlugin`…) subsistent pour les tests de chaque module ; ils acceptent désormais `prefix`.

`ModuleRuntime` fournit : `tenantDb`, `systemDb`, `clock`, `logger`, `manifests`, `env`, `requirePermission`, `auditPort`, `entitlements` (`reader`, `requireFeature`, `isFeatureEnabled`), `scopeTrees`, `resolveContext`, `rateLimiter`, `superAdminAuthorizer`, `accountNotifier`.

| Port | Fournisseur | Remarques |
|---|---|---|
| `requirePermission(perm, { scope? })` | rbac | `scope` : `{type, id}` ou fonction de la requête. Les routes `:id` de tenancy passent le périmètre de la cible (campus / établissement). |
| `auditPort.record / recordPlatform` | audit (`audit.record` / `recordPlatform`) | Mapping par module ci-dessous. Clé HMAC : `AUDIT_HMAC_KEY` (API **et** worker). |
| `entitlements.requireFeature(key)` | entitlements | 403 `entitlements.feature_not_available` (`details.feature`, `details.reason`). |
| `entitlements.isFeatureEnabled(ctx, key)` | entitlements | Pour les contrôles dépendant du corps de requête. |
| `scopeTrees.forTenant / invalidate` | tenancy (`createTenancyScopeTreeProvider`) | Instantané court (5 s) des établissements → campus ; sans lui une assignation d'établissement ne couvre aucun campus et un campus inexistant n'est pas refusé. |
| `resolveContext(request)` | plateforme | `request.ctx` (IAM v2 ou dérivé du legacy), sinon 401. |
| `rateLimiter` | iam (`RedisRateLimiter` si `REDIS_URL`, sinon mémoire) | La mémoire n'est valable que pour une instance : avertissement au démarrage. |
| `superAdminAuthorizer` | `platform/super-admin-authorizer.ts` | JWT super-admin legacy, **séparé** du JWT tenant. Fourni à entitlements (`/admin/*`), iam (`/impersonation`) et platform (`/platform/*`). |
| `accountNotifier` | `platform/account-notifier.ts` | SMTP si `SMTP_HOST` ; sinon journalise l'absence de transport **sans le jeton**. |

### Mapping des ports d'audit

| Module | Port natif | Vers `audit.record(tx, entry)` |
|---|---|---|
| tenancy, entitlements | `record(tx, { action, entity, entityId, before, after, reason, metadata })` | structurellement identique : `runtime.auditPort` est passé tel quel |
| rbac | `record(tx, { tenantId, actorId, requestId, action, entityType, entityId, … })` | `entityType` `role`/`assignment` → `entity` `role`/`role_assignment` ; tenant, acteur et requête dérivés du contexte de la transaction (`rbacAuditAdapter`) |
| finance | `record(tx, ctx, { action, resourceType, resourceId, sensitive, … })` | `resourceType` → `entity`, `resourceId` → `entityId`, `sensitive` → `severity: notice` (sinon `info`), `ctx` ignoré (`financeAuditAdapter`) |
| platform (console) | `recordPlatform(tx, …)` | journal de **plateforme** (événements sans tenant), acteur `superAdmin` explicite |

## 4. Authentification : jeton IAM v2 et jeton legacy cohabitent

| Jeton | Où | Résultat |
|---|---|---|
| IAM v2 (`typ` `at+jwt` / `imp+jwt`) sur une route de module | hook `onRequest` `v2-auth` | `request.ctx` (rôle actif seul, `mfa` lu en base), le middleware legacy s'efface |
| Legacy (`typ: JWT`) | middleware legacy, puis `v2-context` | `request.ctx` dérivé (`userId`, `tenantId`, rôle actif) mais **aucune assignation RBAC** : refus par défaut sur les routes protégées par `requirePermission`. Accepté jusqu'à `LEGACY_TOKEN_SUNSET` (puis 401 `LEGACY_TOKEN_SUNSET`). Son tenant n'est lu qu'**après vérification** de la signature. |
| IAM v2 sur une route **legacy** | hook `v2-auth` (`onRequest`) puis middleware legacy (`attachIamLegacyUser`) | Authentifié (révocation sur toutes les méthodes) ; `request.user` = compte **legacy** de même e-mail dans le tenant du jeton, rôles legacy par inverse strict de `legacyRoleToTemplate`. 401 si le jeton est invalide, 403 `LEGACY_ACCOUNT_MISSING` / `LEGACY_ROLE_UNMAPPED` sinon. `V2_LEGACY_IAM_BRIDGE=0` : 401 comme avant. Voir `auth-cutover.md`. |
| JWT super-admin | `superAdminAuthorizer` sur `/platform/*`, `/entitlements/admin/*`, `/iam/impersonation` | opérateur ; vérifié aussi sur GET (liste noire, compte actif) |

Routes **publiques** : une route de module déclare `config: { public: true }` pour échapper à la garde « contexte présent » du registre **et** au middleware legacy ; elle s'authentifie elle-même (mot de passe, jeton d'étape MFA, refresh token, signature de webhook, JWT super-admin). La liste est **dérivée** de ces déclarations (hook `onRoute`, `platform/public-routes.ts`) et lue par `auth-middleware.ts` (seule modification du legacy avec l'enregistrement dans `index.ts`) ; vide sans plateforme v2. Le test `[D3b]` parcourt toutes les routes publiques sans identifiants et exige un refus (hors `POST /iam/logout`, 204 par conception).

## 5. Console plateforme (`modules/platform`, `/api/v1/platform/*`)

Module et non code technique de `src/platform/` parce qu'il **orchestre** des use cases de plusieurs modules (import par `index.ts` uniquement), a son manifeste, son audit et ses tests ; la couche technique `src/platform/` fournit seulement l'autorisateur (elle seule parle au legacy).

| Route | Action |
|---|---|
| `GET /tenants`, `GET /tenants/:id` | liste (statut, recherche, pagination) ; vue d'ensemble |
| `POST /tenants` | `tenancy.provisionTenant` → `rbac.instantiateSystemRoles` → abonnement d'essai (`entitlements.setSubscription`, TRIALING) → propriétaire (`iam.provisionMember` `owner`, invitation) → rôle système `owner` (`rbac.assignSystemRoleUseCase`) → audit de plateforme |
| `PATCH /tenants/:id/status` | suspension / réactivation / archivage (effet immédiat : l'accès IAM vérifie l'état du tenant à chaque requête) |
| `POST /tenants/:id/reconcile` | reprise idempotente des rôles et de l'abonnement |
| `GET /audit/logs` | journal d'audit de **plateforme** (`audit.platform_audit_log`) : même enveloppe que l'audit d'un tenant (`{ items, nextCursor }`, curseur opaque, plus récent d'abord), filtres `action` (exact ou préfixe `x.*`), `actorId`, `entity`, `entityId`, `severity`, `from`, `to`, `limit` ≤ 200 ; lecture seule via l'API publique du module `audit` (`listPlatformAuditLogs`), transaction système en lecture seule ; seuls `seq` et `hash` de la chaîne sortent |
| `GET /plans`, `PUT /plans/:key`, `PUT /plans/:key/features` | catalogue |
| `GET\|PUT /tenants/:id/subscription`, `GET /tenants/:id/overrides`, `PUT\|DELETE …/overrides/:feature` | abonnement et surcharges |

Contrats de réponse (`packages/contracts/src/v2/platform.ts`) : `PlatformProvisionTenantResponseSchema` (`POST /tenants`, 201 : `tenantId`, `slug`, `institutions[]`, `owner`, `subscription` — le résultat de la console, distinct de `ProvisionTenantResultSchema` du module tenancy qui porte `onboarding`), `PlatformSetTenantStatusResponseSchema` (`PATCH …/status` : `{ tenantId, previous, current }`), `PlatformTenantListResponseSchema` ; validés contre les réponses HTTP réelles par `apps/api/test/phase1/platform-console.integration.test.ts`.

Chaque action réussie écrit dans le journal de **plateforme** (`audit.platform_audit_log`, chaîné) en plus de l'audit du tenant visé fait par les use cases. Un provisioning interrompu laisse un tenant **partiel**, signalé par `platform.provisioning_partial` (étape en cause) ; `reconcile` reprend rôles et abonnement.

## 6. Rattrapage des tenants legacy

`tenant-sync` recopie `public.tenants` dans `kernel.tenants` mais ne crée rien d'autre. Au démarrage (et à la création d'un tenant legacy, via `afterSync`), pour chaque tenant non archivé et **sans doublon** (verrou consultatif, rejouable à volonté — prouvé par test, y compris en concurrence) : profil d'organisation, **un** établissement + son campus par défaut, onboarding, 11 rôles système, abonnement **ACTIF sans échéance** s'il n'en a aucun (un abonnement annulé n'est pas recréé).

> **HYPOTHÈSE DE PRODUIT À VALIDER PAR LE PROPRIÉTAIRE DU PRODUIT.** Plan `V2_LEGACY_TENANT_DEFAULT_PLAN` (défaut `PROFESSIONAL`), pack `V2_LEGACY_TENANT_DEFAULT_PACK` (défaut `HIGHER`, « l'application actuelle devient le pack Higher », décision D1), pays `V2_LEGACY_TENANT_DEFAULT_COUNTRY` (défaut `CI`). Ni le plan, ni le pack, ni l'absence d'échéance n'ont été arbitrés ; rien n'est facturé.

## 7. Asynchrone : abonnés et jobs découverts

`modules/<clé>/subscribers.ts` et `jobs.ts` sont découverts par le worker (disque en développement ; **embarqués dans le bundle** en production — `pnpm --filter @ecoledigitale/worker build`, preuve : `worker-bundle.integration.test.ts` construit et démarre le vrai bundle ; **un nouveau module impose de reconstruire**).

| Module | Abonnés (motif) | Jobs (planification `WORKER_TZ`) |
|---|---|---|
| audit | `audit.iam-impersonation-started`, `audit.iam-login-failed`, `audit.iam-session-revoked`, `audit.rbac-role-changed`, `audit.rbac-assignment-changed`, `audit.tenancy` (`tenancy.**`), `audit.entitlements` (`entitlements.**`), `audit.iam-mfa`, `audit.iam-password`, `audit.iam-membership` : journal d'audit (id de l'événement = clé primaire, idempotent) | `audit.ensure-partitions` 02:10 ; `audit.detach-expired-partitions` 03:30 le 1er (**simulation** sauf `AUDIT_DETACH_MODE=apply`) |
| rbac | `rbac.instantiate-system-roles` (`tenancy.tenant.provisioned`), `rbac.reconcile-roles-on-reactivation`, `rbac.invalidate-permission-cache.*` | |
| entitlements | `entitlements.start-trial` (`tenancy.tenant.provisioned`, `ENTITLEMENTS_TRIAL_*`), `entitlements.invalidate-cache.*` | |
| iam | | `iam.purge-expired-data` 03:40 (`IAM_PURGE_RETENTION_DAYS`) |
| finance | | `finance.mark-overdue-invoices` 01:15 |
| academic | `academic.run-rollover` (`academic.rollover.requested` : reconduction annuelle reprenable, progression en base), `academic.instantiate-reference-data` (`tenancy.institution.created`), **`academic.confirm-on-invoice-paid` (`finance.invoice.paid`)**, `academic.withdraw-on-student-status` (`people.student.status_changed`) | `academic.expire-holds` chaque minute, `academic.finalize-offerings` 01:00 |
| people | `people.project-enrollment` (`academic.enrollment.*`), `people.project-membership`, `people.instantiate-reference-data`, `people.end-assignments-on-classroom-closed`, `people.end-assignments-on-year-closed` | `people.emit-expiring-qualifications` 06:30 |
| assess | `assess.seed-assessment-types` | `assess.purge-batch-receipts` 04:20 |
| results | `results.recompute-on-grade-published` / `-revised` / `-assessment-cancelled` / `-enrollment-created` / `-enrollment-transferred` / `-enrollment-withdrawn`, `results.note-binding-change` (`rules.binding.changed`) | `results.process-recomputes` toutes les 10 s, `results.purge` 04:40 |
| rules | | `rules.replay-reproducibility` 02:50, `rules.purge-evaluation-failures` 04:30 |
| reportcards | `reportcards.render-snapshot`, `reportcards.render-requested`, `reportcards.combine-batch`, `reportcards.seed-templates` | `reportcards.integrity-check` 03:20, `reportcards.sweep-renders` */10, `reportcards.purge-verification-log` 04:10 le 1er |
| higher | `higher.capitalize-on-period-closed` (`results.period.closed`), `higher.evaluate-diplomas-on-capitalized`, `higher.render-document` (`higher.document.issued`) et `higher.render-document-requested` (rendu du PDF ; le scellement a lieu à l'émission) | `higher.expire-credits` 03:20 |
| attendance | `attendance.cancel-session-on-occurrence-cancelled`, `attendance.refresh-summaries-on-enrollment-change.*`, `attendance.refresh-summaries-on-period-change.*`, `attendance.seed-reference-data` | `attendance.recompute-summaries` 02:50 |
| scheduling | `scheduling.hold-on-attendance`, `scheduling.flag-on-staff-leave`, `scheduling.flag-on-staff-status`, `scheduling.flag-on-assignment-ended`, `scheduling.cancel-on-offering-cancelled`, `scheduling.cancel-on-classroom-cancelled`, `scheduling.archive-on-year-closed`, `scheduling.seed-reference-data` | `scheduling.generate-occurrences` 02:30 |
| payroll | `payroll.seed-settings`, `payroll.flag-claim-source-changed.*` (séance annulée / invalidée / replanifiée / minutes payées modifiées), `payroll.close-periods-on-year-closed` | `payroll.fail-stale-runs` */10 |
| analytics | `analytics.refresh-on-academic`, `-people`, `-results`, `-attendance`, `-finance`, `-payroll` : un abonné par source, ne calcule rien, **demande** un rafraîchissement coalescé (`analytics.refresh_requests`) | `analytics.process-refreshes` */30 s (lit les sources par ports, remplace le périmètre) ; `analytics.nightly-rebuild` 03:10 (reconstruction idempotente de chaque tenant) |
| socle du worker | | `outbox-cleanup`, `ensure-partitions` (recoupe `audit.ensure-partitions`, idempotent) |

Cette liste est celle que **découvre** le worker (`discoverModuleExtensions`) ; le test `worker-bundle.integration.test.ts` exige que le bundle de production enregistre exactement les mêmes abonnés et jobs que les sources, et qu'il ait branché les ports entre modules (`ports entre modules branchés (adaptateurs de plateforme)`).

**Le worker n'a pas de Fastify** : les abonnés et jobs lisent des registres **par processus** (`setAcademicWorkerPorts`, `setPeopleWorkerPorts`, `setResultsWorkerPorts`, `registerHigherWorkerPorts`, `registerSchedulingPorts`, `setReportcardsWorkerResources`) que `installWorkerAdapters` remplit au démarrage (`App.start`, étape 1b), AVANT les consommateurs et le planificateur. En développement le câblage est chargé depuis `apps/api/src/platform/adapters/worker.ts` ; en production `apps/worker/scripts/build.mjs` remplace `discovery/platform-wiring.ts` par une version qui l'importe statiquement : **le bundle est autonome**.

Les handlers reçoivent `ctx.tenantDb` (ajout au SDK du worker) pour appeler les use cases des modules, qui prennent un `TenantDb`.

## 8. Variables d'environnement

**Obligatoires dès que `V2_DATABASE_URL` est défini** (démarrage refusé, aucune valeur par défaut) : `IAM_JWT_SECRET` (≥ 32 car.), `IAM_MFA_ENCRYPTION_KEY` (32 octets base64). Le legacy exige déjà `JWT_SECRET` / `SUPER_ADMIN_JWT_SECRET`.

| Variable | Défaut | Portée | Rôle |
|---|---|---|---|
| `V2_DATABASE_URL` | — | API | active la plateforme v2 (rôle `app_user`, jamais superuser) |
| `REDIS_URL` | — | API, worker | limiteur de débit IAM (sinon mémoire) et diffusion des invalidations ; BullMQ pour le worker |
| `WORKER_QUEUE_PREFIX` | `ed` | API, worker | préfixe Redis commun (files, limiteur, canal de diffusion) |
| `AUDIT_HMAC_KEY`, `AUDIT_HMAC_KEY_ID` (`k1`), `AUDIT_HMAC_KEY_PREVIOUS`, `AUDIT_HMAC_KEY_PREVIOUS_ID` (`k0`) | — | API **et** worker | chaînage HMAC du journal ; sans clé : SHA-256 simple (avertissement) |
| `AUDIT_DETACH_MODE` | `dry-run` | worker | `apply` pour détacher réellement les partitions échues |
| `AUDIT_PARTITIONS_MONTHS_AHEAD` | `3` | worker | partitions créées d'avance |
| `IAM_PURGE_RETENTION_DAYS` | `30` | worker | purge des sessions périmées |
| `ENTITLEMENTS_TRIAL_PLAN`, `ENTITLEMENTS_TRIAL_DAYS` | `STARTER`, `30` | API, worker | essai d'un tenant provisionné |
| `V2_LEGACY_TENANT_DEFAULT_PLAN`, `_PACK`, `_COUNTRY` | `PROFESSIONAL`, `HIGHER`, `CI` | API | rattrapage legacy (**hypothèse**, §6) |
| `FINANCE_ENV` | dérivé de `NODE_ENV`, sinon `production` | API | `production`/`staging` : aucune simulation de paiement |
| `FINANCE_WEBHOOK_BASE_URL`, `FINANCE_PROVIDER_<NOM>_<CLÉ>` | — | API | webhooks et fournisseurs de paiement |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | — | API | mêmes noms que l'e-mail legacy |
| `V2_APP_BASE_URL` | — | API | base des liens `/auth/invitation?token=…` et `/auth/reset-password?token=…` |
| `IAM_*` | voir `modules/iam/README.md` | API | cookie, TTL, MFA, politique de mot de passe |
| `V2_LEGACY_IAM_BRIDGE` | actif | API | `0` : les routes legacy refusent à nouveau les jetons IAM |
| `LEGACY_TOKEN_SUNSET` | — | API | date d'extinction des jetons legacy (ISO 8601) ; mal formée = démarrage refusé |
| `TRUST_PROXY` | `false` | API | sauts de proxy / CIDR de confiance (`request.ip` réel : limiteur, audit, sessions) |
| `IAM_SERVICE_SECRET` | — | API, web | active `POST /iam/federated-login` (Google) ; ≥ 32 caractères |
| `AUTH_SOCIAL_SHARED_SECRET` | — | API, web | `/auth/social-login` legacy ; obligatoire en production |
| `LEGACY_DATABASE_URL`, `IAM_IMPORT_TECHNICAL_PASSWORD` | `DATABASE_URL`, — | poste d'import | `pnpm iam:import-legacy` |
| `NEXT_PUBLIC_AUTH_V2`, `NEXT_PUBLIC_GOOGLE_AUTH` | — | web (build) | connexion V2 ; bouton Google |
| `STORAGE_S3_BUCKET`, `_REGION` (`us-east-1`), `_ENDPOINT` (MinIO, force le style chemin), `_FORCE_PATH_STYLE`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_SSE` (`AES256`, `aws:kms`, `none`), `_KMS_KEY_ID`, `_PREFIX` | — | API **et** worker | stockage d'objets partagé (bulletins, justificatifs de présence, pièces des personnes). Chaque variable retombe sur son homologue `REPORTCARDS_S3_*` |
| `STORAGE_DISK_DIR`, `STORAGE_PUBLIC_BASE_URL`, `STORAGE_SIGNING_SECRET` | `./.data/objects` hors production, URL `http://localhost:<PORT>` | API **et** worker | **repli disque, développement seulement** : sans bucket, disque si `STORAGE_DISK_DIR` est défini ou si `NODE_ENV` n'est pas `production` ; sinon aucun stockage (les fonctions qui en dépendent échouent fermé). URL signées HMAC à durée courte servies par `GET /api/v1/storage/object`. Secret absent : aléatoire PAR processus (les URL de l'API ne sont pas valides côté worker : fixer `STORAGE_SIGNING_SECRET` si les deux partagent le disque) |
| `REPORTCARDS_SIGNING_KEY` / `_FILE` / `_ID` | — | API **et** worker | clé privée Ed25519 PKCS#8 de signature des bulletins (voir `modules/reportcards/README.md`) |
| `REPORTCARDS_VERIFICATION_BASE_URL` | `V2_APP_BASE_URL` | API **et** worker | domaine public de vérification (QR `<base>/v/<code>`) |
| `REPORTCARDS_S3_*` | — | API **et** worker | ancien nom du stockage d'objets (repli de `STORAGE_S3_*`) |
| `REPORTCARDS_CHROME_PATH`, `REPORTCARDS_CHROME_NO_SANDBOX=1`, `REPORTCARDS_RENDER_CONCURRENCY` (2) | — | worker | moteur de rendu PDF |

Le worker garde ses propres variables (`WORKER_DATABASE_URL`, `WORKER_RELAY_*`…, voir `apps/worker/README.md`) et lit `AUDIT_*`, `ENTITLEMENTS_*`, `IAM_PURGE_*` depuis `process.env` (les abonnés et jobs des modules sont du code du module).

## 9. Mise en route locale, pas à pas

```bash
pnpm install                                   # ne pas committer pnpm-lock.yaml sans demande

# 1. Postgres 17 et Redis 7 jetables (noms distincts : ne touchez pas aux services locaux)
docker run -d --name ed-dev-pg    -e POSTGRES_PASSWORD=<mot-de-passe-local> -p 127.0.0.1:55432:5432 postgres:17-alpine
docker run -d --name ed-dev-redis -p 127.0.0.1:56379:6379 redis:7-alpine --maxmemory-policy noeviction

# 2. Base v2 et migrations (baseline + worker + modules, ordre topologique) — nom de base finissant par _dev
#    V2_MIGRATOR_URL=postgresql://postgres:<mot-de-passe-local>@127.0.0.1:55432/ecoledigitale_v2_dev
pnpm db:v2:migrate

# 3. Rôle de connexion applicatif (affiché UNE fois) — sert à l'API ET au worker
pnpm db:v2:create-login-role                   # → V2_DATABASE_URL, à copier dans votre .env local

# 4. Secrets (jamais dans le dépôt)
#    IAM_JWT_SECRET=$(openssl rand -base64 48)   IAM_MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)
#    AUDIT_HMAC_KEY=$(openssl rand -hex 24)       REDIS_URL=redis://127.0.0.1:56379

# 5. API (legacy inchangé + v2) puis worker
pnpm dev:api
pnpm --filter @ecoledigitale/worker dev        # WORKER_DATABASE_URL = V2_DATABASE_URL, mêmes REDIS_URL / WORKER_QUEUE_PREFIX / AUDIT_HMAC_KEY

# 6. Première organisation : JWT super-admin (POST /api/v1/super-admin/auth/login), puis
#    POST /api/v1/platform/tenants  { name, slug, countryCode, packs, adminContact: { name, email } }
#    Le propriétaire reçoit le lien d'invitation par e-mail (SMTP_*). Sans SMTP, le lien n'est PAS journalisé (le
#    jeton est un secret) : utilisez un récepteur SMTP local (par ex. Mailpit) ou, pour un essai, réinitialisez le
#    mot de passe via POST /api/v1/iam/password/forgot avec le même récepteur.
#    Le rôle `owner` impose la MFA : le premier login renvoie `mfa_enrollment_required` (POST /api/v1/iam/mfa/enroll puis /verify).
```

Contrôles : `pnpm check:boundaries`, `pnpm check:secrets`, `pnpm test:isolation`, `pnpm test:phase1` (test de sortie de phase + assemblage, Docker requis), `pnpm --filter @ecoledigitale/worker test:integration`.

## 10. Limites connues et décisions

- **Comptes legacy** : importés par `pnpm iam:import-legacy` (identités, accès, assignations RBAC ; idempotent, lecture seule côté legacy, rapport des cas ambigus), puis authentifiés par iam. Un jeton legacy (tant que `LEGACY_TOKEN_SUNSET` n'est pas atteinte) donne un contexte sans droit RBAC. Les comptes créés dans le legacy après l'import doivent être réimportés (voir `auth-cutover.md` §6).
- **`trustProxy`** : `index.ts` ne le règle pas ; derrière un proxy, `request.ip` (limiteur de débit IAM, audit) est celui du proxy. À régler au déploiement.
- **Provisioning de la console** : étapes en transactions distinctes (un use case par module), reprise par `reconcile` ; pas de transaction globale.
- **Caches** : TTL 30 s (droits), 5 s (arbre des périmètres) ; l'invalidation par événement exige Redis. Sans Redis, seuls le processus d'origine et le TTL jouent.
- **Audit des événements de finance** : par écriture directe uniquement (pas de souscription `finance.*`) ; les événements sont relayés mais non consommés par audit.
- **Production de l'API** : l'image exécute `tsx src/index.ts` ; les dossiers `apps/worker` ne sont pas nécessaires à l'API (les `subscribers.ts` ne sont chargés que par le worker). Les migrations v2 s'exécutent depuis un poste ou une étape de déploiement (`pnpm db:v2:migrate`), pas depuis l'image.
- **Fournisseurs de paiement réels** : seul `sandbox` existe (Phase 3) ; son secret de webhook par défaut est public — refusé hors `development`/`test` sauf autorisation explicite du tenant.
- **Stockage disque** : le repli disque (`STORAGE_DISK_DIR`) est un confort de développement (pas de réplication, URL signées servies par l'API) ; en production, configurer `STORAGE_S3_BUCKET`.
- **Frais d'inscription** : ils doivent être facturés séparément de la scolarité (catégorie `REGISTRATION`) pour que le paiement confirme l'inscription ; sans barème applicable l'inscription est confirmée immédiatement.
- **Identité de l'établissement** : le bulletin exige une identité d'établissement (`putBranding`) ; son absence est une erreur explicite du contrôle préalable, pas une valeur par défaut.
- **Totaux des bulletins** : `weighted` / `totalCoefficient` restent `null` tant que le moteur de règles ne les publie pas ; le relevé cumulé n'affiche pas de totaux.

## 11. Ports entre modules : adaptateurs (`platform/adapters`)

Chaque module déclare des **ports** (ce qu'il attend de ses voisins) et échoue **fermé** (`*.port_unavailable`) tant qu'ils ne sont pas branchés. Un module n'importe jamais un autre autrement que par son `index.ts` ; les adaptateurs de `apps/api/src/platform/adapters/` sont le **seul** endroit qui connaît plusieurs modules (règles `platform-adapters-only-via-index`, `platform-adapters-no-legacy-no-pg` et `modules-not-adapters` de `.dependency-cruiser.cjs`, éprouvées par `test/boundaries.test.ts`). Un adaptateur traduit l'API **publique** du fournisseur vers le port du consommateur : jamais de SQL, jamais d'import du legacy.

`createAdapterKit` (`kit.ts`) construit les dépendances de **lecture** de chaque fournisseur (mêmes adaptateurs côté API et côté worker) ; `buildPlatformPorts(kit, storage)` renvoie les ports PAR MODULE CONSOMMATEUR ; `wireApiPorts` les enregistre dans l'API, `installWorkerAdapters` dans le worker.

| Fichier | Fournisseur -> consommateur | Port(s) |
|---|---|---|
| `academic-results` | academic -> results | `CurriculumPort` (structure de calcul tirée des **données** du curriculum : contrat, rang de période, crédits, coefficients, parents), `RosterPort` |
| `academic-assess` | academic -> assess | `RosterPort`, `PeriodPort`, `CurriculumPort` (rattrapage autorisé = donnée du nœud) |
| `academic-attendance` | academic -> attendance | `EnrollmentRosterPort` (classe, effectif à une date, inscription), `PeriodPort` |
| `academic-scheduling` | academic -> scheduling | `AcademicQuery` (classe, nœud, offre, année d'une date) |
| `academic-payroll` | academic -> payroll | `CurriculumLabelPort` |
| `academic-higher` | academic -> higher | `CurriculumPort` (nœud-cycle = programme `is_cycle`, UE par **lignée**), `EnrollmentDirectory` |
| `academic-people` | academic -> people | `AcademicQuery` (affectations, ouverture d'offre) |
| `academic-guards` | assess, results, higher, scheduling -> academic | `CurriculumUsageGuard`, `CompletionLookup`, `ScheduleConflictChecker` |
| `people-academic` | people -> academic | `StudentDirectory`, `GuardianshipPort`, `OfferingReadiness` |
| `people-results`, `people-assess` | people/iam -> results, assess | `GuardianshipPort`, `ActorNamePort`, `TeachingAssignmentPort` |
| `people-attendance`, `people-scheduling`, `people-payroll` | people -> attendance, scheduling, payroll | `PeoplePort`, `PeopleQuery`, `StaffDirectoryPort` (le titulaire d'un compte est résolu par `persons.identity_id`, jamais par e-mail) |
| `people-higher`, `people-reportcards` | people/iam -> higher, reportcards | `StudentDirectory`, `ActorDirectory`, `GuardianshipPort`, `UserDirectoryPort` |
| `directories-finance` | people, academic -> finance | `LearnerDirectory` (un apprenant inconnu est refusé), `EnrollmentDirectory` |
| `finance-academic` | finance -> academic | `InvoiceFactsReader`, `RegistrationFeeProbe` : **confirmation automatique de l'inscription** après paiement des frais d'inscription (décision métier du 2026-10-01) |
| `finance-reportcards` | finance -> reportcards ; reportcards -> finance | `LearnerStandingPort` (impayé exigible, sans montant) ; `ReceiptDocumentPort` (PDF du reçu : scellement, rendu par le worker, vérification publique) |
| `payroll-reportcards` | reportcards -> payroll | `PayslipDocumentPort` (PDF du bulletin de paie versé) |
| `people-finance` | people -> finance | `GuardianshipPort` (lien de tutelle / identité de l'élève : routes famille `/finance/me/*`, relu à chaque requête) |
| `attendance-reportcards` | attendance -> reportcards | `AttendanceSummaryPort` (minutes justifiées / non justifiées, retards) |
| `scheduling-attendance` | scheduling <-> attendance | `OccurrencePort` ; `AttendanceQuery` (l'appel est-il soumis ?) |
| `payroll-sources` | scheduling, attendance -> payroll | `HoursSourcePort` d'origine SESSION (heures payables, **gel atomique** par bulletin) et ATTENDANCE |
| `results-reportcards` | results -> reportcards | `ResultsReadPort` (état de période, effectif, bundle de résultats figé : noms, libellés, règles, trace) |
| `results-higher` | results -> higher | `CreditsSourcePort`, `ResitSessionPort`, `CycleResultsPort` (UE identifiées par lignée) |
| `reportcards-higher` | reportcards -> higher | `SignatoryDirectory`, `InstitutionPort` |
| `reportcards-higher-documents` | higher -> reportcards ; reportcards -> higher | `DocumentFilesPort` (scellement Ed25519 de l'empreinte du snapshot, index de vérification publique, rendu PDF par gabarit de plateforme, URL signée) ; `ExternalDocumentVerifier` (vérification publique d'un diplôme ou d'une attestation : lecture sous la RLS du tenant, signature et empreinte revérifiées, aucune donnée personnelle) |
| `results-academic` | results -> academic | `PromotionDecisionPort` (décisions de passage lues dans `results` pour la reconduction annuelle : jamais calculées par academic) |
| `analytics-sources` | tenancy, academic, people, results, attendance, finance, payroll -> analytics | `AnalyticsSourcePorts` (périmètres, calendrier, inscriptions + sexe, résultats FINAL + décisions confirmées, appels et présences du personnel, reporting financier, caisse, masse salariale, charge d'enseignement) : lectures seules, séquentielles ; un port manquant = passe `UNAVAILABLE` et manque déclaré |
| `storage` | stockage d'objets -> attendance, people, reportcards | S3 / MinIO configurable par l'environnement, repli disque en développement |

### Règles à respecter dans un adaptateur

- **Appels SÉQUENTIELS.** `TenantDb.run` imbrique les exécutions du même contexte en `SAVEPOINT` sur **une seule connexion**. Un port appelé depuis la transaction d'un module partage donc cette connexion : deux appels entrelacés (`Promise.all`) libèrent des points de sauvegarde qui n'existent plus (`savepoint "ed_sp_n" does not exist`). Aucun `Promise.all` sur des lectures de modules, ni dans un adaptateur ni dans un module qui appelle un port dans sa transaction (cas corrigé dans `attendance/application/session-support.ts`).
- **Échec fermé.** Une lecture impossible ne devient jamais « autorisé » : `CurriculumUsageGuard` répond « utilisé », une sonde de frais d'inscription inconnue renvoie `null` (l'inscription reste en attente), un compte sans fiche liée n'a aucun droit « élève » ni « tuteur ».
- **Identités.** Le « nœud-cycle » de `higher` est l'identifiant du **programme** académique (`programs.is_cycle`) ; une UE de `higher` est identifiée par sa **lignée** (stable d'une année à l'autre, malgré le clonage annuel du curriculum) ; le `levelCode` des résultats est le code du niveau (`grade level`) ; le contrat de calcul est `program.calculation_contract ?? education_level.calculation_contract ?? null` (aucun contrat par défaut).
- **Décimaux.** Les crédits et valeurs exactes sont normalisés en chaînes canoniques (`6`, pas `6.00`) avant d'entrer dans un instantané signé.

### Extensions additives des modules fournisseurs

| Module | Extension | Raison |
|---|---|---|
| academic | migration `0706_academic_results_facts` (contrat de calcul, drapeaux de fin de cycle et de rattrapage, crédits, rangs de période portés par le curriculum) ; `application/facts.ts` (`getClassroomFacts`…) ; registre de ports (`registerAcademicPorts`, `setAcademicWorkerPorts`) ; spec `004-academic-core` §7.5 | results/assess/reportcards lisaient ces faits dans des libellés ou des constantes |
| finance | migration `0504_finance_line_source` (`sourceRef` d'une ligne) ; `finance.invoice.paid` **enrichi** (`enrollmentId`, `containsRegistrationFee`, `sourceRefs`) ; `application/facts.ts` (frais d'inscription dus / soldés, faits d'une facture, impayé) ; registre de ports | producteur et consommateur de l'événement ne partageaient aucun contrat ; la confirmation automatique en dépend |
| people | `getDisplayNamesOfIdentities`, `StaffBrief.identityId`, registre de ports (API et worker) | noms d'affichage et compte lié sans accès à la table |
| attendance | `listCompletedStaffPresence` (heures de présence pour la paie) ; appels de ports séquentiels | origine ATTENDANCE de la paie ; bug de savepoints |
| iam | `getMemberEmails` | `UserDirectoryPort` des bulletins |
| assess, results | `isCurriculumNodeInUse`, `isCurriculumNodeInResults` | garde d'usage d'un nœud de curriculum |
| reportcards | `infrastructure/worker-resources.ts` (stockage et ressources de rendu du worker) | le worker n'a pas de Fastify |

### Vérification

`test/adapters/adapters.unit.test.ts` (traductions pures), `test/adapters/chain.integration.test.ts` (people + academic -> assess -> results -> reportcards / higher, avec les **vraies** règles nationales sur une base migrée par toutes les migrations v2), `test/adapters/operations.integration.test.ts` (finance -> academic, scheduling <-> attendance <-> payroll, bulletins) et, dans `test/phase1/`, `assembly.integration.test.ts` [D9] (aucun port obligatoire ne manque) et `worker-bundle.integration.test.ts` (build et démarrage réels du bundle).

### Données de démonstration (`pnpm seed:v2`)

`ALLOW_SEED=1 pnpm seed:v2 --pack HIGHER|PRIMARY|SECONDARY [--seed n] [--slug s] [--year-start AAAA-MM-JJ]` (`scripts/seed-v2.ts`) démarre la plateforme EN PROCESSUS (API + worker) et crée un établissement complet par l'API HTTP publique, sans SQL direct : organisation et abonnement, année et périodes, programme et curriculum publié, classe, élèves, tuteurs et enseignants, inscriptions confirmées par les règlements, factures, emploi du temps, appels, notes publiées, comptes de test par rôle. Il REFUSE de s'exécuter sans `ALLOW_SEED=1` et si le nom de la base de `V2_DATABASE_URL` ne finit pas par `_dev`, `_test` ou `_local`. Il exige `REDIS_URL` et les secrets de l'API (`IAM_JWT_SECRET`, `IAM_MFA_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY`). Les mots de passe des comptes de test (et les secrets TOTP des rôles à MFA) sont générés à l'exécution et affichés une seule fois. Relancé sur le même `--slug`, il ne crée rien. Mêmes graine et début d'année = mêmes données métier (empreinte affichée). PRIMARY et SECONDARY : structure et données disponibles, sans résultats ni bulletins (pas de jeu de règles dans cette version). Test : `test/seed/seed-v2.integration.test.ts`.
