import type { ReactNode } from "react";
import { AttendanceShell } from "./_components/AttendanceShell";
import { AppShell } from "@/platform/shell/AppShell";

/**
 * Habillage des présences (`/v2/attendance/*`) : session obligatoire côté serveur ; la permission de chaque écran est
 * vérifiée par sa page. Fournit la file d'appel hors ligne (`OutboxProvider`) à tous les écrans de la section.
 */
export default async function AttendanceLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <AttendanceShell>{children}</AttendanceShell>
    </AppShell>
  );
}
