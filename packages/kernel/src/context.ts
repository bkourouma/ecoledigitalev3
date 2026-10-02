/**
 * Contexte de requête et sa propagation (AsyncLocalStorage).
 *
 * Le contexte est IMMUABLE (gelé) : pour « changer de campus », on dérive un
 * nouveau contexte (`deriveContext`). `tenantId` est obligatoire dans tous les
 * cas : il n'existe pas de contexte « sans tenant ». Une opération globale
 * (job, super-admin sur la plateforme) passe par `SystemDb` (package database),
 * pas par un contexte à tenant vide.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { InternalError, ValidationError } from "./errors";
import { newId, parseUuid } from "./id";

/**
 * - `user`       : utilisateur du tenant authentifié ;
 * - `system`     : tâche interne (job, relais d'outbox), jamais déclenchée par un humain ;
 * - `superAdmin` : opérateur de la plateforme agissant SUR un tenant désigné
 *                  (sélection ou impersonation) — toujours à auditer.
 */
export type ActorType = "user" | "system" | "superAdmin";

export interface RequestContext {
  readonly tenantId: string;
  /** `null` pour un acteur `system`. */
  readonly userId: string | null;
  readonly roles: readonly string[];
  readonly requestId: string;
  readonly institutionId?: string;
  readonly campusId?: string;
  readonly actor: ActorType;
  /**
   * `true` si l'authentification forte (MFA) est satisfaite pour la session
   * courante. Renseigné par l'authentification ; `false` par défaut. Exigé par
   * les permissions sensibles (`PermissionDef.sensitive`, évaluées par le RBAC).
   */
  readonly mfa: boolean;
}

export interface RequestContextInput {
  tenantId: string;
  userId?: string | null;
  roles?: readonly string[];
  requestId?: string;
  institutionId?: string | null;
  campusId?: string | null;
  actor?: ActorType;
  /** MFA satisfaite pour cette session (défaut `false`). */
  mfa?: boolean;
}

const ACTORS: readonly ActorType[] = ["user", "system", "superAdmin"];

let ambientRequestId: (() => string | undefined) | undefined;

/**
 * Observabilité (ADR-009) : fournisseur du `request_id` AMBIANT (celui de la requête HTTP ou de l'événement en cours de
 * traitement). Un contexte créé SANS `requestId` explicite (`createSystemContext(tenantId)` dans un abonné du worker) en hérite au
 * lieu de générer un identifiant neuf : les événements, lignes d'audit et journaux qu'il produit restent corrélés à la requête
 * d'origine. Sans fournisseur, comportement inchangé (UUID v7 généré). Posé par la plateforme, jamais par un module.
 */
export function setAmbientRequestIdProvider(provider: (() => string | undefined) | undefined): void {
  ambientRequestId = provider;
}

function ambientId(): string | undefined {
  try {
    const id = ambientRequestId?.();
    return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : undefined;
  } catch {
    return undefined;
  }
}

function optionalUuid(value: string | null | undefined, field: string): string | undefined {
  return value === undefined || value === null ? undefined : parseUuid(value, field);
}

/**
 * Construit un contexte validé :
 *  - `tenantId` (et `userId`, `institutionId`, `campusId` s'ils sont fournis) doivent être des UUID ;
 *  - `user` et `superAdmin` exigent un `userId` ; `system` n'en a pas ;
 *  - `requestId` est généré (UUID v7) s'il manque.
 */
export function createRequestContext(input: RequestContextInput): RequestContext {
  const actor: ActorType = input.actor ?? "user";
  if (!ACTORS.includes(actor)) {
    throw ValidationError.field("actor", `actor inconnu : "${String(actor)}".`, "invalid_actor");
  }

  const tenantId = parseUuid(input.tenantId, "tenantId");
  const userId = optionalUuid(input.userId, "userId") ?? null;

  if (actor === "system" && userId !== null) {
    throw ValidationError.field("userId", "Un acteur system n'a pas de userId.", "system_has_user");
  }
  if (actor !== "system" && userId === null) {
    throw ValidationError.field("userId", `Un acteur ${actor} exige un userId.`, "user_required");
  }

  const roles = Object.freeze([...new Set((input.roles ?? []).map((r) => r.trim()).filter(Boolean))]);
  const institutionId = optionalUuid(input.institutionId, "institutionId");
  const campusId = optionalUuid(input.campusId, "campusId");

  return Object.freeze({
    tenantId,
    userId,
    roles,
    requestId: input.requestId?.trim() || ambientId() || newId(),
    actor,
    mfa: input.mfa === true,
    ...(institutionId ? { institutionId } : {}),
    ...(campusId ? { campusId } : {}),
  });
}

/** Contexte d'une tâche interne sur un tenant donné. */
export function createSystemContext(tenantId: string, requestId?: string): RequestContext {
  return createRequestContext({
    tenantId,
    actor: "system",
    userId: null,
    ...(requestId ? { requestId } : {}),
  });
}

/**
 * Dérive un contexte (ex. restreindre à un campus). Le `tenantId` et l'`actor`
 * ne sont volontairement PAS modifiables : changer de tenant = nouveau contexte
 * explicite via `createRequestContext`.
 */
export function deriveContext(
  base: RequestContext,
  patch: {
    roles?: readonly string[];
    institutionId?: string | null;
    campusId?: string | null;
    requestId?: string;
    /** Exceptionnel : élever la MFA relève de l'authentification, pas d'un module. */
    mfa?: boolean;
  },
): RequestContext {
  return createRequestContext({
    tenantId: base.tenantId,
    userId: base.userId,
    actor: base.actor,
    mfa: patch.mfa ?? base.mfa,
    roles: patch.roles ?? base.roles,
    requestId: patch.requestId ?? base.requestId,
    institutionId: patch.institutionId === undefined ? (base.institutionId ?? null) : patch.institutionId,
    campusId: patch.campusId === undefined ? (base.campusId ?? null) : patch.campusId,
  });
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Exécute `fn` avec `ctx` disponible via `getRequestContext()` pour tout son arbre asynchrone. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Comme `getRequestContext` mais lève si aucun contexte n'est actif (bug de câblage). */
export function requireRequestContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new InternalError("Aucun RequestContext actif.", { code: "CONTEXT_MISSING" });
  }
  return ctx;
}

export function hasRole(ctx: RequestContext, role: string): boolean {
  return ctx.roles.includes(role);
}
