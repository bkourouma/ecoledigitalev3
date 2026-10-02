/**
 * Appels NAVIGATEUR vers `/api/v1/iam/*` (réécriture Next -> API) pour les pages de compte.
 *
 * Ne servent que ce qui ne retourne pas de jeton de session : la connexion, le défi MFA, l'enrôlement qui ouvre une
 * session, le changement de rôle / d'établissement / de mot de passe et la désactivation de la MFA passent par
 * NextAuth (`signIn` / `update`) pour que les refresh tokens restent côté serveur.
 *
 * `window.fetch` est patché par `lib/fetch-interceptor.ts` : il ajoute `X-Tenant` et, hors routes publiques, le jeton
 * d'accès. Les appels qui portent leur PROPRE jeton (jeton d'enrôlement, jeton d'accès de la session pour
 * `mfa/enroll|verify`) le posent explicitement.
 */

export class IamClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: string[];
  readonly retryAfterSec: number | null;
  constructor(init: { status: number; code: string; issues?: string[]; retryAfterSec?: number | null }) {
    super(init.code);
    this.name = "IamClientError";
    this.status = init.status;
    this.code = init.code;
    this.issues = init.issues ?? [];
    this.retryAfterSec = init.retryAfterSec ?? null;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  bearer?: string | undefined;
}

export function iamFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  return apiFetch<T>(`/api/v1/iam${path}`, options);
}

export async function apiFetch<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new IamClientError({ status: 0, code: "iam.unreachable" });
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    const body = (json ?? {}) as { code?: unknown; issues?: Array<{ message?: unknown }> };
    const retry = Number(response.headers.get("retry-after"));
    throw new IamClientError({
      status: response.status,
      code: typeof body.code === "string" ? body.code : `http.${response.status}`,
      issues: Array.isArray(body.issues) ? body.issues.map((i) => String(i.message ?? "")).filter(Boolean) : [],
      retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : null,
    });
  }
  return json as T;
}

/** Message d'erreur affichable, en français, sans détail technique ni indice sur l'existence d'un compte. */
export function explainIamError(error: unknown): string {
  if (!(error instanceof IamClientError)) return "Une erreur est survenue. Réessayez.";
  switch (error.code) {
    case "iam.invalid_credentials":
      return "Identifiants invalides.";
    case "iam.too_many_attempts": {
      const minutes = Math.max(1, Math.ceil((error.retryAfterSec ?? 60) / 60));
      return `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`;
    }
    case "iam.password_policy":
      return error.issues.length > 0 ? error.issues.join(" ") : "Le mot de passe ne respecte pas la politique de sécurité.";
    case "iam.reset_token_invalid":
      return "Ce lien n'est plus valable. Demandez-en un nouveau.";
    case "iam.mfa_invalid_code":
      return "Code invalide. Vérifiez l'heure de votre téléphone et réessayez.";
    case "iam.mfa_challenge_invalid":
      return "La vérification a expiré. Reconnectez-vous.";
    case "iam.mfa_already_enabled":
      return "La vérification en deux étapes est déjà activée.";
    case "iam.mfa_not_enabled":
      return "La vérification en deux étapes n'est pas activée.";
    case "iam.mfa_mandatory":
      return "Votre rôle exige la vérification en deux étapes : elle ne peut pas être désactivée.";
    case "iam.impersonation_forbidden":
      return "Action impossible pendant une session d'assistance.";
    case "iam.no_active_access":
      return "Aucun accès actif pour cet établissement.";
    case "iam.forbidden":
      return "Action non autorisée.";
    case "iam.unreachable":
      return "Service d'authentification injoignable. Réessayez dans un instant.";
    default:
      return error.status === 403 ? "Action non autorisée." : "Une erreur est survenue. Réessayez.";
  }
}

/** Erreur d'une action `update()` de session (code seul) : même traduction. */
export function explainIamCode(code: string, retryAfterSec?: number | null): string {
  return explainIamError(new IamClientError({ status: 400, code, retryAfterSec: retryAfterSec ?? null }));
}

// -----------------------------------------------------------------------------
// Appels typés (corps/réponses minimaux ; le schéma complet est dans packages/contracts/src/v2/iam.ts)
// -----------------------------------------------------------------------------

export interface MfaEnrollment {
  otpauthUri: string;
  secret: string;
  issuer: string;
  accountName: string;
}

export const iamApi = {
  forgotPassword: (email: string) => iamFetch<{ message: string }>("/password/forgot", { method: "POST", body: { email } }),
  resetPassword: (token: string, newPassword: string) => iamFetch<void>("/password/reset", { method: "POST", body: { token, newPassword } }),
  /** `bearer` = jeton d'enrôlement (login en attente d'enrôlement) OU jeton d'accès (+ `password` obligatoire). */
  beginMfaEnrollment: (bearer: string, password?: string) => iamFetch<MfaEnrollment>("/mfa/enroll", { method: "POST", bearer, body: password ? { password } : {} }),
  /** Confirmation depuis une session ouverte (le jeton d'accès est celui de la session). */
  confirmMfaEnrollment: (accessToken: string, code: string) => iamFetch<{ recoveryCodes: string[] }>("/mfa/verify", { method: "POST", bearer: accessToken, body: { code, client: "mobile" } }),
  listSessions: () =>
    iamFetch<{ sessions: Array<{ id: string; current: boolean; kind: "user" | "impersonation"; activeRole: string; mfaVerified: boolean; ip: string | null; userAgent: string | null; deviceName: string | null; createdAt: string; lastSeenAt: string; expiresAt: string }> }>("/sessions"),
  revokeSession: (id: string) => iamFetch<void>(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  logoutAll: () => iamFetch<{ revoked: number }>("/logout-all", { method: "POST", body: {} }),
  listMembers: () => iamFetch<{ members: Array<{ membershipId: string; identityId: string; email: string; status: "invited" | "active" | "suspended" | "revoked"; roles: string[]; baseRole: string; mfaEnabled: boolean; createdAt: string }> }>("/admin/members"),
  inviteMember: (input: { email: string; roles: string[] }) => iamFetch<{ membershipId: string }>("/admin/members", { method: "POST", body: { ...input, sendInvitation: true } }),
  updateMember: (membershipId: string, patch: { status?: "active" | "suspended" | "revoked"; roles?: string[] }) =>
    iamFetch<{ membershipId: string; status: string; roles: string[] }>(`/admin/members/${encodeURIComponent(membershipId)}`, { method: "PATCH", body: patch }),
  revokeMemberSessions: (membershipId: string) => iamFetch<{ revoked: number }>(`/admin/members/${encodeURIComponent(membershipId)}/sessions/revoke`, { method: "POST", body: {} }),
  /** Rôles RBAC du tenant (`GET /rbac/roles`) et attribution d'un rôle à une identité (`POST /rbac/assignments`, périmètre : tout le tenant). */
  listRbacRoles: () => apiFetch<{ roles: Array<{ id: string; key: string; templateKey: string | null }> }>("/api/v1/rbac/roles"),
  assignRbacRole: (identityId: string, roleId: string) => apiFetch<unknown>("/api/v1/rbac/assignments", { method: "POST", body: { userId: identityId, identityId, roleId, scope: { type: "tenant" } } }),
  resetMemberMfa: (membershipId: string) => iamFetch<void>(`/admin/members/${encodeURIComponent(membershipId)}/mfa/reset`, { method: "POST", body: {} }),
};
