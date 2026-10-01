import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { PeopleNav } from "./_components/PeopleNav";

/**
 * Habillage des élèves (`/v2/students/*`). Mise en page TEMPORAIRE tant que `app/v2/layout.tsx` n'existe pas : session
 * obligatoire côté serveur + navigation. La permission de chaque écran est vérifiée par sa page (un parent n'a que
 * `student.child.read`, un enseignant que `student.class.read`) ; l'API applique le périmètre fin (ses enfants, ses classes).
 */
export default async function StudentsLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <PeopleNav />
      {children}
    </div>
  );
}
