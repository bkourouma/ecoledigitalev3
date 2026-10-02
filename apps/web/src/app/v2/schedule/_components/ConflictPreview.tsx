"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { usePreviewConflicts } from "@/platform/v2/scheduling";
import { CheckControl, FormField, TextAreaControl } from "@/platform/ui/FormField";
import { LoadingBlock } from "@/platform/ui/states";
import { ConflictList } from "./OccurrenceCard";

export interface PreviewInput {
  kind?: "LESSON" | "EXAM" | "MEETING" | "EVENT" | "RESERVATION" | "COUNCIL" | "OTHER";
  classroomId?: string | null;
  roomId?: string | null;
  staff?: Array<{ staffId: string; role?: "LEAD" | "CO_TEACHER" | "SUBSTITUTE" | "SUPERVISOR" }>;
  date?: string;
  startTime?: string;
  endTime?: string;
  startsAt?: string;
  endsAt?: string;
  excludeOccurrenceId?: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Une plage est « complète » quand l'API peut l'évaluer : (date, début, fin) ou (instants). */
export function isWindowComplete(i: PreviewInput): boolean {
  return Boolean((i.date && i.startTime && i.endTime && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && TIME.test(i.startTime) && TIME.test(i.endTime)) || (i.startsAt && i.endsAt));
}

/**
 * Aperçu des conflits EN DIRECT : à chaque changement de la plage, des intervenants, de la classe ou de la salle, on
 * demande à l'API (après une courte pause de frappe) ce qu'elle déciderait. Les messages sont ceux du serveur.
 * Si un dépassement est possible (`schedule.conflict.override`), il se déclare ici avec son motif.
 */
export function useConflictPreview(input: PreviewInput, delayMs = 400) {
  const preview = usePreviewConflicts();
  const key = JSON.stringify(input);
  const mutate = useRef(preview.mutate);
  mutate.current = preview.mutate;
  useEffect(() => {
    if (!isWindowComplete(input)) return;
    const handle = setTimeout(() => mutate.current(JSON.parse(key) as PreviewInput), delayMs);
    return () => clearTimeout(handle);
    // `key` résume `input` : un changement de contenu relance l'aperçu, pas un simple nouveau rendu.
  }, [key, delayMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return preview;
}

export function ConflictPreviewPanel({
  input,
  override,
  onOverrideChange,
}: {
  input: PreviewInput;
  override: { enabled: boolean; reason: string };
  onOverrideChange: (next: { enabled: boolean; reason: string }) => void;
}) {
  const t = useTranslations("v2Schedule.preview");
  const preview = useConflictPreview(input);
  const canOverride = usePermission("schedule.conflict.override").allowed;
  const data = preview.data;
  if (!isWindowComplete(input)) return <p className="text-sm text-muted-foreground">{t("incomplete")}</p>;
  return (
    <div className="space-y-3" aria-live="polite">
      {preview.isPending && !data ? <LoadingBlock label={t("checking")} className="py-2" /> : null}
      {preview.isError ? <p className="text-sm text-destructive">{preview.error.message}</p> : null}
      {data ? (
        <>
          {data.conflicts.length === 0 ? <p className="text-sm text-emerald-800">{t("none")}</p> : <ConflictList conflicts={data.conflicts} />}
          {data.blocking && canOverride ? (
            <div className="space-y-2 rounded-md border p-3">
              <CheckControl checked={override.enabled} onChange={(enabled) => onOverrideChange({ ...override, enabled })} label={t("override")} hint={t("overrideHint")} />
              {override.enabled ? (
                <FormField label={t("overrideReason")} required error={override.reason.trim().length > 0 && override.reason.trim().length < 5 ? t("overrideReasonShort") : null}>
                  {(c) => <TextAreaControl {...c} value={override.reason} onChange={(reason) => onOverrideChange({ ...override, reason })} maxLength={500} />}
                </FormField>
              ) : null}
            </div>
          ) : null}
          {data.blocking && !canOverride ? <p className="text-sm text-muted-foreground">{t("blockedNoOverride")}</p> : null}
        </>
      ) : null}
    </div>
  );
}

/** État du dépassement de conflit saisi dans un formulaire, et le corps `override` correspondant. */
export function useOverrideState() {
  const [override, setOverride] = useState({ enabled: false, reason: "" });
  const body = override.enabled && override.reason.trim().length >= 5 ? { override: { reason: override.reason.trim() } } : {};
  const invalid = override.enabled && override.reason.trim().length < 5;
  return { override, setOverride, body, invalid };
}
