import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Racine des écrans d'administration de la plateforme v2 (`/v2/...`). Les fournisseurs (session, react-query, i18n,
 * thème de tenant) sont ceux de `app/providers.tsx` ; la coquille avec le menu est posée par les layouts enfants :
 *
 *   - `(admin)/layout.tsx`   : administration d'un tenant (session NextAuth + menu de `/api/v1/rbac/me/navigation`) ;
 *   - `platform/(console)/`  : console opérateur (authentification super-admin séparée).
 *
 * Sections volontairement non indexées (back-office).
 */
export const metadata: Metadata = {
  title: { default: "Administration", template: "%s · EcoleDigitale" },
  robots: { index: false, follow: false },
};

export default function V2Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
