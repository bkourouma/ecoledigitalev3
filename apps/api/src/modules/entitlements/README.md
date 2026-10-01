# Module `entitlements`

Plans, packs, features, abonnements, surcharges et **mesure d'usage**. Socle (`CORE`),
`dependsOn: ["tenancy"]` (statut du tenant lu via l'`index.ts` de `tenancy`). Schéma
Postgres : `entitlements`. Le socle **autorise et mesure** ; il ne facture pas (spec 027).

Références : plan §3.5, ADR-001/002/004/006/007.

## Tables

| Table | Portée | Rôle |
|---|---|---|
| `plans` | **globale** | STARTER, PROFESSIONAL, ENTERPRISE (seed) |
| `packs` | **globale** | PRIMARY, SECONDARY, HIGHER, VIRTUAL (seed) ; `CORE` est implicite |
| `features` | **globale** | alimentée par `syncFeatureCatalog(manifests)` ; jamais supprimée (`retired_at`) |
| `plan_features` | **globale** | features accordées par un plan |
| `tenant_subscriptions` | tenant, RLS | plan, packs souscrits, période, statut, tranche d'apprenants. Un seul abonnement « vivant » par tenant (index unique partiel) |
| `tenant_feature_overrides` | tenant, RLS | GRANT / DENY, **motif obligatoire**, expiration facultative ; une par (tenant, feature). `feature_key` sans FK (le test d'isolation générique ne dépend pas du catalogue) : `setFeatureOverride` refuse les clés inconnues ou retirées, le calcul ignore une surcharge sur une clé inconnue |
| `usage_counters` | tenant, RLS | apprenants actifs, stockage, SMS, par mois UTC |

Migrations : `0151_entitlements_catalog.sql`, `0152_entitlements_tenant_tables.sql`
(numéros globaux à tous les modules : tenancy = `0100-0149`, entitlements = `0150-0199` ; database 0001-0099, rbac 0200-0299, audit 0300-0399, iam 0400-0499, finance 0500-0599, worker 0600-0699).
Les 4 tables globales sont déclarées avec justification dans
`apps/api/src/modules/isolation-allowlist.entitlements.ts`.

## Règle de calcul des droits (fonction PURE `computeEntitlements`)

1. Les features **CORE** (`packs` contient `CORE`) sont toujours accordées.
2. Tenant **suspendu/archivé**, **sans abonnement**, ou abonnement **inactif** (statut ≠
   `ACTIVE`/`TRIALING`, pas commencé, échu) ⇒ **uniquement CORE** — les surcharges ne s'appliquent pas.
   (`PAST_DUE` n'accorde rien : la tolérance de paiement relève de la facturation, spec 027.)
3. Abonnement actif : `CORE ∪ plan_features(plan) ∪ features des packs souscrits`, puis les
   surcharges **non expirées** : `GRANT` ajoute, `DENY` retire — sauf une feature CORE (jamais retirée).
4. Une feature **retirée** du catalogue n'est jamais accordée ; une surcharge sur une feature
   inconnue est ignorée.
5. Chaque feature accordée porte sa **source** (`CORE > PLAN > PACK > OVERRIDE`) ; le résultat
   porte `validUntil` (prochaine échéance sans événement) qui borne le cache.

Union plan ∪ pack : si une feature doit exiger plan **et** pack, ce n'est pas exprimable
aujourd'hui (limite connue) ; on la place dans l'un des deux.

## API publique (`index.ts`)

```ts
// Droits
resolveEntitlements(tx, tenantId, clock?)     // tx ouverte SOUS l'identité de tenantId (sinon entitlements.tenant_mismatch)
hasFeature(tx, tenantId, key, clock?)
computeEntitlements(input, now)               // pure
PgEntitlementsReader / CachedEntitlementsReader   // port EntitlementsReader { getEntitlements, hasFeature }
// Garde Fastify
requireFeature("finance.online-payment")      // preHandler ; lit app.entitlements posé par le plugin
createRequireFeature(reader, resolveContext)  // variante liée explicitement à un lecteur
// Catalogue / abonnements / surcharges / usage
syncFeatureCatalog(deps, manifests, { fullSync? })
getCatalog, upsertPlan, setPlanFeatures
getSubscription, setSubscription
listFeatureOverrides, setFeatureOverride, removeFeatureOverride
recordUsage, getUsage
// Événements
onTenantProvisioned(deps, event, { planKey?, trialDays? })   // consommateur de tenancy.tenant.provisioned
```

Toutes les fonctions applicatives ont la forme `(deps, ctx, input) => Promise<Result<T, AppError>>`.

### `syncFeatureCatalog(manifests)`

Reçoit les manifestes **en paramètre** (aucune dépendance au registre) : l'appelant — le démarrage
de l'API — lui passe `registry.manifests`. Crée / met à jour / réactive les features présentes ;
**retire** (`retired_at`) celles qui ont disparu **des modules fournis** (un appel partiel ne détruit
pas le catalogue des autres) ; `fullSync: true` retire aussi celles des modules absents. Liste vide
refusée. Clés valides, uniques entre modules, packs connus : sinon rien n'est écrit.

### `requireFeature(key)` et le cache

`requireFeature` lit les droits via le port `EntitlementsReader`. Le plugin fournit par défaut
`CachedEntitlementsReader(PgEntitlementsReader)` : cache **court** (30 s) par tenant, borné en taille,
single-flight, jamais repeuplé par un calcul démarré avant une invalidation, et plafonné par
`validUntil` (un droit expiré n'est jamais servi après son échéance). Invalidation :

- **immédiate dans le process** par les use cases (`setSubscription`, `setFeatureOverride`…) ;
- **par événement** : `cache.handleEvent(event)` / `cache.bindToBus(bus)` pour
  `entitlements.subscription.changed`, `entitlements.override.changed`, `tenancy.tenant.status_changed`,
  `tenancy.tenant.provisioned` — à brancher sur le relais d'outbox pour couvrir les **autres instances**.

Refus : `403` `entitlements.feature_not_available` avec `details: { feature, reason }`
(`reason` ∈ `TENANT_SUSPENDED | NO_SUBSCRIPTION | SUBSCRIPTION_INACTIVE | …`). Le garde **envoie lui-même**
le 403 (indépendant du gestionnaire d'erreurs de l'hôte) ; une erreur inattendue est levée, jamais
transformée en autorisation. Sans plugin enregistré : erreur `entitlements.not_registered`.

## API HTTP — `/api/v1/entitlements/*`

Tenant (permission `entitlements.read`) : `GET /me` (droits effectifs), `GET /me/usage?from=AAAA-MM&to=AAAA-MM&metric=`.

Administration, réservée au **`SuperAdminAuthorizer`** (port, voir ci-dessous) :

| Route | |
|---|---|
| `GET /admin/catalog` | plans, packs, features |
| `PUT /admin/plans/:key` · `PUT /admin/plans/:key/features` | plan ; features du plan |
| `GET /admin/tenants/:tenantId/entitlements` | droits effectifs **sans cache** |
| `GET\|PUT /admin/tenants/:tenantId/subscription` | abonnement (sémantique PUT : champs optionnels absents conservés) |
| `GET /admin/tenants/:tenantId/overrides` · `PUT\|DELETE …/overrides/:featureKey` | surcharges |
| `GET /admin/tenants/:tenantId/usage` | usage |

Schémas : `packages/contracts/src/v2/entitlements.ts`.

### Le port `SuperAdminAuthorizer`

Défini dans `http/common.ts`, implémenté **ailleurs** (iam / console plateforme) :

```ts
interface SuperAdminAuthorizer {
  /** Renvoie l'identité de l'opérateur, ou LÈVE UnauthorizedError / ForbiddenError. */
  authorize(request: FastifyRequest): Promise<{ actorId: string }>;
}
```

Sans implémentation branchée, **toutes** les routes `/admin/*` répondent 403
(`entitlements.super_admin_authorizer_missing`). L'identité devient l'acteur `superAdmin` du contexte
(`TenantDb.run` sur le tenant visé : la RLS ne laisse voir que ce tenant). L'option
`adminRequiresPermission: true` exige **en plus** la permission sensible `entitlements.manage`
(MFA + audit via rbac) ; désactivée par défaut car un opérateur plateforme n'a pas de rôle de tenant.

### Initialisation du plugin

```ts
import { entitlementsPlugin, requireFeature, syncFeatureCatalog } from "./modules/entitlements";

await syncFeatureCatalog({ db }, manifests);          // au démarrage
await app.register(entitlementsPlugin, {
  db,                    // TenantDb (obligatoire)
  clock, audit, logger,  // facultatifs
  requirePermission,     // garde du module rbac (sinon app.requirePermission, sinon REFUS TOTAL)
  resolveContext,        // (request) => RequestContext (défaut : request.requestContext puis ALS)
  superAdminAuthorizer,  // PORT (sinon REFUS des routes /admin)
  reader, cacheTtlMs,    // facultatifs (lecteur personnalisé ; TTL du cache par défaut)
});
// ailleurs : { preHandler: requireFeature("finance.online-payment") }
```

Le plugin pose lui-même le préfixe `/api/v1/entitlements` (option `prefix`, ne pas en ajouter un) et **décore
l'instance racine** (`app.entitlements`) : il n'est pas encapsulé, pour que `requireFeature`
fonctionne depuis n'importe quel autre plugin.

**Sous le registre de modules** (`docs/architecture/platform-assembly.md`) : `http/plugin.ts` exporte `setup(app, runtime)`
(crée le service via `createEntitlementsService` / `buildEntitlementsDeps` et décore `app.entitlements` sur la racine,
car un décorateur posé dans le contexte encapsulé du module serait invisible des autres modules) puis
`default(app, runtime)` qui déclare les routes sans préfixe. Le `SuperAdminAuthorizer` vient du runtime.
Les routes d'administration portent `config: { public: true }` : elles ne s'authentifient pas par un contexte
tenant mais par le JWT opérateur (authorizer) ; elles échappent donc aussi à l'authentification legacy.
Worker (`subscribers.ts`) : `entitlements.start-trial` sur `tenancy.tenant.provisioned` (variables
`ENTITLEMENTS_TRIAL_PLAN` / `ENTITLEMENTS_TRIAL_DAYS`) et `entitlements.invalidate-cache.*` sur les événements
de `INVALIDATING_EVENT_TYPES` (diffusion Redis vers les API).

## Événements

Publiés (outbox, `{ v: 1, … }`) : `entitlements.subscription.changed` (état courant **et** précédent),
`entitlements.override.changed` (`effect` `null` = surcharge supprimée).
Consommés : `tenancy.tenant.provisioned` (→ `onTenantProvisioned` : essai `STARTER` de 30 jours avec
les packs choisis, idempotent ; sans ce consommateur un tenant neuf n'a que CORE — comportement sûr),
`tenancy.tenant.status_changed` (invalidation du cache).

## Audit

Les opérations sensibles (abonnement, surcharge, essai) appellent le port optionnel `deps.audit`
(`audit.record(tx, { action, entity, entityId, before, after })`), dans la même transaction :
passer `createAuditService()` du module `audit` (compatibilité vérifiée côté `tenancy`). Actions :
`entitlements.subscription.set`, `entitlements.subscription.trial_started`, `entitlements.override.set|remove`.

## Permissions (manifeste)

`entitlements.read`, `entitlements.manage` (**sensible**).

## Usage

`recordUsage(deps, ctx, { metric, amount, mode? })` — modes par défaut : `ACTIVE_LEARNERS` → `MAX`
(pic du mois), `STORAGE_BYTES` → `SET` (jauge), `SMS_SENT` → `INCREMENT` (cumul). Période = mois UTC.
Compteurs `bigint` en base, refus au-delà des entiers sûrs. La tranche d'apprenants est **mesurée, non bloquante**.

## Tests

```bash
pnpm exec vitest run --config apps/api/src/modules/entitlements/vitest.config.ts      # unitaires
node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/entitlements/vitest.config.ts   # + intégration (Docker)
```

Unitaires : `computeEntitlements` (cas ciblés **et** énumération exhaustive de 8 064 combinaisons
statut × abonnement × packs × plan × surcharges avec invariants), cache (TTL, `validUntil`, invalidation
pendant un calcul, événements, éviction), `requireFeature`, utilitaires de période, manifeste.
Intégration (`TEST_DATABASE_URL`) : catalogue/sync, essai à la création, abonnement, surcharges et
expiration, suspension, usage, HTTP de bout en bout, et `assertTenantIsolation` sur `entitlements` + `tenancy`.

## Limites connues

- Les écritures du catalogue global ne sont protégées que par l'application (`SuperAdminAuthorizer`) :
  la base accorde `INSERT/UPDATE` sur les catalogues à `app_user` (pas de `DELETE`), faute de pouvoir
  distinguer un opérateur d'un tenant à ce niveau.
- Le cache est par process : l'assemblage relaie les invalidations par Redis pub/sub (`event-fanout`) ;
  sans `REDIS_URL`, une autre instance attend l'expiration du TTL (30 s) pour voir un changement.
- Pas de plafonnement par tranche d'apprenants ni de facturation (spec 027).
- Les droits d'un tenant legacy (sans abonnement) se limitent à CORE tant qu'un abonnement n'est pas posé :
  le rattrapage au démarrage (`V2_LEGACY_TENANT_DEFAULT_PLAN`, hypothèse à valider) pose un abonnement.
