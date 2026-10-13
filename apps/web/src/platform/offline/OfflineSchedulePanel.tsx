"use client";

/**
 * Copie hors ligne de l'emploi du temps, affichée sur la page `/offline` (celle que le service worker montre quand une navigation
 * échoue faute de réseau). Lecture SEULE de la copie enregistrée sur cet appareil pour l'identité du jeton courant : aucune requête
 * réseau, aucune page privée mise en cache. Sans copie, ou sans identité, la section n'apparaît pas.
 */

import { useEffect, useId, useState } from "react";
import { DEFAULT_TIME_ZONE } from "@/platform/i18n/config";
import { browserScheduleCache } from "./browser-schedule-cache";
import { freshnessOf, groupByDay, pickSnapshot, type ScheduleSnapshot } from "./schedule-cache";
import { AntSelect } from "@/platform/ui/FormField";

export interface OfflineScheduleLabels {
  title: string;
  /** « {time} » : instant d'enregistrement de la copie. */
  savedAt: string;
  stale: string;
  period: string;
  empty: string;
  cancelled: string;
  truncated: string;
}

const civilToday = (): string => new Date().toLocaleDateString("sv-SE", { timeZone: DEFAULT_TIME_ZONE });

export function OfflineSchedulePanel({ labels }: { labels: OfflineScheduleLabels }) {
  const [list, setList] = useState<ScheduleSnapshot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectId = useId();

  useEffect(() => {
    let alive = true;
    void browserScheduleCache()
      .then((cache) => cache.list())
      .then((rows) => {
        if (!alive) return;
        setList(rows);
        setSelected(pickSnapshot(rows, civilToday())?.key ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const snapshot = list.find((s) => s.key === selected) ?? null;
  if (!snapshot) return null;

  const dateFmt = new Intl.DateTimeFormat("fr-CI", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const timeFmt = new Intl.DateTimeFormat("fr-CI", { hour: "2-digit", minute: "2-digit", timeZone: DEFAULT_TIME_ZONE });
  const stamp = new Intl.DateTimeFormat("fr-CI", { dateStyle: "medium", timeStyle: "short", timeZone: DEFAULT_TIME_ZONE }).format(new Date(snapshot.savedAt));
  const { stale } = freshnessOf(snapshot.savedAt, new Date());
  const days = groupByDay(snapshot.items);
  const range = (s: ScheduleSnapshot) => `${s.from} → ${s.to}`;

  return (
    <section aria-labelledby={`${selectId}-title`} className="w-full max-w-xl space-y-3 text-left" data-testid="offline-schedule">
      <h2 id={`${selectId}-title`} className="text-lg font-semibold">
        {labels.title}
      </h2>
      <p role="status" className="text-sm text-muted-foreground">
        {labels.savedAt.replace("{time}", stamp)}
      </p>
      {stale ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{labels.stale}</p> : null}
      {snapshot.hasMore ? <p className="text-sm text-muted-foreground">{labels.truncated}</p> : null}
      {list.length > 1 ? (
        <div className="space-y-1 text-sm">
          <label htmlFor={selectId} className="font-medium">
            {labels.period}
          </label>
          <AntSelect id={selectId} value={selected ?? ""} onChange={(e) => setSelected(e.target.value)} className="block h-10 w-full rounded-md border border-input bg-background px-2">
            {list.map((s) => (
              <option key={s.key} value={s.key}>
                {range(s)}
              </option>
            ))}
          </AntSelect>
        </div>
      ) : null}
      {days.length === 0 ? <p className="text-sm">{labels.empty}</p> : null}
      {days.map(([day, items]) => (
        <section key={day} aria-label={dateFmt.format(new Date(`${day}T12:00:00Z`))} className="space-y-1">
          <h3 className="text-sm font-semibold capitalize">{dateFmt.format(new Date(`${day}T12:00:00Z`))}</h3>
          <ul className="space-y-1">
            {items.map((o) => {
              const cls = o.classroomId ? snapshot.labels.classrooms[o.classroomId] : undefined;
              const room = o.roomId ? snapshot.labels.rooms[o.roomId] : undefined;
              const cancelled = o.status === "CANCELLED";
              return (
                <li key={o.id} className="rounded-md border p-2 text-sm">
                  <span className="font-medium tabular-nums">
                    {timeFmt.format(new Date(o.startsAt))} – {timeFmt.format(new Date(o.endsAt))}
                  </span>{" "}
                  <span className={cancelled ? "line-through" : undefined}>{o.title ?? ""}</span>
                  {cancelled ? <span className="ml-2 text-xs text-muted-foreground">{labels.cancelled}</span> : null}
                  {cls || room || o.locationLabel ? <span className="block text-muted-foreground">{[cls, room, o.locationLabel].filter(Boolean).join(" · ")}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
