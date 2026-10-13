"use client";

import { useTranslations } from "next-intl";
import { useYearPeriods } from "@/platform/v2/academic";
import { useRuleSets } from "@/platform/v2/rules";
import { useYearResult } from "@/platform/v2/results";
import { showDecimal } from "@/platform/ui/format";
import { PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice, QueryBoundary } from "@/platform/ui/states";
import { DECISION_RULE, MENTION_RULE, shortHash, useCodeLabels } from "./shared";

/** Identifiant de la version de règle d'un jeu (code + numéro) : sert à lire les libellés de ses codes. */
function useRuleVersionId(ruleSetCode: string | null | undefined, versionNo: number | null | undefined): string | null {
  const sets = useRuleSets({ code: ruleSetCode ?? undefined });
  if (!ruleSetCode || versionNo === null || versionNo === undefined) return null;
  const version = (sets.data ?? []).flatMap((s) => s.versions).find((v) => v.ruleSetCode === ruleSetCode && v.versionNo === versionNo);
  return version?.id ?? null;
}

/** Résultat annuel d'une inscription : dérivé des résultats FINAL des périodes ; incomplet tant qu'une période n'est pas clôturée. */
export function YearResultScreen({ enrollmentId, yearId }: { enrollmentId: string; yearId: string }) {
  const t = useTranslations("v2Results.year");
  const query = useYearResult(enrollmentId, yearId);
  const periods = useYearPeriods(yearId);
  const data = query.data;
  const versionId = useRuleVersionId(data?.ruleSetCode, data?.ruleVersionNo);
  const label = useCodeLabels(versionId);
  const periodLabel = (id: string) => periods.data?.find((p) => p.id === id)?.label ?? t("periodFallback", { id: id.slice(0, 4) });

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <QueryBoundary query={query}>
        {data ? (
          <div className="space-y-6">
            {!data.complete ? (
              <Notice kind="warning">
                <p className="font-medium">{t("incomplete")}</p>
                <p>{t("missing", { periods: data.missingPeriodIds.map(periodLabel).join(", ") || "—" })}</p>
              </Notice>
            ) : null}
            <section aria-label={t("summary")} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{t("summary")}</h2>
                {data.validated === true ? <StatusBadge label={t("validated")} tone="success" /> : null}
                {data.validated === false ? <StatusBadge label={t("notValidated")} tone="warning" /> : null}
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Info label={t("average")}>
                  <span title={data.average ? t("exact", { value: showDecimal(data.average) }) : undefined}>{showDecimal(data.averageDisplay ?? data.average)}</span>
                </Info>
                <Info label={t("rank")}>{data.rank !== null ? (data.cohortSize !== null ? t("rankOf", { rank: data.rank, total: data.cohortSize }) : data.rank) : "—"}</Info>
                <Info label={t("mention")}>{label(data.mentionCode, MENTION_RULE)}</Info>
                <Info label={t("decision")}>{label(data.yearDecisionCode, DECISION_RULE)}</Info>
                <Info label={t("credits")}>{data.creditsAcquired !== null ? `${showDecimal(data.creditsAcquired)} / ${showDecimal(data.creditsRequired)}` : "—"}</Info>
                <Info label={t("ruleSet")}>{data.ruleSetCode ? `${data.ruleSetCode} · v${data.ruleVersionNo}` : "—"}</Info>
                <Info label={t("inputsHash")}>
                  <span title={data.inputsHash ?? undefined} className="font-mono text-xs">
                    {shortHash(data.inputsHash)}
                  </span>
                </Info>
              </dl>
            </section>

            <section aria-labelledby="periods-h" className="space-y-2">
              <h2 id="periods-h" className="text-lg font-semibold">
                {t("periods")}
              </h2>
              <div role="region" aria-label={t("periodsCaption")} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">{t("periodsCaption")}</caption>
                  <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2">{t("columns.period")}</th>
                      <th scope="col" className="px-3 py-2 text-right">{t("columns.average")}</th>
                      <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">{t("columns.credits")}</th>
                      <th scope="col" className="px-3 py-2">{t("columns.decision")}</th>
                      <th scope="col" className="px-3 py-2">{t("columns.state")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.periods.map((p) => (
                      <tr key={p.academicPeriodId} className="border-t">
                        <th scope="row" className="px-3 py-2 text-left font-medium">{periodLabel(p.academicPeriodId)}</th>
                        <td className="px-3 py-2 text-right tabular-nums">{showDecimal(p.averageDisplay ?? p.average)}</td>
                        <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{p.creditsAcquired !== null ? `${showDecimal(p.creditsAcquired)} / ${showDecimal(p.creditsRequired)}` : "—"}</td>
                        <td className="px-3 py-2">{label(p.decisionCode, DECISION_RULE)}</td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">
                            <StatusBadge label={t(p.final ? "final" : "provisional")} tone={p.final ? "success" : "info"} />
                            {p.validated === true ? <StatusBadge label={t("validated")} tone="success" /> : null}
                            {p.validated === false ? <StatusBadge label={t("notValidated")} tone="warning" /> : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </QueryBoundary>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
