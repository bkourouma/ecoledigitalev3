import type { ReactNode } from "react";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Espace « mon compte » hors parcours d'authentification : session obligatoire côté serveur. Seules les préférences de
 * notification vivent ici (`/v2/account/notifications`) ; sécurité et sessions sont dans `(auth)/account`.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">{children}</div>
    </AppShell>
  );
}
