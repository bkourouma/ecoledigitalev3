import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      nom?: string | null;
      prenom?: string | null;
      telephone?: string | null;
      emailVerified?: string | null;
      isAdmin?: boolean;
    };
  }

  interface User {
    nom?: string | null;
    prenom?: string | null;
    telephone?: string | null;
    emailVerified?: string | null;
    isAdmin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    nom?: string | null;
    prenom?: string | null;
    telephone?: string | null;
    emailVerified?: string | null;
    isAdmin?: boolean;
  }
}
