/**
 * Branchement de NextAuth sur le module `iam` (`NEXT_PUBLIC_AUTH_V2=1`) : fournisseurs « identifiants », « défi MFA »
 * et « enrôlement MFA », callbacks `jwt` / `session`, événement `signOut`.
 *
 * Connexion en plusieurs étapes, sans jamais conserver de session partielle :
 *   1. `signIn("credentials", { email, password })`
 *        -> session                              si aucune MFA n'est requise ;
 *        -> erreur `MFA_REQUIRED:<jeton>`          le client appelle l'étape 2a ;
 *        -> erreur `MFA_ENROLLMENT_REQUIRED:<jeton>` le client appelle l'étape 2b ;
 *        -> erreur `RATE_LIMITED:<secondes>` / `NO_ACCESS` / `CredentialsSignin` (identifiants invalides : message
 *           volontairement identique pour e-mail inconnu et mot de passe faux).
 *   2a. `signIn("iam-mfa", { challengeToken, code | recoveryCode })`
 *   2b. le navigateur appelle `POST /api/v1/iam/mfa/enroll` (jeton d'enrôlement) puis
 *       `signIn("iam-enroll", { enrollmentToken, code })` : le serveur confirme l'enrôlement et ouvre la session ;
 *       les codes de secours sont transmis UNE fois par `session.recoveryCodes`.
 * Les jetons d'étape sont courts (5 à 10 min), à usage unique et ne donnent accès à aucune route.
 */
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { iamApiBaseUrl } from "./iam-config";
import { IamApiError, clientHintsFromHeaders, createIamServerClient, type ClientHints, type IamServerClient } from "./iam-server";
import { applyAuthenticated, handleUpdate, withLegacyUserId, type IamSessionToken } from "./iam-token";

type AuthorizeReq = { headers?: Record<string, string | string[] | undefined> } | undefined;

export function defaultIamClient(): IamServerClient {
  return createIamServerClient({ baseUrl: iamApiBaseUrl() });
}

function userFor(token: IamSessionToken) {
  return { id: token.userId ?? "", email: token.email ?? "", name: token.email ?? "", iamToken: token };
}
/** Erreur NextAuth « métier » : le message est transmis tel quel au client (`result.error`). */
function authError(message: string): never {
  throw new Error(message);
}

/** Traduit une erreur d'API en message de connexion sans rien révéler de plus que l'API elle-même. */
function loginError(e: unknown): never {
  if (e instanceof IamApiError) {
    if (e.status === 429 || e.code === "iam.too_many_attempts") authError(`RATE_LIMITED:${e.retryAfterSec ?? 60}`);
    if (e.code === "iam.no_active_access") authError("NO_ACCESS");
    if (e.status === 0) authError("UNREACHABLE");
    if (e.status >= 500) authError("UNAVAILABLE");
  }
  // Identifiants invalides, compte désactivé, défi expiré… : la même réponse (NextAuth : « CredentialsSignin »).
  return null as never;
}

