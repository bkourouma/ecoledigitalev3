# ADR-008 — Identité globale, accès par tenant, sessions et MFA

- **Statut :** Accepté
- **Date :** 2026-10-01
- **Références :** plan §2 (sécurité), §3.6, §3.15, §4 Phase 1 étape 5, point ouvert n°4 (parent multi-établissements) ; ADR-001, ADR-002, ADR-004, ADR-006, ADR-007 ; module `apps/api/src/modules/iam`

## Contexte

Constats sur l'authentification historique : JWT de 24 h sans refresh, blacklist vérifiée seulement sur POST/PUT/PATCH/DELETE, tenant d'un JWT pris sans vérification sur les routes publiques, aucun rate limiting, aucun verrouillage, aucune MFA, mots de passe « techniques » par défaut pour l'impersonation, secrets avec valeur par défaut. L'e-mail est unique globalement mais un utilisateur n'appartient qu'à un tenant, ce qui interdit le cas d'un parent dont les enfants sont dans plusieurs établissements.

Il faut une identité qui précède les tenants, des accès par tenant soumis à la RLS (ADR-002), et un moyen sûr de lire les accès d'une personne avant que le contexte de tenant n'existe (login, changement d'établissement).

## Décision

### 1. Une personne = une `identity` globale ; ses accès = des `memberships`

- `iam.identities` (globale) : e-mail normalisé unique à l'échelle de la plateforme, hash du mot de passe, secret TOTP chiffré, `auth_epoch`.
- `iam.memberships` (**tenant, RLS forcée**) : (identity_id, tenant_id, statut, rôles). **C'est l'autorité de l'accès** : un accès actif est toujours vérifié sous RLS, dans le tenant concerné.
- L'identifiant utilisateur du `RequestContext` (`userId`) est celui de l'identité. Le jeton garde `userId`, `tenantId`, `tenantSlug`, `roles`, `activeRole`, `jti` (+ `sid`, `mid`, `mfa`, `amr`).

### 2. Lire les accès avant tout contexte de tenant : annuaire minimal en lecture seule

Option retenue : une table de liaison **non RLS**, `iam.identity_tenants (identity_id, tenant_id)`, réduite à deux colonnes, **en lecture seule** pour `app_user`, alimentée uniquement par un trigger `SECURITY DEFINER` depuis `iam.memberships`. Elle répond à « dans quels tenants cette personne a-t-elle un accès ? » (login, switch-tenant, révocation globale). Elle ne dit rien du statut ni des rôles : ceux-ci sont lus dans `iam.memberships` **sous la RLS du tenant visé** avant toute émission de jeton. L'autorisation reste donc appliquée côté application et vérifiée sous RLS ; l'annuaire ne peut ni accorder ni étendre un accès.

Alternatives écartées :
- *Membership globale sans RLS* : les écritures et lectures d'administration (liste des membres d'un tenant, rôles) retomberaient dans des `WHERE tenant_id` manuels, exactement ce qu'ADR-002 supprime.
- *Politique RLS à double clé* (`tenant_id` OU `identity_id`) : exige une variable de session d'identité que `TenantDb`/`SystemDb` ne posent pas, contredit la règle « une seule policy `tenant_isolation` » et sort du test d'isolation générique.
- *Fonction SECURITY DEFINER qui contourne la RLS* : impossible avec `FORCE ROW LEVEL SECURITY` (le propriétaire est soumis) sans rôle `BYPASSRLS`, interdit par ADR-002.
- *Un compte par tenant* : retour au problème de départ (pas de parent multi-établissements, doublons d'e-mail).

Tables globales du module (allowlist du test d'isolation, avec justification : `apps/api/src/modules/isolation-allowlist.iam.ts`) : `identities`, `identity_tenants`, `mfa_recovery_codes`, `password_reset_tokens`. Les tables de tenant (`memberships`, `sessions`, `refresh_tokens`, `login_challenges`) passent le test générique (vérifié sur Postgres réel, comportement A/B inclus).

Risque résiduel assumé : une seule connexion `app_user` pour tous les modules ; un bug de SQL hors du module iam pourrait lire `iam.identities` (hash, secret chiffré) ou l'annuaire. Mitigation : règles de frontière (ADR-001/006), droits par colonne (pas de DELETE, UPDATE restreint, `identity_id`/`tenant_id` immuables), secrets TOTP chiffrés avec une clé hors base, hash de mot de passe lents.

### 3. Jetons et sessions

- **Accès** : JWT HS256, 15 min (borné à 1 h), secret par environnement (`IAM_JWT_SECRET`, ≥ 32 car., **aucune valeur par défaut**, démarrage refusé sinon), clés dérivées par HKDF et **distinctes** pour (porteur), (étapes MFA) et (hachage des jetons opaques). Implémentation stricte : `alg` = HS256 uniquement, en-tête exactement {alg, typ}, `typ` contrôlé, signature vérifiée à temps constant **avant** de lire le payload, forme Zod stricte, `aud` = slug du tenant. Le tenant du jeton n'est utilisé qu'après ces contrôles, puis confronté à la session lue sous RLS.
- **Révocation sur toutes les méthodes** : une requête est valide si, en une seule requête SQL, la session n'est pas révoquée ni expirée, `sessions.auth_epoch = identities.auth_epoch`, l'identité est active, l'accès actif, le tenant actif, et le rôle actif appartient toujours à l'accès. `auth_epoch + 1` (changement de mot de passe, déconnexion globale, désactivation MFA) invalide en un UPDATE les sessions de **tous** les tenants.
- **Refresh token** : opaque, 256 bits, `rt1.<tenant>.<secret>`, haché (HMAC-SHA256, clé serveur) en base ; le préfixe de tenant n'est pas authentifié et ne sert qu'à choisir la transaction RLS (un tenant falsifié ne trouve aucune ligne). **Rotation** à chaque usage ; un jeton déjà utilisé qui revient **révoque toute la session** (`iam.session.revoked`, raison `refresh_reuse`). Fenêtre de grâce configurable (0 par défaut) pour les doubles soumissions mobiles. Durée d'inactivité 14 j, durée absolue de session 30 j.
- **Transport** : web = cookie `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/iam` (le corps ne contient pas le refresh token), mobile = corps (`client: "mobile"`). Les routes qui lisent le cookie contrôlent `Origin`. Le jeton d'accès voyage en en-tête `Authorization: Bearer`.
- **Contexte** : `roles = [rôle actif]` (permissions évaluées sur le seul rôle actif), `mfa` lu en base (jamais dans la revendication) et posé dans `RequestContext.mfa` pour les permissions sensibles du RBAC ; `request.ctx` est posé pour `requirePermission`.
- **Appareil** : IP, user-agent, nom d'appareil (nettoyés et bornés) ; liste des sessions actives, révocation par l'utilisateur ou par un administrateur (`iam.session.revoke`).

### 4. Mots de passe

scrypt (`node:crypto`, N=2^16, r=8, p=1 par défaut, paramètres encodés dans le hash, sel 16 octets, comparaison à temps constant, sémaphore de concurrence). Hash bcrypt legacy vérifié puis **re-haché de façon transparente** au login réussi (aussi pour des paramètres scrypt plus faibles). Politique configurable (longueur 12–128, liste de mots courants + liste du tenant, interdit = e-mail ou sa partie locale, répétitions, suites). Réinitialisation : jeton aléatoire 256 bits, haché, usage unique atomique, 30 min, la politique est évaluée **avant** de consommer le jeton.

### 5. Anti-bruteforce et anti-énumération

Port `RateLimiter` (fenêtre fixe + verrouillage progressif), implémentations mémoire et Redis (scripts Lua atomiques, panne = échec fermé par défaut). Compteurs par (e-mail saisi, IP), par e-mail et par IP, indexés par l'**empreinte de la valeur saisie, qu'elle existe ou non** : le verrouillage ne révèle rien. Mêmes code et message pour e-mail inconnu / mot de passe faux / compte désactivé ; calcul de hachage factice pour les comptes absents ; plancher de durée sur tout échec (600 ms par défaut) ; « mot de passe oublié » renvoie 202 constant et envoie l'e-mail hors du chemin de réponse ; événement `iam.login.failed` publié hors chemin de réponse, sans e-mail en clair.

### 6. MFA TOTP

RFC 6238 avec `node:crypto` (vecteurs de la RFC testés). Secret chiffré AES-256-GCM (clé `IAM_MFA_ENCRYPTION_KEY` hors base, rotation par identifiant de clé, AAD = identité), anti-rejeu (dernier pas accepté, UPDATE conditionnel), codes de secours 60 bits hachés, usage unique. Enrôler et désactiver exigent le mot de passe (et, pour désactiver, le second facteur) ; la désactivation est refusée si un rôle de l'identité, dans n'importe quel tenant, impose la MFA, et invalide les autres sessions. Politique `mfaRequiredFor(roles)` (rôles configurables : `owner`, `admin`, `director`, `bursar`, `accountant`, `super_admin` par défaut) : sans MFA enrôlée, le login renvoie un jeton d'enrôlement (aucune session) ; avec MFA, un challenge à usage unique (5 essais, verrouillage progressif). La MFA étant globale à l'identité, un administrateur de tenant ne peut la réinitialiser que pour une personne dont c'est l'unique accès (`iam.mfa.reset`, sensible, session MFA exigée).

### 7. Impersonation

Jeton distinct (`typ imp+jwt`, `use: impersonation`), TTL 10 min (30 max), claim `act`, **non renouvelable**, `mfa=false` (les permissions sensibles restent refusées), changement de mot de passe/MFA/tenant interdits. L'événement `iam.impersonation.started` est écrit dans l'outbox **dans la même transaction** que la session : pas d'audit, pas de session. Plus aucun mot de passe technique. Le contexte construit a `actor: "superAdmin"` et `userId` = utilisateur imité ; l'acteur réel est dans `claims.act` / `principal.impersonatedBy` et dans `actor_id` de l'événement. Limite : le `RequestContext` du kernel n'a pas de champ « agissant pour » ; proposition : `actingAs?: string` dans une évolution du kernel pour que l'audit des opérations faites sous impersonation cite l'acteur réel.

### 8. Événements (outbox, payload `{ v: 1, … }`)

`iam.user.logged_in`, `iam.login.failed`, `iam.session.revoked`, `iam.mfa.enabled`, `iam.mfa.disabled`, `iam.mfa.reset`, `iam.password.changed`, `iam.impersonation.started`, `iam.membership.created`, `iam.membership.changed`. Les clés lues par le module audit (`userId`, `reason`, `revokedBy`, `superAdminId`, `targetUserId`, `identifier`, `locked`, `ip`, `userAgent`) sont présentes. Les événements d'identité sans tenant unique (changement de mot de passe) sont écrits dans l'outbox de chaque tenant de l'identité (le tenant courant dans la transaction, les autres au mieux).

## Conséquences

- Un parent a un seul compte, plusieurs accès, et change d'établissement par `switch-tenant` (nouvelle session, ancienne révoquée, MFA réévaluée).
- Chaque requête authentifiée coûte une requête SQL indexée (clé primaire) ; un cache court est possible mais affaiblirait la révocation immédiate (non retenu).
- Migrations iam : plage 0400–0499 (`0400_iam_schema.sql`).
- Le basculement du login legacy reste à faire par le lead : `buildRequestContextFromToken`/`iamAuthHook` sont prêts ; les comptes legacy s'importent via `provisionMember({ passwordHash })` (hash bcrypt accepté).
- Câblage requis hors module : dépendances `@ecoledigitale/kernel|database` dans `apps/api`, `Redis` pour `RedisRateLimiter`, un `AccountNotifier` réel (SMTP), `requirePermission` du rbac et l'authentificateur super-admin.

## Addendum 2026-10-01 — coexistence avec le legacy et bascule

`iam` devient la seule source d'authentification ; la transition est pilotée par drapeaux (plan : `docs/architecture/auth-cutover.md`).

- **Passerelle IAM -> legacy** (`platform/legacy-iam-bridge.ts`) : le crochet `onRequest` de `platform/v2-auth.ts` authentifie un jeton `at+jwt` / `imp+jwt` sur **toute** route (module ou legacy) : signature, session, révocation, époque, accès et tenant actifs, sur toutes les méthodes HTTP. Le middleware legacy en tire le `request.user` attendu : identifiant du compte **legacy** de même e-mail dans le tenant du jeton, rôles legacy par l'**inverse strict** de `legacyRoleToTemplate` (un modèle partiel n'élève rien : 403 `LEGACY_ROLE_UNMAPPED`). Retour arrière : `V2_LEGACY_IAM_BRIDGE=0`.
- **Tenant jamais lu d'un jeton non vérifié** : `plugins/tenant-context.ts` décodait le JWT sans le vérifier, y compris sur les routes publiques (corrigé). Un jeton legacy ne désigne un tenant que s'il est valide et que `LEGACY_TOKEN_SUNSET` n'est pas atteinte ; un jeton IAM, que si la session est valide.
- **Extinction** : `LEGACY_TOKEN_SUNSET` (ISO 8601). Jeton legacy de tenant refusé (401), émission de jetons legacy fermée (410). Valeur mal formée : démarrage refusé.
- **Impersonation sur les routes legacy** : chaque requête est journalisée dans `super_admin_audit_logs` (acteur réel + compte imité) via `request.iamImpersonation`. On ne pose **pas** `request.superAdmin` : les routes `/super-admin/*` s'y fient et une session d'impersonation ne doit pas y donner accès.
- **Défauts corrigés** : `/auth/social-login` (legacy) délivrait un jeton pour n'importe quel e-mail -> secret partagé `AUTH_SOCIAL_SHARED_SECRET` ; l'en-tête `X-User-Id` fourni par le client est réécrit avec le compte du jeton ; `request.ip` derrière proxy (`TRUST_PROXY`) ; `IAM_REFRESH_REUSE_GRACE_MS` n'était pas lisible depuis l'environnement.
- **Ajouts au module** : `POST /iam/switch-role` (nouvelle session dans le même tenant, ancienne révoquée, facteurs conservés, interdit sous impersonation), `POST /iam/federated-login` (Google : secret de service `IAM_SERVICE_SECRET`, aucune création de compte, **MFA toujours exigée** pour les rôles sensibles, facteur `fed`), `email` dans le principal authentifié.
- **Web** (`NEXT_PUBLIC_AUTH_V2=1`) : NextAuth conserve le refresh token dans son JWT chiffré (cookie HttpOnly), **jamais exposé à la page** (le `session` callback ne le copie pas) ; la rotation n'a lieu que sur `trigger: "update"` (route `POST /api/auth/session`, seul endroit où le cookie peut être réécrit) et est sérialisée entre onglets par Web Locks ; `events.signOut` révoque la session IAM. Transport « mobile » depuis le serveur Next : aucun cookie `Path=/api/v1/iam` n'est posé dans le navigateur par ce chemin, donc aucune surface CSRF supplémentaire.

## Menaces non couvertes (connues)

Compromission d'un super-utilisateur Postgres ou de la clé maître ; vol d'un jeton d'accès pendant ses 15 min (limité par la révocation immédiate, mais non empêché) ; phishing temps réel du code TOTP (pas de WebAuthn) ; fuite de session par XSS côté web pour l'accès (le refresh, lui, est httpOnly) ; DoS par verrouillage ciblé d'une identité (plafond par identité haut, verrou plafonné à 1 h) ; absence de détection d'anomalie (géolocalisation, appareil inconnu) ; vérification de l'e-mail à l'inscription et SSO/OIDC hors périmètre ; listes de mots de passe fuités limitées à la liste intégrée ; messages d'erreur « aucun accès actif » distincts pour qui a prouvé son mot de passe ; sessions listées pour le tenant courant seulement ; attribution de l'acteur réel dans l'audit sous impersonation limitée par le `RequestContext` actuel ; événements `iam.password.changed` des tenants secondaires écrits au mieux.

## Alternatives rejetées

- **`jsonwebtoken`** : acceptable, mais la surface (algorithmes, `kid`, `jku`) est plus large que nécessaire ; un vérificateur de 60 lignes strict est plus simple à auditer.
- **Sessions entièrement sans état (JWT seul)** : incompatible avec la révocation immédiate sur toutes les méthodes.
- **Liste noire de `jti`** : croît sans borne et ne couvre pas l'invalidation par identité ; la session en base est la source de vérité.
- **bcrypt/argon2 natifs** : scrypt est dans `node:crypto` (aucune dépendance native), paramétrable et suffisant ; bcrypt reste accepté en lecture pour la migration.
- **Compteurs de verrouillage en base** : écritures sur chaque tentative, contention ; Redis (ou mémoire) convient et ne persiste aucune donnée personnelle brute.
