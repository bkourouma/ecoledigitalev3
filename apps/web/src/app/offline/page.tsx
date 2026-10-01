import type { Metadata } from "next";
import { DEFAULT_LOCALE } from "@/platform/i18n/config";
import { getMessages } from "@/platform/i18n/messages";

export const metadata: Metadata = {
  title: "Hors ligne - EcoleDigitale",
  robots: { index: false, follow: false },
};

/**
 * Page affichée par le service worker quand une navigation échoue faute de réseau (public/sw.js).
 * Statique et sans donnée privée : elle est pré-cachée à l'installation du service worker.
 */
export default function OfflinePage() {
  const t = getMessages(DEFAULT_LOCALE).pwa;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{t.offlineTitle}</h1>
      <p className="max-w-md text-sm text-muted-foreground md:text-base">{t.offlineBody}</p>
      {/* Lien simple (navigation complète) : fonctionne sans JavaScript. */}
      <a href="/" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        {t.offlineRetry}
      </a>
    </main>
  );
}
