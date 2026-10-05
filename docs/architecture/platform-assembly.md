# Assemblage de la plateforme v2

Ce document décrit comment les modules `tenancy`, `entitlements`, `iam`, `rbac`, `audit`, `finance`, le module `platform` (console des opérateurs) et `apps/worker` sont **assemblés** dans l'API, sans casser le legacy. Il complète `module-conventions.md` (normatif pour écrire un module) ; ici, on décrit ce qui se passe **entre** les modules.

Preuve exécutable : `apps/api/test/phase1/` — en particulier `exit-criteria.integration.test.ts` (test de sortie de phase 1 du plan §4), lancé par `pnpm test:phase1` (Postgres + Redis éphémères dans Docker) et, en CI, par le job bloquant `v2-modules`. Le parcours complet d'une **année scolaire simulée** (provisionnement HIGHER -> inscription confirmée par événement -> appels -> notes -> résultats `rules` -> bulletins signés -> diplôme -> paie -> audit -> isolation -> accès parent) est dans `apps/api/test/phase2/` (`pnpm test:phase2`, job bloquant `phase2`) ; voir `phase2-exit.md` (journal des défauts et limites). Les parcours des packs Primary et Secondary (modèle de pack, admission, classe, appel, compétences, conseil, bilan scellé, vie scolaire, affectation État, examens) sont dans `apps/api/test/phase3/` (`pnpm test:phase3`, job bloquant `phase3`, §13).

## 1. Flux d'une requête

