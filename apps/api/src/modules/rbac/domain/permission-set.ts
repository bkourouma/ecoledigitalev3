/**
 * Évaluation des permissions — 100 % PURE (aucune I/O, horloge injectée).
 *
 *   PermissionSet        : ce qu'un utilisateur a reçu (par permission : fenêtres
 *                          { périmètre, validité }), précalculé depuis ses assignations ;
 *   AuthorizationContext : PermissionSet + MFA + instant + hiérarchie des périmètres
 *                          + périmètre actif de la requête ;
 *   can / decide         : la décision. REFUS PAR DÉFAUT : sans octroi explicite
 *                          couvrant le périmètre demandé, à l'instant demandé, la
 *                          réponse est non.
 *
 * Règles :
 *   1. Une permission est accordée si AU MOINS UNE assignation active (validité
 *      début ≤ now < fin) la porte avec un périmètre qui COUVRE la cible.
 *   2. Couverture : tenant ⊇ institution ⊇ campus (cf. `scopeCovers`).
 *   3. Cible omise : périmètre actif de la requête (campus > établissement) ; à
 *      défaut le tenant entier — qui n'est couvert que par une assignation tenant.
 *   4. `ANY_SCOPE` : « l'utilisateur détient-il cette permission quelque part ? »
 *      (menus, endpoints de liste qui filtrent ensuite par `grantedScopes`).
 *   5. Permission sensible : en plus, la session doit avoir satisfait la MFA.
 */
import { InternalError, type RequestContext } from "@ecoledigitale/kernel";
import {
  ANY_SCOPE,
  EMPTY_SCOPE_TREE,
  campusScope,
  institutionScope,
  scopeCovers,
  scopeKey,
  TENANT_SCOPE,
  withContextHints,
  type ScopeRef,
  type ScopeTarget,
  type ScopeTree,
} from "./scope";

export interface PermissionWindow {
  readonly scope: ScopeRef;
  /** Epoch ms inclus ; `null` = valide depuis toujours. */
  readonly validFrom: number | null;
  /** Epoch ms exclu ; `null` = sans expiration. */
  readonly validUntil: number | null;
  readonly roleId: string;
  readonly assignmentId: string;
}

export interface PermissionSet {
  readonly tenantId: string;
  readonly userId: string;
  readonly byPermission: ReadonlyMap<string, readonly PermissionWindow[]>;
  /** Clés du catalogue marquées sensibles (MFA requise). */
  readonly sensitive: ReadonlySet<string>;
  /** Epoch ms du chargement (diagnostic / cache). */
  readonly loadedAt: number;
}

export interface AssignmentRecord {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly scope: ScopeRef;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
}

export interface BuildPermissionSetInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly assignments: readonly AssignmentRecord[];
  /** Permissions concrètes de chaque rôle (clé = roleId). */
  readonly rolePermissions: ReadonlyMap<string, readonly string[]>;
  readonly sensitive: Iterable<string>;
  readonly now: Date;
}

/** Précalcule le `PermissionSet` d'un utilisateur. Pure. Les assignations déjà expirées sont ignorées. */
export function buildPermissionSet(input: BuildPermissionSetInput): PermissionSet {
  const now = input.now.getTime();
  const acc = new Map<string, PermissionWindow[]>();
  for (const a of input.assignments) {
    const until = a.validUntil ? a.validUntil.getTime() : null;
    if (until !== null && until <= now) continue; // déjà expirée : inutile de la conserver
    const window: PermissionWindow = Object.freeze({
      scope: a.scope,
      validFrom: a.validFrom ? a.validFrom.getTime() : null,
      validUntil: until,
      roleId: a.roleId,
      assignmentId: a.assignmentId,
    });
    for (const key of input.rolePermissions.get(a.roleId) ?? []) {
      const list = acc.get(key);
      if (list) list.push(window);
      else acc.set(key, [window]);
    }
  }
  return Object.freeze({
    tenantId: input.tenantId.toLowerCase(),
    userId: input.userId.toLowerCase(),
    byPermission: acc,
    sensitive: new Set(input.sensitive),
    loadedAt: now,
  });
}

export function emptyPermissionSet(tenantId: string, userId: string, now: Date): PermissionSet {
  return buildPermissionSet({
    tenantId,
    userId,
    assignments: [],
    rolePermissions: new Map(),
    sensitive: [],
    now,
  });
}

export interface AuthorizationContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly permissionSet: PermissionSet;
  /** MFA satisfaite pour la session (`RequestContext.mfa`). */
  readonly mfa: boolean;
  readonly now: Date;
  readonly tree: ScopeTree;
  /** Périmètre actif de la requête, utilisé quand `can` est appelé sans cible. */
  readonly activeScope?: ScopeRef;
}

export interface CreateAuthorizationContextInput {
  readonly ctx: RequestContext;
  readonly permissionSet: PermissionSet;
  readonly now: Date;
  readonly tree?: ScopeTree;
}

/** Périmètre actif d'une requête : campus, sinon établissement, sinon aucun (= tenant). */
export function activeScopeOf(ctx: Pick<RequestContext, "campusId" | "institutionId">): ScopeRef | undefined {
  if (ctx.campusId) return campusScope(ctx.campusId);
  if (ctx.institutionId) return institutionScope(ctx.institutionId);
  return undefined;
}

