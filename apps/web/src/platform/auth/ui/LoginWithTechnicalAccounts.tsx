"use client";

/**
 * Page de connexion V2 : sur écran large (et si le serveur autorise le panneau de test), deux cartes de même hauteur
 * côte à côte — formulaire (`LoginFlow`) et comptes de test (liste défilante) —, empilées sur mobile. Sans panneau
 * (production, ou aucun compte), seul le formulaire est rendu, exactement comme avant.
 */
import { useEffect, useState } from "react";
import type { TechnicalAccount } from "@/lib/technical-accounts";
import { resolveBrowserTenant } from "@/platform/tenant/browser";
import { AuthBrand, AuthEmbeddedProvider, useScrollableDocument } from "./AuthShell";
import { LoginFlow, type LoginPrefill } from "./LoginFlow";
import { TechnicalAccountsPanel, useTechnicalAccounts } from "./TechnicalAccountsPanel";

export function LoginWithTechnicalAccounts() {
  // Sans fichier DEV_CREDENTIALS_FILE, le serveur ne connaît que les comptes génériques de l'établissement du sous-domaine.
  const [tenantSlug, setTenantSlug] = useState<string | undefined>(undefined);
  useEffect(() => {
    setTenantSlug(resolveBrowserTenant()?.slug ?? undefined);
  }, []);

  const { enabled, accounts } = useTechnicalAccounts(tenantSlug);
  const [prefill, setPrefill] = useState<LoginPrefill | undefined>(undefined);
  const withPanel = enabled && accounts.length > 0;
  useScrollableDocument(withPanel);

  const pick = (account: TechnicalAccount) =>
    setPrefill((prev) => ({ email: account.email, password: account.password, seq: (prev?.seq ?? 0) + 1 }));

  if (!withPanel) return <LoginFlow />;

  return (
    <main className="min-h-screen bg-background px-4 pb-12 pt-8 sm:px-6 sm:pt-12 lg:px-10">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <AuthBrand />
        {/* La carte de droite est positionnée en absolu sur grand écran : la hauteur de la rangée est celle du formulaire,
            et la liste des comptes défile dans la carte au lieu de l'étirer. */}
        <div className="mx-auto grid w-full max-w-md items-stretch gap-6 lg:min-h-[40rem] lg:max-w-none lg:grid-cols-[minmax(0,28rem)_minmax(0,32rem)] lg:justify-center lg:gap-8">
          <AuthEmbeddedProvider value={true}>
            <LoginFlow prefill={prefill} />
          </AuthEmbeddedProvider>
          <aside aria-label="Comptes de test" className="relative">
            <div className="h-[34rem] lg:absolute lg:inset-0 lg:h-auto">
              <TechnicalAccountsPanel accounts={accounts} onPick={pick} className="h-full" />
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
