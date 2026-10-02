"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EXAM_COUNT_GROUPS, type ExamCountGroup, type ExamSessionDetailDto, type ExamStatisticsGroupDto } from "@ecoledigitale/contracts/v2/examinations";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useExamStatistics } from "@/platform/v2/examinations";
import { DemoBanner, SessionScope, useExamLabels } from "./shared";

/** Taux : décimal exact calculé par la RÈGLE (jamais recalculé ici), affiché en pourcentage avec la virgule française. */
const showRate = (v: string | null): string => (v === null ? "—" : `${v.replace(".", ",")} %`);

function Table({ title, groups, total, groupBy }: { title: string; groups: ExamStatisticsGroupDto[]; total: ExamStatisticsGroupDto; groupBy: ExamCountGroup }) {
  const t = useTranslations("v2Examinations.statistics.table");
  const ts = useTranslations("v2Examinations.statistics");
  const groupLabel = (key: string) => (groupBy === "SEX" && ts.has(`sex.${key}` as never) ? ts(`sex.${key}` as never) : key === "ALL" ? ts("all") : key);
  const rows = [...groups, { ...total, groupKey: "__total__" }];
  return (
    <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={title}>
      <table className="w-full text-sm">
        <caption className="sr-only">{title}</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2">{t("group")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("registered")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("present")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("admitted")}</th>
            <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">{t("failed")}</th>
            <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">{t("absent")}</th>
            <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">{t("excluded")}</th>
            <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">{t("deferred")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("rate")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const isTotal = g.groupKey === "__total__";
            return (
              <tr key={g.groupKey} className={isTotal ? "border-t-2 font-semibold" : "border-t"}>
                <th scope="row" className="px-3 py-2 text-left">{isTotal ? t("total") : groupLabel(g.groupKey)}</th>
                <td className="px-3 py-2 text-right">{g.registered}</td>
                <td className="px-3 py-2 text-right">{g.present}</td>
                <td className="px-3 py-2 text-right">{g.admitted}</td>
                <td className="hidden px-3 py-2 text-right sm:table-cell">{g.failed}</td>
                <td className="hidden px-3 py-2 text-right md:table-cell">{g.absent}</td>
                <td className="hidden px-3 py-2 text-right md:table-cell">{g.excluded}</td>
                <td className="hidden px-3 py-2 text-right md:table-cell">{g.deferred}</td>
                <td className="px-3 py-2 text-right" data-testid={isTotal ? "rate-total" : undefined}>{showRate(g.rate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.statistics");
  const labels = useExamLabels();
  const [groupBy, setGroupBy] = useState<ExamCountGroup>("ALL");
  const [compare, setCompare] = useState<"" | "previous_year" | "mock">("");
  const stats = useExamStatistics(session.id, groupBy, compare === "" ? undefined : compare);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("groupBy")}>{(c) => <NativeSelect {...c} value={groupBy} options={EXAM_COUNT_GROUPS.map((g) => ({ value: g, label: labels.countGroup(g) }))} onChange={(v) => setGroupBy(v as ExamCountGroup)} />}</FormField>
        <FormField label={t("compare")}>{(c) => <NativeSelect {...c} value={compare} placeholder={t("compareNone")} options={[{ value: "previous_year", label: t("previousYear") }, ...(session.sessionKind === "OFFICIAL" ? [{ value: "mock", label: t("mockCompare") }] : [])]} onChange={(v) => setCompare(v as typeof compare)} />}</FormField>
      </div>
      {stats.isPending ? <LoadingBlock /> : stats.isError ? <ErrorBlock error={stats.error} onRetry={() => void stats.refetch()} /> : (
        <>
          <DemoBanner visible={stats.data.demoRules} />
          {!stats.data.rateAvailable ? <Notice kind="warning">{stats.data.rateNote ?? t("rateUnavailable")}</Notice> : <p className="text-xs text-muted-foreground">{t("rateNote")}</p>}
          <Table title={t("title")} groups={stats.data.groups} total={stats.data.total} groupBy={stats.data.groupBy} />
          {stats.data.compare ? (
            <section aria-labelledby="compare-title" className="space-y-2">
              <h2 id="compare-title" className="text-base font-semibold">{t("compareTitle", { label: stats.data.compare.label })}</h2>
              <Table title={stats.data.compare.label} groups={stats.data.compare.groups} total={stats.data.compare.total} groupBy={stats.data.groupBy} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Statistiques d'une session : effectifs par établissement, filière, sexe ; le taux vient de la règle (dénominateur paramétré). */
export function StatisticsScreen() {
  const t = useTranslations("v2Examinations.statistics");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <SessionScope>{(session) => <Panel session={session} />}</SessionScope>
    </div>
  );
}
