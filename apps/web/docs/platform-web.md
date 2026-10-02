# Fondation web (`src/platform`) — piste C de la Phase 1

Tout ce qui est décrit ici est **additif** : aucune page existante n'a été migrée. Les pages passeront par tranches
verticales vers ces briques (voir `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md`, § 3.14 et Phase 1, piste C).

## 1. Tenant : une seule résolution

`src/platform/tenant/resolve-tenant.ts` (fonction pure, testée). Ordre :

1. `override` explicite (choix super-admin) ;
2. **session** (slug, sinon identifiant) ;
3. **domaine** : domaine personnalisé configuré, puis `<slug>.ecoledigitale.allianceconsultants.net` (et `<slug>.localhost` en dev) ;
4. **`NEXT_PUBLIC_TENANT_SLUG`** (développement local, déploiement mono-tenant).

Aucun repli codé en dur : sans correspondance, le résultat est `null` (« tenant inconnu »). Adaptateurs :

| Contexte | Module |
|----------|--------|
| Navigateur (`TenantContext`, `api-utils`, `fetch-interceptor`) | `platform/tenant/browser.ts` |
| Routes proxy Next (`app/api/**`) | `platform/tenant/server.ts` → `tenantFallback(request)` (dernier recours d'une chaîne `request.headers.get('X-Tenant') \|\| session.tenantId \|\| tenantFallback(request)` ; chaîne vide si inconnu) |

`useTenant()` renvoie `{ tenantSlug: string | null, status: 'resolved' | 'unknown', source }` ; l'UI doit gérer `unknown`.
`getTenantSlug()` (api-utils) **lève** `TenantUnknownError` quand le tenant est inconnu (ses appelants avaient déjà un `try/catch`).

Variables : `NEXT_PUBLIC_TENANT_SLUG`, `NEXT_PUBLIC_TENANT_BASE_DOMAINS` (domaines de base supplémentaires, séparés par des
virgules), `NEXT_PUBLIC_TENANT_CUSTOM_DOMAINS` (`hote=slug,hote2=slug2`). Voir `ENV_EXAMPLE.md`.

**Reste à migrer** (hors périmètre de cette tâche) : ~40 composants / hooks / pages qui écrivent en dur
`'X-Tenant': 'imhotepacademy'` dans leurs appels (`lib/hooks/*`, `components/assignments/*`, `components/academic/EnrollmentForm.tsx`,
`app/(dashboard)/**`, `app/payments/periods`, `app/academic/evaluations/[id]`…). L'intercepteur remplace aujourd'hui ce slug par
l'identifiant du jeton quand l'utilisateur est connecté ; ces lignes disparaîtront avec la migration du client API.
Autre valeur en dur à traiter : `'aspci'` (module RSO) dans `fetch-interceptor.ts`.

## 2. Client API typé (`src/platform/api`)

```ts
import { createApiClient, createQueryHooks } from "@/platform/api";

const client = createApiClient({ baseUrl: "", getToken, getTenant });
const hooks = createQueryHooks(client);

const { data } = hooks.useApiQuery(["students"], "/api/v1/students", { schema: StudentListSchema, query: { page: 1 } });
const create = hooks.useApiMutation({ path: "/api/v1/students", schema: StudentSchema, invalidate: [["students"]] });
```

- erreurs normalisées `ApiError { code, message, status, details, requestId }` (formats kernel, enveloppe `{error:{…}}` et anciens formats) ;
- réponse validée par un schéma Zod (`packages/contracts/src/v2/*` dès qu'ils existent) ; violation = `RESPONSE_INVALID` ;
- retries (2 par défaut, backoff exponentiel + jitter, `Retry-After`) pour GET/HEAD/PUT/DELETE et POST avec `idempotencyKey` ;
- annulation (`signal`, branchée sur react-query) et délai (`timeoutMs`) ;
- clés de cache `["api", <tenant>, ...clé]` ; aucune requête sans tenant (`TENANT_UNKNOWN`).

Instance du navigateur : `platform/api/default-client.ts` (`platformApi`, `platformHooks`) — jeton du stockage JWT historique,
`requireToken: true` (sans jeton, échec 401 local au lieu d'un appel qui déclencherait la redirection de l'intercepteur vers `/login`).
Le patch de `window.fetch` n'est **pas** retiré.

## 3. Gardes serveur (`src/platform/auth`)

```ts
// layout.tsx (server component)
import { requireRole, requirePermission, requireAccess } from "@/platform/auth/server";

await requireRole("admin", "owner");                    // /login si pas de session, /unauthorized sinon
await requirePermission("finance.payment.read");        // via GET /api/v1/rbac/me/permissions (fail-closed)
await requireAccess((session, pathname) => canAccessOwnerPath(session, pathname));
```

Le middleware pose l'en-tête interne `x-pathname` (toujours écrasé, jamais accepté du client) pour que les layouts connaissent
la route. Les gardes **complètent** les gardes client (conservés) ; la barrière réelle sur les données reste l'API.
`/select-role` n'est pas affecté : les gardes lisent `roles` comme les gardes client, et `requireSession({ requireRoleSelected: true })`
est disponible mais non activé.

Appliqué à : `app/owner/layout.tsx`, `app/tableau-de-bord/layout.tsx`, `app/professionnel/admin/layout.tsx` (nouveau).
Les anciens layouts clients ont été renommés `owner-client-layout.tsx` / `tableau-de-bord-client-layout.tsx` (contenu inchangé).

Limite App Router : un layout n'est pas ré-exécuté pour une navigation interne entre deux pages qu'il enveloppe déjà ; la garde
s'applique à l'entrée dans la section et au rechargement. Le contrôle par route (middleware avec jeton signé) viendra avec le module `iam`.

`/professionnel/admin/notes` reste ouvert aux enseignants (c'est leur écran de notation, entrée « Notes » de leur menu).

### Layouts / sections qui restent à protéger côté serveur

| Section | État actuel | Rôle attendu |
|---------|-------------|--------------|
| `app/teacher/**` | aucun layout, pas de garde | teacher |
| `app/student/**` | aucun layout, pas de garde | student |
| `app/parent/**` | aucun layout, pas de garde | parent |
| `app/payments/layout.tsx` | passe-plat | admin (+ owner) |
| `app/(dashboard)/**`, `app/academic/**`, `app/annee-academique/**`, `app/evaluations/**`, `app/courses/**`, `app/dashboard/**` | aucun layout | selon section (admin / teacher) |
| `app/_rso/**` (4 layouts) | layouts d'habillage, jeton RSO séparé | à traiter avec le module RSO |
| `app/super-admin/**` | authentification séparée (jeton localStorage, pas NextAuth) | à traiter avec le module `iam` (impersonation) |
| `app/live/**` | aucun layout | selon session |

## 4. Navigation pilotée par l'API (`src/platform/navigation`)

`GET /api/v1/rbac/me/navigation` → `MenuItem[]` (`key, label, href, permission, feature?, portal, icon?, order?`, aligné sur
`MenuDef` du kernel). L'API renvoie le menu déjà filtré par permissions et entitlements.

- `useNavigation({ portal })` : `source: "api" | "legacy"` ; endpoint absent, en erreur ou menu vide ⇒ `legacy`.
- `PlatformSidebar` : composant accessible, mobile-first.
- `SidebarGate` (branché dans `components/layout/Layout.tsx`) : **éteint par défaut**. `NEXT_PUBLIC_PLATFORM_NAV=1` l'active
  pour tous les portails, `NEXT_PUBLIC_PLATFORM_NAV=admin,teacher` pour certains seulement. Éteint : le Sidebar legacy est rendu tel
  quel et **aucune requête** n'est émise. Allumé mais API indisponible : retour au Sidebar legacy.

`usePermission(key)` / `useFeature(key)` (`src/platform/access`) lisent `GET /api/v1/rbac/me/permissions` et
`GET /api/v1/entitlements/me`, avec cache partagé ; fail-closed (`allowed: false`, `isUnavailable: true` si l'endpoint échoue).

## 5. Thème de tenant (`src/platform/theme`)

`TenantTheme` (branché dans `providers.tsx`) pose `--brand-primary`, `--brand-secondary`, `--brand-*-rgb`, `--brand-logo-url`
sur `:root` depuis `GET /api/v1/tenancy/profile` (`{ name?, theme: { primaryColor, secondaryColor, logoUrl } }`).
Valeurs validées (hex strict, logo https ou chemin interne) ; défauts EcoleDigitale (`#2563eb` / `#059669`) si le profil est absent
ou invalide. Ne touche pas à `[data-role]` / `--role-primary`. Aucun appel pour un visiteur non connecté.

## 6. i18n

Voir `docs/i18n.md`.

## 7. PWA

- `public/manifest.webmanifest`, icônes `public/icons/*` (source `icon.svg`, régénérables avec `scripts/generate-pwa-icons.mjs`).
- `public/sw.js` : met en cache **uniquement** l'app shell (`/offline`, manifeste, icônes) et les fichiers statiques Next
  **versionnés** (nom haché). Il n'intervient jamais sur `/api/`, les requêtes avec `Authorization`, les non-GET, le cross-origin,
  les flux RSC ; les navigations passent par le réseau et, hors ligne, redirigent vers `/offline?from=<page>`. Aucune page
  privée n'est écrite dans le cache. Test de non-régression : `src/platform/pwa/sw.test.ts`.
- Enregistrement (`platform/pwa/RegisterServiceWorker`) : production uniquement, ou `NEXT_PUBLIC_PWA=1`. `NEXT_PUBLIC_PWA=0` =
  interrupteur d'arrêt (désinscrit les service workers existants).
- Déconnexion : `navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_CACHES" })` purge les caches `ed-*`.
- Changer `CACHE_VERSION` dans `sw.js` quand `/offline`, le manifeste ou les icônes changent.
- File d'appel hors ligne (IndexedDB, identifiants non nominatifs, synchronisation par lot) : `src/platform/offline/`, voir `docs/v2-attendance-schedule.md`.
  Ce n'est pas un cache de réponses : le service worker reste inchangé.

## 8. Écrans d'administration v2 (`/v2/...`)

Arborescence `src/app/v2/` (pages minces) ; toute la logique est dans `src/platform/admin/**` (testée). Aucune page legacy touchée.

| Zone | Routes | Garde |
|------|--------|-------|
| Console opérateur | `/v2/platform/login`, `tenants`, `tenants/new`, `tenants/[id]`, `plans`, `audit` | jeton super-admin (client, `OperatorShell`) ; l'API (`SuperAdminAuthorizer`) reste la barrière |
| Établissement | `/v2/settings` (profil/marque), `institutions`, `onboarding`, `subscription` | `requirePermission("tenancy.institution.read")` |
| Rôles et accès | `/v2/access/roles` (+ `new`, `[id]`), `/v2/access/assignments` | `requirePermission("rbac.role.read")` |
| Audit | `/v2/audit`, `/v2/audit/[id]` | `requirePermission("audit.read")` + `FeatureGate("audit.log")` |

- **Coquille** : `admin/shell/Shell` (lien d'évitement, tiroir mobile `aria-expanded`, Échap, `PlatformSidebar`). Menu tenant =
  `rbac/me/navigation` (hrefs historiques `/admin/...` réécrits vers `/v2/...`, entrées v2 manquantes ajoutées **seulement** si la
  permission est détenue — `admin/menu.ts`). `AppLayout` n'enveloppe pas `/v2`.
- **Console** : client API **sans tenant** (`createApiClient({ tenantless: true })`, clé de cache `["api","platform",…]`), jeton
  `superAdminToken` (stockage séparé). `fetch-interceptor` traite `/api/v1/platform/*` et `/api/v1/entitlements/admin/*` comme des
  routes opérateur.
- **Extensions rétro-compatibles de `platform/`** : `useApiInfiniteQuery`, corps de mutation calculé (`body`), `tenantless` ;
  schémas alignés sur les réponses réelles (`/rbac/me/permissions` = `[{key,sensitive,scopes}]`, `/rbac/me/navigation` =
  `{portals}`, `/tenancy/profile` = `{branding}`) tout en acceptant les anciennes formes.
- **Briques** `packages/ui/src/admin` : `PageHeader`, `LoadingState/EmptyState/ErrorState`, `Notice`, `StatusBadge`, `Field`,
  `NativeSelect`, `ConfirmDialog`, `ProgressBar`, `ResponsiveTable` (tableau ≥ md, cartes en dessous).
- **Erreurs** : `admin/errors.ts` (anti-escalade, dernier propriétaire, rôle verrouillé, MFA…) ; notifications = `sonner` existant.
- **Limites** : pas de téléversement de logo (URL https) ; journal de plateforme : route de lecture absente côté API
  (`GET /api/v1/platform/audit/logs` attendue) ; périmètres « campus » affichés par identifiant court.
- **Tests** : `pnpm --filter @ecoledigitale/web test` (Vitest/RTL, API simulée) ;
  `PW_CHANNEL=msedge pnpm exec playwright test -c playwright.admin.config.ts` (smoke console + gardes, 375 px et bureau, sans API).

## 9. Authentification V2 (`NEXT_PUBLIC_AUTH_V2=1`)

Absent (défaut) : authentification **legacy**, inchangée. Plan de bascule, drapeaux, retour arrière : `docs/architecture/auth-cutover.md`.

- **NextAuth sur `/api/v1/iam/*`** (`platform/auth/iam-next-auth.ts`, `iam-server.ts`, `iam-token.ts`) : fournisseurs `credentials` (étape 1), `iam-mfa`
  (défi TOTP / code de secours), `iam-enroll` (enrôlement MFA, codes de secours transmis UNE fois) et Google (route fédérée d'iam).
  Le **refresh token vit dans le JWT chiffré de NextAuth (cookie HttpOnly)** et n'est jamais copié dans `session` ni dans le stockage de la page ;
  le jeton d'accès (15 min) circule comme avant (`session.jwtToken`, `SessionAuthSync`, `lib/jwt-storage`, fetch-interceptor : **même forme de jeton**).
- **Rotation côté serveur, jamais en rendu serveur** : elle n'a lieu que sur `useSession().update({ action: "refresh" })` (`POST /api/auth/session`,
  seul endroit où NextAuth peut réécrire le cookie). `IamSessionKeeper` (dans `providers.tsx`) la planifie 2 min avant l'échéance, sous verrou Web Locks
  inter-onglets (`lib/iam-session.ts`) ; l'intercepteur la déclenche aussi (jeton proche de l'échéance ou 401, un seul rejeu). Session sans support
  serveur (révoquée, refresh réutilisé) : retour à `/login?expired=1`. `signOut()` révoque la session IAM (`events.signOut`).
- **Actions de session** (`update({ action })`) : `refresh`, `switch-role` (utilisé par `/select-role`), `switch-tenant`, `change-password`, `disable-mfa`,
  `ack-recovery-codes`, `mfa-enabled`, `clear-error`. Tout autre champ envoyé par le navigateur est **ignoré** (le legacy acceptait n'importe quel `jwtToken`).
- **Pages** (`platform/auth/ui/*`, routes dans `app/v2/(auth)/…` et `app/auth/…`, 404 tant que le drapeau est absent) : `/login` (V2 : identifiants -> défi MFA ou
  enrôlement + QR -> codes de secours), `/v2/forgot-password`, `/v2/reset-password` et `/auth/reset-password` / `/auth/invitation` (liens e-mail de l'API),
  `/v2/account/sessions` (mes sessions actives, révocation), `/v2/account/security` (mot de passe, MFA), `/v2/account/tenants` (sélecteur d'établissement),
  `/v2/admin/members` (invitation + droits RBAC équivalents, suspension, révocation de sessions, réinitialisation MFA ; permissions vérifiées par l'API).
- **Accessibilité / mobile** : un `<main>` et un `<h1>` par page, champs étiquetés (`aria-describedby`), erreurs en `role="alert"`, cibles tactiles ≥ 44 px, focus
  déplacé à chaque étape, aucun défilement horizontal (vérifié par le test e2e).
- **Rôles** : `session.activeRole` / `roles` / `availableRoles` restent dans le vocabulaire de l'interface (legacy) ; `iamRoles` / `iamActiveRole` portent les rôles de
  l'accès IAM (`platform/auth/iam-roles.ts`, inverse strict de `legacyRoleToTemplate`).
- **Variables** : `NEXT_PUBLIC_AUTH_V2`, `NEXT_PUBLIC_GOOGLE_AUTH` (build), `IAM_SERVICE_SECRET`, `AUTH_SOCIAL_SHARED_SECRET` (serveur) — voir `ENV_EXAMPLE.md`.

## Tests

```bash
pnpm --filter @ecoledigitale/web test                       # Vitest (logique pure + hooks, jsdom)
pnpm test:e2e:auth                                          # Playwright V2 : connexion -> MFA -> navigation -> rotation -> déconnexion (faux iam, sans base ; PW_CHANNEL=msedge|chrome)
cd apps/web && pnpm exec playwright test -c playwright.pwa.config.ts   # smoke PWA (Next seul, sans API ni base)
```
Le smoke PWA utilise le Chromium de Playwright (`playwright install chromium`) ou `PW_CHANNEL=msedge|chrome`.
