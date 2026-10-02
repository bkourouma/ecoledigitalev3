"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useClassMatrix, type ClassMatrix } from "@/platform/v2/results";
import { usePermission } from "@/platform/access";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { showDecimal } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice, QueryBoundary } from "@/platform/ui/states";
import { toneOfStatus, useNodeLabels, useStudentNames } from "../../assessments/_components/shared";
import { ClassPeriodSelector, DECISION_RULE, MENTION_RULE, useClassPeriodSelection, useCodeLabels } from "./shared";

type Row = ClassMatrix["rows"][number];

export function MatrixScreen({ initialClassroomId = "", initialPeriodId = "" }: { initialClassroomId?: string; initialPeriodId?: string }) {
  const t = useTranslations("v2Results.matrix");
  const sel = useClassPeriodSelection({ classroom: initialClassroomId, period: initialPeriodId });
  const [detail, setDetail] = useState(false);
  const matrix = useClassMatrix(sel.classroomId || null, sel.periodId || null, { lines: detail });
  const hasSelection = Boolean(sel.classroomId && sel.periodId);
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ClassPeriodSelector classroomId={sel.classroomId} periodId={sel.periodId} onClassroom={sel.setClassroom} onPeriod={sel.setPeriod} />
      {!hasSelection ? (
        <Notice kind="info">{t("choose")}</Notice>
      ) : (
        <QueryBoundary query={matrix} isEmpty={matrix.data?.rows.length === 0} empty={<Notice kind="info">{t("empty")}</Notice>}>
          {matrix.data ? <MatrixTable matrix={matrix.data} classroomId={sel.classroomId} detail={detail} onDetail={setDetail} /> : null}
        </QueryBoundary>
      )}
    </div>
  );
}

