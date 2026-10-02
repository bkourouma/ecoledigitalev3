"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { SchedulingConflictViewDto } from "@ecoledigitale/contracts/v2/scheduling";
import type { Directory } from "@/platform/v2/directory";
import type { OccurrenceDto } from "@/platform/v2/scheduling";
import { StatusBadge } from "@/platform/ui/PageHeader";

/**
 * Ce que la carte lit d'une séance : `OccurrenceDto` convient, et la copie hors ligne (qui n'a ni intervenants ni motif d'annulation,
 * champs potentiellement personnels) aussi.
 */
export type OccurrenceView = Pick<OccurrenceDto, "id" | "kind" | "title" | "classroomId" | "roomId" | "startsAt" | "endsAt" | "occursOn" | "status" | "needsReplacement" | "conflictOverride" | "deliveryMode" | "locationLabel"> & {
  staff?: OccurrenceDto["staff"];
  cancelReason?: string | null;
};

export interface Directories {
  classrooms: Directory;
  staff: Directory;
  rooms: Directory;
}

/** Plage horaire locale d'une séance (fuseau de l'établissement, via le formateur de l'application). */
export function useTimeRange() {
  const format = useFormatter();
  return (o: Pick<OccurrenceDto, "startsAt" | "endsAt">): string => `${format.dateTime(new Date(o.startsAt), { timeStyle: "short" })} – ${format.dateTime(new Date(o.endsAt), { timeStyle: "short" })}`;
}

/**
 * Séance dans une vue d'emploi du temps : heure, intitulé, classe, salle, intervenants (quand l'utilisateur peut les
 * nommer), états (annulée, constatée, à remplacer, dérogation). `actions` : boutons propres à l'écran appelant.
 */
export function OccurrenceCard({ o, dirs, actions, compact = false }: { o: OccurrenceView; dirs: Directories; actions?: ReactNode; compact?: boolean }) {
  const t = useTranslations("v2Schedule");
  const range = useTimeRange();
  const staffNames = (o.staff ?? []).map((s) => dirs.staff.find(s.staffId)).filter((n): n is string => n !== null);
  const roomName = o.roomId ? dirs.rooms.find(o.roomId) : null;
  const cancelled = o.status === "CANCELLED";
  const classroom = o.classroomId ? dirs.classrooms.find(o.classroomId) : null;
  const title = o.title ?? t(`kind.${o.kind}`);
  return (
    <article
      aria-label={`${range(o)} ${title}`}
      className={cn("space-y-1.5 rounded-md border bg-card p-2.5 text-sm", cancelled && "border-dashed opacity-75", o.needsReplacement && !cancelled && "border-amber-400")}
    >
      <p className="font-semibold tabular-nums">{range(o)}</p>
      <p className={cn("font-medium", cancelled && "line-through")}>{title}</p>
      {!compact || classroom ? <p className="text-muted-foreground">{[classroom, roomName, o.locationLabel].filter(Boolean).join(" · ")}</p> : null}
      {staffNames.length > 0 ? <p className="text-muted-foreground">{staffNames.join(", ")}</p> : null}
      <div className="flex flex-wrap gap-1">
        {cancelled ? <StatusBadge label={t("status.CANCELLED")} tone="neutral" /> : null}
        {o.status === "HELD" ? <StatusBadge label={t("status.HELD")} tone="success" /> : null}
        {o.needsReplacement && !cancelled ? <StatusBadge label={t("needsReplacement")} tone="warning" /> : null}
        {o.conflictOverride ? <StatusBadge label={t("overridden")} tone="danger" /> : null}
        {o.deliveryMode !== "IN_PERSON" ? <StatusBadge label={t(`delivery.${o.deliveryMode}`)} tone="info" /> : null}
      </div>
      {cancelled && o.cancelReason ? <p className="text-xs text-muted-foreground">{t("cancelReason", { reason: o.cancelReason })}</p> : null}
      {actions ? <div className="flex flex-wrap gap-1 pt-1">{actions}</div> : null}
    </article>
  );
}

/** Conflits renvoyés par l'API (aperçu ou refus d'écriture) : le message du serveur est affiché tel quel. */
export function ConflictList({ conflicts, title }: { conflicts: ReadonlyArray<SchedulingConflictViewDto>; title?: string }) {
  const t = useTranslations("v2Schedule.conflicts");
  const range = useFormatter();
  if (conflicts.length === 0) return null;
  const blocking = conflicts.filter((c) => c.severity === "BLOCKING");
  const warnings = conflicts.filter((c) => c.severity !== "BLOCKING");
  const item = (c: SchedulingConflictViewDto, i: number) => (
    <li key={`${c.code}-${c.resourceId ?? ""}-${i}`}>
      <span className="font-medium">{t(`resource.${c.resourceKind}`)} : </span>
      {c.message}
      {c.with ? <span className="text-muted-foreground"> ({range.dateTime(new Date(c.with.startsAt), { dateStyle: "short", timeStyle: "short" })}{c.with.title ? `, ${c.with.title}` : ""})</span> : null}
    </li>
  );
  return (
    <div className="space-y-2" aria-label={title ?? t("title")}>
      {blocking.length > 0 ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-semibold">{t("blocking", { count: blocking.length })}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{blocking.map(item)}</ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">{t("warnings", { count: warnings.length })}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{warnings.map(item)}</ul>
        </div>
      ) : null}
    </div>
  );
}

/** Conflits portés par une erreur 409 (`details.conflicts`) : la liste détaillée de l'API quand elle existe. */
export function conflictsFromError(error: unknown): SchedulingConflictViewDto[] {
  const details = (error as { details?: unknown } | null)?.details;
  if (!details || typeof details !== "object") return [];
  const list = (details as { conflicts?: unknown }).conflicts;
  if (!Array.isArray(list)) return [];
  return list.filter((c): c is SchedulingConflictViewDto => !!c && typeof c === "object" && typeof (c as { message?: unknown }).message === "string" && typeof (c as { resourceKind?: unknown }).resourceKind === "string");
}
