"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { usePermission } from "@/platform/access";
import { addDays, mondayOf, todayCivil, weekDays } from "@/platform/v2/dates";
import { useClassroomDirectory, useRoomDirectory, useStaffDirectory } from "@/platform/v2/directory";
import { useClassroomOptions, useStaffOptions, useStudentOptions } from "@/platform/v2/lookups";
import { useMyChildren } from "@/platform/v2/people";
import { useChildTimetable, useMyTimetable, useRooms, useViewOccurrences } from "@/platform/v2/scheduling";
import { CheckControl, FormField, NativeSelect } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { OccurrenceCard, type Directories, type OccurrenceView } from "./OccurrenceCard";
import { OfflineCopyNotice, useOfflineTimetable } from "./offline-timetable";

type Mode = "mine" | "children" | "classroom" | "staff" | "room" | "student";

/** Séances groupées par jour civil (`occursOn` renvoyé par l'API) et triées par heure : aucune règle d'horaire côté client. */
export function groupByDay<T extends Pick<OccurrenceView, "startsAt" | "occursOn">>(items: ReadonlyArray<T>): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const o of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const list = map.get(o.occursOn) ?? [];
    list.push(o);
    map.set(o.occursOn, list);
  }
  return map;
}

/**
 * Emploi du temps lisible : la semaine en colonnes sur écran large, en liste par jour sur téléphone ; vue « Jour »
 * partout. Sujets : moi, mes enfants (parent), une classe, un enseignant, une salle, un élève (selon les droits).
 */
