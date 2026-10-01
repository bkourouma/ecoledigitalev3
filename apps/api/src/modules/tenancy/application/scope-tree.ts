/**
 * Hiérarchie des périmètres d'un tenant (établissements → campus), à l'usage du RBAC.
 *
 * Le module `rbac` ne dépend pas de `tenancy` : il consomme un port `ScopeTreeProvider`
 * (`forTenant(tenantId) → { institutionOfCampus, knows }`). Ce fournisseur, structurellement compatible,
 * est branché à l'assemblage (`ModuleRuntime.scopeTrees`). Sans lui, une assignation d'établissement ne
 * couvre AUCUN campus (échec fermé) et une assignation vers un périmètre inexistant n'est pas refusée.
 *
 * Instantané court (TTL 5 s par défaut) : un contrôle de permission le lit à chaque requête gardée par
 * `requirePermission`. Les routes de `tenancy` qui modifient la structure invalident l'entrée du tenant
 * dans le processus (`invalidate`) ; les autres instances rattrapent au plus tard à l'expiration du TTL.
 */
import { createSystemContext, systemClock, type Clock } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";

export interface TenancyScopeRef {
  readonly type: "tenant" | "institution" | "campus";
  readonly id?: string;
}

export interface TenancyScopeTree {
  /** Établissement parent d'un campus ; `undefined` si inconnu. */
  institutionOfCampus(campusId: string): string | undefined;
  /** Le périmètre existe-t-il dans ce tenant ? (`tenant` toujours vrai.) */
  knows(scope: TenancyScopeRef): boolean;
}

export interface TenancyScopeTreeProvider {
  forTenant(tenantId: string): Promise<TenancyScopeTree>;
  /** Oublie l'instantané du tenant (après une modification de la structure). */
  invalidate(tenantId: string): void;
}

export interface ScopeTreeProviderOptions {
  ttlMs?: number;
  clock?: Clock;
}

interface Snapshot {
  tree: TenancyScopeTree;
  expiresAt: number;
}

export function buildScopeTree(campuses: ReadonlyArray<{ id: string; institutionId: string }>, institutionIds: readonly string[]): TenancyScopeTree {
  const campusToInstitution = new Map(campuses.map((c) => [c.id.toLowerCase(), c.institutionId.toLowerCase()]));
  const institutions = new Set([...institutionIds.map((i) => i.toLowerCase()), ...campusToInstitution.values()]);
  return Object.freeze({
    institutionOfCampus: (campusId: string) => campusToInstitution.get(campusId.toLowerCase()),
    knows: (scope: TenancyScopeRef) =>
      scope.type === "tenant" ||
      (typeof scope.id === "string" && (scope.type === "institution" ? institutions.has(scope.id.toLowerCase()) : campusToInstitution.has(scope.id.toLowerCase()))),
  });
}

export function createTenancyScopeTreeProvider(db: TenantDb, options: ScopeTreeProviderOptions = {}): TenancyScopeTreeProvider {
  const ttlMs = options.ttlMs ?? 5_000;
  const clock = options.clock ?? systemClock;
  const cache = new Map<string, Snapshot>();
  const inflight = new Map<string, Promise<TenancyScopeTree>>();
  const versions = new Map<string, number>();

  async function load(tenantId: string): Promise<TenancyScopeTree> {
    return db.run(
      createSystemContext(tenantId),
      async (tx) => {
        const campuses = await tx.many<{ id: string; institution_id: string }>("SELECT id, institution_id FROM tenancy.campuses");
        const institutions = await tx.many<{ id: string }>("SELECT id FROM tenancy.institutions");
        return buildScopeTree(
          campuses.map((c) => ({ id: c.id, institutionId: c.institution_id })),
          institutions.map((i) => i.id),
        );
      },
      { readOnly: true },
    );
  }

  return {
    async forTenant(tenantId) {
      const key = tenantId.toLowerCase();
      const hit = cache.get(key);
      if (hit && hit.expiresAt > clock.now().getTime()) return hit.tree;
      const running = inflight.get(key);
      if (running) return running;
      const versionAtStart = versions.get(key) ?? 0;
      const promise = load(key)
        .then((tree) => {
          // Invalidé pendant le chargement : on rend l'arbre lu mais on ne le mémorise pas.
          if ((versions.get(key) ?? 0) === versionAtStart && ttlMs > 0) {
            cache.set(key, { tree, expiresAt: clock.now().getTime() + ttlMs });
          }
          return tree;
        })
        .finally(() => {
          if (inflight.get(key) === promise) inflight.delete(key);
        });
      inflight.set(key, promise);
      return promise;
    },
    invalidate(tenantId) {
      const key = tenantId.toLowerCase();
      cache.delete(key);
      inflight.delete(key);
      versions.set(key, (versions.get(key) ?? 0) + 1);
    },
  };
}
