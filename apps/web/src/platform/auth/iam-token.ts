/**
 * État IAM porté par le JWT de session NextAuth (chiffré, cookie HttpOnly) et transitions.
 *
 * Champs conservés dans le JWT NextAuth (côté serveur seulement ; `session` n'expose JAMAIS `iamRefreshToken`) :
 *   jwtToken / jwtExpiresAt   jeton d'accès IAM (15 min) et son échéance — même nom que le jeton legacy, donc
 *                             `SessionAuthSync`, le fetch-interceptor et les gardes continuent de fonctionner ;
 *   iamRefreshToken           refresh token opaque, à rotation ;
 *   iamSessionId, tenants…    métadonnées de la session IAM.
 *
 * Rotation du refresh : exclusivement sur `trigger: "update"` (route `POST /api/auth/session`, où NextAuth peut
 * réécrire le cookie). Les rendus serveur (`getServerSession` dans un layout) ne peuvent pas persister un cookie :
 * y faire tourner le refresh perdrait le nouveau jeton et déclencherait la détection de réutilisation (révocation de
 * la session). Ils lisent donc le jeton tel quel. Un « single-flight » par refresh token évite deux rotations
 * simultanées dans ce processus ; entre onglets, `lib/iam-session.ts` sérialise avec Web Locks.
 */
import type { AuthenticatedResponse, LoginResponse } from "@ecoledigitale/contracts/v2/iam";
import { IamApiError, type ClientHints, type IamServerClient } from "./iam-server";
import { iamRoleForLegacy, sessionRolesFromIam } from "./iam-roles";

export interface IamTenantRef {
  id: string;
  slug: string;
  name: string;
}

/** Étape intermédiaire en attente (changement d'établissement qui exige le second facteur). */
export interface IamPending {
  kind: "mfa_required" | "mfa_enrollment_required";
  token: string;
}

export interface IamSessionToken {
  userId?: string;
  email?: string;
  tenantId?: string;
  tenantSlug?: string;
  roles?: string[];
  activeRole?: string;
  availableRoles?: string[];
  iamRoles?: string[];
  iamActiveRole?: string;
  requiresRoleSelection?: boolean;
  jwtToken?: string;
  /** ISO 8601. */
  jwtExpiresAt?: string;
  iamRefreshToken?: string;
  iamSessionId?: string;
  tenants?: IamTenantRef[];
  mfaEnabled?: boolean;
  /** Codes de secours à montrer UNE fois (puis `ack-recovery-codes`). */
  recoveryCodes?: string[];
  iamPending?: IamPending;
  /** Dernière erreur d'une action `update` (affichée par l'interface, effacée à l'action suivante). */
  iamError?: { action: string; code: string; retryAfterSec?: number | null };
  /** La session IAM n'est plus valide (refresh refusé) : l'interface doit se déconnecter. */
  iamExpired?: boolean;
  [key: string]: unknown;
}

export type UpdateAction =
  | { action: "refresh" }
  | { action: "switch-role"; activeRole: string }
  | { action: "switch-tenant"; tenantId: string }
  | { action: "change-password"; currentPassword: string; newPassword: string }
  | { action: "disable-mfa"; password: string; code?: string; recoveryCode?: string }
  | { action: "ack-recovery-codes" }
  | { action: "mfa-enabled" }
  | { action: "clear-error" };

export interface TokenDeps {
  client: IamServerClient;
  now(): number;
  hints?: ClientHints;
}

/** Valeur du JWT NextAuth après une authentification réussie. */
export function applyAuthenticated(token: IamSessionToken, a: AuthenticatedResponse, now: number): IamSessionToken {
  const roles = sessionRolesFromIam(a.user.activeRole, a.user.availableRoles);
  const next: IamSessionToken = {
    ...token,
    userId: a.user.id,
    email: a.user.email,
    tenantId: a.user.tenantId,
    tenantSlug: a.user.tenantSlug,
    ...roles,
    requiresRoleSelection: a.user.requiresRoleSelection,
    jwtToken: a.accessToken,
    jwtExpiresAt: new Date(now + a.expiresIn * 1000).toISOString(),
    iamSessionId: a.sessionId,
    tenants: a.tenants,
    mfaEnabled: a.user.mfaEnabled,
  };
  if (a.refreshToken) next.iamRefreshToken = a.refreshToken;
  delete next.iamPending;
  delete next.iamError;
  delete next.iamExpired;
  return next;
}

function applyOutcome(token: IamSessionToken, outcome: LoginResponse, now: number): IamSessionToken {
  if (outcome.status === "authenticated") return applyAuthenticated(token, outcome, now);
  if (outcome.status === "mfa_required") return { ...token, iamPending: { kind: "mfa_required", token: outcome.challengeToken } };
  return { ...token, iamPending: { kind: "mfa_enrollment_required", token: outcome.enrollmentToken } };
}

const inflight = new Map<string, Promise<IamSessionToken>>();

