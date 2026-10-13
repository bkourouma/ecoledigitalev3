"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { addDays, minutesToTime, todayCivil } from "@/platform/v2/dates";
import { useInstitutions } from "@/platform/v2/lookups";
import { useSuggestSlots, type SlotSuggestionDto } from "@/platform/v2/scheduling";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";

/**
 * Aide au placement (`suggestSlots`) : les premiers créneaux LIBRES pour cette durée, ces intervenants, cette classe et
 * éventuellement cette salle, dans une fenêtre de dates. C'est une aide, pas un solveur : l'API classe de façon
 * déterministe et signale les avertissements ; on choisit un créneau, qui remplit le formulaire (et l'aperçu des
 * conflits le revérifie).
 */
export function SlotSuggester({
  staffIds,
  classroomId,
  roomId,
  onPick,
}: {
  staffIds: string[];
  classroomId: string | null;
  roomId: string | null;
  onPick: (slot: SlotSuggestionDto) => void;
}) {
  const t = useTranslations("v2Schedule.slots");
  const date = useDateFormat();
  const institutions = useInstitutions();
  const suggest = useSuggestSlots();
  const today = todayCivil();
  const [duration, setDuration] = useState("60");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 14));
  const [error, setError] = useState<string | null>(null);
  const institutionId = institutions.data?.[0]?.id ?? null;

  function run() {
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
      setError(t("durationInvalid"));
      return;
    }
    if (!institutionId) {
      setError(t("noInstitution"));
      return;
    }
    setError(null);
    suggest.mutate({
      institutionId,
      durationMinutes: minutes,
      window: { from, to },
      count: 8,
      ...(staffIds.length > 0 ? { staffIds } : {}),
      ...(classroomId ? { classroomId } : {}),
      ...(roomId ? { roomId } : {}),
    });
  }

  return (
    <section aria-labelledby="slots-title" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <h3 id="slots-title" className="text-sm font-semibold">
        {t("title")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("duration")} error={error}>
          {(c) => <TextControl {...c} type="number" inputMode="numeric" min={5} max={1440} value={duration} onChange={setDuration} />}
        </FormField>
        <FormField label={t("from")}>{(c) => <TextControl {...c} type="date" value={from} onChange={setFrom} />}</FormField>
        <FormField label={t("to")}>{(c) => <TextControl {...c} type="date" value={to} onChange={setTo} />}</FormField>
      </div>
      <button type="button" className={buttonClass.secondary} onClick={run} disabled={suggest.isPending}>
        {suggest.isPending ? t("searching") : t("search")}
      </button>
      {suggest.isError ? <Notice kind="error">{suggest.error.message}</Notice> : null}
      {suggest.data ? (
        suggest.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {suggest.data.items.map((s) => (
              <li key={`${s.date}-${s.startMinute}-${s.roomId ?? ""}`} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">
                    {date.civil(s.date)} · {minutesToTime(s.startMinute)} – {minutesToTime(s.endMinute)}
                    {s.roomCode ? ` · ${s.roomCode}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.preferred ? <StatusBadge label={t("preferred")} tone="success" /> : null}
                    {s.warnings.map((w, i) => (
                      <StatusBadge key={i} label={w.message} tone="warning" className="whitespace-normal" />
                    ))}
                  </div>
                </div>
                <button type="button" className={buttonClass.secondary} onClick={() => onPick(s)}>
                  {t("use")}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
