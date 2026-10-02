# Revue de sécurité v2 (Phase E)

Date : 2026-10-02. Branche de travail : `worktree-agent-ae874b18ce61b1dbf` (base `feat/v2-phase-0`).

## 1. Méthode

- Lecture du code par domaine, en quatre passes indépendantes : (a) authentification et sessions (IAM, super-admin, en-têtes, CORS, cookies, legacy `/auth/*`) ; (b) isolation multi-tenant et contrôle d'accès (RLS des migrations v2, couverture des routes par `requirePermission`, IDOR, `SystemDb`, SQL dynamique) ; (c) finance (webhooks, signatures, SSRF), documents (uploads, signature Ed25519, `/verify`), imports (CSV/XLSX, ZIP, XML), notifications, worker, adaptateurs ; (d) endpoints publics (admissions, vérification de bulletins), `apps/web/src`, `infra/`, journaux.
- Chaque constat classé « corrigé » a été relu dans le code puis **reproduit par un test** avant correction (ou, pour une garde pure, couvert par un test unitaire qui échoue sans le correctif).
- `pnpm audit --prod` : résultats seulement (section 5), aucune mise à jour de dépendance.
- Aucune requête réseau externe, aucun scan. Postgres : conteneurs Docker éphémères uniquement.

Périmètre : `apps/api/src` (plateforme, IAM, rbac, tenancy, finance, documents, imports, notifications, admissions, reportcards, adaptateurs, routes legacy montées dans la même application), `apps/worker`, `apps/web/src`, `infra/`.
Les migrations v2 sont dans `packages/database/migrations/*.sql` et `apps/api/src/modules/*/migrations` (et non dans `infra/scripts/migrations`, qui ne contient que le legacy, non modifié).

Points solides constatés (pas de défaut) : 363 tables à `tenant_id` passent toutes par `kernel.enable_tenant_rls()` (ENABLE + FORCE RLS) ; les 12 fonctions `SECURITY DEFINER` fixent `search_path` ; les 1228 routes de modules ont une garde ou sont publiques avec authentification propre ; SQL dynamique paramétré (tris par table de correspondance) ; JWT IAM (HS256 seul, signature en temps constant, claims stricts) ; rotation de refresh avec détection de réutilisation ; MFA (anti-rejeu TOTP, codes de secours hachés) ; webhooks finance (HMAC, `timingSafeEqual`, idempotence, pas de SSRF) ; uploads (octets magiques, macros refusées, clés générées côté serveur, quarantaine) ; imports (ZIP inspecté, DOCTYPE/ENTITY refusés, neutralisation des formules) ; vérification Ed25519 et réponses neutres sur `/verify` ; formulaires publics (jetons CSPRNG de 79 à 256 bits, hachés, réponses uniformes) ; redaction centrale des journaux.

## 2. Synthèse

| Gravité | Constats | Corrigés | À décider / acceptés |
|---|---|---|---|
| Critique | 2 | 2 | 0 |
| Élevé | 8 | 4 corrigés, 1 atténué | 3 à décider |
| Moyen | 14 | 2 | 12 |
| Faible | 12 | 2 | 10 |

## 3. Constats critiques et élevés

### SEC-06 Critique, corrigé. Escalade vers `owner` par l'invitation de portail
- `apps/api/src/modules/people/application/accounts.ts` (`provisionPortalAccount`), `people/infrastructure/iam-account-provisioner.ts:38-70`, `packages/contracts/src/v2/people.ts:728-736`.
- Le corps `role` était une chaîne libre (simple regex). La garde HTTP ne vérifie que la permission sur la **qualité** de la personne (`guardian.manage`, `student.update`, `staff.update`, que détient un secrétariat) ; le rôle est ensuite attribué sous un contexte `system`, sans l'anti-escalade de `assignRoleUseCase`. Un secrétariat pouvait donc créer un tuteur à son adresse et s'inviter avec `{"role":"owner"}`.
- Correctif : liste blanche `PORTAL_ROLES = parent, eleve, enseignant, educateur` (`accounts.ts`), échec `role_not_portal` avant tout appel à iam/rbac.
- Test : `people/test/unit/portal-role-escalation.test.ts`.