/** Rotation du refresh token (une seule à la fois par jeton dans ce processus). */
export async function rotateRefresh(token: IamSessionToken, deps: TokenDeps): Promise<IamSessionToken> {
  const refreshToken = token.iamRefreshToken;
  if (!refreshToken) {
    const dead: IamSessionToken = { ...token, iamExpired: true };
    delete dead.jwtToken;
    return dead;
  }
  const existing = inflight.get(refreshToken);
  if (existing) return existing;

  const run = (async (): Promise<IamSessionToken> => {
    try {
      const r = await deps.client.refresh(refreshToken, deps.hints);
      const next: IamSessionToken = {
        ...token,
        jwtToken: r.accessToken,
        jwtExpiresAt: new Date(deps.now() + r.expiresIn * 1000).toISOString(),
        iamSessionId: r.sessionId,
        ...(r.refreshToken ? { iamRefreshToken: r.refreshToken } : {}),
      };
      delete next.iamError;
      delete next.iamExpired;
      return next;
    } catch (e) {
      if (e instanceof IamApiError && (e.status === 401 || e.status === 403)) {
        // Session révoquée, jeton réutilisé ou expiré : la session web n'a plus de support côté serveur.
        const dead: IamSessionToken = { ...token, iamExpired: true, iamError: { action: "refresh", code: e.code } };
        delete dead.jwtToken;
        delete dead.iamRefreshToken;
        return dead;
      }
      // Panne passagère (réseau, 5xx, 429) : on garde l'état, l'interface réessaiera.
      return { ...token, iamError: { action: "refresh", code: e instanceof IamApiError ? e.code : "iam.unreachable", retryAfterSec: e instanceof IamApiError ? e.retryAfterSec : null } };
    } finally {
      inflight.delete(refreshToken);
    }
  })();
  inflight.set(refreshToken, run);
  return run;
}

function failure(token: IamSessionToken, action: string, e: unknown): IamSessionToken {
  const code = e instanceof IamApiError ? e.code : "iam.unreachable";
  return { ...token, iamError: { action, code, retryAfterSec: e instanceof IamApiError ? e.retryAfterSec : null } };
}

/**
 * Actions demandées par l'interface via `useSession().update(...)`. Les données viennent du navigateur : chaque action
 * est validée et ne fait qu'appeler l'API avec les propres identifiants du jeton (jeton d'accès, mot de passe saisi).
 */
export async function handleUpdate(token: IamSessionToken, data: unknown, deps: TokenDeps): Promise<IamSessionToken> {
  const input = (data ?? {}) as Partial<UpdateAction> & Record<string, unknown>;
  const str = (v: unknown, max = 256): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
  const access = token.jwtToken;

  switch (input.action) {
    case "refresh":
      // Session ouverte avec un jeton legacy (connexion Google transitoire) : rien à renouveler, il expire à 24 h.
      if (token.legacyToken === true) return token;
      return rotateRefresh(token, deps);

    case "ack-recovery-codes": {
      const next = { ...token };
      delete next.recoveryCodes;
      return next;
    }
    case "clear-error": {
      const next = { ...token };
      delete next.iamError;
      return next;
    }
    // Indicateur d'AFFICHAGE seulement (l'état réel est côté serveur) : l'enrôlement depuis une session ouverte vient d'aboutir.
    case "mfa-enabled":
      return { ...token, mfaEnabled: true };

    case "switch-role": {
      const wanted = str(input.activeRole, 64);
      if (!wanted || !access) return failure(token, "switch-role", new IamApiError({ status: 400, code: "iam.bad_request" }));
      const iamRole = iamRoleForLegacy(wanted, token.iamRoles ?? []);
      if (!iamRole) return failure(token, "switch-role", new IamApiError({ status: 403, code: "iam.forbidden" }));
      try {
        const next = applyOutcome(token, await deps.client.switchRole(access, iamRole, deps.hints), deps.now());
        // Le rôle vient d'être choisi explicitement : l'écran de choix n'a plus lieu d'être jusqu'à la prochaine connexion.
        return next.iamPending ? next : { ...next, requiresRoleSelection: false };
      } catch (e) {
        return failure(token, "switch-role", e);
      }
    }

    case "switch-tenant": {
      const tenantId = str(input.tenantId, 64);
      if (!tenantId || !access) return failure(token, "switch-tenant", new IamApiError({ status: 400, code: "iam.bad_request" }));
      try {
        return applyOutcome(token, await deps.client.switchTenant(access, tenantId, deps.hints), deps.now());
      } catch (e) {
        return failure(token, "switch-tenant", e);
      }
    }

    case "change-password": {
      const currentPassword = str(input.currentPassword);
      const newPassword = str(input.newPassword);
      if (!currentPassword || !newPassword || !access) return failure(token, "change-password", new IamApiError({ status: 400, code: "iam.bad_request" }));
      try {
        return applyOutcome(token, await deps.client.changePassword(access, { currentPassword, newPassword }, deps.hints), deps.now());
      } catch (e) {
        return failure(token, "change-password", e);
      }
    }

    case "disable-mfa": {
      const password = str(input.password);
      const code = str(input.code, 6);
      const recoveryCode = str(input.recoveryCode, 32);
      if (!password || !access || (code === null) === (recoveryCode === null)) return failure(token, "disable-mfa", new IamApiError({ status: 400, code: "iam.bad_request" }));
      try {
        const outcome = await deps.client.disableMfa(access, { password, ...(code ? { code } : { recoveryCode: recoveryCode as string }) }, deps.hints);
        const next = applyOutcome(token, outcome, deps.now());
        return outcome.status === "authenticated" ? { ...next, mfaEnabled: false } : next;
      } catch (e) {
        return failure(token, "disable-mfa", e);
      }
    }

    default:
      // Aucune autre mise à jour venant du navigateur n'est prise en compte (le legacy acceptait n'importe quels champs).
      return token;
  }
}

/** Le jeton d'accès expire-t-il dans moins de `skewSec` secondes ? */
export function accessExpiresWithin(token: IamSessionToken, skewSec: number, now: number): boolean {
  if (!token.jwtExpiresAt) return true;
  const t = Date.parse(token.jwtExpiresAt);
  return !Number.isFinite(t) || t - now <= skewSec * 1000;
}
