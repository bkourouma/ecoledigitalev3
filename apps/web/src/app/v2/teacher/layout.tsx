import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PORTAL_GUARD, PortalShell } from "@/platform/portal";
import { TeacherProviders } from "./_components/TeacherAttendance";

export const metadata: Metadata = { title: "Espace enseignant" };

/**
 * Portail enseignant (`/v2/teacher/*`). Garde serveur : session + droit sur SES données de personnel ou SON emploi du temps
 * (fail-closed). Le périmètre (ses classes, ses élèves, ses séances) est appliqué par chaque module de l'API ; l'écran n'affiche que
 * ce qui est renvoyé. La file d'appel hors ligne est fournie à tout le portail.
 */
export default async function TeacherLayout({ children }: { children: ReactNode }) {
  await requireAnyPermission(...PORTAL_GUARD.teacher);
  return (
    <PortalShell portal="teacher">
      <TeacherProviders>{children}</TeacherProviders>
    </PortalShell>
  );
}
