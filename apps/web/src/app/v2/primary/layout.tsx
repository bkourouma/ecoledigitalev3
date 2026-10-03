import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { AppShell } from "@/platform/shell/AppShell";
import { PRIMARY_ANY_PERMISSION } from "./_components/guards";
import { PrimaryNav } from "./_components/PrimaryNav";

export const metadata: Metadata = { title: "Pack Primaire" };

/**
 * Habillage du pack Primary (`/v2/primary/*`) : maternelle et primaire (compétences, conseil des maîtres, bilans annuels, archives,
 * états). Garde SERVEUR : session + au moins une permission du pack (fail-closed) ; chaque section ajoute la sienne dans son propre
 * `layout.tsx`. Les gardes client (`usePermission`, `useFeature`) masquent les boutons non permis ; la vraie barrière reste l'API.
 * Le web ne calcule ni moyenne, ni rang, ni décision : il affiche des comptages et des codes (voir `apps/web/docs/v2-primary.md`).
 *
 * Coque de navigation (`AppShell`) : portail enseignant pour l'instituteur et la famille (`mon-enfant`), coque de gestion pour la
 * direction ; le `<main>` est celui de la coque (un seul point de repère « main » par page).
 */
export default async function PrimaryLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PRIMARY_ANY_PERMISSION);
  return (
    <AppShell>
      <div id="primary-main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <PrimaryNav />
        {children}
      </div>
    </AppShell>
  );
}
