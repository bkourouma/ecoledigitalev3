import type { ReactNode } from "react";
import { GradeSyncProvider } from "@/platform/offline/GradeSyncProvider";
import { AssessmentsNav } from "./_components/AssessmentsNav";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage des évaluations et des notes (`/v2/assessments/*`). La session est exigée côté serveur ; la permission de
 * chaque écran est vérifiée par sa page (l'enseignant n'a que `grade.enter`/`assessment.create`, la direction a le reste).
 * L'API applique le périmètre fin (ses évaluations, ses classes).
 */
export default async function AssessmentsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <AssessmentsNav />
        <GradeSyncProvider>{children}</GradeSyncProvider>
      </div>
    </AppShell>
  );
}
