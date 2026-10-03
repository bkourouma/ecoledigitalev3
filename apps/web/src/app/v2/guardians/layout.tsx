import type { ReactNode } from "react";
import { PeopleNav } from "../students/_components/PeopleNav";
import { AppShell } from "@/platform/shell/AppShell";

/** Habillage des tuteurs (`/v2/guardians/*`) : mise en page TEMPORAIRE, voir `students/layout.tsx`. */
export default async function GuardiansLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <PeopleNav />
        {children}
      </div>
    </AppShell>
  );
}