function MatrixTable({ matrix, classroomId, detail, onDetail }: { matrix: ClassMatrix; classroomId: string; detail: boolean; onDetail: (v: boolean) => void }) {
  const t = useTranslations("v2Results.matrix");
  const tStatus = useTranslations("v2Results.periodStatus");
  const tResult = useTranslations("v2Results.resultStatus");
  const tOutcome = useTranslations("v2Results.outcome");
  const { names } = useStudentNames(classroomId);
  const nodeLabels = useNodeLabels(classroomId);
  const label = useCodeLabels(matrix.state.ruleVersionId);
  const canExplain = usePermission("result.explain");
  const [order, setOrder] = useState<"name" | "rank">("name");

  // Ordre d'AFFICHAGE : par nom, ou selon le rang fourni par l'API (jamais recalculé ici).
  const rows = useMemo(() => {
    const name = (r: Row) => names.get(r.header.studentId)?.name ?? `~${r.header.studentId}`;
    const copy = [...matrix.rows];
    if (order === "rank") return copy.sort((a, b) => (a.header.rank ?? Number.MAX_SAFE_INTEGER) - (b.header.rank ?? Number.MAX_SAFE_INTEGER) || name(a).localeCompare(name(b), "fr", { sensitivity: "base" }));
    return copy.sort((a, b) => name(a).localeCompare(name(b), "fr", { sensitivity: "base" }));
  }, [matrix.rows, names, order]);

  // Colonnes du détail : les nœuds de niveau UE / matière, dans l'ordre de première apparition.
  const columns = useMemo(() => {
    if (!detail) return [] as string[];
    const seen: string[] = [];
    for (const r of matrix.rows) for (const l of r.lines) if ((l.level === "UE" || l.level === "SUBJECT") && l.curriculumNodeId && !seen.includes(l.curriculumNodeId)) seen.push(l.curriculumNodeId);
    return seen;
  }, [detail, matrix.rows]);

  const anyDraft = matrix.rows.some((r) => r.header.status === "DRAFT");
  const total = rows.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={tStatus(matrix.state.status)} tone={toneOfStatus(matrix.state.status)} />
        <span className="text-sm text-muted-foreground">{t("ruleLine", { ruleSet: `${matrix.state.ruleSetCode} v${matrix.state.ruleVersionNo}`, version: matrix.state.resultsVersion })}</span>
      </div>
      {anyDraft ? <Notice kind="info">{t("draftHint")}</Notice> : null}
      <div className="flex flex-wrap items-end gap-4">
        <FormField label={t("order")} className="w-48">
          {(c) => (
            <NativeSelect
              {...c}
              value={order}
              onChange={(v) => setOrder(v as "name" | "rank")}
              options={[
                { value: "name", label: t("orderName") },
                { value: "rank", label: t("orderRank") },
              ]}
            />
          )}
        </FormField>
        <label className="flex min-h-[2.75rem] items-center gap-2 text-sm">
          <input type="checkbox" checked={detail} onChange={(e) => onDetail(e.target.checked)} className="h-4 w-4 accent-primary" />
          {t("detail")}
        </label>
        <p className="pb-2 text-sm text-muted-foreground">{t("count", { count: total })}</p>
      </div>

      <div role="region" aria-label={t("tableCaption")} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">{t("columns.student")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("columns.average")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("columns.rank")}</th>
              <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("columns.mention")}</th>
              <th scope="col" className="px-3 py-2">{t("columns.decision")}</th>
              <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">{t("columns.credits")}</th>
              {columns.map((nodeId) => (
                <th key={nodeId} scope="col" className="whitespace-nowrap px-3 py-2 text-right">
                  {nodeLabels.get(nodeId) ?? t("nodeFallback", { id: nodeId.slice(0, 4) })}
                </th>
              ))}
              <th scope="col" className="px-3 py-2">{t("columns.state")}</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">{t("columns.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const h = r.header;
              const name = names.get(h.studentId)?.name ?? t("studentFallback", { id: h.studentId.slice(0, 4) });
              const byNode = new Map(r.lines.filter((l) => l.curriculumNodeId).map((l) => [l.curriculumNodeId as string, l] as const));
              return (
                <tr key={h.id} className="border-t align-top">
                  <th scope="row" className="min-w-[8rem] px-3 py-2 text-left font-medium">
                    <span className="block">{name}</span>
                    {names.get(h.studentId)?.number ? <span className="block text-xs font-normal text-muted-foreground">{names.get(h.studentId)!.number}</span> : null}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums" title={h.average ? t("exact", { value: showDecimal(h.average) }) : undefined}>
                    {showDecimal(h.averageDisplay ?? h.average)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.rank !== null ? (h.cohortSize !== null ? t("rankOf", { rank: h.rank, total: h.cohortSize }) : h.rank) : "—"}</td>
                  <td className="hidden px-3 py-2 sm:table-cell">{label(h.mentionCode, MENTION_RULE)}</td>
                  <td className="px-3 py-2">
                    <span className="block">{label(h.decisionCode, DECISION_RULE)}</span>
                    {h.decisionOutcome ? <span className="block text-xs text-muted-foreground">{tOutcome(h.decisionOutcome)}</span> : null}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{h.creditsAcquired !== null ? `${showDecimal(h.creditsAcquired)} / ${showDecimal(h.creditsRequired)}` : "—"}</td>
                  {columns.map((nodeId) => {
                    const l = byNode.get(nodeId);
                    return (
                      <td key={nodeId} className="px-3 py-2 text-right tabular-nums">
                        {l ? (
                          <>
                            <span className={l.overridden ? "font-semibold underline decoration-dotted" : undefined} title={l.overridden ? t("overridden") : undefined}>
                              {showDecimal(l.displayValue ?? l.value)}
                            </span>
                            {l.statusCode ? <span className="block text-xs text-muted-foreground">{label(l.statusCode)}</span> : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      <StatusBadge label={tResult(h.status)} tone={toneOfStatus(h.status)} />
                      {h.validated === true ? <StatusBadge label={t("validated")} tone="success" /> : null}
                      {h.validated === false ? <StatusBadge label={t("notValidated")} tone="warning" /> : null}
                    </span>
                    {h.status === "ERROR" ? <span className="mt-1 block max-w-[14rem] text-xs text-destructive">{errorMessage(h.error) ?? t("errorUnknown")}</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <span className="flex flex-wrap justify-end gap-1">
                      {canExplain.allowed ? (
                        <Link href={`/v2/results/${h.id}/explain?classroom=${classroomId}`} className={buttonClass.ghost} aria-label={t("explainOf", { name })}>
                          {t("explain")}
                        </Link>
                      ) : null}
                      <Link href={`/v2/results/year/${h.enrollmentId}/${matrix.state.academicYearId}`} className={buttonClass.ghost} aria-label={t("yearOf", { name })}>
                        {t("year")}
                      </Link>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") return (error as { message: string }).message;
  return null;
}
