import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { isAuthV2 } from "../iam-config";

/**
 * Enveloppe serveur des pages V2 : inexistantes (404) tant que `NEXT_PUBLIC_AUTH_V2=1` n'est pas posé — les fournisseurs
 * NextAuth `iam-mfa` / `iam-enroll` n'existent pas en mode legacy. `Suspense` : les pages lisent `useSearchParams`.
 */
export function AuthV2Gate({ children }: { children: ReactNode }) {
  if (!isAuthV2()) notFound();
  return <Suspense fallback={null}>{children}</Suspense>;
}
