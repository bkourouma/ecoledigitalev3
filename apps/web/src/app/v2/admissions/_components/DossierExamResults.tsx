"use client";

import { useTranslations } from "next-intl";
import type { AdmissionsApplicationDetailDto } from "@ecoledigitale/contracts/v2/admissions";
import { useApplicationExamResults } from "@/platform/v2/admissions-exam-results";
import { StatusBadge } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { showDecimal } from "@/platform/ui/format";

/**
 * Résultat d'examen transmis par la plateforme d'examens (CEPE vers l'admission en 6e) : « admis / non admis » pour tout le personnel qui
 * lit les dossiers ; la MOYENNE seulement pour le personnel d'admission habilité (lecture tracée). L'écran n'en tire aucune décision :
 * l'admission est prononcée par les personnes habilitées (décision formelle du dossier).
 */
export function DossierExamResults({ application }: { application: AdmissionsApplicationDetailDto }) {
  const t = useTranslations("v2AdmissionsExamResults");
  const query = useApplicationExamResults(application.id, !application.anonymized);
  if (application.anonymized) return null;
  if (query.isPending) return <LoadingBlock />;
  // Une indisponibilité de ce volet ne bloque jamais le dossier : simple mention, sans alerte.
  if (query.isError) return <p className="text-xs text-muted-foreground">{t("unavailable")}</p>;
  const { items, canSeeAverage } = query.data;
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="dossier-exam-results" className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4" data-testid="dossier-exam-results">
      <h2 id="dossier-exam-results" className="text-base font-semibold">{t("title")}</h2>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <ul className="divide-y text-sm">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="font-medium">{t("exam", { code: r.examTypeCode, year: r.sessionYear })}</span>
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge label={r.admitted ? t("admitted") : t("notAdmitted")} tone={r.admitted ? "success" : "warning"} />
              {r.outcome === "ABSENT" || r.outcome === "EXCLUDED" || r.outcome === "DEFERRED" ? <span className="text-xs text-muted-foreground">{t(`outcome.${r.outcome}` as never)}</span> : null}
              {r.average !== null ? <span data-testid="exam-average">{t("average", { average: showDecimal(r.average) })}</span> : null}
              {r.averageHidden ? <span className="text-xs text-muted-foreground">{t("averageHidden")}</span> : null}
              {r.matchedBy === "CONFIRMED_DUPLICATE" ? <span className="text-xs text-muted-foreground">{t("viaDuplicate")}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {canSeeAverage ? <Notice kind="info">{t("tracedNotice")}</Notice> : null}
    </section>
  );
}
