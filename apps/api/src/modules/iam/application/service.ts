/**
 * Racine de composition du module : assemble les dépendances et expose les use
 * cases liés (`IamService`). C'est ce que le plugin HTTP, les tests et les autres
 * modules (via `index.ts`) consomment.
 */
import { noopLogger, systemClock, type Clock, type Logger, type RequestContext } from "@ecoledigitale/kernel";
import type { SystemDb, TenantDb } from "@ecoledigitale/database";
import type { IamConfig } from "../config";
import { PasswordHasher } from "../domain/password-hash";
import { PasswordPolicy } from "../domain/password-policy";
import { createMfaPolicy } from "../domain/mfa-policy";
import { MemoryRateLimiter } from "../infrastructure/rate-limiter.memory";
import { getProcessVerdictCache, type SessionVerdictCache } from "../infrastructure/session-verdict-cache";
import type { IamDeps, RequestMeta } from "./deps";
import { login, type LoginInput } from "./login";
import { federatedLogin, type FederatedLoginInput } from "./federated";
import * as mfa from "./mfa";
import * as password from "./password";
import * as members from "./members";
import * as impersonation from "./impersonation";
import * as sessionsUc from "./sessions";
import { noopNotifier, type AccountNotifier, type AuthenticatedPrincipal, type BackgroundTasks, type RateLimiter, type SuperAdminActor } from "./ports";

