# Assemblage de la plateforme v2

Ce document décrit comment les modules `tenancy`, `entitlements`, `iam`, `rbac`, `audit`, `finance`, le module `platform` (console des opérateurs) et `apps/worker` sont **assemblés** dans l'API, sans casser le legacy. Il complète `module-conventions.md` (normatif pour écrire un module) ; ici, on décrit ce qui se passe **entre** les modules.

Preuve exécutable : `apps/api/test/phase1/` — en particulier `exit-criteria.integration.test.ts` (test de sortie de phase 1 du plan §4), lancé par `pnpm test:phase1` (Postgres + Redis éphémères dans Docker) et, en CI, par le job bloquant `v2-modules`.

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
| Legacy (`typ: JWT`) | middleware legacy inchangé, puis `v2-context` | `request.ctx` dérivé (`userId`, `tenantId`, rôle actif) mais **aucune assignation RBAC** : refus par défaut sur les routes protégées par `requirePermission` (les comptes legacy ne sont migrés vers iam qu'en Phase 2) |
| IAM v2 sur une route **legacy** | middleware legacy | 401 comme avant (jeton inconnu) |
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
| `GET /plans`, `PUT /plans/:key`, `PUT /plans/:key/features` | catalogue |
| `GET\|PUT /tenants/:id/subscription`, `GET /tenants/:id/overrides`, `PUT\|DELETE …/overrides/:feature` | abonnement et surcharges |

Chaque action réussie écrit dans le journal de **plateforme** (`audit.platform_audit_log`, chaîné) en plus de l'audit du tenant visé fait par les use cases. Un provisioning interrompu laisse un tenant **partiel**, signalé par `platform.provisioning_partial` (étape en cause) ; `reconcile` reprend rôles et abonnement.

## 6. Rattrapage des tenants legacy

`tenant-sync` recopie `public.tenants` dans `kernel.tenants` mais ne crée rien d'autre. Au démarrage (et à la création d'un tenant legacy, via `afterSync`), pour chaque tenant non archivé et **sans doublon** (verrou consultatif, rejouable à volonté — prouvé par test, y compris en concurrence) : profil d'organisation, **un** établissement + son campus par défaut, onboarding, 11 rôles système, abonnement **ACTIF sans échéance** s'il n'en a aucun (un abonnement annulé n'est pas recréé).

> **HYPOTHÈSE DE PRODUIT À VALIDER PAR LE PROPRIÉTAIRE DU PRODUIT.** Plan `V2_LEGACY_TENANT_DEFAULT_PLAN` (défaut `PROFESSIONAL`), pack `V2_LEGACY_TENANT_DEFAULT_PACK` (défaut `HIGHER`, « l'application actuelle devient le pack Higher », décision D1), pays `V2_LEGACY_TENANT_DEFAULT_COUNTRY` (défaut `CI`). Ni le plan, ni le pack, ni l'absence d'échéance n'ont été arbitrés ; rien n'est facturé.

## 7. Asynchrone : abonnés et jobs découverts

`modules/<clé>/subscribers.ts` et `jobs.ts` sont découverts par le worker (disque en développement ; **embarqués dans le bundle** en production — `pnpm --filter @ecoledigitale/worker build`, preuve : `worker-bundle.integration.test.ts` construit et démarre le vrai bundle ; **un nouveau module impose de reconstruire**).

| Abonné | Motif | Effet |
|---|---|---|
| `audit.<motif>` (10) | `iam.impersonation.started`, `iam.login.failed`, `iam.session.revoked`, `rbac.role.changed`, `rbac.assignment.changed`, `tenancy.**`, `entitlements.**`, `iam.mfa.**`, `iam.password.**`, `iam.membership.**` | journal d'audit (id de l'événement = clé primaire : idempotent) ; le contact du fondateur n'est pas recopié |
| `rbac.instantiate-system-roles` | `tenancy.tenant.provisioned` | rôles système (idempotent, verrouillé) |
| `rbac.reconcile-roles-on-reactivation` | `tenancy.tenant.status_changed` → `active` | rôles système re-résolus |
| `rbac.invalidate-permission-cache.*` | `rbac.role.changed`, `rbac.assignment.changed`, `tenancy.tenant.status_changed` | diffusion Redis aux instances de l'API |
| `entitlements.start-trial` | `tenancy.tenant.provisioned` | abonnement d'essai (`ENTITLEMENTS_TRIAL_*`), no-op si un abonnement existe |
| `entitlements.invalidate-cache.*` | changements d'abonnement / surcharge / statut / provisioning | diffusion Redis |

| Job | Planification (`WORKER_TZ`) | Effet |
|---|---|---|
| `finance.mark-overdue-invoices` | 01:15 chaque jour | factures échues → OVERDUE, un `finance.invoice.overdue` par transition |
| `audit.ensure-partitions` | 02:10 chaque jour | partitions d'audit créées à l'avance |
| `iam.purge-expired-data` | 03:40 chaque jour | sessions / challenges périmés (`IAM_PURGE_RETENTION_DAYS`) |
| `audit.detach-expired-partitions` | 03:30 le 1er du mois | **simulation** (journalisée) ; détachement réel seulement si `AUDIT_DETACH_MODE=apply` |
| `outbox-cleanup`, `ensure-partitions` | socle du worker | purge de l'outbox ; (recoupe `audit.ensure-partitions`, idempotent) |

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

- **Comptes legacy** : aucun import vers iam (Phase 2). Un jeton legacy donne un contexte sans droit RBAC.
- **`trustProxy`** : `index.ts` ne le règle pas ; derrière un proxy, `request.ip` (limiteur de débit IAM, audit) est celui du proxy. À régler au déploiement.
- **Provisioning de la console** : étapes en transactions distinctes (un use case par module), reprise par `reconcile` ; pas de transaction globale.
- **Caches** : TTL 30 s (droits), 5 s (arbre des périmètres) ; l'invalidation par événement exige Redis. Sans Redis, seuls le processus d'origine et le TTL jouent.
- **Audit des événements de finance** : par écriture directe uniquement (pas de souscription `finance.*`) ; les événements sont relayés mais non consommés par audit.
- **Production de l'API** : l'image exécute `tsx src/index.ts` ; les dossiers `apps/worker` ne sont pas nécessaires à l'API (les `subscribers.ts` ne sont chargés que par le worker). Les migrations v2 s'exécutent depuis un poste ou une étape de déploiement (`pnpm db:v2:migrate`), pas depuis l'image.
- **Fournisseurs de paiement réels** : seul `sandbox` existe (Phase 3) ; son secret de webhook par défaut est public — refusé hors `development`/`test` sauf autorisation explicite du tenant.