```
Client ── HTTP ──▶ Fastify (apps/api/src/index.ts)
  │
  │  onRequest   observability ... request_id (x-request-id), contexte de corrélation (journaux), span serveur, métriques HTTP (§12)
  │              rls-context (legacy)  ·  audit request-meta (ip, user-agent → AsyncLocalStorage)
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
| finance | `finance.instantiate-pack` (`tenancy.institution.created` : catégories de frais `REGISTRATION` et `TUITION` du modèle de pack PRIMARY / SECONDARY, libellés seulement, idempotent) | `finance.mark-overdue-invoices` 01:15 ; **`finance.reconcile-pending-payments` toutes les 2 minutes** (rapprochement des paiements `PENDING` et des remboursements `REFUND_PENDING` : interroge les fournisseurs avec le registre et le coffre assemblés par `infrastructure/runtime.ts` — le même assemblage que l'API —, confirme / échoue avec les contrôles du webhook, plafonne les tentatives, signale `finance.payment.reconciliation_needed` ; bail en base, audit direct avec `AUDIT_HMAC_KEY`). Un seul abonné (le modèle de pack, ci-contre) : finance publie et n'écoute rien d'autre |
| academic | `academic.run-rollover` (`academic.rollover.requested` : reconduction annuelle reprenable, progression en base), `academic.instantiate-reference-data` (`tenancy.institution.created`), **`academic.confirm-on-invoice-paid` (`finance.invoice.paid`)**, `academic.withdraw-on-student-status` (`people.student.status_changed`) | `academic.expire-holds` chaque minute, `academic.finalize-offerings` 01:00 |
| people | `people.project-enrollment` (`academic.enrollment.*`), `people.project-membership`, `people.instantiate-reference-data`, `people.end-assignments-on-classroom-closed`, `people.end-assignments-on-year-closed` | `people.emit-expiring-qualifications` 06:30 |
| assess | `assess.seed-assessment-types` | `assess.purge-batch-receipts` 04:20 |
| results | `results.recompute-on-grade-published` / `-revised` / `-assessment-cancelled` / `-enrollment-created` / `-enrollment-transferred` / `-enrollment-withdrawn`, `results.note-binding-change` (`rules.binding.changed`) | `results.process-recomputes` toutes les 10 s, `results.purge` 04:40 |
| rules | `rules.apply-pack-bindings` (`tenancy.institution.created` : liaisons par défaut du pack vers les jeux FICTIFS — PRIMARY : `CI-PRIMARY-PLACEHOLDER` ; SECONDARY : `CI-SECONDARY-PLACEHOLDER` et `CI-EXAM-PLACEHOLDER` ; refus d'accusé en production journalisé et ignoré) | `rules.replay-reproducibility` 02:50, `rules.purge-evaluation-failures` 04:30 |
| reportcards | `reportcards.render-snapshot`, `reportcards.render-requested`, `reportcards.combine-batch`, `reportcards.seed-templates` | `reportcards.integrity-check` 03:20, `reportcards.sweep-renders` */10, `reportcards.purge-verification-log` 04:10 le 1er |
| higher | `higher.capitalize-on-period-closed` (`results.period.closed`), `higher.evaluate-diplomas-on-capitalized`, `higher.render-document` (`higher.document.issued`) et `higher.render-document-requested` (rendu du PDF ; le scellement a lieu à l'émission) | `higher.expire-credits` 03:20 |
| attendance | `attendance.cancel-session-on-occurrence-cancelled`, `attendance.refresh-summaries-on-enrollment-change.*`, `attendance.refresh-summaries-on-period-change.*`, `attendance.seed-reference-data` | `attendance.recompute-summaries` 02:50 |
| scheduling | `scheduling.hold-on-attendance`, `scheduling.flag-on-staff-leave`, `scheduling.flag-on-staff-status`, `scheduling.flag-on-assignment-ended`, `scheduling.cancel-on-offering-cancelled`, `scheduling.cancel-on-classroom-cancelled`, `scheduling.archive-on-year-closed`, `scheduling.seed-reference-data` | `scheduling.generate-occurrences` 02:30 |
| payroll | `payroll.seed-settings`, `payroll.flag-claim-source-changed.*` (séance annulée / invalidée / replanifiée / minutes payées modifiées), `payroll.close-periods-on-year-closed` | `payroll.fail-stale-runs` */10 |
| analytics | `analytics.refresh-on-academic`, `-people`, `-results`, `-attendance`, `-finance`, `-payroll` : un abonné par source, ne calcule rien, **demande** un rafraîchissement coalescé (`analytics.refresh_requests`) | `analytics.process-refreshes` */30 s (lit les sources par ports, remplace le périmètre) ; `analytics.nightly-rebuild` 03:10 (reconstruction idempotente de chaque tenant) |
| messaging | `messaging.system-message-on-absence` (`attendance.absence.recorded`), `messaging.system-message-on-late` (`attendance.late.recorded`) : message système dans le fil d'alertes de tous les tuteurs joignables, gabarit du tenant, idempotents (`evt:<id>`) | `messaging.publish-scheduled-announcements` chaque minute, `messaging.housekeeping` 04:50 (notifications lues périmées, pièces jamais liées) |
| imports | `imports.validate` (`imports.job.validation_requested`), `imports.run` (`imports.run.requested`) : validation et exécution des imports Excel / CSV, SANS `idempotent()` (idempotence par le bail et l'état de l'import), délai de tentative 30 min | `imports.resume-stalled` toutes les 30 s (republie les imports dont l'exécutant est mort), `imports.purge` 04:25 (brouillons abandonnés, valeurs brutes et fichiers périmés) |
| tenancy (extension) | `tenancy.onboarding-on-import-completed` (`imports.run.completed`) : complète `STUDENT_IMPORT` (import d'élèves) et `TEACHERS` (import de personnel) ; idempotent, étape déjà résolue = sans effet | |
| documents | (aucun) | `documents.expiry-sweep` 06:10 (alertes `documents.document.expiring` / `expired`, une fois par seuil), `documents.housekeeping` 03:40 (quarantaine échue, rétention : purge des archives échues) |
| notifications | un abonné par événement déclencheur : `notifications.on.finance-invoice-issued`, `-finance-invoice-overdue`, `-finance-payment-completed`, `-attendance-absence-recorded`, `-attendance-late-recorded`, `-attendance-alert-triggered`, `-reportcards-report-card-published`, `-scheduling-occurrence-cancelled`, `-messaging-announcement-published`, `-people-staff-qualification-expiring`, `-payroll-payslip-notification-requested` (règles de l'établissement -> destinataires -> mise en file au journal, idempotents) ; `notifications.stop-dunning-on-invoice-paid` (`finance.invoice.paid`) | `notifications.dispatch` toutes les 15 s (envoi des remises dues, **hors transaction**, reprise avec backoff, plafonds), `notifications.run-dunning` 07:00 (relances J+7 / J+21 / J+45), `notifications.evaluate-alerts` 07:30, `notifications.housekeeping` 04:15 (purge du journal, abonnements push expirés) |
| examinations | `examinations.withdraw-on-enrollment-withdrawn` (`academic.enrollment.withdrawn` : retrait automatique du candidat, motif tracé, numéro conservé ; sans effet une fois les résultats saisis) | (aucun : rien n'est purgé, rétention illimitée) |
| primary_school | `primary_school.instantiate-reference-data` (`tenancy.institution.created`, pack PRIMARY seulement : échelle, référentiels de démonstration, phrases, paramètres), `primary_school.mirror-period-lock.*` (`academic.classroom_period.*` : miroir du verrou de saisie), `primary_school.on-decision-confirmed` (`results.decision.confirmed` : dossier décidé, issue d'inscription de fin d'année), `primary_school.request-review-document` (`primary_school.annual_review.sealed` : PDF du bilan demandé à reportcards, échec fermé tant que la nature `ANNUAL_REVIEW` n'est pas livrée), `primary_school.on-document-rendered` (`reportcards.official_document.rendered`) | `primary_school.purge-draft-reviews` 04:35 (par tenant) |
| admissions | `admissions.derive-enrolled` (`academic.enrollment.confirmed` : `ENROLLED` DÉRIVÉ de la confirmation, élève activé, pièces rattachées, une seule fois), `admissions.close-on-enrollment-cancelled` / `-withdrawn`, `admissions.initialize-institution` (`tenancy.institution.created` : paramètres, workflow modèle publié, motifs), `admissions.record-exam-result` (`examinations.result.transmitted`, Q-E18 : résultat « admis / non admis » ET moyenne d'un élève, idempotent et ordonné par version, abonné SEUL) | `admissions.expire-offers` */15 min, `admissions.payment-deadline` à la 5e minute de chaque heure (inactif sans `payment_deadline_days`), `admissions.purge-public-form` 03:20, `admissions.anonymize-expired` 04:10 (inactif sans `rejected_retention_months`) |
| stateassign | `stateassign.on.finance-payment-completed`, `stateassign.on.finance-invoice-issued` (demandent un rapprochement : ne calculent rien) | `stateassign.reconcile` 01:40 (rapprochement de tous les tenants, idempotent), `stateassign.plan-controls` 06:20, `stateassign.flag-overdue` 07:20 (alerte unique par échéance), `stateassign.notify-due-controls` 07:25 |
| councils | `councils.instantiate-reference-data` (`tenancy.institution.created` : types de décision, rôles, modèle de PV, paramètres par défaut du pack SECONDAIRE), `councils.render-minutes` (`councils.minutes.generated` : demande le rendu officiel), `councils.on-minutes-rendered` (`reportcards.official_document.rendered` : rattache le PV scellé), `councils.revert-on-results-reopened` (`results.period.reopened` : retire les effets de résultats d'un conseil rouvert) | `councils.apply-effects` toutes les 30 s (rejoue les effets PENDING/FAILED, chacun dans sa transaction, sous l'identité de l'humain qui a décidé), `councils.expire-unlock-requests` 05:40 |
| schoollife | (aucun) | `schoollife.remind-convocations` à la 10e minute de chaque heure (rappel d'une convocation envoyée, inactif sans `convocation_reminder_hours`), `schoollife.exclusion-boundaries` 06:15 (avis neutre de début et de fin d'une exclusion en vigueur, inactif sans `exclusion_boundary_notices`) ; ports du worker : `setSchoolLifeWorkerPorts` |
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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | — | API **et** worker | mêmes noms que l'e-mail legacy ; le module `notifications` les réutilise pour l'e-mail (le worker envoie) |
| `NOTIFICATIONS_UNSUBSCRIBE_SECRET`, `NOTIFICATIONS_WEBHOOK_SECRET`, `NOTIFICATIONS_DEFAULT_SENDER_NAME`, `NOTIFICATIONS_SIMULATE`, `NOTIFICATIONS_DISPATCH_BATCH` (50), `NOTIFICATIONS_LEASE_MS` (120000), `NOTIFICATIONS_MAX_PENDING` (20000) | — | API **et** worker | notifications : secret des liens de désinscription (**obligatoire en production** pour l'e-mail), secret des accusés de fournisseurs, expéditeur par défaut, simulation EXPLICITE (refusée en production), débit |
| `SMS_HTTP_*` (`URL`, `METHOD`, `CONTENT_TYPE`, `BODY`, `HEADERS`, `API_KEY[_HEADER\|_PREFIX]`, `USERNAME`, `SENDER_ID`, `SUCCESS_PATH\|_EQUALS`, `ID_PATH`, `COST_PATH\|_MULTIPLIER\|_CURRENCY`, `ERROR_PATH`, `TIMEOUT_MS`, `PROFILE`) | — | worker (API : état de santé) | SMS : adaptateur HTTP **générique**, fournisseur non choisi (Q-18) ; voir `modules/notifications/README.md` |
| `WASENDER_API_KEY`, `WASENDER_API_BASE_URL`, `WASENDER_SESSION`, `WASENDER_SESSION_NAME`, `WASENDER_TIMEOUT_MS`, `WASENDER_SKIP_STATUS_CHECK`, `WHATSAPP_PROVIDER` | — | worker (API : état de santé) | WhatsApp (WaSender), mêmes noms que le legacy |
| `NOTIFICATIONS_VAPID_PUBLIC_KEY`, `NOTIFICATIONS_VAPID_PRIVATE_KEY`, `NOTIFICATIONS_VAPID_SUBJECT` | — | API (clé publique) **et** worker | Web Push (VAPID) : `npx web-push generate-vapid-keys` |
| `FINANCE_ENV` | dérivé de `NODE_ENV`, sinon `production` | API **et** worker | `production`/`staging` : aucune simulation de paiement |
| `FINANCE_WEBHOOK_BASE_URL`, `FINANCE_PROVIDER_<NOM>_<CLÉ>` | — | API (le worker lit `FINANCE_PROVIDER_*`) | webhooks et fournisseurs de paiement |
| `FINANCE_SECRETS_KEYS`, `FINANCE_SECRETS_ACTIVE_KEY` | — | API **et** worker | trousseau du coffre des identifiants marchands : **le worker doit avoir le même**, sinon le rapprochement ne peut pas ouvrir les secrets d'un tenant (tentatives comptées puis signalement `provider_unavailable`) |
| `FINANCE_RECONCILIATION_MIN_AGE_MS` (900000), `_MAX_ATTEMPTS` (12), `_BACKOFF_BASE_MS` (600000), `_BACKOFF_MAX_MS` (14400000), `_LEASE_MS` (600000), `_BATCH_SIZE` (50) | voir colonne | worker | rapprochement planifié des paiements en attente (valeur hors plage ignorée : défaut) |
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
| `IMPORTS_LEASE_SECONDS` (45), `IMPORTS_HEARTBEAT_MS` (5000), `IMPORTS_MAX_RUN_ATTEMPTS` (5), `IMPORTS_STALE_AFTER_SECONDS` (90) | voir défauts | worker | imports Excel / CSV (031) : durée du bail d'un exécutant, cadence du battement de coeur, tentatives d'exécution avant échec définitif, délai avant republication par le job de filet. Bornées, jamais d'échec au démarrage ; l'upload exige un stockage d'objets (`STORAGE_*`) |
| `DOCUMENTS_SCANNER` (`none`, `clamav-tcp`, `clamav-socket`, `clamav-http`), `DOCUMENTS_CLAMAV_HOST`, `_PORT` (3310), `_SOCKET`, `_URL`, `_TIMEOUT_MS` (30000), `DOCUMENTS_SCAN_FAIL_CLOSED` | `none` ; fail-closed en production | API **et** worker | antivirus des dépôts (module `documents`) et enveloppe `storage-scan` des autres modules. Production sans antivirus : le dépôt de documents est refusé en `503` tant que la politique est fail-closed |
| `DOCUMENTS_HARD_MAX_BYTES`, `DOCUMENTS_SIGNED_URL_TTL_SECONDS`, `DOCUMENTS_QUOTA_BASE_BYTES`, `_EXTENDED_BYTES`, `_LARGE_BYTES`, `DOCUMENTS_OFFICE_CONVERTER` (`off`, `libreoffice`), `DOCUMENTS_SOFFICE_PATH`, `DOCUMENTS_OFFICE_TIMEOUT_MS` | 50 Mio ; 60 s (≤ 300) ; 5 / 50 / 250 Gio ; `off` | API | plafonds de taille, durée des URL signées, quotas par palier du plan, prévisualisation Office (désactivée par défaut). Détail : `modules/documents/README.md` |
| `ADMISSIONS_FINGERPRINT_SECRET` (≥ 16 car.), `ADMISSIONS_PUBLIC_BASE_URL` (repli `V2_APP_BASE_URL`), `ADMISSIONS_MAX_FILE_BYTES` (plafond 50 Mio) | secret aléatoire PAR PROCESSUS ; lien relatif ; 15 Mio | API **et** worker | admissions : HMAC des empreintes d'IP et d'agent du formulaire public (jamais d'IP en clair ; un secret par processus fait diverger les empreintes entre instances : à fixer en production), base du lien de réponse à une offre (`<base>/v2/apply/<lien>/offer#t=<jeton>`), taille maximale d'une pièce |
| `REPORTCARDS_SIGNING_KEY` / `_FILE` / `_ID` | — | API **et** worker | clé privée Ed25519 PKCS#8 de signature des bulletins (voir `modules/reportcards/README.md`) |
| `REPORTCARDS_VERIFICATION_BASE_URL` | `V2_APP_BASE_URL` | API **et** worker | domaine public de vérification (QR `<base>/v/<code>`) |
| `REPORTCARDS_S3_*` | — | API **et** worker | ancien nom du stockage d'objets (repli de `STORAGE_S3_*`) |
| `REPORTCARDS_CHROME_PATH`, `REPORTCARDS_CHROME_NO_SANDBOX=1`, `REPORTCARDS_RENDER_CONCURRENCY` (2) | — | worker | moteur de rendu PDF |
| `LOG_LEVEL` | `info` (production), `debug` sinon | API, worker | niveau des journaux JSON (§12) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_TRACES_SAMPLER_ARG`, `OTEL_SDK_DISABLED` | absent = traçage **désactivé** | API, worker | traces OpenTelemetry ; aucun appel réseau sans point d'accès (§12) |
| `METRICS_TOKEN`, `METRICS_PORT`, `METRICS_HOST`, `METRICS_TENANT_LABEL_MAX` | absents = pas de `/metrics` | API (worker : `METRICS_TOKEN`) | métriques Prometheus ; **jamais publiques sans authentification** (§12) |
| `OBS_READY_REQUIRE`, `OBS_HEALTH_DETAILS`, `OBS_TRUST_INBOUND_TRACEPARENT`, `OBS_ROUTE_LABEL_LIMIT`, `OBS_COLLECT_CACHE_MS`, `OBS_BUSINESS_GAUGES_INTERVAL_MS`, `OBS_PAYMENTS_STALE_MINUTES` | voir le runbook | API, worker | santé, traces, cardinalité (docs/architecture/runbook-exploitation.md §2) |
| `STATEASSIGN_EXPORT_MAX_ROWS` | borne interne | API | nombre maximal de lignes d'un export des élèves affectés (troncature signalée) |

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
- **Alertes de rapprochement** : `finance.payment.reconciliation_needed` / `finance.refund.reconciliation_needed` sont publiés dans l'outbox et audités, mais aucun abonné ne les transforme encore en notification ; l'alerte est un journal d'erreur structuré (`alert: true`). Le branchement d'un port d'alerte / de compteurs se fait par `setFinanceWorkerResources` (exporté par `modules/finance`) depuis `installWorkerAdapters`.
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
| `people-notifications` | people, academic, rbac, iam -> notifications | `RecipientDirectory` : élève et tuteurs AVEC ou SANS compte (clé de personne `user:` / `person:` + alias), classe, personnel, titulaires de rôles, comptes — **coordonnées de remise** (e-mail, téléphone) lues par l'extension additive de people, jamais journalisées en clair |
| `sources-notifications` | finance, results, academic, people, messaging -> notifications | `OverdueSource` (échéances en retard, relues avant l'envoi), `GradeSource` (deux résultats FINAL consécutifs : transport, aucune formule), `TeachingLoadSource`, `AnnouncementFeed` (titre, extrait, destinataires figés) |
| `academic-schoollife`, `people-schoollife`, `attendance-schoollife`, `notifications-schoollife` | academic, people, attendance, notifications -> schoollife | `EnrollmentPort` + `PeriodPort` (inscription, niveau de la classe, effectif, périodes), `PeoplePort` (tutelle relue à chaque appel, périmètre d'enseignant = classes affectées de people ∩ inscriptions vivantes d'academic, tuteurs d'un élève, noms), `StudentStatusPort` (`people.changeStudentStatus`, UNIQUEMENT sur un acte humain), `AttendanceViewPort` (VUE d'absences en lecture seule, jamais copiée), `NotificationPort` (envoi manuel de `notifications` dans la transaction ; texte neutre, jamais le motif ; échec explicite si personne n'est joignable) ; échec FERMÉ `schoollife.port_unavailable` sans adaptateur |
| `reportcards-higher` | reportcards -> higher | `SignatoryDirectory`, `InstitutionPort` |
| `reportcards-higher-documents` | higher -> reportcards ; reportcards -> higher | `DocumentFilesPort` (scellement Ed25519 de l'empreinte du snapshot, index de vérification publique, rendu PDF par gabarit de plateforme, URL signée) ; `ExternalDocumentVerifier` (vérification publique d'un diplôme ou d'une attestation : lecture sous la RLS du tenant, signature et empreinte revérifiées, aucune donnée personnelle) |
| `results-academic` | results -> academic | `PromotionDecisionPort` (décisions de passage lues dans `results` pour la reconduction annuelle : jamais calculées par academic) |
| `analytics-sources` | tenancy, academic, people, results, attendance, finance, payroll -> analytics | `AnalyticsSourcePorts` (périmètres, calendrier, inscriptions + sexe, résultats FINAL + décisions confirmées, appels et présences du personnel, reporting financier, caisse, masse salariale, charge d'enseignement) : lectures seules, séquentielles ; un port manquant = passe `UNAVAILABLE` et manque déclaré |
| `storage` | stockage d'objets -> attendance, people, reportcards | S3 / MinIO configurable par l'environnement, repli disque en développement |
| `people-messaging`, `academic-messaging` | people, academic, rbac, iam -> messaging | `PeopleDirectory` (profils d'acteurs : élève, tuteur, personnel affecté ; personnes joignables d'une classe ; titulaires de rôles ; tuteurs d'un élève), `AudienceDirectory` (cibles d'annonce -> comptes) : liens réels, comptes suspendus exclus |
| `storage` | stockage d'objets -> attendance, people, reportcards, messaging, documents | S3 / MinIO configurable par l'environnement, repli disque en développement ; vue `asDocumentsStorage` (écriture, lecture, suppression, URL signée) |
| `imports-people`, `imports-academic`, `imports-assess`, `imports-finance` (+ `imports-support`) | people, academic, assess, finance -> imports | `ImportTargetPort` par importeur : `plan` (lecture seule : transaction toujours annulée) et `apply` (écriture d'UNE ligne par l'API PUBLIQUE du module cible, avec le vrai audit : `runtime.auditPort` dans l'API, le service d'audit du processus dans le worker) ; dépendances d'écriture construites sur le kit de lecture et les ports de la plateforme ; appels séquentiels |
| `storage-scan` | antivirus -> messaging, people, attendance | enveloppe `withMalwareScan` des vues de stockage : un fichier infecté est refusé avant écriture ; politique fail-closed en production quand un antivirus est configuré |
| `people-documents` | people, iam -> documents | `OwnerDirectory` : propriétaires (élève, personnel), tuteurs d'un élève, enfants liés d'un compte, personnes à partager ; liens relus à chaque requête |
| `admissions-people` | people -> admissions | `StudentRegistry` : `findDuplicateStudents` (score et raisons), `createStudent` (élève **INACTIF**, matricule gapless de people), `createGuardian` + `linkGuardian`, `changeStudentStatus` ; `ActorDirectory` (nom figé d'une décision). Écriture par les cas d'usage publics, dans la transaction d'admissions |
| `admissions-academic` | academic, tenancy, people -> admissions | `EnrollmentService` (`enrollStudent` PENDING avec `sourceKind: ADMISSION`, annulation d'une inscription en attente) ; `InstitutionCatalog` (établissements, niveaux, classes, liens de parenté). Les statuts d'élève inscriptibles sont étendus à `INACTIVE` pour ce seul flux |
| `admissions-finance` | finance (+ academic) -> admissions | `RegistrationFeeService` : frais d'inscription dus ? (`isRegistrationFeeDue`), facture `REGISTRATION` idempotente par offre (`issueInvoiceFromSchedule`), annulation (`cancelInvoice`) ; barème indéterminé = échec fermé |
| `admissions-documents` | stockage d'objets, documents -> admissions | `DocumentStore` : type RÉEL par les octets (`detectFileType`), liste blanche de la pièce, taille, SHA-256, antivirus de la plateforme, écriture de l'objet ; `link` = non rattaché tant que `documents` n'expose pas le rattachement |
| `admissions-notifier` | notifications -> admissions | `ApplicantNotifier` : mise EN FILE par `enqueueInTx` (e-mail, SMS, WhatsApp ; gabarit `announcement`, texte neutre) ; aucune coordonnée joignable : échec fermé `admissions.channel_unavailable` (`SKIPPED` / `CHANNEL_UNAVAILABLE`), aucune simulation |
| `entitlements-documents` | entitlements -> documents | `UsageReporter` : jauge `STORAGE_BYTES` ; paliers de quota selon les features `documents.storage.*` |
| `examinations-finance` | finance -> examinations | `ExamFeesPort` (Q-E13, frais d'examen intégrés à l'inscription) : `listFeeCatalog` (EXAMS), `issueInvoiceFromSchedule` (idempotent par clé `exam-fee-<candidat>`), `getInvoiceById` (paiement relu en direct), `cancelInvoice` (jamais une facture encaissée : remboursement manuel). Dépendances d'**écriture** de `finance` (vrai audit, vrais annuaires d'apprenants et d'inscriptions). Un candidat libre sans compte famille : `MANUAL_REQUIRED`, aucune donnée personnelle transmise |
| `examinations-directories`, `examinations-rules`, `examinations-assess`, `examinations-documents` | academic, people, tenancy, iam, rules, assess, documents, reportcards -> examinations | `StudentDirectory` (inscription, classe, état civil figé à l'inscription à l'examen), `EligibilityFactsPort` (**attend** `academic.getEligibilityFacts`, échec fermé sinon), `InstitutionDirectory`, `FamilyLinks` (tutelle relue à chaque requête), `RulesPort` (contrat `exam-national@1`), `AssessPort` (notes publiées d'un examen blanc), `PieceDocumentPort`, `OfficialDocumentPort` (**attend** les natures `EXAM_CONVOCATION`, `EXAM_SUCCESS_CERTIFICATE`, `EXAM_TRANSCRIPT` de `reportcards`, échec fermé sinon) ; stockage = vue `asDocumentsStorage` |
| `storage` | stockage d'objets -> attendance, people, reportcards, messaging | S3 / MinIO configurable par l'environnement, repli disque en développement |
| `academic-primary` | academic (+ people, tenancy) -> primary_school | `ClassroomPort` (classe, effectif nommé daté, inscription, périodes d'enseignement, année, établissements du pack), `PeriodStatePort` (état EFFECTIF classe × période, échec fermé), `OutcomePort` (issue d'inscription) |
| `people-primary` | people -> primary_school | `TeachingPort` (instituteur d'un compte, affectation, titulaire `HOMEROOM`, équipe de classe), `GuardianshipPort` |
| `results-primary` | results (+ academic, rules, attendance) -> primary_school | `ResultsPort` (délibération COUNCIL, propositions de la règle, confirmation, résultat d'année, origine du jeu de règles), `RulesPort` (quorum `quorum_conseil`, motifs `cas_limite` / `cas_absences` / `cas_deja_redoublant` ; sans contrat publié : aucune règle liée) |
| `attendance-primary` | attendance (+ academic) -> primary_school | `AttendancePort` (récapitulatif d'année par somme des périodes, registre d'appel mensuel `DAILY`) |
| `reportcards-primary` | reportcards -> primary_school | `DocumentsPort` (PV `COUNCIL_MINUTES`, bilan `ANNUAL_REVIEW`, périodes publiées) : **échec fermé** tant que ces natures ne sont pas dans `OFFICIAL_DOCUMENT_KINDS` |
| `primary-academic` | primary_school -> academic | `ClassroomActivationGuard` : « classe du primaire active => titulaire » (`checkHomeroomForActivation`) ; refus 409 `primary_school.homeroom_required`, dérogation d'établissement auditée |
| `primary-results` | primary_school -> results | `CompetencyCountersPort` : compétences évaluées / attendues par inscription (`getCompetencyCounters`), entrée de la décision de fin d'année `competency-period@1` |
| `academic-stateassign` | academic -> stateassign | `EnrollmentPort` (faits d'inscription, période) et `EnrollmentFundingPort` (référence d'affectation portée par l'inscription, après vérification humaine) |
| `finance-stateassign` | finance -> stateassign | `FinancePort` : factures de l'inscription (nettes des avoirs) et paiements `CONFIRMED` du financeur ; la facture famille ne porte que la part parent |
| `attendance-stateassign` | attendance -> stateassign | `AttendanceFactsPort` : faits de présence d'une période (jamais calculés par stateassign) |
| `documents-stateassign` | documents -> stateassign | `DocumentRefPort` : pièces d'un dossier d'affectation |
| `people-stateassign` | people, iam -> stateassign | `StudentNamesPort`, `GuardianshipPort` (vue famille : lien relu à chaque requête) |
| `academic-councils`, `tenancy-councils` | academic, people, tenancy -> councils | `AcademicPort` (classe, période, effectif nommé et daté, inscription, nom de l'établissement) et `OutcomePort` (issue d'inscription, redirection par les DONNÉES d'academic, changement de classe) ; modèle de pack `councils` de tenancy avec repli sur le modèle livré |
| `results-councils` | results, rules, academic -> councils | `ResultsReadPort` (instantané de période et d'année, signatures de règles), `ResultsWritePort` (décisions et appréciations par l'API d'écriture de `results`, scellement du PV `COUNCIL_MINUTES`), `RuleCodesPort` (codes de décision du jeu de règles : aucune valeur réglementaire dans `councils`) |
| `attendance-councils`, `schoollife-councils` | attendance, schoollife -> councils | VUES en lecture seule (comptages d'absences et de retards, comptages et codes disciplinaires) ; jamais de texte libre ni d'élément confidentiel |
| `people-councils` | people -> councils | `StaffPort`, `FamilyPort` (tutelle relue à chaque appel, échec fermé), `StudentStatusPort` (UNIQUEMENT sur un acte humain) |
| `notifications-councils`, `reportcards-councils`, `storage-councils` | notifications, reportcards, storage -> councils | notification des tuteurs (texte neutre), rendu et scellement du PV, dépôt du fichier ; échec FERMÉ `councils.port_unavailable` (409) sans adaptateur |

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
| people | `application/contacts.ts` : `listNotificationContactsOfStudents / Staff / Identities` (lectures seules, jamais exposées par une route) | coordonnées de remise des notifications : tuteur avec ou sans compte |
| finance | `application/overdue-feed.ts` : `listOverdueInstallments`, `isInstallmentOverdue` | relances par paliers et alertes de retard ; arrêt dès paiement |
| messaging | `application/delivery-feed.ts` : `readAnnouncementForDelivery` | relais d'une annonce sur les canaux externes (destinataires figés) |
| schoollife | registre de ports (`registerSchoolLifePorts`, lu à chaque requête) ; `index.ts` : `getStudentLifeSummary`, `getClassroomLifeSummary`, `getDisciplineFacts`, `getConductPoints`, `isStudentExcludedOn` (comptages et codes, jamais de texte libre ni d'élément confidentiel) | conseil de classe (`councils`), bulletins, examens, présences ; aucun abonné ni job du worker (le worker n'a pas de port schoollife) |
| notifications | registre de ports (`registerNotificationsPorts`, `setNotificationsWorkerPorts`) ; spec `016-communications` partie B | annuaire des destinataires, sources des relances et alertes ; abonnés et jobs du worker |
| assess, results | `isCurriculumNodeInUse`, `isCurriculumNodeInResults` | garde d'usage d'un nœud de curriculum |
| reportcards | `infrastructure/worker-resources.ts` (stockage et ressources de rendu du worker) | le worker n'a pas de Fastify |
| people | `application/audience.ts` (`listAudienceOfStudents`, `searchAudienceIdentities`) | la messagerie joint les tuteurs et les élèves par leur COMPTE (`persons.identity_id`) : le DTO des tuteurs ne portait pas l'identité |
| messaging | registre de ports (`registerMessagingPorts`, `setMessagingWorkerPorts`) ; spec `016-communications` | annuaire des personnes, audiences, stockage ; abonnés et jobs du worker |
| people | `resolveStudentRefs` (matricule d'origine ou de la plateforme -> élève, par lots de 500) ; spec `031-imports` | importeurs de tuteurs, de notes et de soldes d'ouverture : résolution des références d'un fichier sans accès à la table |
| tenancy | abonné `tenancy.onboarding-on-import-completed` (`application/onboarding-events.ts`) ; `events.consumes: ["imports.run.completed"]` | complétion par événement des étapes d'onboarding « Importer les élèves / les enseignants » |
| councils (fournisseur) | `index.ts` : `councilsPortUnavailable`, registre de ports (`registerCouncilsPorts`, `setCouncilsWorkerPorts`) ; événements `councils.council.*`, `councils.decision.*`, `councils.minutes.*` | résultats de décision et PV scellé exposés aux bulletins, aux examens et aux portails ; abonnés et jobs du worker |

### Vérification

`test/adapters/adapters.unit.test.ts` (traductions pures), `test/adapters/chain.integration.test.ts` (people + academic -> assess -> results -> reportcards / higher, avec les **vraies** règles nationales sur une base migrée par toutes les migrations v2), `test/adapters/operations.integration.test.ts` (finance -> academic, scheduling <-> attendance <-> payroll, bulletins) et, dans `test/phase1/`, `assembly.integration.test.ts` [D9] (aucun port obligatoire ne manque) et `worker-bundle.integration.test.ts` (build et démarrage réels du bundle).

### Extensions des modules du cœur pour les packs Primaire, Secondaire, Examens (Phase 4-5)

Extensions **additives et rétro-compatibles** demandées par les specs 005, 006, 007 et 018 aux modules existants, pour que les nouveaux modules de packs (`primary_school`, `admissions`, `examinations`, `councils`, `schoollife`, `stateassign`) s'appuient dessus. Les 4 packs partagent le cœur : aucun comportement antérieur ne change (les seuls tests modifiés comptent des objets livrés : jeux de règles, contrats, gabarits, rôles système, migrations).

| Module | Ce qui est livré | Où |
|---|---|---|
| `rules` | `source_kind = placeholder` ; **refus de liaison d'un jeu fictif en production sans accusé** (`rules.placeholder_requires_ack`, permission sensible `rules.binding.accept_placeholder`, audit, événement) ; contrats `coef-period@1`, `competency-period@1`, `exam-national@1`, `secondary-annual@1` ; jeux fictifs `CI-PRIMARY-PLACEHOLDER`, `CI-SECONDARY-PLACEHOLDER`, `CI-EXAM-PLACEHOLDER` ; liaison par cycle d'enseignement ; `applyPackPlaceholderBindings` | migration `1004` ; spec 012 |
| `results` | pipelines des trois contrats (aucune formule) ; `COUNCIL_REVIEW` jamais décision finale ; `ruleSourceKind` (vue de période, bundle FINAL) ; **port d'écriture des conseils** (`publishYearDecision`, `recordDistinction`, `writeCouncilAppreciation`, `openCouncilDeliberation`, `markDeliberationHeld`) ; `evaluateCouncilQuorum` ; ports facultatifs `YearFactsPort` (adaptateur `results-year-facts.ts`) et `CompetencyCountersPort` (à brancher par `primary_school`) | migration `1204` ; spec 011 |
| `reportcards` | natures `COUNCIL_MINUTES`, `ANNUAL_REVIEW`, `EXAM_CONVOCATION`, `EXAM_SUCCESS_CERTIFICATE`, `EXAM_TRANSCRIPT` (service générique, vérification publique étendue) ; gabarits en données dont `report-primary` ; filigrane et mention « règles de démonstration » ; « Affecté(e) » dérivé du financement de l'inscription | migration `1305` ; spec 013 |
| `academic` | `calculationContract` des modèles CI/PRIMARY (`coef-period@1`, `competency-period@1`) et CI/SECONDARY (`secondary-annual@1`) ; niveaux `terminalExamRequired` (3e, Tle) ; port optionnel `classroomActivation` (`ClassroomActivationGuard`, repli : aucun refus) à brancher par `registerAcademicPorts` (adaptateur `people` / `primary_school` : titulaire de classe) ; `cancelEnrollment` d'une inscription `PENDING` (événement `academic.enrollment.cancelled`) ; `getEligibilityFacts`, `countRepeatsInCycle` ; poids de moyenne des périodes (`average_weight`, `slots[].averageWeight`) ; inscription d'un élève `INACTIVE` **seulement** par une admission (`sourceKind = ADMISSION`) ; `tenancy.getPackTemplateSection(pack, educationSystem, section)` (sections de modèle de pack par module, validées par le module propriétaire) | migration `0709` ; spec 004 |
| `people` | `createStudent` avec `initialStatus` (`INACTIVE`) et `id` fourni par l'appelant (jamais par HTTP) ; `INACTIVE → ACTIVE` ; `findDuplicateStudents` avec score et raisons ; `getStudentAgeOn` / `ageInYearsOn` (date de référence fournie par la règle) ; `SUSPENDED` / `EXCLUDED` exigent un motif et un acteur humain ; titulaire généraliste (`HOMEROOM` + `covers_all_subjects`) dans `getResponsibleForNode` | spec 008 |
| `attendance` | politique d'appel `PRIMARY_DAILY` (modèle de pack `attendance/templates/CI/primary.json`, instanciée au provisioning) ; `getAttendanceDays` / `getAttendanceDaysForEnrollments` (entrées de la règle `cas_absences`) ; le calendrier fournit `openDays` quand il existe | spec 010 |
| `finance` | `getRegistrationFeeStatus.status` (`NOT_BILLED` avant facturation) ; `issueInvoiceFromSchedule` idempotent par clé d'offre ; `cancelInvoice` sans paiement ; `instantiateFinancePack` (catégories `REGISTRATION` et `TUITION`, aucun montant) | spec 014 |
| `rbac` | rôle système `instituteur` (12 modèles) ; permissions **réservées** des modules à venir (`rbac/templates/reserved-permissions.ts`) : elles restent en attente (`rbac.role_pending_permissions`, journal `info`) jusqu'à la livraison du manifeste, puis sont résolues par `syncRbac` dans tous les tenants | README rbac |

**Livrer un module de pack** : déclarer les clés de permission exactes de la liste blanche de `rbac` puis **les retirer** de `RESERVED_FOR_UPCOMING_MODULES` (sinon le test de non-oubli échoue : le message dit quoi faire), étendre l'oracle de `system-roles.test.ts`, justifier les permissions sensibles accordées ; brancher ses ports (`results.competencyCounters`, `academic.classroomActivation`) ; appeler `rules.applyPackPlaceholderBindings` à l'activation du pack (hors production : libre ; en production : accusé explicite) ; choisir le gabarit de bulletin `report-primary` dans la configuration de gabarit du tenant ; passer `ruleSourceKind` à `requestOfficialDocument` pour tout document calculé par un jeu de règles.

**Environnement** : `RULES_ENV` (sinon `NODE_ENV`) décide si la liaison d'un jeu de règles de démonstration exige un accusé ; **défaut sûr : production** (seuls `development`, `dev`, `test`, `demo`, `demonstration`, `staging` l'ouvrent).

**Limites connues** : les natures de documents des packs n'ont pas de route HTTP propre (le module propriétaire appelle le service) ; le plan de périodes distingue le poids de **répartition des dates** (`weight`, entier) du poids de **moyenne** (`averageWeight`) — la spec 005 les confondait ; `cancelInvoice` n'est pas idempotent (un second appel renvoie `finance.invalid_transition`, que les admissions doivent tolérer) ; `instantiateFinancePack` et `applyPackPlaceholderBindings` sont câblés depuis la phase 3 par des abonnés de `tenancy.institution.created` (`finance.instantiate-pack`, `rules.apply-pack-bindings`), non à `tenancy.tenant.provisioned` (le pack est une propriété de l'établissement).

### Données de démonstration (`pnpm seed:v2`)

`ALLOW_SEED=1 pnpm seed:v2 --pack HIGHER|PRIMARY|SECONDARY [--seed n] [--slug s] [--year-start AAAA-MM-JJ]` (`scripts/seed-v2.ts`) démarre la plateforme EN PROCESSUS (API + worker) et crée un établissement complet par l'API HTTP publique, sans SQL direct : organisation et abonnement, année et périodes, programme et curriculum publié, classe, élèves, tuteurs et enseignants, inscriptions confirmées par les règlements, factures, emploi du temps, appels, notes publiées, comptes de test par rôle. Il REFUSE de s'exécuter sans `ALLOW_SEED=1` et si le nom de la base de `V2_DATABASE_URL` ne finit pas par `_dev`, `_test` ou `_local`. Il exige `REDIS_URL` et les secrets de l'API (`IAM_JWT_SECRET`, `IAM_MFA_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY`). Les mots de passe des comptes de test (et les secrets TOTP des rôles à MFA) sont générés à l'exécution et affichés une seule fois. Relancé sur le même `--slug`, il ne crée rien. Mêmes graine et début d'année = mêmes données métier (empreinte affichée). PRIMARY et SECONDARY : structure et données disponibles, sans résultats ni bulletins (pas de jeu de règles dans cette version). Test : `test/seed/seed-v2.integration.test.ts`.

## 12. Observabilité (ADR-009)

Décision : `docs/adr/ADR-009-observabilite.md` ; exploitation (SLO, alertes, procédures) : `runbook-exploitation.md` ; règles et tableau de bord : `infra/observability/`. Code : `apps/api/src/platform/observability/` (cœur sans Fastify dans `core/`, partagé avec `apps/worker/src/observability/`) et `packages/kernel/src/logger.ts` (redaction pure).

| Besoin | Mécanisme |
|---|---|
| Une ligne de journal retrouve la requête, l'événement et le job | `request_id` (`x-request-id` ou UUID v7) = `RequestContext.requestId` = `kernel.domain_events.request_id` ; le relais le transmet au job ; un contexte créé sans identifiant dans un abonné (`createSystemContext`) hérite du `request_id` ambiant (`setAmbientRequestIdProvider`) |
| Une trace relie HTTP -> outbox -> worker | colonne `kernel.domain_events.traceparent` (migration worker `0604`), écrite par `PgOutboxWriter` quand le traçage est actif ; spans `METHOD <route>` -> `outbox publish` -> `route` -> `handle <abonné>` |
| Aucune donnée personnelle | `sanitizeForLog` (clés et valeurs), journal d'accès sans URL ni requête, exportateur de spans filtrant ; `assertNoForbiddenLogContent` dans les tests |
| Santé | `GET /health` (liveness), `GET /ready` (PG, Redis, migrations, worker, stockage) sur l'API et sur le worker |
| Métriques | `/metrics` protégé (jeton ou port dédié loopback) ; modules = étiquette `module` dérivée du préfixe `/api/v1/<clé>` |

Ordre d'amorçage de l'API (`src/index.ts`) : `config/bootstrap-env` (charge `.env`) puis **`platform/observability/bootstrap`** (avant Fastify et `pg` : les instrumentations ne patchent que les modules chargés après elles), puis le plugin `observability` **en premier** (ses hooks ne couvrent que les routes déclarées après lui ; ses routes `/health`, `/ready`, `/metrics` sont déclarées publiques pour le middleware d'authentification legacy). Le serveur de santé du worker est rattaché au même cœur.

Le plugin n'est pas enregistré par `registerV2Platform` : les tests d'assemblage (`test/phase1`, `test/phase2`) bootent sans lui, sauf `test/observability/correlation.integration.test.ts`, qui boote la plateforme complète **avec** observabilité et vérifie la corrélation de bout en bout (même `request_id` et même trace de la requête HTTP aux abonnés du worker, aucun champ interdit dans les journaux, `/ready`, `/metrics`, jauges).

## 13. Parcours des packs Primary et Secondary (phase 3)

Preuve exécutable : `apps/api/test/phase3/` (`pnpm test:phase3`, job bloquant `phase3`), même harnais que la phase 2 (plateforme assemblée, worker en processus, Postgres + Redis jetables, comptes IAM réels, tout par HTTP).

| Parcours | Enchaînement prouvé |
|---|---|
| `primary.integration.test.ts` (43 tests) | provisionnement avec le **modèle de pack** (référentiels `academic` et `primary_school`, catégories de frais `finance`, liaisons de règles `rules`, politique d'appel journalier `attendance`, tous appliqués par événement) -> année, curriculum de la maternelle -> **garde d'activation** (409 sans titulaire, dérogation auditée) -> admission (candidature, consentement, décision, offre, saga d'inscription, frais d'inscription payés, `ENROLLED` dérivé, notifications mises en file) -> appel journalier (séparation saisie / validation) -> compétences (saisie en lot idempotente, validation, ligne validée gelée) -> résultats (**compteurs de compétences** de `primary_school` dans la décision de fin d'année) -> conseil des maîtres (présence signée, décisions humaines avec justification, PV) -> bilan annuel **scellé** (PDF, vérification publique « démonstration », immuabilité) -> archive gelée -> accès famille -> second tenant (appels croisés, RLS sur 13 tables) |
| `secondary.integration.test.ts` (31 tests) | modèle de pack Secondary -> curriculum à coefficients -> admission -> notes (circuit de validation) -> résultats par `CI-SECONDARY-PLACEHOLDER` (`secondary-annual@1`) -> bulletins signés (filigrane) -> vie scolaire (incident, mesure proposée, **validée par un humain** différent du proposant, effet sur le statut `AWAITING_HUMAN` puis appliqué, base qui refuse un acteur système, avis aux tuteurs neutre) -> élève affecté par l'État (dossier vérifié, facture scindée, rapprochement `BALANCED`, créance, versement de l'État rapproché, vue famille sans montants) -> examens (éligibilité par les faits d'`academic`, examen blanc calculé par la règle) -> second tenant (RLS sur 16 tables) |

**Aucune règle officielle n'est inventée** : toutes les liaisons visent des jeux `source_kind = placeholder` ; le bandeau (`ruleSourceKind` de la vue de période, `demonstration: true` de la vérification publique, filigrane scellé avec le document) est asserté. Les types d'événements de vie scolaire et le type d'examen du parcours Secondary sont des DONNÉES de test marquées `isPlaceholder` / `placeholder`.

**Défauts d'assemblage trouvés et corrigés par ces parcours** :

1. **Documents officiels scellés dans la transaction d'un module de pack** (`primary_school`, `examinations`) : la première demande du processus enregistre la clé publique et les gabarits de plateforme (tables globales, acteur `system`), ce qui change d'identité dans une transaction -> `TX_IDENTITY_SWITCH` (500). Correctif : `warmOfficialDocuments` (adaptateurs) lancé au démarrage de l'API et du worker, hors transaction ; les adaptateurs attendent la même promesse. L'amorçage des gabarits est de plus sans course (`ON CONFLICT DO NOTHING`) : l'API et le worker démarrent ensemble.
2. **Filigrane de démonstration non imposé** : `primary_school` et `examinations` passaient `ruleSourceKind` dans le contenu au lieu de l'option de `requestOfficialDocument` ; le document n'était donc pas marqué. Corrigé (provenance scellée avec le document).
3. **Éligibilité d'examen toujours `port_unavailable`** : l'adaptateur appelait `academic.getEligibilityFacts` avec un objet au lieu de l'identifiant (les tests injectaient un faux `academic`).
4. **Garde d'activation insatisfiable** : `people` refusait tout titulaire sur une classe en brouillon ; or la garde exige un titulaire AVANT l'activation. Le titulaire généraliste (`HOMEROOM`, sans nœud) est accepté en brouillon.
5. Registre d'appel mensuel sans noms d'élèves (la liste d'appel d'`academic` n'en porte pas) : résolus par `people`.

**Branchements livrés** : `academic.classroomActivation` <- `primary_school` ; `results.competencyCounters` <- `primary_school` ; `admissions.notifier` -> `notifications` ; abonnés `finance.instantiate-pack` et `rules.apply-pack-bindings` (modèle de pack, sur `tenancy.institution.created`) ; lectures de solde de `finance` (`getLearnerStanding`, `getLinkedInvoicesTotals`, `getBilledAmounts`). Complétude vérifiée par `test/adapters/adapters.unit.test.ts` (aucun port déclaré « indisponible » n'est resté sans adaptateur, hors exceptions justifiées).

**Ce qui reste (à arbitrer, rien n'est simulé)** :

- `admissions` `DocumentStore.link` : non branché. `documents.createDocument` exige un humain (`created_by` NOT NULL) alors que le rattachement se fait dans l'abonné `admissions.derive-enrolled` (acteur système). Les pièces restent dans le stockage d'admissions.
- `attendance` ne consomme pas `schoollife.measure.validated` : la qualification des absences d'une exclusion est la question métier ouverte Q6-19.
- Aucun abonné de `notifications` pour les événements de `stateassign` (`reconciliation.discrepancy`, `receivable.overdue`, `control.due`, `control.anomaly_detected`) ni de `schoollife` (suggestion de convocation sur `attendance.alert.triggered`).
- `stateassign.gateway` (`NotConfigured`) et `admissions.captcha` (aucun prestataire) restent volontairement fermés.
- Dates d'effet : les jeux de démonstration ne sont effectifs qu'à partir du 2026-09-01 (`PLACEHOLDER_EFFECTIVE_FROM`) ; une année plus ancienne n'a aucune règle applicable (`results.no_active_ruleset`). Les liaisons posées par le modèle de pack valent depuis 2000-01-01 ; en production elles exigent un accusé explicite (non posé par l'abonné : à faire par l'établissement).
- Le lien de réponse à une offre figure dans le contenu mis en file du journal de `notifications` (rendu du message).
- Une admission crée l'inscription à la date du jour : les appels des jours antérieurs n'existent pas pour cet élève.
