import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { isPortalAdminEmail } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/schemas";

const providers: NonNullable<NextAuthOptions["providers"]> = [
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Mot de passe", type: "password" },
    },
    async authorize(credentials) {
      const parsed = loginSchema.safeParse(credentials);
      if (!parsed.success) return null;

      const user = await prisma.publicUser.findUnique({
        where: { email: parsed.data.email },
      });

      if (!user?.motDePasseHash || !user.emailVerified) return null;

      const isValid = await bcrypt.compare(
        parsed.data.password,
        user.motDePasseHash
      );

      if (!isValid) return null;

      return {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        telephone: user.telephone,
        emailVerified: user.emailVerified.toISOString(),
        isAdmin: isPortalAdminEmail(user.email),
        name: [user.prenom, user.nom].filter(Boolean).join(" ").trim() || user.email,
      };
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

function serializeEmailVerified(value?: string | Date | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers,
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user.email) return true;

      const syncedUser = await prisma.publicUser.upsert({
        where: { email: user.email },
        update: {
          prenom: user.name?.split(" ")[0] || undefined,
          nom: user.name?.split(" ").slice(1).join(" ") || undefined,
          emailVerified: new Date(),
          avatarUrl: user.image || undefined,
        },
        create: {
          email: user.email,
          prenom: user.name?.split(" ")[0] || null,
          nom: user.name?.split(" ").slice(1).join(" ") || null,
          emailVerified: new Date(),
          avatarUrl: user.image || null,
        },
      });

      await prisma.account.upsert({
        where: {
          provider_providerAccountId: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        },
        update: {
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          scope: account.scope,
          tokenType: account.token_type,
          idToken: account.id_token,
          sessionState: account.session_state as string | undefined,
        },
        create: {
          userId: syncedUser.id,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          scope: account.scope,
          tokenType: account.token_type,
          idToken: account.id_token,
          sessionState: account.session_state as string | undefined,
        },
      });

      user.id = syncedUser.id;
      user.nom = syncedUser.nom;
      user.prenom = syncedUser.prenom;
      user.telephone = syncedUser.telephone;
      user.emailVerified = syncedUser.emailVerified?.toISOString() || null;
      user.isAdmin = isPortalAdminEmail(syncedUser.email);

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.nom = user.nom;
        token.prenom = user.prenom;
        token.telephone = user.telephone;
        token.emailVerified = serializeEmailVerified(user.emailVerified);
        token.isAdmin = user.isAdmin ?? isPortalAdminEmail(user.email);
      }

      if (
        token.email &&
        (!token.id || token.emailVerified === undefined || token.isAdmin === undefined)
      ) {
        const existingUser = await prisma.publicUser.findUnique({
          where: { email: token.email },
        });

        if (existingUser) {
          token.id = existingUser.id;
          token.nom = existingUser.nom;
          token.prenom = existingUser.prenom;
          token.telephone = existingUser.telephone;
          token.emailVerified = existingUser.emailVerified?.toISOString() || null;
          token.isAdmin = isPortalAdminEmail(existingUser.email);
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.nom = token.nom as string | null | undefined;
        session.user.prenom = token.prenom as string | null | undefined;
        session.user.telephone = token.telephone as string | null | undefined;
        session.user.emailVerified = token.emailVerified as string | null | undefined;
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.name =
          [session.user.prenom, session.user.nom].filter(Boolean).join(" ").trim() ||
          session.user.name ||
          session.user.email ||
          "Apprenant";
      }

      return session;
    },
  },
};

export const nextAuthHandler = NextAuth(authOptions);
