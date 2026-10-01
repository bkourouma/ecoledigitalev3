# Module `iam` — identité, sessions, MFA

Décisions : `docs/adr/ADR-008-identite-et-sessions.md`. Pack CORE, schéma Postgres `iam`, migrations **0400–0499**.
Additif : ne remplace pas encore le login legacy ; la forme du jeton reste compatible (`userId`, `tenantId`, `tenantSlug`, `roles`, `activeRole`, `jti`, `iss`, `aud` = slug).

## Modèle

| Table | Portée | Rôle |
|---|---|---|
| `iam.identities` | globale | une personne : e-mail unique, hash, secret TOTP chiffré, `auth_epoch` |
| `iam.identity_tenants` | globale, lecture seule | annuaire (identité, tenant), alimenté par trigger |
| `iam.mfa_recovery_codes`, `iam.password_reset_tokens` | globales | empreintes HMAC uniquement |
| `iam.memberships` | tenant (RLS) | autorité de l'accès : statut, rôles |
| `iam.sessions`, `iam.refresh_tokens`, `iam.login_challenges` | tenant (RLS) | sessions, rotation, étapes MFA |

Tables globales justifiées dans `../isolation-allowlist.iam.ts` (à fusionner dans le test d'isolation central).

## Routes `/api/v1/iam`

`POST login`, `mfa/challenge`, `refresh`, `logout`, `logout-all`, `switch-tenant`, `GET me`, `GET sessions`, `DELETE sessions/:id`, `POST password/change|forgot|reset`, `mfa/enroll|verify|disable`.
Administration (seulement si `requirePermission` du rbac est fourni) : `GET|POST admin/members`, `PATCH admin/members/:id`, `POST admin/members/:id/sessions/revoke`, `POST admin/members/:id/mfa/reset`.
Impersonation (seulement si `authenticateSuperAdmin` est fourni) : `POST impersonation`.
Schémas Zod : `packages/contracts/src/v2/iam.ts`.

Transport du refresh token : web = cookie `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/iam` (`client: "web"`, défaut, envoyer un corps `{}` en JSON) ; mobile = corps (`client: "mobile"`). Accès : `Authorization: Bearer`.

## Câblage (à faire par le lead / platform-api)

```ts
import { loadIamConfig, createIamService, registerIam, RedisRateLimiter, IAM_MIGRATIONS_DIR } from "./modules/iam";
import { requirePermission } from "./modules/rbac";

const iam = createIamService({ config: loadIamConfig(), tenantDb, systemDb, limiter: new RedisRateLimiter(redis), notifier });
await registerIam(app, { iam, requirePermission, authenticateSuperAdmin });
// migrations : passer IAM_MIGRATIONS_DIR au runner (après la baseline et rbac si besoin)
```

Ailleurs : `app.get("/x", { preHandler: iamAuthHook(iam) }, …)` ou `buildRequestContextFromToken(token, iam, { expectedTenantSlug })`. `verifyAccessToken(token, { config, clock })` vérifie sans base (pas la révocation).
Import legacy : `iam.provisionMember(ctx, { email, roles, passwordHash })` (bcrypt accepté, re-haché au premier login). Entretien : `iam.purgeExpiredData()` en job planifié.

Hors module : ajouter `@ecoledigitale/kernel` et `@ecoledigitale/database` aux dépendances de `apps/api` (les tests utilisent des alias, cf. `vitest.config.ts`), un `AccountNotifier` SMTP, Redis.

## Variables d'environnement (aucun défaut pour les secrets)

| Variable | Rôle |
|---|---|
| `IAM_JWT_SECRET` (obligatoire, ≥ 32 car.) | clé maître (HKDF → clés porteur / étapes / hachage) |
| `IAM_MFA_ENCRYPTION_KEY` (obligatoire, 32 octets base64) | chiffrement des secrets TOTP ; `IAM_MFA_ENCRYPTION_KEY_PREVIOUS` pour la rotation |
| `IAM_COOKIE_SECURE` (défaut `true`; `false` interdit en production), `IAM_COOKIE_DOMAIN`, `IAM_ALLOWED_ORIGINS` (liste séparée par des virgules) | cookie et contrôle d'Origin |
| `IAM_MFA_REQUIRED_ROLES`, `IAM_MFA_TOTP_ISSUER` | politique MFA, libellé `otpauth://` |
| `IAM_ACCESS_TTL_SEC` (900), `IAM_REFRESH_IDLE_TTL_SEC`, `IAM_SESSION_MAX_AGE_SEC`, `IAM_IMPERSONATION_TTL_SEC` (600), `IAM_PASSWORD_MIN_LENGTH` (12), `IAM_SCRYPT_LOG_N` (16) | réglages bornés |

## Tests

```bash
# unitaires (sans base) : TOTP RFC 4226/6238, hachage, politique, JWT, rate limiter
node_modules/.bin/vitest run --config apps/api/src/modules/iam/vitest.config.ts
# intégration Postgres éphémère
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config "$(pwd)/apps/api/src/modules/iam/vitest.config.ts"
# contrat RateLimiter sur Redis (conteneur éphémère nommé, à supprimer ensuite)
docker run -d --name ed-iam-redis-test -p 127.0.0.1:63791:6379 redis:7-alpine
REDIS_URL=redis://127.0.0.1:63791 node_modules/.bin/vitest run --config apps/api/src/modules/iam/vitest.config.ts rate-limiter
docker rm -f ed-iam-redis-test
# types
apps/api/node_modules/.bin/tsc -p apps/api/src/modules/iam/tsconfig.json
```

Les tests de `test/` ne sont pas dans `__tests__` : Jest (apps/api) ne les exécute pas.
