"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallCompliance } from "@/platform/v2/attendance";
import { addDays, todayCivil } from "@/platform/v2/dates";
import { useClassroomDirectory, useStaffDirectory } from "@/platform/v2/directory";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";

interface RateRow {
  key: string;
  label: string;
  expected: number;
  taken: number;
  missing: number;
  rateBps: number | null;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-card/40 p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

/** Conformité des appels : séances planifiées passées sans appel soumis (donnée brute, sans seuil). */
export function ComplianceScreen() {
  const t = useTranslations("v2Attendance.compliance");
  const format = useFormatter();
  const date = useDateFormat();
  const today = todayCivil();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const q = useCallCompliance({ from, to });
  const classrooms = useClassroomDirectory();
  const staff = useStaffDirectory();
  const percent = (bps: number | null) => (bps === null ? t("noData") : format.number(bps / 10_000, { style: "percent", maximumFractionDigits: 1 }));

  const columns = (nameHeader: string): DataTableColumn<RateRow>[] => [
    { id: "name", header: nameHeader, rowHeader: true, cell: (r) => r.label },
    { id: "expected", header: t("expected"), align: "right", cell: (r) => r.expected },
    { id: "taken", header: t("taken"), align: "right", cell: (r) => r.taken },
    { id: "missing", header: t("missing"), align: "right", cell: (r) => r.missing },
    { id: "rate", header: t("rate"), align: "right", cell: (r) => percent(r.rateBps) },
  ];

  const data = q.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("from")}>{(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}</FormField>
        <FormField label={t("to")}>{(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}</FormField>
      </div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : data ? (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("expected")} value={data.expected} />
            <Stat label={t("taken")} value={data.taken} />
            <Stat label={t("missing")} value={data.missing} />
            <Stat label={t("rate")} value={percent(data.rateBps)} />
          </dl>
          <section aria-labelledby="by-staff" className="space-y-2">
            <h2 id="by-staff" className="text-lg font-semibold">
              {t("byStaff")}
            </h2>
            <DataTable
              caption={t("byStaffCaption")}
              columns={columns(t("staff"))}
              rows={data.byStaff.map((r) => ({ key: r.staffId ?? "none", label: r.staffId ? staff.name(r.staffId) : t("noStaff"), expected: r.expected, taken: r.taken, missing: r.missing, rateBps: r.rateBps }))}
              getRowId={(r) => r.key}
              emptyTitle={t("empty")}
            />
          </section>
          <section aria-labelledby="by-class" className="space-y-2">
            <h2 id="by-class" className="text-lg font-semibold">
              {t("byClassroom")}
            </h2>
            <DataTable
              caption={t("byClassroomCaption")}
              columns={columns(t("classroom"))}
              rows={data.byClassroom.map((r) => ({ key: r.classroomId, label: classrooms.name(r.classroomId), expected: r.expected, taken: r.taken, missing: r.missing, rateBps: r.rateBps }))}
              getRowId={(r) => r.key}
              emptyTitle={t("empty")}
            />
          </section>
          <section aria-labelledby="missing-list" className="space-y-2">
            <h2 id="missing-list" className="text-lg font-semibold">
              {t("missingList")}
            </h2>
            {data.missingOccurrences.length === 0 ? (
              <EmptyBlock title={t("noneMissing")} />
            ) : (
              <ul className="divide-y rounded-md border">
                {data.missingOccurrences.map((o) => (
                  <li key={o.occurrenceId} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <strong>{date.civil(o.date)}</strong> · {classrooms.name(o.classroomId)}
                      {o.staffIds.length > 0 ? ` · ${o.staffIds.map((id) => staff.name(id)).join(", ")}` : ""}
                    </span>
                    <Link href={`/v2/attendance/call/occurrence/${o.occurrenceId}`} className={buttonClass.ghost}>
                      {t("doCall")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
