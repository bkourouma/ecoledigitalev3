"use client";

import { useTranslations } from "next-intl";
import type { PrimaryCompetencySummaryDto } from "@ecoledigitale/contracts/v2/primary_school";

/**
 * Synthèse de compétences d'un élève : COMPTEURS par domaine et niveau de maîtrise (lignes validées seulement).
 * Aucune moyenne, aucun pourcentage « acquis », aucun seuil : on affiche les nombres renvoyés par l'API.
 */
export function SummaryCounts({ data }: { data: PrimaryCompetencySummaryDto }) {
  const t = useTranslations("v2PrimaryCommon.summary");
  const domains = Object.keys(data.summary);
  const levels = data.levelOrder.filter((code) => code in data.levelLabels);
  // Un niveau absent de l'ordre mais présent dans les compteurs reste affiché (rien n'est masqué).
  for (const byLevel of Object.values(data.summary)) for (const code of Object.keys(byLevel)) if (!levels.includes(code)) levels.push(code);
  if (domains.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("region")}>
      <table className="w-full text-sm">
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left">
            <th scope="col" className="px-3 py-2 font-medium">
              {t("domain")}
            </th>
            {levels.map((code) => (
              <th key={code} scope="col" className="px-3 py-2 text-center font-medium">
                <span className="block">{code}</span>
                <span className="block text-xs font-normal text-muted-foreground">{data.levelLabels[code] ?? code}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {domains.map((domain) => (
            <tr key={domain} className="border-b last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {data.domainLabels[domain] ?? domain}
              </th>
              {levels.map((code) => (
                <td key={code} className="px-3 py-2 text-center tabular-nums">
                  {data.summary[domain]?.[code] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
