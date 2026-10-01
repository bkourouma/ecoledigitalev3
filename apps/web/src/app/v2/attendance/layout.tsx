import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { AttendanceShell } from "./_components/AttendanceShell";

/**
 * Habillage des présences (`/v2/attendance/*`) : session obligatoire côté serveur ; la permission de chaque écran est
 * vérifiée par sa page. Fournit la file d'appel hors ligne (`OutboxProvider`) à tous les écrans de la section.
 */
export default async function AttendanceLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <AttendanceShell>{children}</AttendanceShell>;
}
