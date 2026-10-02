import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Désinscription PUBLIQUE par lien signé (e-mail, SMS) : aucune session, aucun menu. Le jeton signé (`?t=`) porte
 * l'établissement, la personne et le canal. Page non indexée, sans en-tête `Referer` (le jeton ne doit pas fuir).
 */
export const metadata: Metadata = {
  title: "Préférences de notification",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function UnsubscribeLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">{children}</main>;
}