export function createIamProviders(getClient: () => IamServerClient = defaultIamClient, now: () => number = Date.now) {
  const hints = (req: AuthorizeReq): ClientHints => clientHintsFromHeaders(req?.headers);
  const str = (v: unknown, max = 512): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

  return [
    CredentialsProvider({
      id: "credentials",
      name: "credentials",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" }, tenantSlug: { label: "Tenant", type: "text" } },
      async authorize(credentials, req) {
        const email = str(credentials?.email, 254);
        const password = str(credentials?.password, 256);
        if (!email || !password) return null;
        const tenantSlug = str(credentials?.tenantSlug, 64);
        try {
          const out = await getClient().login({ email: email.trim().toLowerCase(), password, ...(tenantSlug ? { tenantSlug } : {}) }, hints(req as AuthorizeReq));
          if (out.status === "mfa_required") return authError(`MFA_REQUIRED:${out.challengeToken}`);
          if (out.status === "mfa_enrollment_required") return authError(`MFA_ENROLLMENT_REQUIRED:${out.enrollmentToken}`);
          return userFor(await withLegacyUserId(applyAuthenticated({}, out, now()), getClient(), hints(req as AuthorizeReq))) as never;
        } catch (e) {
          if (e instanceof Error && !(e instanceof IamApiError)) throw e; // erreurs « métier » ci-dessus
          return loginError(e);
        }
      },
    }),
    CredentialsProvider({
      id: "iam-mfa",
      name: "iam-mfa",
      credentials: { challengeToken: { type: "text" }, code: { type: "text" }, recoveryCode: { type: "text" } },
      async authorize(credentials, req) {
        const challengeToken = str(credentials?.challengeToken, 1024);
        const code = str(credentials?.code, 6);
        const recoveryCode = str(credentials?.recoveryCode, 32);
        if (!challengeToken || (code === null) === (recoveryCode === null)) return null;
        try {
          const out = await getClient().completeChallenge({ challengeToken, ...(code ? { code } : { recoveryCode: recoveryCode as string }) }, hints(req as AuthorizeReq));
          return userFor(await withLegacyUserId(applyAuthenticated({}, out, now()), getClient(), hints(req as AuthorizeReq))) as never;
        } catch (e) {
          if (e instanceof Error && !(e instanceof IamApiError)) throw e;
          return loginError(e);
        }
      },
    }),
    CredentialsProvider({
      id: "iam-enroll",
      name: "iam-enroll",
      credentials: { enrollmentToken: { type: "text" }, code: { type: "text" } },
      async authorize(credentials, req) {
        const enrollmentToken = str(credentials?.enrollmentToken, 1024);
        const code = str(credentials?.code, 6);
        if (!enrollmentToken || !code) return null;
        try {
          const out = await getClient().verifyEnrollment({ enrollmentToken, code }, hints(req as AuthorizeReq));
          if (!out.session) return null;
          const token = await withLegacyUserId(applyAuthenticated({}, out.session, now()), getClient(), hints(req as AuthorizeReq));
          return userFor({ ...token, recoveryCodes: out.recoveryCodes }) as never;
        } catch (e) {
          if (e instanceof Error && !(e instanceof IamApiError)) throw e;
          return loginError(e);
        }
      },
    }),
  ];
}

/**
 * Callback `signIn` du fournisseur Google en V2 : vérifie `email_verified`, demande à iam d'ouvrir la session
 * (`POST /iam/federated-login`, secret de service `IAM_SERVICE_SECRET`) et applique sa politique MFA.
 *   - session ouverte -> l'état IAM est posé sur `user.iamToken` (lu par le callback `jwt`) ;
 *   - second facteur requis -> abandon de la connexion OAuth et redirection vers `/login?mfa=<jeton>` / `?enroll=<jeton>`
 *     (le formulaire reprend à l'étape voulue avec le fournisseur `iam-mfa` / `iam-enroll`) ;
 *   - aucun accès -> `/login?error=NO_ACCESS`. AUCUN compte n'est créé à la volée.
 * Renvoie `null` quand le secret de service n'est pas configuré : l'appelant retombe sur la connexion legacy transitoire.
 */
export function createGoogleSignIn(getClient: () => IamServerClient = defaultIamClient, now: () => number = Date.now, secretOf: () => string | undefined = () => process.env.IAM_SERVICE_SECRET) {
  return async function googleSignIn({ user, account, profile }: { user: unknown; account: { provider?: string } | null; profile?: unknown }): Promise<boolean | string | null> {
    if (account?.provider !== "google") return true;
    const secret = secretOf();
    if (!secret) return null;
    const u = user as { email?: string | null; iamToken?: IamSessionToken } | undefined;
    const verified = (profile as { email_verified?: unknown } | undefined)?.email_verified === true;
    if (!u?.email || !verified) return "/login?error=GOOGLE_UNVERIFIED";
    try {
      const out = await getClient().federatedLogin({ provider: "google", email: u.email.trim().toLowerCase() }, secret);
      if (out.status === "mfa_required") return `/login?mfa=${encodeURIComponent(out.challengeToken)}`;
      if (out.status === "mfa_enrollment_required") return `/login?enroll=${encodeURIComponent(out.enrollmentToken)}`;
      const token = await withLegacyUserId(applyAuthenticated({}, out, now()), getClient());
      u.iamToken = token;
      (user as { id?: string }).id = token.legacyUserId ?? token.userId;
      return true;
    } catch (e) {
      if (e instanceof IamApiError && e.status === 429) return "/login?error=RATE_LIMITED";
      if (e instanceof IamApiError && (e.code === "iam.no_active_access" || e.status === 403)) return "/login?error=NO_ACCESS";
      return "/login?error=GOOGLE_FAILED";
    }
  };
}

