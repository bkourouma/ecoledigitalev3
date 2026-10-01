"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import type { payrollCalculationReportDtoSchema, payrollLineDtoSchema } from "@ecoledigitale/contracts/v2/payroll";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";

export type CalcReport = z.infer<typeof payrollCalculationReportDtoSchema>;
type CalcItem = CalcReport["items"][number];
type Line = z.infer<typeof payrollLineDtoSchema>;

const OUTCOME_TONE: Record<string, Tone> = { CALCULATED: "success", SKIPPED: "neutral", LOCKED: "warning", FAILED: "danger" };

/**
 * Compte rendu d'un calcul (aperçu ou réel) : compteurs, enseignants calculés, ÉCARTÉS (avec le motif) et verrouillés.
 * Tous les montants, minutes et motifs sont ceux de l'API ; l'aperçu (`dryRun`) n'a rien enregistré.
 */
export function CalculationReport({ report }: { report: CalcReport }) {
  const t = useTranslations("v2Payroll.report");
  const tOutcome = useTranslations("v2Payroll.outcome");
  const tReason = useTranslations("v2Payroll.skipReason");
  const tSource = useTranslations("v2Payroll.source");
  const money = useMoney();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section aria-labelledby="calc-report" className="space-y-3 rounded-md border-2 border-primary/30 p-3">
      <h3 id="calc-report" className="text-base font-semibold">
        {report.dryRun ? t("titlePreview") : t("title")}
      </h3>
      {report.dryRun ? <Notice kind="info">{t("previewNotice")}</Notice> : null}
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {(
          [
            ["calculated", report.calculated],
            ["skipped", report.skipped],
            ["locked", report.locked],
            ["failed", report.failed],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{t(`counters.${k}`)}</dt>
            <dd className="text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="divide-y rounded-md border text-sm" aria-label={t("items")}>
        {report.items.map((item) => (
          <li key={item.staffId} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{item.staffName}</span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge label={tOutcome(item.outcome)} tone={OUTCOME_TONE[item.outcome] ?? "neutral"} />
                {item.total !== null ? <span className="font-semibold tabular-nums">{money.fmt(item.total)}</span> : null}
              </span>
            </div>
            {item.skipReason ? <p className="text-muted-foreground">{tReason(item.skipReason)}</p> : null}
            {item.message ? <p className="text-muted-foreground">{item.message}</p> : null}
            {item.minutesBySource ? (
              <p className="text-xs text-muted-foreground">
                {Object.entries(item.minutesBySource)
                  .map(([source, minutes]) => `${source === "SESSION" || source === "ATTENDANCE" ? tSource(source) : source} : ${money.minutes(minutes)}`)
                  .join(" · ")}
              </p>
            ) : null}
            {item.preview ? (
              <div>
                <button type="button" className="text-sm font-medium text-primary underline-offset-4 hover:underline" aria-expanded={open === item.staffId} onClick={() => setOpen(open === item.staffId ? null : item.staffId)}>
                  {open === item.staffId ? t("hideLines") : t("showLines", { count: item.preview.lines.length })}
                  <span className="sr-only"> — {item.staffName}</span>
                </button>
                {open === item.staffId ? <PreviewDetail item={item} /> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("duration", { ms: report.durationMs })}</p>
    </section>
  );
}

function PreviewDetail({ item }: { item: CalcItem }) {
  const t = useTranslations("v2Payroll.report.preview");
  const money = useMoney();
  const preview = item.preview!;
  return (
    <div className="mt-2 space-y-2">
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        {(
          [
            ["salary", preview.salary],
            ["regularHours", preview.regularHours],
            ["overtime", preview.overtime],
            ["bonus", preview.bonus],
            ["deduction", preview.deduction],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{t(`amounts.${k}`)}</dt>
            <dd className="tabular-nums">{money.fmt(v)}</dd>
          </div>
        ))}
      </dl>
      <LinesTable lines={preview.lines} caption={t("lines", { name: item.staffName })} />
    </div>
  );
}

/** Lignes d'heures d'un calcul ou d'un bulletin : date, durée, tarif, majoration, montant (tels que calculés par l'API). */
export function LinesTable({ lines, caption }: { lines: ReadonlyArray<Line>; caption: string }) {
  const t = useTranslations("v2Payroll.lines");
  const tSource = useTranslations("v2Payroll.source");
  const tOrigin = useTranslations("v2Payroll.rateOrigin");
  const money = useMoney();
  const date = useDateFormat();
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <table className="w-full min-w-[34rem] border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50">
          <tr>
            {(["date", "source", "label", "duration", "rate", "multiplier", "amount"] as const).map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                {t(`columns.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.position}-${l.sourceRefId}`} className="border-t">
              <td className="px-2 py-1.5">{date.civil(l.date)}{l.startTime ? ` ${l.startTime}` : ""}</td>
              <td className="px-2 py-1.5">{tSource(l.source)}</td>
              <td className="px-2 py-1.5">
                {l.label ?? l.code ?? "—"}
                {l.classroomLabel ? <span className="text-muted-foreground"> · {l.classroomLabel}</span> : null}
                {l.isOvertime ? <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900">{t("overtime")}</span> : null}
                <span className="block text-muted-foreground">{tOrigin(l.rateOrigin)}</span>
              </td>
              <td className="px-2 py-1.5 tabular-nums">{money.minutes(l.minutes)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money.fmt(l.rate)}</td>
              <td className="px-2 py-1.5 tabular-nums">{money.permille(l.multiplierPermille)}</td>
              <td className="px-2 py-1.5 text-right font-medium tabular-nums">{money.fmt(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