/**
 * Assemble le contexte d'autorisation d'une requête. Refuse (erreur de câblage)
 * un `PermissionSet` qui n'est pas celui de l'utilisateur/tenant du contexte :
 * mieux vaut un 500 qu'un octroi d'un autre utilisateur.
 */
export function createAuthorizationContext(input: CreateAuthorizationContextInput): AuthorizationContext {
  const { ctx, permissionSet } = input;
  if (ctx.userId === null || ctx.userId.toLowerCase() !== permissionSet.userId || ctx.tenantId.toLowerCase() !== permissionSet.tenantId) {
    throw new InternalError("PermissionSet étranger au contexte de requête.", { code: "rbac.permission_set_mismatch" });
  }
  const active = activeScopeOf(ctx);
  const tree = withContextHints(input.tree ?? EMPTY_SCOPE_TREE, {
    institutionId: ctx.institutionId,
    campusId: ctx.campusId,
  });
  return Object.freeze({
    tenantId: permissionSet.tenantId,
    userId: permissionSet.userId,
    permissionSet,
    mfa: ctx.mfa === true,
    now: input.now,
    tree,
    ...(active ? { activeScope: active } : {}),
  });
}

export type DenyReason =
  /** Aucune assignation ne porte cette permission. */
  | "not_granted"
  /** Portée par des assignations, mais aucune ne couvre le périmètre demandé. */
  | "out_of_scope"
  /** Portée et couvrante, mais hors fenêtre de validité (expirée ou pas encore valide). */
  | "not_active"
  /** Accordée, mais sensible et la MFA n'est pas satisfaite. */
  | "mfa_required";

export type Decision =
  | { readonly allowed: true; readonly reason: "granted" }
  | { readonly allowed: false; readonly reason: DenyReason };

const GRANTED: Decision = Object.freeze({ allowed: true, reason: "granted" });
const deny = (reason: DenyReason): Decision => Object.freeze({ allowed: false, reason });

/** Décision détaillée (la raison sert aux codes d'erreur et au diagnostic). */
export function decide(auth: AuthorizationContext, permission: string, scope?: ScopeTarget): Decision {
  const set = auth.permissionSet;
  if (set.tenantId !== auth.tenantId.toLowerCase() || set.userId !== auth.userId.toLowerCase()) {
    return deny("not_granted");
  }
  const windows = set.byPermission.get(permission);
  if (!windows || windows.length === 0) return deny("not_granted");

  const target: ScopeTarget = scope ?? auth.activeScope ?? TENANT_SCOPE;
  const now = auth.now.getTime();

  let covering = 0;
  let active = 0;
  for (const w of windows) {
    if (!scopeCovers(w.scope, target, auth.tree)) continue;
    covering += 1;
    if ((w.validFrom === null || w.validFrom <= now) && (w.validUntil === null || now < w.validUntil)) active += 1;
  }
  if (covering === 0) return deny("out_of_scope");
  if (active === 0) return deny("not_active");
  if (set.sensitive.has(permission) && !auth.mfa) return deny("mfa_required");
  return GRANTED;
}

/** `can(ctx, permission, scope?)` — pur, refus par défaut. */
export function can(auth: AuthorizationContext, permission: string, scope?: ScopeTarget): boolean {
  return decide(auth, permission, scope).allowed;
}

/** Vrai si TOUTES les permissions sont accordées sur la cible. */
export function canAll(auth: AuthorizationContext, permissions: readonly string[], scope?: ScopeTarget): boolean {
  return permissions.every((p) => can(auth, p, scope));
}

/**
 * Périmètres où `permission` est actuellement accordée (MFA incluse), dédupliqués.
 * Un périmètre tenant couvre tout : la liste se réduit alors à `[tenant]`.
 * Sert aux endpoints de liste : « filtrer sur ces campus/établissements ».
 */
export function grantedScopes(auth: AuthorizationContext, permission: string): ScopeRef[] {
  const set = auth.permissionSet;
  if (set.tenantId !== auth.tenantId.toLowerCase() || set.userId !== auth.userId.toLowerCase()) return [];
  if (set.sensitive.has(permission) && !auth.mfa) return [];
  const now = auth.now.getTime();
  const seen = new Map<string, ScopeRef>();
  for (const w of set.byPermission.get(permission) ?? []) {
    if (w.validFrom !== null && w.validFrom > now) continue;
    if (w.validUntil !== null && now >= w.validUntil) continue;
    seen.set(scopeKey(w.scope), w.scope);
  }
  if (seen.has("tenant")) return [TENANT_SCOPE];
  return [...seen.values()];
}

/** Toutes les permissions actuellement accordées « quelque part » (diagnostic, `/me/permissions`). */
export function effectivePermissions(auth: AuthorizationContext): string[] {
  const out: string[] = [];
  for (const key of auth.permissionSet.byPermission.keys()) {
    if (can(auth, key, ANY_SCOPE)) out.push(key);
  }
  return out.sort();
}
