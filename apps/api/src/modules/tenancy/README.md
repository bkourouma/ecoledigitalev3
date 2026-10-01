# Module `tenancy`

Organisation (tenant), profil et branding, établissements, campus, référentiel des
pays, **provisioning par modèles de pack** et **onboarding**. Socle (`CORE`),
sans dépendance (`dependsOn: []`). Schéma Postgres : `tenancy`.

Références : ADR-001/002/004/006/007, plan §3.4 et §4 (phase 1, piste A, étape 3),
`docs/architecture/module-conventions.md`.

## Hiérarchie

```
kernel.tenants (= organisation, 1:1) ── tenancy.tenant_profiles   (raison sociale, contacts, branding, domaine)
        └── tenancy.institutions   (pack PRIMARY|SECONDARY|HIGHER|VIRTUAL, pays, système éducatif, statut)
                └── tenancy.campuses   (un campus par défaut par établissement)
tenancy.country_profiles   (GLOBAL : CI = XOF, fr-CI, Africa/Abidjan, +225, système éducatif CI)
tenancy.onboarding_steps   (11 étapes PRD §56 par tenant)
```

`tenant_id` est la clé d'isolation RLS ; établissement et campus sont des dimensions
de périmètre. Les tables de tenant passent par `kernel.enable_tenant_rls()`.

## Tables