/** Exécute les tâches hors du chemin de réponse ; les erreurs sont journalisées. */
export function createBackgroundTasks(logger: Logger): BackgroundTasks {
  const pending = new Set<Promise<void>>();
  return {
    run(label, task) {
      const p: Promise<void> = new Promise<void>((resolve) => {
        setImmediate(() => {
          task()
            .catch((e: unknown) => logger.error({ event: "iam_background_failed", label, error: e instanceof Error ? e.message : String(e) }, "Tâche d'arrière-plan en échec"))
            .finally(resolve);
        });
      });
      pending.add(p);
      void p.then(() => pending.delete(p));
    },
    async drain() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

export interface IamServiceOptions {
  config: IamConfig;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  /** Défaut : mémoire (mono-process). En production multi-instance : `RedisRateLimiter`. */
  limiter?: RateLimiter;
  notifier?: AccountNotifier;
  clock?: Clock;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
  background?: BackgroundTasks;
  /** Cache du verdict de session (Redis). Absent : celui du processus s'il existe ; `null` : aucun. */
  verdictCache?: SessionVerdictCache | null;
}

export interface IamService {
  readonly deps: IamDeps;
  login(input: LoginInput): ReturnType<typeof login>;
  /** Connexion fédérée (identité déjà vérifiée par le serveur web) : voir application/federated.ts. */
  federatedLogin(input: FederatedLoginInput): ReturnType<typeof federatedLogin>;
  completeMfaChallenge(input: mfa.ChallengeInput): ReturnType<typeof mfa.completeChallenge>;
  refresh(input: sessionsUc.RefreshInput): ReturnType<typeof sessionsUc.refresh>;
  authenticate(token: string, options?: sessionsUc.AuthenticateOptions): ReturnType<typeof sessionsUc.authenticateBearer>;
  logout(principal: AuthenticatedPrincipal, meta: RequestMeta): Promise<void>;
  logoutByRefreshToken(refreshToken: string, meta: RequestMeta): Promise<void>;
  logoutAll(principal: AuthenticatedPrincipal, meta: RequestMeta): ReturnType<typeof sessionsUc.logoutAll>;
  switchTenant(principal: AuthenticatedPrincipal, input: Parameters<typeof sessionsUc.switchTenant>[2]): ReturnType<typeof sessionsUc.switchTenant>;
  switchRole(principal: AuthenticatedPrincipal, input: Parameters<typeof sessionsUc.switchRole>[2]): ReturnType<typeof sessionsUc.switchRole>;
  listSessions(principal: AuthenticatedPrincipal): ReturnType<typeof sessionsUc.listMySessions>;
  revokeSession(principal: AuthenticatedPrincipal, sessionId: string, meta: RequestMeta): ReturnType<typeof sessionsUc.revokeMySession>;
  adminRevokeMemberSessions(principal: AuthenticatedPrincipal, membershipId: string, meta: RequestMeta): ReturnType<typeof sessionsUc.adminRevokeMemberSessions>;
  changePassword(principal: AuthenticatedPrincipal, input: Parameters<typeof password.changePassword>[2]): ReturnType<typeof password.changePassword>;
  forgotPassword(input: Parameters<typeof password.forgotPassword>[1]): Promise<void>;
  resetPassword(input: Parameters<typeof password.resetPassword>[1]): ReturnType<typeof password.resetPassword>;
  resolveEnrollmentToken(token: string, meta: RequestMeta): ReturnType<typeof mfa.resolveEnrollmentToken>;
  beginMfaEnrollment(subject: mfa.MfaSubject, input: Parameters<typeof mfa.beginEnrollment>[2]): ReturnType<typeof mfa.beginEnrollment>;
  confirmMfaEnrollment(subject: mfa.MfaSubject, input: Parameters<typeof mfa.confirmEnrollment>[2]): ReturnType<typeof mfa.confirmEnrollment>;
  disableMfa(principal: AuthenticatedPrincipal, input: Parameters<typeof mfa.disableMfa>[2]): ReturnType<typeof mfa.disableMfa>;
  /** Élévation d'authentification (step-up) : code TOTP en cours de session -> MFA satisfaite pour une fenêtre courte. */
  stepUpMfa(principal: AuthenticatedPrincipal, input: Parameters<typeof mfa.stepUp>[2]): ReturnType<typeof mfa.stepUp>;
  adminResetMfa(principal: AuthenticatedPrincipal, membershipId: string, meta: RequestMeta): ReturnType<typeof mfa.adminResetMfa>;
  startImpersonation(actor: SuperAdminActor, input: Parameters<typeof impersonation.startImpersonation>[2]): ReturnType<typeof impersonation.startImpersonation>;
  provisionMember(ctx: RequestContext, input: members.ProvisionInput): ReturnType<typeof members.provisionMember>;
  listMembers(principal: AuthenticatedPrincipal, page?: { limit?: number; offset?: number }): ReturnType<typeof members.listMembers>;
  updateMember(principal: AuthenticatedPrincipal, membershipId: string, patch: Parameters<typeof members.updateMember>[3], meta: RequestMeta): ReturnType<typeof members.updateMember>;
  purgeExpiredData(retentionDays?: number): ReturnType<typeof sessionsUc.purgeExpiredData>;
  /** Attend la fin des tâches d'arrière-plan (e-mails, événements de télémétrie). */
  drainBackground(): Promise<void>;
}

export function createIamService(options: IamServiceOptions): IamService {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? noopLogger;
  const config = options.config;
  const deps: IamDeps = {
    config,
    tenantDb: options.tenantDb,
    systemDb: options.systemDb,
    clock,
    logger,
    limiter: options.limiter ?? new MemoryRateLimiter(clock),
    hasher: new PasswordHasher({ params: config.scrypt }),
    policy: new PasswordPolicy(config.password),
    mfaPolicy: createMfaPolicy(config.mfa.requiredRoles),
    notifier: options.notifier ?? noopNotifier,
    background: options.background ?? createBackgroundTasks(logger),
    // Cache du verdict de session : celui du processus (posé au démarrage de la plateforme) sauf injection (`null` = aucun).
    verdictCache: (options.verdictCache === undefined ? getProcessVerdictCache() : options.verdictCache) ?? undefined,
    sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };

  return {
    deps,
    login: (input) => login(deps, input),
    federatedLogin: (input) => federatedLogin(deps, input),
    completeMfaChallenge: (input) => mfa.completeChallenge(deps, input),
    refresh: (input) => sessionsUc.refresh(deps, input),
    authenticate: (token, opts) => sessionsUc.authenticateBearer(deps, token, opts),
    logout: (p, meta) => sessionsUc.logout(deps, p, meta),
    logoutByRefreshToken: (t, meta) => sessionsUc.logoutByRefreshToken(deps, t, meta),
    logoutAll: (p, meta) => sessionsUc.logoutAll(deps, p, meta),
    switchTenant: (p, input) => sessionsUc.switchTenant(deps, p, input),
    switchRole: (p, input) => sessionsUc.switchRole(deps, p, input),
    listSessions: (p) => sessionsUc.listMySessions(deps, p),
    revokeSession: (p, id, meta) => sessionsUc.revokeMySession(deps, p, id, meta),
    adminRevokeMemberSessions: (p, id, meta) => sessionsUc.adminRevokeMemberSessions(deps, p, id, meta),
    changePassword: (p, input) => password.changePassword(deps, p, input),
    forgotPassword: (input) => password.forgotPassword(deps, input),
    resetPassword: (input) => password.resetPassword(deps, input),
    resolveEnrollmentToken: (t, meta) => mfa.resolveEnrollmentToken(deps, t, meta),
    beginMfaEnrollment: (s, input) => mfa.beginEnrollment(deps, s, input),
    confirmMfaEnrollment: (s, input) => mfa.confirmEnrollment(deps, s, input),
    disableMfa: (p, input) => mfa.disableMfa(deps, p, input),
    stepUpMfa: (p, input) => mfa.stepUp(deps, p, input),
    adminResetMfa: (p, id, meta) => mfa.adminResetMfa(deps, p, id, meta),
    startImpersonation: (a, input) => impersonation.startImpersonation(deps, a, input),
    provisionMember: (ctx, input) => members.provisionMember(deps, ctx, input),
    listMembers: (p, page) => members.listMembers(deps, p, page),
    updateMember: (p, id, patch, meta) => members.updateMember(deps, p, id, patch, meta),
    purgeExpiredData: (days) => sessionsUc.purgeExpiredData(deps, days),
    drainBackground: () => deps.background.drain(),
  };
}
