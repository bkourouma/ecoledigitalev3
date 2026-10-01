/**
 * Dépendances communes des use cases + utilitaires partagés (événements,
 * erreurs génériques, anti-timing).
 */
import { isIP } from "node:net";
import {
  ForbiddenError,
  UnauthorizedError,
  createDomainEvent,
  createRequestContext,
  createSystemContext,
  newId,
  type Clock,
  type Logger,
  type RequestContext,
} from "@ecoledigitale/kernel";
import { PgOutboxWriter, type SystemDb, type TenantDb, type Tx } from "@ecoledigitale/database";
import { AuthErrorCodes } from "@ecoledigitale/contracts/v2/iam";
import type { IamConfig } from "../config";
import type { PasswordHasher } from "../domain/password-hash";
import type { PasswordPolicy } from "../domain/password-policy";
import type { MfaPolicy } from "../domain/mfa-policy";
import type { AccountNotifier, BackgroundTasks, RateLimiter } from "./ports";

export interface IamDeps {
  config: IamConfig;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  clock: Clock;
  logger: Logger;
  limiter: RateLimiter;
  hasher: PasswordHasher;
  policy: PasswordPolicy;
  mfaPolicy: MfaPolicy;
  notifier: AccountNotifier;
  background: BackgroundTasks;
  /** Attente injectable (tests déterministes). */
  sleep: (ms: number) => Promise<void>;
}

/** Métadonnées de la requête HTTP, nettoyées par la couche http. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

export const IAM_EVENT = {
  userLoggedIn: "iam.user.logged_in",
  loginFailed: "iam.login.failed",
  sessionRevoked: "iam.session.revoked",
  mfaEnabled: "iam.mfa.enabled",
  mfaDisabled: "iam.mfa.disabled",
  mfaReset: "iam.mfa.reset",
  passwordChanged: "iam.password.changed",
  impersonationStarted: "iam.impersonation.started",
  membershipCreated: "iam.membership.created",
  membershipChanged: "iam.membership.changed",
} as const;
export type IamEventType = (typeof IAM_EVENT)[keyof typeof IAM_EVENT];

/** Écrit un événement dans l'outbox, dans la transaction COURANTE (conventions §6 : payload `{ v: 1, ... }`). */
export async function publish(
  deps: Pick<IamDeps, "clock">,
  tx: Tx,
  ctx: RequestContext,
  type: IamEventType,
  payload: Record<string, unknown>,
  aggregate?: { type: string; id: string },
): Promise<void> {
  // Le module audit lit `userId` : alias de `identityId` (l'identifiant d'utilisateur EST celui de l'identité).
  const body: Record<string, unknown> = { v: 1, ...payload };
  if (body.userId === undefined && typeof body.identityId === "string") body.userId = body.identityId;
  const event = createDomainEvent({
    type,
    payload: body,
    ctx,
    clock: deps.clock,
    ...(aggregate ? { aggregateType: aggregate.type, aggregateId: aggregate.id } : {}),
  });
  await new PgOutboxWriter(tx).append([event]);
}

export function userContext(tenantId: string, identityId: string, roles: readonly string[], requestId: string): RequestContext {
  return createRequestContext({ tenantId, userId: identityId, roles, requestId, actor: "user" });
}

export function systemContext(tenantId: string, requestId: string): RequestContext {
  return createSystemContext(tenantId, requestId);
}

// -----------------------------------------------------------------------------
// Erreurs
// -----------------------------------------------------------------------------

/** 429 : sous-classe de `ForbiddenError` (le kernel n'a pas de catégorie dédiée) ; la couche HTTP mappe sur 429 + Retry-After. */
export class TooManyAttemptsError extends ForbiddenError {
  readonly retryAfterSec: number;
  constructor(retryAfterMs: number) {
    const sec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    super("Trop de tentatives. Réessayez plus tard.", { code: AuthErrorCodes.tooManyAttempts, details: { retryAfterSec: sec } });
    this.retryAfterSec = sec;
  }
}

/** Message VOLONTAIREMENT identique pour « e-mail inconnu », « mot de passe faux », « compte désactivé »… */
export const invalidCredentials = (): UnauthorizedError =>
  new UnauthorizedError("Identifiants invalides.", { code: AuthErrorCodes.invalidCredentials });

export const sessionInvalid = (code: string = AuthErrorCodes.tokenInvalid): UnauthorizedError =>
  new UnauthorizedError("Authentification requise.", { code });

// -----------------------------------------------------------------------------
// Anti-timing
// -----------------------------------------------------------------------------

/**
 * Complète l'attente jusqu'à `minMs` mesurés depuis `startedAt` (horloge monotone).
 * À appeler sur TOUS les chemins d'échec : la durée observable ne dépend plus du
 * travail réellement effectué (compte existant ou non, hash bcrypt ou scrypt…),
 * tant que ce travail reste inférieur au plancher.
 */
export async function padToMinimum(deps: Pick<IamDeps, "sleep">, startedAt: bigint, minMs: number): Promise<void> {
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const remaining = minMs - elapsedMs;
  if (remaining > 0) await deps.sleep(remaining);
}

export const startTimer = (): bigint => process.hrtime.bigint();

// -----------------------------------------------------------------------------
// Assainissement des métadonnées
// -----------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

export function cleanText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(CONTROL, " ").trim().slice(0, max);
  return v.length > 0 ? v : null;
}

export function cleanIp(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/^::ffff:/i, "");
  return isIP(v) ? v : null;
}

export function newRequestId(): string {
  return newId();
}

export type { RequestContext, Logger };
