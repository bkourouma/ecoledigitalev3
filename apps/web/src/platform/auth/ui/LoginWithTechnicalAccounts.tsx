"use client";

/**
 * Page de connexion V2 : formulaire (`LoginFlow`) à gauche, panneau des comptes de test à droite sur écran large
 * (empilé sous le formulaire sur mobile). Sans panneau autorisé par le serveur (production, ou aucun compte), seul le
 * formulaire est rendu, exactement comme avant.
 */
import { useEffect, useState } from "react";
import type { TechnicalAccount } from "@/lib/technical-accounts";
import { resolveBrowserTenant } from "@/platform/tenant/browser";
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

  const pick = (account: TechnicalAccount) =>
    setPrefill((prev) => ({ email: account.email, password: account.password, seq: (prev?.seq ?? 0) + 1 }));

  if (!enabled || accounts.length === 0) return <LoginFlow />;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:items-start">
      <LoginFlow prefill={prefill} />
      <aside aria-label="Comptes de test" className="px-4 pb-16 sm:px-6 lg:pt-12">
        <TechnicalAccountsPanel accounts={accounts} onPick={pick} />
      </aside>
    </div>
  );
}
