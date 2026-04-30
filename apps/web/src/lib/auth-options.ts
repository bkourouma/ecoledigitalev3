import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";

function apiBaseUrl(): string {
  return process.env.NODE_ENV === "development"
    ? "http://localhost:4000"
    : process.env.API_URL || "http://localhost:4000";
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET || "your-secret-key-here-change-in-production",
  debug: process.env.NODE_ENV === "development",
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    CredentialsProvider({
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
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      if (!user?.email) return false;

      try {
        const [firstName, ...rest] = (user.name || "").trim().split(" ").filter(Boolean);
        const lastName = rest.join(" ");

        const response = await fetch(`${apiBaseUrl()}/api/v1/auth/social-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
    },
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
  },
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
