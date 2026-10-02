import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { resolveNextAuthSecret } from "./env.server";
import { isAuthV2 } from "@/platform/auth/iam-config";
import { createGoogleSignIn, createIamCallbacks, createIamEvents, createIamProviders } from "@/platform/auth/iam-next-auth";

function apiBaseUrl(): string {
  // Honor an explicit override in any environment so devs running the API on a
  // non-default port (or behind nginx) don't have NextAuth silently call a phantom
  // localhost:4000. API_INTERNAL_URL is the same var the Next.js rewrite uses.
  const override = process.env.API_INTERNAL_URL || process.env.API_URL;
  if (override) return override;
  return "http://localhost:4000";
}

/**
 * En-têtes de l'appel serveur -> API pour la connexion Google : `/auth/social-login` délivre un jeton pour N'IMPORTE
 * QUEL e-mail, l'API l'a donc verrouillé par un secret partagé (`AUTH_SOCIAL_SHARED_SECRET`, même valeur des deux côtés).
 */
function socialLoginHeaders(): Record<string, string> {
  const secret = process.env.AUTH_SOCIAL_SHARED_SECRET;
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-social-login-secret": secret } : {}),
  };
}

// Authentification V2 (`NEXT_PUBLIC_AUTH_V2=1`) : identifiants, défi MFA et enrôlement passent par `/api/v1/iam/*`
// (voir platform/auth/iam-next-auth.ts). Sinon : authentification legacy, inchangée (défaut).
const AUTH_V2 = isAuthV2();
const v2GoogleSignIn = createGoogleSignIn();

const googleProvider = GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID || "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
});

const legacyCredentials = CredentialsProvider({
  name: "credentials",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials) {
    if (!credentials?.email || !credentials?.password) {
      return null;
    }

    try {
      const response = await fetch(`${apiBaseUrl()}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: credentials.email.trim().toLowerCase(),
          password: credentials.password,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Auth API error:", response.status, errorText);
        return null;
      }

      const loginResponse = await response.json();
      if (!loginResponse?.user || !loginResponse?.token) {
        return null;
      }

      return {
        id: loginResponse.user.id,
        email: loginResponse.user.email,
        name: loginResponse.user.email,
        tenantId: loginResponse.user.tenantId,
        tenantSlug: loginResponse.user.tenantSlug,
        roles: loginResponse.user.roles,
        activeRole: loginResponse.user.activeRole,
        availableRoles: loginResponse.user.availableRoles,
        requiresRoleSelection: loginResponse.user.requiresRoleSelection,
        jwtToken: loginResponse.token,
        jwtExpiresAt: loginResponse.expiresAt,
      } as any;
    } catch (error) {
      console.error("Auth error:", error);
      return null;
    }
  },
});

/** Connexion Google : jeton legacy via `/auth/social-login` (en V2, jusqu'à la route iam équivalente, voir auth-cutover.md). */
async function googleSignIn({ user, account }: { user: any; account: any }): Promise<boolean> {
  if (account?.provider !== "google") return true;
  if (!user?.email) return false;

  try {
    const [firstName, ...rest] = (user.name || "").trim().split(" ").filter(Boolean);
    const lastName = rest.join(" ");

    const response = await fetch(`${apiBaseUrl()}/api/v1/auth/social-login`, {
      method: "POST",
      headers: socialLoginHeaders(),
      body: JSON.stringify({
        provider: "google",
        email: user.email.trim().toLowerCase(),
        firstName: firstName || user.email.split("@")[0],
        lastName: lastName || "Client",
      }),
    });

    if (!response.ok) return false;
    const data = await response.json();
    (user as any).id = data?.user?.id;
    (user as any).tenantId = data?.user?.tenantId;
    (user as any).tenantSlug = data?.user?.tenantSlug;
    (user as any).roles = data?.user?.roles || ["student"];
    (user as any).activeRole = data?.user?.activeRole || data?.user?.roles?.[0] || "student";
    (user as any).availableRoles = data?.user?.availableRoles || data?.user?.roles || ["student"];
    (user as any).requiresRoleSelection = Boolean(data?.user?.requiresRoleSelection);
    (user as any).jwtToken = data?.token;
    (user as any).jwtExpiresAt = data?.expiresAt;
    return true;
  } catch {
    return false;
  }
}

const legacyCallbacks: NonNullable<NextAuthOptions["callbacks"]> = {
  signIn: googleSignIn,
  async jwt({ token, user, trigger, session }) {
    if (user) {
      (token as any).userId = (user as any).id;
      (token as any).tenantId = (user as any).tenantId;
      (token as any).tenantSlug = (user as any).tenantSlug;
      (token as any).roles = (user as any).roles;
      (token as any).activeRole = (user as any).activeRole;
      (token as any).availableRoles = (user as any).availableRoles;
      (token as any).requiresRoleSelection = (user as any).requiresRoleSelection;
      (token as any).jwtToken = (user as any).jwtToken;
      (token as any).jwtExpiresAt = (user as any).jwtExpiresAt;
    }

    if (trigger === "update" && session) {
      const patch = session as any;
      if (patch.jwtToken) (token as any).jwtToken = patch.jwtToken;
      if (patch.jwtExpiresAt) (token as any).jwtExpiresAt = patch.jwtExpiresAt;
      if (patch.activeRole) (token as any).activeRole = patch.activeRole;
      if (patch.roles) (token as any).roles = patch.roles;
      if (patch.availableRoles) (token as any).availableRoles = patch.availableRoles;
      if (typeof patch.requiresRoleSelection === "boolean") {
        (token as any).requiresRoleSelection = patch.requiresRoleSelection;
      }
    }

    return token;
  },
  async session({ session, token }) {
    if (token) {
      if (!session.user) session.user = {} as any;
      (session.user as any).id = (token as any).userId;
      (session as any).tenantId = (token as any).tenantId;
      (session as any).tenantSlug = (token as any).tenantSlug;
      (session as any).roles = (token as any).roles;
      (session as any).activeRole = (token as any).activeRole;
      (session as any).availableRoles = (token as any).availableRoles;
      (session as any).requiresRoleSelection = (token as any).requiresRoleSelection;
      (session as any).jwtToken = (token as any).jwtToken;
      (session as any).jwtExpiresAt = (token as any).jwtExpiresAt;
    }
    return session;
  },
};

export const authOptions: NextAuthOptions = {
  // Jamais de valeur par défaut : voir `env.server.ts` (production : erreur si
  // absent/faible ; développement : secret aléatoire par process + avertissement).
  secret: resolveNextAuthSecret(),
  debug: process.env.NODE_ENV === "development",
  providers: AUTH_V2 ? [googleProvider, ...createIamProviders()] : [googleProvider, legacyCredentials],
  // V2 : Google ouvre une session IAM (route fédérée, secret de service) ; sans `IAM_SERVICE_SECRET`, repli transitoire sur la
  // connexion legacy (jeton legacy de 24 h valable jusqu'à LEGACY_TOKEN_SUNSET).
  callbacks: AUTH_V2
    ? {
        ...createIamCallbacks(),
        async signIn(params) {
          const federated = await v2GoogleSignIn({ user: params.user, account: params.account, profile: params.profile });
          return federated === null ? googleSignIn(params) : federated;
        },
      }
    : legacyCallbacks,
  ...(AUTH_V2 ? { events: createIamEvents() } : {}),
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  jwt: {
    maxAge: 30 * 24 * 60 * 60,
  },
};
