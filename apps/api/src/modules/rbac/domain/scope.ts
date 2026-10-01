/**
 * Périmètres (scopes) d'une assignation de rôle.
 *
 *   tenant (toute l'organisation)
 *     └─ institution (établissement)
 *          └─ campus
 *
 * Le module `rbac` ne dépend PAS du module de tenancy : un périmètre est une
 * référence par UUID. La hiérarchie institution → campus est fournie par le
 * port `ScopeTree` (implémenté à l'assemblage par la tenancy quand elle existe).
 * Sans arbre, une assignation d'établissement ne couvre AUCUN campus (échec
 * fermé) ; seul le périmètre « tenant » couvre tout par définition.
 */
import { isUuid } from "@ecoledigitale/kernel";

export const SCOPE_TYPES = ["tenant", "institution", "campus"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export type TenantScope = { readonly type: "tenant" };
export type InstitutionScope = { readonly type: "institution"; readonly id: string };
export type CampusScope = { readonly type: "campus"; readonly id: string };
export type ScopeRef = TenantScope | InstitutionScope | CampusScope;

/** Cible d'un contrôle : un périmètre précis, ou « n'importe lequel » (menus, listes filtrées). */
export const ANY_SCOPE = "any" as const;
export type ScopeTarget = ScopeRef | typeof ANY_SCOPE;

export const TENANT_SCOPE: TenantScope = Object.freeze({ type: "tenant" });

export const institutionScope = (id: string): InstitutionScope =>
  Object.freeze({ type: "institution", id: normalizeId(id) });
export const campusScope = (id: string): CampusScope => Object.freeze({ type: "campus", id: normalizeId(id) });

function normalizeId(id: string): string {
  if (!isUuid(id)) throw new TypeError(`Identifiant de périmètre invalide : "${String(id)}".`);
  return id.toLowerCase();
}

/** Construit un `ScopeRef` depuis les colonnes `scope_type` / `scope_id` (ou un corps d'API). */
export function scopeFromParts(type: string, id: string | null | undefined): ScopeRef {
  switch (type) {
    case "tenant":
      if (id !== null && id !== undefined) throw new TypeError("Un périmètre tenant n'a pas d'identifiant.");
      return TENANT_SCOPE;
    case "institution":
      return institutionScope(id ?? "");
    case "campus":
      return campusScope(id ?? "");
    default:
      throw new TypeError(`Type de périmètre inconnu : "${type}".`);
  }
}

export function scopeId(scope: ScopeRef): string | null {
  return scope.type === "tenant" ? null : scope.id;
}

export function sameScope(a: ScopeRef, b: ScopeRef): boolean {
  if (a.type !== b.type) return false;
  return a.type === "tenant" || a.id === (b as InstitutionScope | CampusScope).id;
}

export function scopeKey(scope: ScopeRef): string {
  return scope.type === "tenant" ? "tenant" : `${scope.type}:${scope.id}`;
}

/**
 * Port : hiérarchie des périmètres d'UN tenant. Synchrone et pur pour que
 * `can()` le reste ; l'implémentation charge un instantané en amont
 * (`ScopeTreeProvider`).
 */
export interface ScopeTree {
  /** Établissement parent d'un campus ; `undefined` si inconnu. */
  institutionOfCampus(campusId: string): string | undefined;
  /**
   * Optionnel : le périmètre existe-t-il dans ce tenant ? Utilisé pour refuser une
   * assignation vers un périmètre inexistant. Absent = pas de vérification.
   */
  knows?(scope: ScopeRef): boolean;
}

/** Fournisseur asynchrone d'un `ScopeTree` pour un tenant (à brancher sur la tenancy). */
export interface ScopeTreeProvider {
  forTenant(tenantId: string): Promise<ScopeTree>;
}

/** Aucune hiérarchie connue : seules les assignations « tenant » couvrent les sous-périmètres. */
export const EMPTY_SCOPE_TREE: ScopeTree = Object.freeze({
  institutionOfCampus: () => undefined,
});

export const emptyScopeTreeProvider: ScopeTreeProvider = Object.freeze({
  forTenant: async () => EMPTY_SCOPE_TREE,
});

/** Arbre construit depuis des paires (campus → établissement), pour les tests et les adaptateurs simples. */
export function scopeTreeFromPairs(
  campusToInstitution: Readonly<Record<string, string>>,
  institutions: readonly string[] = [],
): ScopeTree {
  const map = new Map(Object.entries(campusToInstitution).map(([c, i]) => [c.toLowerCase(), i.toLowerCase()]));
  const insts = new Set([...institutions.map((i) => i.toLowerCase()), ...map.values()]);
  return {
    institutionOfCampus: (campusId) => map.get(campusId.toLowerCase()),
    knows: (scope) =>
      scope.type === "tenant" ||
      (scope.type === "institution" ? insts.has(scope.id) : map.has(scope.id)),
  };
}

/**
 * Complète un arbre avec ce que le contexte de requête dit déjà : si la requête
 * est située dans un campus ET un établissement, ce couple est connu même quand
 * l'arbre fourni l'ignore.
 */
export function withContextHints(
  tree: ScopeTree,
  hints: { institutionId?: string | undefined; campusId?: string | undefined },
): ScopeTree {
  if (!hints.campusId || !hints.institutionId) return tree;
  const campus = hints.campusId.toLowerCase();
  const institution = hints.institutionId.toLowerCase();
  return {
    institutionOfCampus: (campusId) =>
      campusId.toLowerCase() === campus ? (tree.institutionOfCampus(campusId) ?? institution) : tree.institutionOfCampus(campusId),
    ...(tree.knows ? { knows: tree.knows.bind(tree) } : {}),
  };
}

/**
 * Le périmètre `grant` (celui d'une assignation) couvre-t-il `target` ?
 *  - tenant       : couvre tout ;
 *  - institution  : couvre cette institution et ses campus ;
 *  - campus       : couvre ce campus seulement.
 */
export function scopeCovers(grant: ScopeRef, target: ScopeTarget, tree: ScopeTree): boolean {
  if (target === ANY_SCOPE) return true;
  switch (grant.type) {
    case "tenant":
      return true;
    case "institution":
      if (target.type === "institution") return target.id === grant.id;
      if (target.type === "campus") return tree.institutionOfCampus(target.id) === grant.id;
      return false;
    case "campus":
      return target.type === "campus" && target.id === grant.id;
  }
}
