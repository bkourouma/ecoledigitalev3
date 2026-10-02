"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { classify } from "@/platform/offline/outbox-manager";
import { browserScheduleCache } from "@/platform/offline/browser-schedule-cache";
import { prefetchWindow } from "@/platform/offline/schedule-prefetch";
import { freshnessOf, type CachedOccurrence, type ScheduleCache, type ScheduleSnapshot } from "@/platform/offline/schedule-cache";
import { shortId, type Directory } from "@/platform/v2/directory";
import { addDays, todayCivil } from "@/platform/v2/dates";
import { fetchMyTimetablePage, type OccurrenceDto, type WindowQuery } from "@/platform/v2/scheduling";
import { Notice } from "@/platform/ui/states";
import type { Directories, OccurrenceView } from "./OccurrenceCard";

/** Requête de l'emploi du temps personnel, vue par ce qui importe ici (tout `UseQueryResult` convient). */
export interface TimetableQueryLike {
  data?: { items: OccurrenceDto[]; hasMore: boolean } | undefined;
  isError: boolean;
  error: unknown;
  isPlaceholderData: boolean;
  fetchStatus: string;
}

function directoryOf(labels: Readonly<Record<string, string>>): Directory {
  return {
    name: (id) => (id ? (labels[id] ?? shortId(id)) : "—"),
    find: (id) => (id ? (labels[id] ?? null) : null),
    isLoading: false,
  };
}

const labelsOf = (ids: ReadonlyArray<string | null>, dir: Directory): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const id of ids) {
    if (!id || id in out) continue;
    const name = dir.find(id);
    if (name) out[id] = name;
  }
  return out;
};

/**
 * Emploi du temps PERSONNEL consultable sans réseau :
 *  - chaque fenêtre affichée avec succès en ligne est enregistrée sur l'appareil (copie minimale, voir `schedule-cache.ts`) ;
 *  - si le réseau est injoignable (hors ligne, délai, serveur indisponible) et qu'aucune donnée n'est à l'écran, la copie de la
 *    MÊME fenêtre est affichée, en lecture seule, avec sa date d'enregistrement ;
 *  - après l'enregistrement de la semaine COURANTE, la semaine suivante est préchargée en arrière-plan (une seule tentative par
 *    ouverture, en ligne et hors économie de données, échec silencieux) pour pouvoir y naviguer hors ligne ;
 *  - jamais pour un autre sujet que « moi » (`active` faux) : on ne garde rien des classes, collègues ou élèves.
 */
export function useOfflineTimetable({ active, window, query, dirs, cache }: { active: boolean; window: WindowQuery; query: TimetableQueryLike; dirs: Pick<Directories, "classrooms" | "rooms">; cache?: Promise<ScheduleCache> }) {
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot | null>(null);
  const [looked, setLooked] = useState(false);
  const includeCancelled = Boolean(window.includeCancelled);
  const prefetched = useRef(false);
  const live = query.data !== undefined && !query.isPlaceholderData;
  const unreachable = active && !live && ((query.isError && classify(query.error).retry) || query.fetchStatus === "paused");

  // Libellés des classes et salles de la fenêtre affichée (annuaires déjà chargés par l'écran).
  const items = live ? query.data!.items : [];
  const classrooms = labelsOf(items.map((i) => i.classroomId), dirs.classrooms);
  const rooms = labelsOf(items.map((i) => i.roomId), dirs.rooms);
  const labelsKey = JSON.stringify([classrooms, rooms]);

  useEffect(() => {
    if (!active || !live) return;
    let alive = true;
    void (cache ?? browserScheduleCache())
      .then(async (c) => {
        if (!alive) return false;
        const saved = await c.save({ from: window.from, to: window.to, includeCancelled, hasMore: query.data!.hasMore, items: query.data!.items, classrooms, rooms });
        // Semaine courante (7 jours contenant aujourd'hui) enregistrée : on précharge la suivante, une seule fois par ouverture.
        const today = todayCivil();
        const isCurrentWeek = window.from <= today && today <= window.to && window.to === addDays(window.from, 6);
        if (saved && isCurrentWeek && !prefetched.current) {
          prefetched.current = true;
          void prefetchWindow({
            next: { from: addDays(window.from, 7), to: addDays(window.to, 7), includeCancelled },
            cache: c,
            fetchPage: (w) => fetchMyTimetablePage(w),
            labels: { classrooms, rooms },
          });
        }
        return saved;
      })
      .catch(() => false);
    return () => {
      alive = false;
    };
    // `classrooms` / `rooms` sont dérivés de `labelsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, live, query.data, window.from, window.to, includeCancelled, labelsKey, cache]);

  useEffect(() => {
    if (!unreachable) {
      setSnapshot(null);
      setLooked(false);
      return;
    }
    let alive = true;
    void (cache ?? browserScheduleCache())
      .then((c) => c.load({ from: window.from, to: window.to, includeCancelled }))
      .then((s) => {
        if (!alive) return;
        setSnapshot(s);
        setLooked(true);
      })
      .catch(() => alive && setLooked(true));
    return () => {
      alive = false;
    };
  }, [unreachable, window.from, window.to, includeCancelled, cache]);

  const cachedItems = useMemo(() => (snapshot ? snapshot.items.map(toView) : []), [snapshot]);
  const directories = useMemo(() => (snapshot ? { classrooms: directoryOf(snapshot.labels.classrooms), rooms: directoryOf(snapshot.labels.rooms), staff: directoryOf({}) } : null), [snapshot]);
  return { fromCache: unreachable && snapshot !== null, missing: unreachable && looked && snapshot === null, snapshot, items: cachedItems as OccurrenceView[], directories };
}

const toView = (o: CachedOccurrence): OccurrenceView => ({ ...o, staff: [], cancelReason: null }) as unknown as OccurrenceView;

/** Bandeau de la copie hors ligne : fraîcheur affichée, lecture seule, alerte si ancienne. */
export function OfflineCopyNotice({ snapshot }: { snapshot: ScheduleSnapshot }) {
  const t = useTranslations("v2Offline.schedule");
  const { ageMinutes, stale } = freshnessOf(snapshot.savedAt, new Date());
  const ago = ageMinutes < 60 ? t("ago", { minutes: ageMinutes }) : ageMinutes < 48 * 60 ? t("agoHours", { hours: Math.floor(ageMinutes / 60) }) : t("agoDays", { days: Math.floor(ageMinutes / 1440) });
  return (
    <div className="space-y-2" data-testid="offline-copy-notice">
      <Notice kind="info">{t("cachedNotice", { time: ago })}</Notice>
      {stale ? <Notice kind="warning">{t("cachedStale")}</Notice> : null}
      {snapshot.hasMore ? <Notice kind="info">{t("truncated")}</Notice> : null}
    </div>
  );
}
