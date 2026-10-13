"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { COUNCIL_STATUSES, councilsCreateSchema, type CouncilsCouncilDto } from "@ecoledigitale/contracts/v2/councils";
import { useAcademicYears, useYearPeriods } from "@/platform/v2/academic";
import { useClassroomCouncilSummary, useCouncilsList, useCouncilsReference, useCreateCouncil } from "@/platform/v2/councils";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CouncilsBoundary, EnumLabel, ScrollTable, TD, TH, councilTitle, localToIso, useClassChoices, useDateTime } from "./shared";

const PAGE_SIZE = 25;

/**
 * Calendrier des conseils : liste filtrable (classe, année, période, statut, dates), création d'une séance et, pour une
 * classe choisie, état des résultats et alerte « conseil à revoir » (période de résultats rouverte sous une séance signée).
 */
export function CalendarScreen() {
  const t = useTranslations("v2Councils.calendar");
  const dt = useDateTime();
  const classes = useClassChoices();
  const years = useAcademicYears();
  const [classroomId, setClassroomId] = useState("");
  const [yearId, setYearId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CouncilsCouncilDto | null>(null);
  const periods = useYearPeriods(yearId || null);
  const list = useCouncilsList({ classroomId: classroomId || undefined, academicYearId: yearId || undefined, academicPeriodId: periodId || undefined, status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE });
  const summary = useClassroomCouncilSummary(classroomId || null);
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const reviewIds = summary.data?.reviewNeeded ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="council.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("create")}
            </button>
          </Can>
        }
      />
      {created ? (
        <Notice kind="success">
          {t("created")}{" "}
          <Link href={`/v2/councils/${created.id}`} className="font-medium underline">
            {t("openCreated")}
          </Link>
        </Notice>
      ) : null}
      <form className="grid gap-3 rounded-2xl border border-white/10 bg-card/40 p-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("filters.label")} onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("filters.classroom")}>
          {(c) => <NativeSelect {...c} value={classroomId} placeholder={t("filters.all")} onChange={reset(setClassroomId)} options={classes.options} />}
        </FormField>
        <FormField label={t("filters.year")}>
          {(c) =>
            <NativeSelect
              {...c}
              value={yearId}
              placeholder={t("filters.all")}
              onChange={(v) => {
                setYearId(v);
                setPeriodId("");
                setPage(1);
              }}
              options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))}
            />
          }
        </FormField>
        <FormField label={t("filters.period")}>
          {(c) => <NativeSelect {...c} value={periodId} placeholder={t("filters.all")} disabled={yearId === ""} onChange={reset(setPeriodId)} options={(periods.data ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
        </FormField>
        <FormField label={t("filters.status")}>
          {(c) => <NativeSelect {...c} value={status} placeholder={t("filters.all")} onChange={reset(setStatus)} options={COUNCIL_STATUSES.map((s) => ({ value: s, label: t(`statusOptions.${s}`) }))} />}
        </FormField>
        <FormField label={t("filters.from")}>{(c) => <TextControl {...c} type="date" value={from} onChange={reset(setFrom)} />}</FormField>
        <FormField label={t("filters.to")}>{(c) => <TextControl {...c} type="date" value={to} min={from || undefined} onChange={reset(setTo)} />}</FormField>
      </form>

      {classroomId && summary.data ? (
        <section aria-labelledby="cal-summary" className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-3">
          <h2 id="cal-summary" className="text-lg font-semibold">
            {t("summary.title")}
          </h2>
          {reviewIds.length > 0 ? (
            <Notice kind="warning">
              <p className="font-medium">{t("summary.reviewNeeded")}</p>
              <ul className="mt-1 list-disc pl-5">
                {reviewIds.map((id) => (
                  <li key={id}>
                    <Link href={`/v2/councils/${id}`} className="underline">
                      {t("summary.reviewLink")}
                    </Link>
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <ul className="flex flex-wrap gap-2" aria-label={t("summary.effects")}>
            <li><StatusBadge label={t("summary.pending", { count: summary.data.effects.pending })} tone="info" /></li>
            <li><StatusBadge label={t("summary.failed", { count: summary.data.effects.failed })} tone={summary.data.effects.failed > 0 ? "danger" : "neutral"} /></li>
            <li><StatusBadge label={t("summary.awaitingHuman", { count: summary.data.effects.awaitingHuman })} tone={summary.data.effects.awaitingHuman > 0 ? "warning" : "neutral"} /></li>
          </ul>
          {Object.keys(summary.data.decisionsByCode).length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={t("summary.decisions")}>
              {Object.entries(summary.data.decisionsByCode).map(([code, n]) => (
                <li key={code}>
                  <StatusBadge label={`${code} : ${n}`} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <CouncilsBoundary query={list} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ScrollTable caption={t("table.caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{t("table.council")}</th>
              <th scope="col" className={TH}>{t("table.classroom")}</th>
              <th scope="col" className={TH}>{t("table.period")}</th>
              <th scope="col" className={TH}>{t("table.date")}</th>
              <th scope="col" className={TH}>{t("table.status")}</th>
              <th scope="col" className={TH}>{t("table.progress")}</th>
              <th scope="col" className={TH}>{t("table.results")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((c) => (
              <tr key={c.id}>
                <td className={TD}>
                  <Link href={`/v2/councils/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                    {councilTitle({ ...c, classroomName: null, periodLabel: null })}
                  </Link>
                  <PlaceholderTag kind={c.ruleSourceKind} />
                </td>
                <td className={TD}>{c.classroomName ?? "—"}</td>
                <td className={TD}>{c.periodLabel ?? t("table.yearScope")}</td>
                <td className={TD}>{c.heldOn ? dt.date(c.heldOn) : dt.dateTime(c.scheduledAt)}</td>
                <td className={TD}>
                  <div className="flex flex-wrap items-center gap-1">
                    <EnumLabel group="status" value={c.status} />
                    {reviewIds.includes(c.id) ? <StatusBadge label={t("table.reviewNeeded")} tone="warning" /> : null}
                    {c.reopenCount > 0 ? <StatusBadge label={t("table.reopened", { count: c.reopenCount })} tone="warning" /> : null}
                  </div>
                </td>
                <td className={TD}>{t("table.progressValue", { decided: c.counts.decided, items: c.counts.agendaItems, present: c.counts.present, participants: c.counts.participants })}</td>
                <td className={TD}>{c.resultsStateId ? t("table.resultsLinked") : t("table.resultsNotLinked")}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
        {total > PAGE_SIZE ? (
          <nav aria-label={t("pagination.label")} className="mt-3 flex items-center justify-between gap-2">
            <button type="button" className={buttonClass.secondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t("pagination.previous")}
            </button>
            <span className="text-sm text-muted-foreground">{t("pagination.page", { page, pages: lastPage })}</span>
            <button type="button" className={buttonClass.secondary} disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
              {t("pagination.next")}
            </button>
          </nav>
        ) : null}
      </CouncilsBoundary>
      {creating ? <CouncilFormDialog onClose={() => setCreating(false)} onCreated={setCreated} /> : null}
    </div>
  );
}

function PlaceholderTag({ kind }: { kind: string | null }) {
  const t = useTranslations("v2Councils.banner");
  return kind === "placeholder" ? <StatusBadge label={t("short")} tone="warning" className="ml-2" /> : null;
}

/** Création d'une séance : classe, année, type (donnée d'établissement), période si le type est de portée période. */
function CouncilFormDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CouncilsCouncilDto) => void }) {
  const t = useTranslations("v2Councils.calendar.form");
  const classes = useClassChoices();
  const ref = useCouncilsReference();
  const years = useAcademicYears();
  const create = useCreateCouncil();
  const [classroomId, setClassroomId] = useState("");
  const [yearId, setYearId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("14:00");
  const [location, setLocation] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const types = (ref.data?.councilTypes ?? []).filter((x) => x.active);
  const type = types.find((x) => x.id === typeId);
  const effectiveYear = yearId || (years.data ?? []).find((y) => y.isCurrent)?.id || "";
  const periods = useYearPeriods(type?.scope === "PERIOD" && effectiveYear ? effectiveYear : null);

  function submit() {
    const payload = compact({
      classroomId,
      councilTypeId: typeId,
      academicPeriodId: type?.scope === "PERIOD" ? periodId : "",
      title: title.trim(),
      scheduledAt: date ? localToIso(`${date}T${time || "14:00"}`) : "",
      location: location.trim(),
    });
    const v = validateWith(councilsCreateSchema, payload);
    const local: FieldErrors = {};
    if (type?.scope === "PERIOD" && periodId === "") local.academicPeriodId = t("periodRequired");
    const all = { ...(v.ok ? {} : v.errors), ...local };
    if (Object.keys(all).length > 0) return setErrors(all);
    if (!v.ok) return;
    setErrors({});
    create.mutate(v.data, {
      onSuccess: (c) => {
        onCreated(c);
        onClose();
      },
      onError: (e) => setErrors(apiErrorToFieldErrors(e)),
    });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrorToFieldErrors(create.error)).length === 0 ? create.error : undefined} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("classroom")} required error={errors.classroomId ?? null}>
          {(c) => <NativeSelect {...c} value={classroomId} placeholder={t("chooseClassroom")} onChange={setClassroomId} options={classes.options} />}
        </FormField>
        <FormField label={t("type")} required error={errors.councilTypeId ?? null}>
          {(c) => <NativeSelect {...c} value={typeId} placeholder={t("chooseType")} onChange={(v) => { setTypeId(v); setPeriodId(""); }} options={types.map((x) => ({ value: x.id, label: x.label }))} />}
        </FormField>
        {type?.scope === "PERIOD" ? (
          <>
            <FormField label={t("year")}>
              {(c) => <NativeSelect {...c} value={effectiveYear} onChange={(v) => { setYearId(v); setPeriodId(""); }} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
            </FormField>
            <FormField label={t("period")} required error={errors.academicPeriodId ?? null}>
              {(c) => <NativeSelect {...c} value={periodId} placeholder={t("choosePeriod")} onChange={setPeriodId} options={(periods.data ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
            </FormField>
          </>
        ) : type ? (
          <p className="text-sm text-muted-foreground sm:col-span-2">{t("yearScope")}</p>
        ) : null}
      </div>
      <FormField label={t("titleLabel")} error={errors.title ?? null}>
        {(c) => <TextControl {...c} value={title} onChange={setTitle} maxLength={200} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("date")} error={errors.scheduledAt ?? null}>
          {(c) => <TextControl {...c} type="date" value={date} onChange={setDate} />}
        </FormField>
        <FormField label={t("time")}>{(c) => <TextControl {...c} type="time" value={time} onChange={setTime} />}</FormField>
        <FormField label={t("location")} error={errors.location ?? null}>
          {(c) => <TextControl {...c} value={location} onChange={setLocation} maxLength={200} />}
        </FormField>
      </div>
    </FormDialog>
  );
}