export function TimetableScreen({ exportHref = "/v2/schedule/export" }: { exportHref?: string } = {}) {
  const t = useTranslations("v2Schedule.viewer");
  const tOffline = useTranslations("v2Offline.schedule");
  const format = useFormatter();
  const own = usePermission("schedule.own.read").allowed;
  const self = usePermission("schedule.self.read").allowed;
  const child = usePermission("schedule.child.read").allowed;
  const all = usePermission("schedule.read").allowed;

  const modes = useMemo<Mode[]>(() => {
    const m: Mode[] = [];
    if (own || self) m.push("mine");
    if (child) m.push("children");
    if (all) m.push("classroom", "staff", "room", "student");
    return m;
  }, [own, self, child, all]);
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode: Mode | null = picked && modes.includes(picked) ? picked : (modes[0] ?? null);

  const [anchor, setAnchor] = useState(todayCivil());
  const [view, setView] = useState<"week" | "day">("week");
  const [showCancelled, setShowCancelled] = useState(false);
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const [person, setPerson] = useState<SelectOption | null>(null);
  const [student, setStudent] = useState<SelectOption | null>(null);
  const [roomId, setRoomId] = useState("");
  const [childId, setChildId] = useState("");

  const days = weekDays(anchor);
  const window = view === "week" ? { from: days[0]!, to: days[6]!, includeCancelled: showCancelled } : { from: anchor, to: anchor, includeCancelled: showCancelled };

  const rooms = useRooms({}, mode === "room");
  const children = useMyChildren(mode === "children");
  const mine = useMyTimetable(window, mode === "mine");
  const kids = useChildTimetable(mode === "children" && childId ? childId : null, window);
  const byClass = useViewOccurrences("classroom", mode === "classroom" ? (classroom?.value ?? null) : null, window);
  const byStaff = useViewOccurrences("staff", mode === "staff" ? (person?.value ?? null) : null, window);
  const byRoom = useViewOccurrences("room", mode === "room" ? roomId || null : null, window);
  const byStudent = useViewOccurrences("student", mode === "student" ? (student?.value ?? null) : null, window);
  const query = mode === "mine" ? mine : mode === "children" ? kids : mode === "classroom" ? byClass : mode === "staff" ? byStaff : mode === "room" ? byRoom : byStudent;
  const subjectChosen = mode === "mine" || (mode === "children" && childId !== "") || (mode === "classroom" && classroom) || (mode === "staff" && person) || (mode === "room" && roomId !== "") || (mode === "student" && student);

  const liveDirs: Directories = { classrooms: useClassroomDirectory(), staff: useStaffDirectory(), rooms: useRoomDirectory() };
  // Hors ligne (ou réseau défaillant) : « mon » emploi du temps se lit depuis la copie enregistrée sur l'appareil, en lecture seule.
  const offline = useOfflineTimetable({ active: mode === "mine", window, query: mine, dirs: liveDirs });
  const cachedMode = mode === "mine" && offline.fromCache && offline.directories !== null;
  const dirs: Directories = cachedMode && offline.directories ? offline.directories : liveDirs;
  const shownItems: ReadonlyArray<OccurrenceView> = cachedMode ? offline.items : (query.data?.items ?? []);
  const grouped = groupByDay(shownItems);
  const shift = (n: number) => setAnchor((a) => addDays(view === "week" ? mondayOf(a) : a, n * (view === "week" ? 7 : 1)));
  const dayLabel = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const dayShort = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "short", day: "numeric", timeZone: "UTC" });
  const today = todayCivil();

  if (modes.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} description={t("description")} />
        <Notice kind="info">{t("noAccess")}</Notice>
      </div>
    );
  }

  const shownDays = view === "week" ? days : [anchor];
  const agendaDays = shownDays.filter((d) => grouped.has(d) || view === "day");
  const rangeLabel = view === "week" ? t("weekOf", { from: dayLabel(days[0]!), to: dayLabel(days[6]!) }) : dayLabel(anchor);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href={exportHref} className={buttonClass.secondary}>
            {t("export")}
          </Link>
        }
      />

      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("show")}>{(c) => <NativeSelect {...c} value={mode ?? ""} onChange={(v) => setPicked(v as Mode)} options={modes.map((m) => ({ value: m, label: t(`modes.${m}`) }))} />}</FormField>
        {mode === "classroom" ? <FormField label={t("modes.classroom")}>{(c) => <SelectAsync {...c} value={classroom} onChange={setClassroom} useOptions={useClassroomOptions} ariaLabel={t("modes.classroom")} placeholder={t("chooseClassroom")} />}</FormField> : null}
        {mode === "staff" ? <FormField label={t("modes.staff")}>{(c) => <SelectAsync {...c} value={person} onChange={setPerson} useOptions={useStaffPickOptions} ariaLabel={t("modes.staff")} placeholder={t("chooseStaff")} />}</FormField> : null}
        {mode === "student" ? <FormField label={t("modes.student")}>{(c) => <SelectAsync {...c} value={student} onChange={setStudent} useOptions={useStudentOptions} ariaLabel={t("modes.student")} placeholder={t("chooseStudent")} />}</FormField> : null}
        {mode === "room" ? <FormField label={t("modes.room")}>{(c) => <NativeSelect {...c} value={roomId} onChange={setRoomId} placeholder={t("chooseRoom")} options={(rooms.data ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))} />}</FormField> : null}
        {mode === "children" ? <FormField label={t("modes.children")}>{(c) => <NativeSelect {...c} value={childId} onChange={setChildId} placeholder={t("chooseChild")} options={(children.data ?? []).map((k) => ({ value: k.id, label: k.displayName }))} />}</FormField> : null}
        <FormField label={t("view")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={view}
              onChange={(v) => setView(v as "week" | "day")}
              options={[
                { value: "week", label: t("viewWeek") },
                { value: "day", label: t("viewDay") },
              ]}
            />
          )}
        </FormField>
      </div>

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
        </div>
        <p className="text-sm font-medium" aria-live="polite">
          {rangeLabel}
        </p>
        <CheckControl checked={showCancelled} onChange={setShowCancelled} label={t("showCancelled")} />
      </div>

      {!subjectChosen ? (
        <EmptyBlock title={t("chooseSubject")} description={t("chooseSubjectHint")} />
      ) : mode === "mine" && offline.missing ? (
        <div className="space-y-3">
          <Notice kind="warning">{tOffline("noCopy")}</Notice>
          {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
        </div>
      ) : !cachedMode && query.isPending ? (
        <LoadingBlock />
      ) : !cachedMode && query.isError ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : shownItems.length === 0 ? (
        <>
          {cachedMode && offline.snapshot ? <OfflineCopyNotice snapshot={offline.snapshot} /> : null}
          <EmptyBlock title={view === "week" ? t("emptyWeek") : t("emptyDay")} description={t("emptyHint")} />
        </>
      ) : (
        <>
          {cachedMode && offline.snapshot ? <OfflineCopyNotice snapshot={offline.snapshot} /> : null}
          {!cachedMode && query.data?.hasMore ? <Notice kind="info">{t("truncated")}</Notice> : null}
          {query.isPlaceholderData ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t("updating")}
            </p>
          ) : null}
          {view === "week" ? (
            <div className="hidden gap-2 md:grid md:grid-cols-7" role="list" aria-label={t("weekGrid")}>
              {days.map((d) => (
                <section key={d} role="listitem" aria-label={dayLabel(d)} className={cn("min-w-0 space-y-2 rounded-2xl border p-2", d === today && "border-primary bg-primary/5")}>
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

const useStaffPickOptions = (search: string, enabled: boolean) => useStaffOptions(search, enabled, {});
