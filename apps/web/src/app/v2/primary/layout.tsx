import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PRIMARY_ANY_PERMISSION } from "./_components/guards";
import { PrimaryNav } from "./_components/PrimaryNav";

export const metadata: Metadata = { title: "Pack Primaire" };

/**
 * Habillage du pack Primary (`/v2/primary/*`) : maternelle et primaire (compétences, conseil des maîtres, bilans annuels, archives,
 * états). Garde SERVEUR : session + au moins une permission du pack (fail-closed) ; chaque section ajoute la sienne dans son propre
 * `layout.tsx`. Les gardes client (`usePermission`, `useFeature`) masquent les boutons non permis ; la vraie barrière reste l'API.
 * Le web ne calcule ni moyenne, ni rang, ni décision : il affiche des comptages et des codes (voir `apps/web/docs/v2-primary.md`).
 */
export default async function PrimaryLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_ANY_PERMISSION);
  return (
    <main id="primary-main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <PrimaryNav />
      {children}
    </main>
  );
}
