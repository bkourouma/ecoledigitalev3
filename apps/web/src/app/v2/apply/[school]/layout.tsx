import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Candidature PUBLIQUE (QR code, lien partagé par l'établissement) : aucune session, aucun menu. Pages volontairement non
 * indexées et sans `Referer` : le lien désigne l'établissement et ne doit se retrouver ni dans un moteur de recherche ni chez un tiers.
 */
export const metadata: Metadata = {
  title: "Candidature en ligne",
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: "no-referrer",
};

export default function ApplyLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{children}</main>;
}