### SEC-03 Critique, corrigé. Lecture de fichiers hors dossier, sans authentification (routes legacy `/api/v1/files/*`)
- `apps/api/src/routes/files.ts` (routes `/:tenantId/:courseId/submissions/:filename`, `/:tenantId/:courseId/:filename`, `/download/...`, `/serve-file`) et `plugins/auth-middleware.ts` (préfixe `/api/v1/files/` exempté du JWT).
- `%2F` est décodé dans un paramètre de route : `GET /api/v1/files/t/c/submissions/..%2F..%2F..%2Fsec03-secret.txt` renvoyait le contenu d'un fichier hors de `uploads/` (reproduit : le fichier de test était servi). Seules 4 routes sur 9 validaient le nom de fichier.
- Correctif : crochet `preValidation` sur tout le plugin qui refuse (400) un paramètre de chemin ou de requête (`tenantId`, `courseId`, `filename`) contenant `..`, `/`, `\` ou un octet nul (`isUnsafePathSegment`).
- Test : `src/__tests__/files-path-traversal.test.ts` (8 URL).

### SEC-07 Élevé, corrigé. Un directeur peut créer ou promouvoir un `owner` via IAM
- `iam/http/plugin.ts` (`POST /admin/members`, `PATCH /admin/members/:id`), `iam/application/members.ts`.
- `membership.roles` est relu à chaque requête comme source de droits et accepte `owner` (`rbac/domain/legacy.ts:35`). Le modèle `directeur` détient `iam.user.manage` mais exclut abonnement, rôles et paie propriétaire : un complice `owner` (ou le déclassement/suspension du dernier propriétaire) contournait ces exclusions.
- Correctif : `canManageElevatedRoles` / `assertCanGrantRoles` : `owner` ne s'accorde, ne se retire et ne se suspend que depuis une session active `owner` ; `admin`/`administrateur` depuis owner ou admin. Appliqué à la création et à la modification (rôles demandés **et** rôles actuels de la cible).
- Test : `iam/test/elevated-roles.test.ts`. Suites IAM et people d'intégration (Postgres éphémère) vertes.
- Limite assumée : les autres rôles (directeur, secrétariat, économe) restent attribuables par `iam.user.manage` ; une anti-escalade complète par comparaison de permissions passerait par le module rbac (voir décisions).

### SEC-04 Élevé, corrigé. Écriture de fichiers sans JWT (legacy `POST /api/v1/files/upload`)
- `plugins/auth-middleware.ts` : `"/api/v1/files/"` était dans `skipAuthRoutes` pour **toutes** les méthodes ; l'« authentification » de `routes/files.ts:173-200` n'était que la présence des en-têtes `x-tenant` et `x-user-id`, fournis par le client.
- Correctif : l'exemption ne vaut plus que pour `GET` et `HEAD` ; toute autre méthode exige un JWT valide.
- Test : `files-path-traversal.test.ts` (POST sans jeton, en-têtes forgés : 401).

### SEC-02 Élevé, corrigé (défaut). Comptes techniques (admin, mot de passe) exposés par défaut
- `infra/compose/docker-compose.yml:111` : `SHOW_TECHNICAL_ACCOUNTS: ${SHOW_TECHNICAL_ACCOUNTS:-true}` ; `apps/web/src/app/api/technical-accounts/route.ts` répond sans authentification avec l'e-mail et le mot de passe partagé de chaque rôle (`admin@<slug>.local`, `owner@...`).
- Correctif : défaut `false` dans le compose. Une instance de démonstration doit l'activer explicitement (`SHOW_TECHNICAL_ACCOUNTS=true`).
- Test : `apps/web/src/platform/compose-security-defaults.test.ts`.
- À décider : refuser le démarrage en production si le drapeau vaut `true` (aujourd'hui simple avertissement dans `env.server.ts:137`).

### SEC-05 Élevé, corrigé. `/auth/social-login` : connexion pour n'importe quel e-mail sans secret
- `apps/api/src/routes/auth.ts` (`socialLoginAuthorized`). La route n'a aucun jeton Google : elle charge (ou crée) le compte par e-mail et renvoie un JWT legacy de 24 h. Garde existante : secret partagé `AUTH_SOCIAL_SHARED_SECRET`, mais **absent = autorisé sauf si `NODE_ENV === "production"`** : un `NODE_ENV` absent ou `staging` rouvrait la prise de contrôle de compte. Le point est dans le périmètre v2 : le web v2 l'appelle en repli (`apps/web/src/lib/auth-options.ts:100,185`).
- Correctif : sans secret, toléré uniquement si `NODE_ENV` vaut explicitement `development` ou `test`.
- Test : `files-path-traversal.test.ts` (bloc SEC-05) ; le test d'intégration existant du pont d'authentification reste valide.
- Décision restante : fermer la route (410) et retirer le repli du web (voir D-3).

### DEP-1 Élevé, atténué. Next.js 15.0.0 (contournement du middleware, CVE-2025-29927, corrigé en 15.2.3)
- `apps/web/package.json:93` ; le middleware porte la CSP et des gardes. `pnpm audit` signale 5 avis critiques `next` (versions corrigées jusqu'à 15.5.24).
- Atténuation appliquée : `infra/nginx/ecoledigitale.conf` et `ecoledigitale-staging.conf` neutralisent l'en-tête interne `x-middleware-subrequest`. Aucune mise à jour de dépendance (consigne).
- À décider : montée de version de Next (D-1).

### LEG-1 Élevé, à décider. `/api/v1/files/*` en lecture reste public et se fie à des en-têtes forgeables
- `routes/files.ts:110-133` (`/download/...`) : le contrôle de tenant ne s'applique que si `x-tenant` est présent ; `routes/files.ts:38-70`, `:347`, `:754` : « authentification » par la seule présence de `x-tenant` et `x-user-id`. Nginx fixe `X-Tenant` d'après l'hôte, mais l'API directe ou un domaine nu le laisse au client. La lecture sans en-tête est volontaire (éléments média sans en-têtes) et `receipts/:filename` est volontairement ouvert.
- Non corrigé : une correction propre exige des URL signées de courte durée (comme `platform/adapters/storage.ts`) et la migration des clients. Les identifiants à deviner (UUID, nom horodaté) limitent l'exposition mais ce n'est pas un contrôle d'accès.

### LEG-2 Élevé, à décider. Login legacy sans MFA, sans limitation, sans extinction
- `routes/auth.ts` (`/login`, `/register`, `/refresh`) ; `.env.example:157` laisse `LEGACY_TOKEN_SUNSET` commentée. Pas de limiteur (`@fastify/rate-limit` absent), pas de MFA (obligatoire en v2 pour owner/admin), pas de calcul factice pour un compte inconnu (oracle de temps), `/register` crée un compte `student` actif avec jeton immédiat, messages d'erreur internes renvoyés (`error.message`, lignes 213, 378, 478, 545, 639, 751).
- Non corrigé : legacy en cours d'extinction ; décision sur la date `LEGACY_TOKEN_SUNSET` (D-2).

### LEG-3 Élevé, à décider. Login super-admin sans MFA ni limitation
- `routes/super-admin-auth.ts:41-57`, `services/super-admin-jwt.service.ts:16` : mot de passe seul, 24 h, `SUPER_ADMIN_JWT_SECRET` retombe sur `JWT_SECRET` ; le jeton ouvre l'impersonation (`POST /iam/impersonation`, 10 min, audité, motif obligatoire).
- Non corrigé : décision produit (second facteur opérateur, secret distinct obligatoire en production).

## 4. Constats moyens et faibles

| Id | Gravité | Fichier | Constat | Statut |
|---|---|---|---|---|
| SEC-01 | Moyen | `finance/infrastructure/providers/sandbox-provider.ts:37,88`, `registry.ts` | Secret de webhook sandbox public par défaut ; hors dev avec `allowSandbox`, n'importe qui signait un webhook SUCCEEDED | Corrigé : secret aléatoire par processus hors dev/test (test dans `providers.test.ts`) |
| SEC-08 | Moyen | `finance/infrastructure/providers/wave.ts:238-243,268` | Wave en `shared_secret` : Bearer statique, statut et montant du corps crus | Corrigé : `requiresActiveVerification` dans ce mode (test) |
| M-1 | Moyen | `documents/infrastructure/clamav-scanner.ts:166`, `documents/application/uploads.ts:56` | Sans `DOCUMENTS_SCANNER` : fichiers servis `UNSCANNED` ; panne clamd fail-open si `DOCUMENTS_SCAN_FAIL_CLOSED=false` | À décider (D-4) |
| M-2 | Moyen | `index.ts:128`, `infra/` | `TRUST_PROXY` jamais défini : limiteurs « par IP » communs à tous les visiteurs derrière nginx ; nginx transmet `$proxy_add_x_forwarded_for` | À décider (D-5) |
| M-3 | Moyen | `apps/web/src/lib/auth-options.ts:167`, `middleware.ts:38-48` | JWT API exposé à JS via la session, CSP avec `unsafe-inline`/`unsafe-eval`, `localStorage` pour `superAdminToken` ; `SearchResults.tsx:130` injecte `extrait` via `dangerouslySetInnerHTML` (source à vérifier) | À décider |
| M-4 | Moyen | `infra/compose/docker-compose.yml:171` | MinIO `minioadmin/minioadmin` par défaut (port lié à 127.0.0.1) ; déploiement production non conditionné au succès de la CI | À décider |
| M-5 | Moyen | `plugins/auth-middleware.ts:64-71` | Révocation des jetons legacy contrôlée seulement sur les écritures ; refresh legacy sans rotation | À décider (avec LEG-2) |
| M-6 | Moyen | `iam/application/login.ts:91-95` | Verrou d'identité (25 échecs) exploitable en déni de service d'un compte connu | À décider |
| M-7 | Moyen | `iam/migrations/0400_iam_schema.sql`, `packages/database/migrations/0002_kernel.sql:35` | `TenantDb` et `SystemDb` partagent `app_user` : tables globales (`iam.identities`, `kernel.tenants`) accessibles depuis une transaction de tenant | À décider (défense en profondeur ; aucune injection SQL trouvée) |
| M-8 | Moyen | `rules`, `rbac`, `reportcards` migrations | Politiques d'écriture globales fondées sur `app.actor = 'system'` ; `createSystemContext(tenantId)` est utilisé dans des chemins déclenchés par des requêtes publiques | À décider |
| M-9 | Moyen | `routes/auth.ts` | `error.message` renvoyé en réponse (messages Postgres) | À décider (legacy) |
| M-10 | Moyen | `index.ts:139-144` | CORS réfléchi avec credentials hors production (staging inclus) ; jetons Bearer, impact limité | À décider |
| M-11 | Moyen | `finance` `packages/contracts/src/v2/finance.ts:559,1042` | `returnUrl` accepte tout schéma et tout hôte (redirection de payeur) ; non fetché côté serveur | À décider (liste blanche par tenant) |
| M-12 | Moyen | `infra/` | `pnpm audit` : voir section 5 | À décider |
| L-1 | Faible | `iam/http/plugin.ts` (`/logout-all`) | Autorisé pendant une impersonation | Corrigé (403) |
| L-2 | Faible | `notifications/infrastructure/channels/sms-http.ts:192` | Redirections suivies vers un fournisseur SMS (clé API en en-tête) | Corrigé (`redirect: "error"`) |
| L-3 | Faible | `sms-http.ts:94`, `sms-orange.ts:85` | `http://` toléré pour les URL de fournisseurs SMS | Accepté (URL d'environnement, de confiance) |
| L-4 | Faible | `finance/.../tresorpay.ts:152` | Webhook TresorPay sans horodatage (rejeu neutralisé par l'idempotence) | Accepté |
| L-5 | Faible | `notifications/http/plugin.ts:274`, `domain/tokens.ts:55` | Secret de webhook global, tenant hors signature | Accepté |
| L-6 | Faible | `finance/.../mtn-momo.ts:224` | Jeton d'URL MTN statique par tenant (compensé par la vérification active) | Accepté |
| L-7 | Faible | `documents/infrastructure/office-converter.ts:49` | LibreOffice sans coupure réseau (désactivé par défaut) | À décider (exécuter sans réseau) |
| L-8 | Faible | `platform/adapters/storage.ts:82` | Liens symboliques non traités (repli de développement) | Accepté |
| L-9 | Faible | `people/http/plugin.ts:455` | `personNotFound` vs 403 : fuite d'existence intra-tenant | Accepté |
| L-10 | Faible | `higher/http/plugin.ts:335-405` | Routes `documents` et `students` sans garde d'entitlement | À décider |
| L-11 | Faible | `admissions/http/plugin.ts:488` | Limiteur IP désactivé si `rateLimiter` absent (échec ouvert) | À décider |
| L-12 | Faible | `iam/config.ts:282` | `IAM_MFA_REQUIRED_ROLES=""` désactive la MFA obligatoire | Accepté (variable d'environnement de confiance) |

Autres points mineurs consignés : jeton ICS et `storage/object?token=` en query string (journaux nginx), `apps/web/src/app/api/receipts/view/route.ts` (pas de filtre `..` : l'utilisateur n'atteint que d'autres routes avec son propre jeton), JWT legacy sans `aud`, `public_form_index` en lecture ouverte (justifié), fonctions `audit.detach_expired_partitions` / `ensure_partitions` exécutables par `app_user` (plancher de rétention à 12 mois), journaux `console.log` du legacy (`routes/files.ts`, `notification.service.ts:350`) hors redaction.

## 5. Dépendances (`pnpm audit --prod`, résultats seulement)

263 avis (15 faibles, 100 modérés, 141 élevés, 7 critiques). Critiques et élevés les plus significatifs, par racine :
- `apps/web` : `next` 15.0.0 (5 avis critiques, dont le contournement de middleware), `next-auth` (< 4.24.15, critique), `brace-expansion` (élevé).
- `apps/api` : `fast-xml-parser` (critique, aussi à la racine), `basic-ftp` (critique), `fastify` 4.x (< 5.12.2), `@fastify/multipart` 7.x (<= 8.3.0), `@fastify/static` (<= 10.1.0), `@xmldom/xmldom`, `fast-uri`, `extract-zip`, `deepmerge-ts`.
- Racine : `axios` (plusieurs avis élevés), `fast-xml-parser`.
- Faibles notables : `dompurify` (mode `IN_PLACE`), `postcss-selector-parser`.

Aucune mise à jour n'a été faite : à planifier (D-1).

## 6. Corrections livrées

| Id | Fichiers modifiés | Tests de non-régression |
|---|---|---|
| SEC-01 | `finance/infrastructure/providers/registry.ts` | `finance/test/unit/providers.test.ts` |
| SEC-02 | `infra/compose/docker-compose.yml` | `apps/web/src/platform/compose-security-defaults.test.ts` |
| SEC-03 | `routes/files.ts` | `src/__tests__/files-path-traversal.test.ts` |
| SEC-04 | `plugins/auth-middleware.ts` | idem |
| SEC-05 | `routes/auth.ts` | idem |
| SEC-06 | `people/application/accounts.ts` | `people/test/unit/portal-role-escalation.test.ts` |
| SEC-07 | `iam/application/members.ts`, `iam/http/plugin.ts` | `iam/test/elevated-roles.test.ts` |
| SEC-08 | `finance/infrastructure/providers/wave.ts` | `finance/test/unit/providers-wave.test.ts` |
| SEC-09 | `infra/nginx/ecoledigitale*.conf` | (configuration) |
| L-1, L-2 | `iam/http/plugin.ts`, `sms-http.ts` | suites IAM / notifications existantes |

Tests préexistants : trois échecs de `src/__tests__/file-serving.test.ts` (500/404 au lieu de 200/400) sont **antérieurs** aux corrections (vérifié en restaurant l'ancien `files.ts`).

## 7. Décisions pour l'humain

- D-1 : planifier la montée de version `next` (>= 15.5.24), `next-auth` (>= 4.24.15), `fastify` 5.x, `@fastify/*`, `axios`, `fast-xml-parser`. L'atténuation nginx (SEC-09) ne protège pas un accès direct au port 3011.
- D-2 : fixer `LEGACY_TOKEN_SUNSET` ; d'ici là, ajouter limiteur, MFA ou fermeture de `/register`, `/login`, `/refresh` legacy (LEG-2, M-5, M-9).
- D-3 : fermer `/auth/social-login` (410) et retirer le repli du web, ou le conserver derrière le secret obligatoire.
- D-4 : rendre ClamAV obligatoire en production (refus de démarrer sans scanner, `failClosed=true`, pas de téléchargement `UNSCANNED` pour les non-gestionnaires).
- D-5 : définir `TRUST_PROXY` (nombre de sauts ou CIDR de nginx) et remplacer `$proxy_add_x_forwarded_for` par `$remote_addr` dans nginx ; refuser `TRUST_PROXY=true`.
- D-6 : URL signées de courte durée pour `/api/v1/files/*` (LEG-1) ; second facteur et secret dédié pour le super-admin (LEG-3).
- D-7 : anti-escalade complète par comparaison de permissions pour `iam.user.invite` / `iam.user.manage` (au-delà de `owner`/`admin`), et séparation `app_user` / `system_user` en base (M-7).
- D-8 : activer `SHOW_TECHNICAL_ACCOUNTS=true` seulement sur la démonstration ; faire échouer le démarrage de production si le drapeau est actif.
