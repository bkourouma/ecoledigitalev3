import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Vérification PUBLIQUE d'un document (QR code ou code imprimé) : aucune session, aucun menu, aucun établissement imposé.
 * Page volontairement non indexée : les codes ne doivent pas se retrouver dans un moteur de recherche.
 */
export const metadata: Metadata = {
  title: "Vérification d'un document",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function VerifyLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{children}</main>;
}