/** Callbacks V2. `trigger: "update"` est le SEUL endroit qui fait tourner le refresh (voir iam-token.ts). */
export function createIamCallbacks(getClient: () => IamServerClient = defaultIamClient, now: () => number = Date.now): NonNullable<NextAuthOptions["callbacks"]> {
  return {
    async signIn() {
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      const signedIn = user as unknown as (Record<string, unknown> & { iamToken?: IamSessionToken }) | undefined;
      if (signedIn?.iamToken) {
        return { ...(token as Record<string, unknown>), ...signedIn.iamToken } as typeof token;
      }
      if (signedIn && typeof signedIn.jwtToken === "string") {
        // Connexion Google, tant que le module iam n'a pas de route fédérée : jeton LEGACY (24 h, sans refresh).
        const u = signedIn;
        return {
          ...(token as Record<string, unknown>),
          userId: u.id, tenantId: u.tenantId, tenantSlug: u.tenantSlug, roles: u.roles, activeRole: u.activeRole,
          availableRoles: u.availableRoles, requiresRoleSelection: u.requiresRoleSelection, jwtToken: u.jwtToken,
          jwtExpiresAt: u.jwtExpiresAt, legacyToken: true,
        } as typeof token;
      }
      if (trigger === "update") {
        return (await handleUpdate(token as IamSessionToken, session, { client: getClient(), now })) as typeof token;
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as IamSessionToken;
      const s = session as unknown as Record<string, unknown> & { user?: Record<string, unknown> };
      s.user ??= {};
      // `session.user.id` = compte LEGACY quand il existe (les pages et routes proxy existantes s'en servent comme
      // identifiant d'utilisateur) ; l'identité IAM globale reste disponible en `iamUserId`.
      s.user.id = t.legacyUserId ?? t.userId;
      s.iamUserId = t.userId;
      s.tenantId = t.tenantId;
      s.tenantSlug = t.tenantSlug;
      s.roles = t.roles;
      s.activeRole = t.activeRole;
      s.availableRoles = t.availableRoles;
      s.requiresRoleSelection = t.requiresRoleSelection;
      s.jwtToken = t.jwtToken;
      s.jwtExpiresAt = t.jwtExpiresAt;
      // Spécifique IAM. JAMAIS `iamRefreshToken` : le refresh token ne quitte pas le serveur.
      s.authVersion = 2;
      s.iamRoles = t.iamRoles;
      s.iamActiveRole = t.iamActiveRole;
      s.iamSessionId = t.iamSessionId;
      s.tenants = t.tenants;
      s.mfaEnabled = t.mfaEnabled;
      s.recoveryCodes = t.recoveryCodes;
      s.iamPending = t.iamPending;
      s.iamError = t.iamError;
      s.iamExpired = t.iamExpired === true;
      return session;
    },
  };
}

/** Événement `signOut` : révoque la session IAM côté serveur (jeton d'accès + refresh), quel que soit l'appelant de `signOut()`. */
export function createIamEvents(getClient: () => IamServerClient = defaultIamClient): NonNullable<NextAuthOptions["events"]> {
  return {
    async signOut({ token }) {
      const t = token as IamSessionToken | undefined;
      if (!t?.iamRefreshToken && !t?.jwtToken) return;
      try {
        await getClient().logout({ ...(t.jwtToken ? { accessToken: t.jwtToken } : {}), ...(t.iamRefreshToken ? { refreshToken: t.iamRefreshToken } : {}) });
      } catch {
        // Le cookie de session web est supprimé de toute façon ; la session IAM expirera (jeton d'accès 15 min, refresh 14 j d'inactivité).
      }
    },
  };
}
