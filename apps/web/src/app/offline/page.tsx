import type { Metadata } from "next";
import { DEFAULT_LOCALE } from "@/platform/i18n/config";
import { getMessages } from "@/platform/i18n/messages";
import { OfflineSchedulePanel } from "@/platform/offline/OfflineSchedulePanel";
import { RetryLink } from "@/platform/pwa/RetryLink";

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
      <RetryLink label={t.offlineRetry} />
      {/* Copie locale (lecture seule) de l'emploi du temps de la personne connectée sur cet appareil ; absente s'il n'y en a pas. */}
      <OfflineSchedulePanel
        labels={{
          title: t.offlineScheduleTitle,
          savedAt: t.offlineScheduleSavedAt,
          stale: t.offlineScheduleStale,
          period: t.offlineSchedulePeriod,
          empty: t.offlineScheduleEmpty,
          cancelled: t.offlineScheduleCancelled,
          truncated: t.offlineScheduleTruncated,
        }}
      />
    </main>
  );
}
