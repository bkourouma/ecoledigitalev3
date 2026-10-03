import type { ReactNode } from "react";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Racine des écrans « élèves affectés par l'État » (`/v2/stateassign/*`) : session obligatoire côté serveur. La permission de chaque
 * écran est vérifiée par sa page (`requirePermission` / `requireAnyPermission`, refus par défaut) ; l'API reste la barrière réelle
 * (périmètre d'établissement, acte humain, séparation des tâches). Les écrans du personnel sont dans `(staff)` (navigation de
 * section), la vue famille dans `family`.
 */
export default async function StateassignLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      {children}
    </AppShell>
  );
}
