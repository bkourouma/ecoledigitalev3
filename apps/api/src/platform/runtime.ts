/**
 * Contrat d'assemblage des modules v2 : `ModuleRuntime`.
 *
 * Le registre (`modules/registry.ts`) appelle, pour chaque `modules/<key>/http/plugin.ts`,
 *
 *     export async function setup?(app, runtime)   // 1) à la RACINE de l'application (décorateurs partagés)
 *     export default async function plugin(app, runtime)   // 2) dans un contexte Fastify encapsulé,
 *                                                         //    déjà préfixé `/api/v1/<key>`
 *
 * - `setup` (facultatif) pose sur l'instance RACINE ce que les AUTRES modules lisent à la requête
 *   (`app.rbac`, `app.entitlements`, `app.iam`). Un décorateur posé dans le contexte encapsulé d'un
 *   module serait invisible des modules voisins : c'est le défaut d'assemblage que ce contrat corrige.
 * - `plugin` déclare les routes SANS préfixe : le préfixe `/api/v1/<key>` est appliqué par le registre
 *   (plus de double préfixe) et le contexte encapsulé porte déjà le gestionnaire d'erreurs du kernel et
 *   la garde « contexte présent » (401 sauf `config: { public: true }`).
 *
 * `config: { public: true }` signifie « n'exige pas de `request.ctx` ET n'est pas soumise à
 * l'authentification legacy » : la route s'authentifie elle-même (login IAM, webhook signé, console
 * super-admin) ou est ouverte. La liste des routes publiques est DÉRIVÉE de ces déclarations
 * (`platform/public-routes.ts`), jamais codée en dur dans le middleware legacy.
 *
 * Ce fichier ne contient que des TYPES (aucun import de module) : il peut être importé par n'importe
 * quel module sans créer de cycle. Les ports sont décrits structurellement.
 */
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { SystemDb, TenantDb, Tx } from "@ecoledigitale/database";
import type { Clock, Logger, ModuleManifest, RequestContext } from "@ecoledigitale/kernel";
import type { RateLimiter, AccountNotifier } from "../modules/iam/application/ports";

export type { RateLimiter, AccountNotifier };

/** Entrée d'audit telle que l'attend le module `audit` (`audit.record`). L'acteur, le tenant et la requête viennent du contexte. */
export interface RuntimeAuditEntry {
  /** `entité.verbe`, ex. `tenancy.campus.create`. */
  action: string;
  /** Type d'objet (snake_case), ex. `campus`. */
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
  actor?: { type: "user" | "system" | "superAdmin" | "impersonation"; id: string | null; impersonatedBy?: string | null };
}

/**
 * Adaptateur vers `audit.record` / `audit.recordPlatform`. Chaque module l'adapte à SON port d'audit
 * (mappings documentés dans les README de tenancy, entitlements, rbac, finance).
 */
export interface RuntimeAuditPort {
  record(tx: Tx, entry: RuntimeAuditEntry): Promise<unknown>;
  recordPlatform(tx: Tx, entry: RuntimeAuditEntry): Promise<unknown>;
}

/** Droits effectifs minimaux lus par les modules. */
export interface RuntimeEntitlementsReader {
  getEntitlements(tenantId: string): Promise<{ features: readonly string[]; reason?: string }>;
  hasFeature(tenantId: string, featureKey: string): Promise<boolean>;
}

export interface RuntimeEntitlements {
  /** Lecteur mis en cache (TTL court, invalidé par les use cases du processus et par les événements relayés). */
  readonly reader: RuntimeEntitlementsReader;
  /** `preHandler` : 403 `entitlements.feature_not_available` si la feature n'est pas accordée au tenant du contexte. */
  requireFeature(featureKey: string): preHandlerAsyncHookHandler;
  /** Variante programmatique (corps de requête, branches conditionnelles). */
  isFeatureEnabled(ctx: RequestContext, featureKey: string): Promise<boolean>;
}

/** Opérateur plateforme authentifié (JWT super-admin legacy). */
export interface SuperAdminIdentity {
  actorId: string;
  email?: string;
}

/**
 * Port : qui est opérateur de la plateforme ? Renvoie l'identité ou LÈVE `UnauthorizedError` /
 * `ForbiddenError`. Implémenté par `platform/super-admin-authorizer.ts` à partir du JWT super-admin
 * legacy (séparé du JWT tenant). Structurellement identique au port de `entitlements`.
 */
export interface SuperAdminAuthorizer {
  authorize(request: { headers: Record<string, string | string[] | undefined> }): Promise<SuperAdminIdentity>;
}

export interface RuntimeRequirePermission {
  /** Garde du module rbac. `options.scope` : voir `RequirePermissionOptions` du module rbac. */
  requirePermission(permission: string, options?: { scope?: unknown }): preHandlerAsyncHookHandler;
}

/** Hiérarchie établissements → campus d'un tenant (fournie par `tenancy`, consommée par `rbac`). */
export interface RuntimeScopeTrees {
  forTenant(tenantId: string): Promise<{
    institutionOfCampus(campusId: string): string | undefined;
    knows(scope: { readonly type: "tenant" | "institution" | "campus"; readonly id?: string }): boolean;
  }>;
  /** À appeler après une modification de la structure : l'instantané du tenant est relu. */
  invalidate(tenantId: string): void;
}

export interface ModuleRuntime {
  /** Seule porte d'accès aux données d'un tenant (RLS). */
  readonly tenantDb: TenantDb;
  /** Accès système explicite et audité (jobs, console plateforme). */
  readonly systemDb: SystemDb;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Manifestes des modules chargés, en ordre topologique. */
  readonly manifests: readonly Readonly<ModuleManifest>[];
  /** Variables d'environnement (lecture seule, injectables en test). Les secrets ne sont jamais journalisés. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Garde `requirePermission` du module rbac (résout `fastify.rbac` à la requête). */
  readonly requirePermission: RuntimeRequirePermission["requirePermission"];
  readonly auditPort: RuntimeAuditPort;
  readonly entitlements: RuntimeEntitlements;
  /** Arbre des périmètres (tenancy → rbac). */
  readonly scopeTrees: RuntimeScopeTrees;
  /** `request.ctx` ou `UnauthorizedError`. */
  resolveContext(request: FastifyRequest): RequestContext;
  /** Redis si `REDIS_URL`, sinon mémoire (mono-process). */
  readonly rateLimiter: RateLimiter;
  readonly superAdminAuthorizer: SuperAdminAuthorizer;
  /** Notifications de compte (invitation, réinitialisation). Défaut : aucun transport (journalisé). */
  readonly accountNotifier: AccountNotifier;
}

/** `setup(app, runtime)` : décorations de l'instance RACINE (facultatif). */
export type ModuleSetup = (app: FastifyInstance, runtime: ModuleRuntime) => Promise<void> | void;

/** `default` de `http/plugin.ts` : routes du module, sans préfixe. */
export type ModulePlugin = (app: FastifyInstance, runtime: ModuleRuntime) => Promise<void> | void;

declare module "fastify" {
  interface FastifyInstance {
    /** Runtime d'assemblage (posé par la plateforme v2, absent tant que V2_DATABASE_URL n'est pas défini). */
    v2Runtime: ModuleRuntime;
  }
}
