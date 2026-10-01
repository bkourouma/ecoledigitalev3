import type { ReactNode } from "react";
import { requireSession } from "@/platform/auth/server";
import { PeopleNav } from "../students/_components/PeopleNav";

/** Habillage des tuteurs (`/v2/guardians/*`) : mise en page TEMPORAIRE, voir `students/layout.tsx`. */
export default async function GuardiansLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <PeopleNav />
      {children}
    </div>
  );
}
