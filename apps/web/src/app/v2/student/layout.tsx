import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { StudentNav } from "./_components/StudentNav";

/**
 * Habillage de l'espace élève (`/v2/student/*`). Session exigée côté serveur ; la permission de chaque écran est vérifiée par
 * sa page (`student.self.read`) et par l'API, qui ne renvoie que le dossier du compte connecté.
 */
export default async function StudentSelfLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <StudentNav />
      {children}
    </div>
  );
}