| Table | Portée | Remarques |
|---|---|---|
| `country_profiles` | **globale** (allowlist d'isolation) | `app_user` : `SELECT` seulement ; un pays s'ajoute par migration. Seed : `CI`. |
| `tenant_profiles` | tenant, RLS | PK = `tenant_id` (1:1). `custom_domain` unique (insensible à la casse). |
| `institutions` | tenant, RLS | `UNIQUE(tenant_id, code)`. Pas de `DELETE` : on archive. |
| `campuses` | tenant, RLS | Un seul `is_default` par établissement (index unique partiel). Un trigger garantit que l'établissement appartient au **même tenant** (les FK contournent la RLS). |
| `onboarding_steps` | tenant, RLS | PK `(tenant_id, step_key)`. |

Migrations : `0101_tenancy_core.sql`, `0102_tenancy_tenant_tables.sql`.
**Les numéros de migration sont globaux à tous les modules** (loader du package
`database`). Plage réservée : tenancy = `0100-0149`, entitlements = `0150-0199`.

## Provisioning

```ts
import { provisionTenant } from "../tenancy";

const r = await provisionTenant({ db }, {
  name: "Groupe Les Lauriers", slug: "lauriers", countryCode: "CI",
  packs: ["PRIMARY", "SECONDARY"],
  adminContact: { name: "Awa Koné", email: "direction@lauriers.ci", phone: "+225 07 00 00 00 00" },
}, { requestedBy: operatorUserId /* facultatif : acteur superAdmin tracé */ });
// r: Result<{ tenantId, slug, institutions: [{ id, code, pack, defaultCampusId }], onboarding }>
```

Une seule transaction, sous l'identité du nouveau tenant : `kernel.tenants`, profil,
une institution + un campus par défaut **par pack**, onboarding (compte, établissement,
pays, type, pack = terminés), puis événements outbox. Au moindre échec **rien** n'est créé.
Slug réservé (`admin`, `api`, `www`…), slug déjà pris (`tenancy.slug_taken`), pays inconnu :
erreurs typées, sans écriture.

### Modèles de pack (`templates/`)

Un fichier JSON par pack (`primary|secondary|higher|virtual.json`), validé par Zod au
chargement (`PackTemplateSchema`) : **données, pas code**. Aujourd'hui : drapeau de pack,
modèle de nom et code d'établissement, campus par défaut. `levels` et `periods` sont
réservés (vides) pour les modules académiques. Ajouter un pack = un JSON + son entrée
dans `INSTITUTION_PACKS` (contrat) et dans les catalogues `entitlements`.
`provisionTenant` accepte des `templates` injectés (tests, surcharges).

## Onboarding (machine d'états pure : `domain/onboarding.ts`)

Étapes : `ACCOUNT, INSTITUTION, COUNTRY, INSTITUTION_TYPE, PACK, ACADEMIC_YEAR,
STUDENT_IMPORT*, CLASSES, TEACHERS*, FINANCE*, GO_LIVE` (`*` facultatives).

- une étape obligatoire exige que les obligatoires précédentes soient terminées ;
- une facultative n'est jamais bloquante et peut être ignorée (`skip`) puis reprise ;
- `GO_LIVE` exige toutes les autres étapes résolues et n'est pas ignorable ; état terminal.

Codes d'erreur : `tenancy.onboarding.{prerequisites_unmet, step_not_skippable, step_already_resolved, already_live, unknown_step}`.

## API HTTP — `/api/v1/tenancy/*`

| Route | Permission |
|---|---|
| `GET /countries` | `tenancy.institution.read` |
| `GET /profile` · `PATCH /profile` | `…read` · `tenancy.institution.manage` |
| `GET /institutions[?status=]` · `GET /institutions/:id` | `…read` |
| `POST /institutions` (201, campus par défaut inclus) · `PATCH /institutions/:id` | `tenancy.institution.manage` |
| `GET /institutions/:id/campuses` | `…read` |
| `POST /institutions/:id/campuses` (201) · `PATCH /campuses/:id` · `DELETE /campuses/:id` (204) | `tenancy.campus.manage` |
| `GET /onboarding` | `…read` |
| `POST /onboarding/steps/:step/complete` · `…/skip` | `tenancy.institution.manage` |

Schémas Zod : `packages/contracts/src/v2/tenancy.ts` (réexporté par `v2/index.ts`).
Erreurs : `{ status, code, kind, message, issues?, requestId }` (`toErrorBody` du kernel).

### Initialisation du plugin

```ts
import { tenancyPlugin } from "./modules/tenancy";

await app.register(tenancyPlugin, {
  db,                    // TenantDb (obligatoire)
  clock,                 // facultatif (défaut : horloge système)
  audit,                 // facultatif : { record(tx, entry) } du module audit
  requirePermission,     // fabrique de garde du module rbac ; à défaut app.requirePermission ; sinon REFUS TOTAL
  resolveContext,        // (request) => RequestContext ; défaut : request.requestContext puis AsyncLocalStorage
});
```

Le plugin pose **lui-même** le préfixe `/api/v1/tenancy` : ne pas en ajouter un.
**Échec fermé** : sans garde de permissions câblée, toutes les routes répondent 403
(`tenancy.permission_guard_missing`) ; sans contexte authentifié : 401.

## Événements publiés (outbox, payload `{ v: 1, … }`)

| Type | Quand |
|---|---|
| `tenancy.institution.created` | création d'un établissement (provisioning ou API), un par établissement |
| `tenancy.tenant.provisioned` | fin du provisioning (packs, ids, contact admin) |
| `tenancy.tenant.status_changed` | `setTenantStatus` (suspension, réactivation, archivage) — invalide les droits `entitlements` |

Schémas des payloads : contrats `Tenancy*PayloadSchema`.

## API publique (`index.ts`)

`manifest`, `tenancyPlugin`, `provisionTenant`, `getTenantProfile`, `updateTenantProfile`,
`listCountries`, `listInstitutions`, `getInstitution`, `createInstitution`, `updateInstitution`,
`listCampuses`, `createCampus`, `updateCampus`, `deleteCampus`, `getOnboarding`,
`completeOnboardingStep`, `skipOnboardingStep`, **`getTenantStatus(tx, tenantId)`**
(lu par `entitlements`), **`setTenantStatus`** (acteur `superAdmin`/`system` uniquement),
domaine pur (`computeOnboardingState`, `transitionOnboarding`, `planProvisioning`…),
modèles de pack (`defaultPackTemplates`, `buildPackTemplates`).

## Isolation et allowlist

`apps/api/src/modules/isolation-allowlist.tenancy.ts` : une seule table globale,
`tenancy.country_profiles` (clé + justification). Les quatre autres tables sont soumises à
`assertTenantIsolation` (structure **et** comportement : toutes testées pour de vrai).

## Tests

```bash
# unitaires (machine d'onboarding, plan de provisioning, modèles, contrats) — sans base
pnpm exec vitest run --config apps/api/src/modules/tenancy/vitest.config.ts
# + intégration (Postgres éphémère dans Docker ; ED_PG_IMAGE=postgres:17-alpine si l'image 17 n'est pas locale)
node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/tenancy/vitest.config.ts
```

Les tests vivent dans `test/` (et non `__tests__/`) pour ne pas être ramassés par Jest, qui
exécute les tests historiques de l'API. `vitest.config.ts` aliase les paquets workspace vers
leurs sources car `apps/api/package.json` ne déclare pas encore `@ecoledigitale/kernel` ni
`@ecoledigitale/database`.

## Limites connues

- Les tenants **legacy** (miroir de `public.tenants` dans `kernel.tenants`) n'ont ni profil, ni
  établissement, ni onboarding : il faudra un rattrapage (`ensure…`) lors de la tranche 2.0.
- Pas de route HTTP de provisioning ni de statut : ce sont des opérations de la console plateforme
  (autorisation `SuperAdminAuthorizer` du module `entitlements`) qui appelleront `provisionTenant` / `setTenantStatus`.
- L'audit est un port **optionnel** (`deps.audit`), structurellement compatible avec `createAuditService()` du
  module `audit` (test `audit-port.integration.test.ts`) : à passer au câblage ; actions `tenancy.tenant.provision`,
  `tenancy.institution.create|update`, `tenancy.campus.create|update|delete`, `tenancy.profile.update`,
  `tenancy.onboarding.complete|skip`, `tenancy.tenant.status`.
- Le domaine personnalisé est unique globalement mais n'est pas vérifié (DNS) ni résolu en tenant ici.
