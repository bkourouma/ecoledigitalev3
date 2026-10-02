"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { addDays, mondayOf, todayCivil, weekDays } from "@/platform/v2/dates";
import type { Directory } from "@/platform/v2/directory";
import { useFamilyLabels, type FamilySubject } from "@/platform/v2/portal";
import { useChildTimetable, useMyTimetable, type OccurrenceDto } from "@/platform/v2/scheduling";
import { CheckControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { OccurrenceCard, type Directories } from "../schedule/_components/OccurrenceCard";
import { groupByDay } from "../schedule/_components/TimetableScreen";

const unknownDirectory: Directory = { name: () => "—", find: () => null, isLoading: false };

/**
 * Emploi du temps de l'élève ou d'un enfant lié : semaine (colonnes ≥ md, liste par jour sur mobile) ou jour, navigation
 * précédente / suivante / aujourd'hui. Les séances et leurs horaires sont ceux de l'API ; les noms de classes et de matières
 * viennent des libellés de l'inscription (un nom inconnu n'est jamais remplacé par un identifiant).
 */
export function FamilySchedule({ subject, title }: { subject: FamilySubject; title: string }) {
  const t = useTranslations("v2Portal.family.schedule");
  const format = useFormatter();
  const labels = useFamilyLabels(subject);
  const [anchor, setAnchor] = useState(todayCivil());
  const [view, setView] = useState<"week" | "day">("week");
  const [showCancelled, setShowCancelled] = useState(false);
  const days = weekDays(anchor);
  const window = view === "week" ? { from: days[0]!, to: days[6]!, includeCancelled: showCancelled } : { from: anchor, to: anchor, includeCancelled: showCancelled };
  const mine = useMyTimetable(window, subject.kind === "me");
  const child = useChildTimetable(subject.kind === "child" ? subject.id : null, window);
  const query = subject.kind === "me" ? mine : child;

  const dirs: Directories = {
    classrooms: { name: (id) => labels.classroom(id) ?? "—", find: (id) => labels.classroom(id), isLoading: labels.isLoading },
    staff: unknownDirectory,
    rooms: unknownDirectory,
  };
  const named = (o: OccurrenceDto): OccurrenceDto => ({ ...o, title: o.title ?? labels.node(o.curriculumNodeId) });
  const items = (query.data?.items ?? []).map(named);
  const grouped = groupByDay(items);
  const shift = (n: number) => setAnchor((a) => addDays(view === "week" ? mondayOf(a) : a, n * (view === "week" ? 7 : 1)));
  const dayLabel = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const dayShort = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "short", day: "numeric", timeZone: "UTC" });
  const today = todayCivil();
  const shownDays = view === "week" ? days : [anchor];
  const agendaDays = shownDays.filter((d) => grouped.has(d) || view === "day");
  const rangeLabel = view === "week" ? t("weekOf", { from: dayLabel(days[0]!), to: dayLabel(days[6]!) }) : dayLabel(anchor);

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={t("description")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1" role="group" aria-label={t("navigation")}>
          <button type="button" className={buttonClass.secondary} onClick={() => shift(-1)} aria-label={view === "week" ? t("previousWeek") : t("previousDay")}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={buttonClass.secondary} onClick={() => setAnchor(todayCivil())}>
            {t("today")}
          </button>
          <button type="button" className={buttonClass.secondary} onClick={() => shift(1)} aria-label={view === "week" ? t("nextWeek") : t("nextDay")}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={buttonClass.ghost} aria-pressed={view === "day"} onClick={() => setView((v) => (v === "week" ? "day" : "week"))}>
            {view === "week" ? t("viewDay") : t("viewWeek")}
          </button>
        </div>
        <p className="text-sm font-medium" aria-live="polite">
          {rangeLabel}
        </p>
        <CheckControl checked={showCancelled} onChange={setShowCancelled} label={t("showCancelled")} />
      </div>

      {query.isPending ? (
        <LoadingBlock />
      ) : query.isError ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock title={view === "week" ? t("emptyWeek") : t("emptyDay")} description={t("emptyHint")} />
      ) : (
        <>
          {query.data?.hasMore ? <Notice kind="info">{t("truncated")}</Notice> : null}
          {view === "week" ? (
            <div className="hidden gap-2 md:grid md:grid-cols-7" role="list" aria-label={t("weekGrid")}>
              {days.map((d) => (
                <section key={d} role="listitem" aria-label={dayLabel(d)} className={cn("min-w-0 space-y-2 rounded-lg border p-2", d === today && "border-primary bg-primary/5")}>
                  <h2 className="text-center text-sm font-semibold capitalize">{dayShort(d)}</h2>
                  {(grouped.get(d) ?? []).map((o) => (
                    <OccurrenceCard key={o.id} o={o} dirs={dirs} compact />
                  ))}
                </section>
              ))}
            </div>
          ) : null}
          <div className={cn("space-y-4", view === "week" && "md:hidden")} aria-label={t("agenda")}>
            {agendaDays.map((d) => (
              <section key={d} aria-labelledby={`day-${d}`} className="space-y-2">
                <h2 id={`day-${d}`} className={cn("text-base font-semibold capitalize", d === today && "text-primary")}>
                  {dayLabel(d)}
                </h2>
                {(grouped.get(d) ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("nothingThatDay")}</p>
                ) : (
                  <ul className="space-y-2">
                    {(grouped.get(d) ?? []).map((o) => (
                      <li key={o.id}>
                        <OccurrenceCard o={o} dirs={dirs} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
