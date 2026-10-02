"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import type { assessPublishedGradeDtoSchema } from "@ecoledigitale/contracts/v2/assess";
import type { resultsFamilyResultDtoSchema } from "@ecoledigitale/contracts/v2/results";
import { useFamilyGrades, useFamilyLabels, useFamilyResults, type FamilySubject, type LabelLookup } from "@/platform/v2/portal";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { showDecimal, useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";

type Grade = z.infer<typeof assessPublishedGradeDtoSchema>;
type Result = z.infer<typeof resultsFamilyResultDtoSchema>;

const LEVEL_ORDER = ["YEAR", "PERIOD", "SECTION", "UE", "SUBJECT", "ECUE"] as const;

/**
 * « Mes résultats » (élève) / « Résultats de mon enfant » (parent) : résultats officiels de période et d'année (valeurs, rangs et
 * décisions renvoyés par l'API, jamais recalculés) et notes PUBLIÉES des évaluations. Aucune note non publiée n'existe côté famille.
 */
export function FamilyResults({ subject, title }: { subject: FamilySubject; title: string }) {
  const t = useTranslations("v2Portal.family.results");
  const labels = useFamilyLabels(subject);
  return (
    <div className="space-y-8">
      <PageHeader title={title} description={t("description")} />
      <OfficialResults subject={subject} labels={labels} />
      <PublishedGrades subject={subject} labels={labels} />
    </div>
  );
}

function OfficialResults({ subject, labels }: { subject: FamilySubject; labels: LabelLookup }) {
  const t = useTranslations("v2Portal.family.results.official");
  const tOutcome = useTranslations("v2Results.outcome");
  const date = useDateFormat();
  const query = useFamilyResults(subject);

  return (
    <section aria-labelledby="official-results" className="space-y-3">
      <h2 id="official-results" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {query.isPending ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      <ul className="space-y-3">
        {(query.data ?? []).map((r, index) => {
          const period = r.scope === "YEAR" ? t("yearScope") : (labels.period(r.academicPeriodId) ?? t("periodFallback"));
          const key = `${r.scope}-${r.academicPeriodId ?? "year"}-${r.version}-${index}`;
          return (
            <li key={key} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold">{period}</h3>
                <span className="flex flex-wrap gap-1">
                  {r.validated === true ? <StatusBadge label={t("validated")} tone="success" /> : null}
                  {r.validated === false ? <StatusBadge label={t("notValidated")} tone="warning" /> : null}
                  {r.decisionOutcome ? <StatusBadge label={outcomeLabel(tOutcome, r.decisionOutcome)} tone={r.decisionOutcome === "ADMITTED" || r.decisionOutcome === "PROMOTED" ? "success" : "info"} /> : null}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t("average")}</dt>
                  <dd className="text-xl font-semibold tabular-nums" title={r.average ?? undefined}>
                    {showDecimal(r.averageDisplay ?? r.average)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("rank")}</dt>
                  <dd className="tabular-nums">{r.rank !== null ? (r.cohortSize !== null ? t("rankOf", { rank: r.rank, size: r.cohortSize }) : String(r.rank)) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("credits")}</dt>
                  <dd className="tabular-nums">{r.creditsRequired !== null ? t("creditsOf", { acquired: showDecimal(r.creditsAcquired), required: showDecimal(r.creditsRequired) }) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("mention")}</dt>
                  <dd>{r.mentionCode ?? "—"}</dd>
                </div>
              </dl>
              {r.decisionCode ? <p className="mt-2 text-sm text-muted-foreground">{t("decision", { code: r.decisionCode })}</p> : null}
              {r.finalizedAt ? <p className="mt-1 text-xs text-muted-foreground">{t("finalizedOn", { date: date.instant(r.finalizedAt) })}</p> : null}
              <LinesDetails result={r} labels={labels} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function outcomeLabel(t: (key: never) => string, outcome: string): string {
  return (["PROMOTED", "REPEAT", "PENDING", "EXAM_REFERRAL", "COUNCIL_REVIEW", "ADMITTED", "RESIT", "ADJOURNED", "OTHER"] as const).includes(outcome as never) ? t(outcome as never) : outcome;
}

function LinesDetails({ result, labels }: { result: Result; labels: LabelLookup }) {
  const t = useTranslations("v2Portal.family.results.lines");
  const tLevel = useTranslations("v2Results.levels");
  const lines = useMemo(
    () => result.lines.filter((l) => l.level !== "PERIOD" && l.level !== "YEAR").sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)),
    [result.lines],
  );
  if (lines.length === 0) return null;
  return (
    <details className="mt-3 rounded-md border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t("summary", { count: lines.length })}</summary>
      <div className="overflow-x-auto border-t">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">
                {t("subject")}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                {t("value")}
              </th>
              <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">
                {t("coefficient")}
              </th>
              <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">
                {t("credits")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("state")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l, i) => (
              <tr key={`${l.curriculumNodeId ?? "x"}-${l.level}-${i}`}>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {labels.node(l.curriculumNodeId) ?? t("unnamed", { level: tLevel(l.level) })}
                  <span className="block text-xs font-normal text-muted-foreground">{tLevel(l.level)}</span>
                </th>
                <td className="px-3 py-2 text-right tabular-nums" title={l.value ?? undefined}>
                  {showDecimal(l.displayValue ?? l.value)}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{showDecimal(l.coefficient)}</td>
                <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{showDecimal(l.credits)}</td>
                <td className="px-3 py-2">{l.validated === true ? t("validated") : l.validated === false ? t("notValidated") : (l.statusCode ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function PublishedGrades({ subject, labels }: { subject: FamilySubject; labels: LabelLookup }) {
  const t = useTranslations("v2Portal.family.results.grades");
  const tEntry = useTranslations("v2Assess.entryStatus");
  const date = useDateFormat();
  const [periodId, setPeriodId] = useState("");
  const query = useFamilyGrades(subject, { academicPeriodId: periodId || undefined });
  const all = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  // Les périodes proposées sont celles qui portent des notes (ou, à défaut de libellé, un intitulé générique).
  const periodOptions = useMemo(() => {
    const ids = [...new Set(all.map((g) => g.academicPeriodId))];
    return ids.map((id) => ({ value: id, label: labels.period(id) ?? t("periodFallback") }));
  }, [all, labels, t]);

  const rows = all;
  const columns: DataTableColumn<Grade>[] = [
    { id: "title", header: t("columns.title"), rowHeader: true, cell: (g) => <span className="font-medium">{g.title}</span> },
    { id: "subject", header: t("columns.subject"), cell: (g) => labels.node(g.curriculumNodeId) ?? "—", className: "hidden sm:table-cell" },
    { id: "type", header: t("columns.type"), cell: (g) => g.typeLabel ?? "—", className: "hidden md:table-cell" },
    { id: "date", header: t("columns.date"), cell: (g) => date.civil(g.assessedOn) },
    {
      id: "score",
      header: t("columns.score"),
      align: "right",
      cell: (g) =>
        g.entryStatus === "ENTERED" ? (
          <span className="font-semibold tabular-nums" title={g.score ?? undefined}>
            {t("scoreOf", { score: showDecimal(g.score), max: showDecimal(g.scaleMax) })}
          </span>
        ) : (
          <StatusBadge label={tEntry(g.entryStatus)} tone={g.entryStatus === "ABSENT_UNEXCUSED" ? "warning" : "neutral"} />
        ),
    },
    { id: "weight", header: t("columns.weight"), align: "right", cell: (g) => <span className="tabular-nums">{showDecimal(g.weight)}</span>, className: "hidden md:table-cell" },
  ];

  return (
    <section aria-labelledby="published-grades" className="space-y-3">
      <h2 id="published-grades" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {periodOptions.length > 1 || periodId ? (
        <div className="max-w-xs">
          <FormField label={t("period")}>{(c) => <NativeSelect {...c} value={periodId} onChange={setPeriodId} placeholder={t("allPeriods")} options={periodOptions} />}</FormField>
        </div>
      ) : null}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={rows}
        getRowId={(g) => g.gradeId}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {t("more")}
          </button>
        </div>
      ) : null}
      {rows.length > 0 ? <Notice kind="info">{t("note")}</Notice> : null}
    </section>
  );
}
