"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { schedulingSettingsBodySchema } from "@ecoledigitale/contracts/v2/scheduling";
import { useSchedulingSettings, useUpdateSchedulingSettings } from "@/platform/v2/scheduling";
import { useInstitutions } from "@/platform/v2/lookups";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Horaires d'ouverture de l'école (L-16) : heure d'ouverture, heure de fermeture et jours ouvrés. Ils servent au taux d'occupation
 * des salles (« Salles et équipements ») ; sans eux l'écran affiche « Horaires d'ouverture non renseignés ». Les heures des
 * créneaux restent saisies séance par séance.
 */
export function HoursScreen() {
  const t = useTranslations("v2Schedule.hours");
  const institutions = useInstitutions();
  const [chosen, setChosen] = useState("");
  const list = institutions.data ?? [];
  const institutionId = chosen || (list.length === 1 ? list[0]!.id : "");
  const settings = useSchedulingSettings(institutionId || null);
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {institutions.isError ? <ErrorBlock error={institutions.error} onRetry={() => void institutions.refetch()} /> : null}
      {list.length > 1 ? (
        <div className="max-w-md">
          <FormField label={t("institution")}>{(c) => <NativeSelect {...c} value={chosen} onChange={setChosen} placeholder={t("choose")} options={list.map((i) => ({ value: i.id, label: i.name }))} />}</FormField>
        </div>
      ) : null}
      {settings.isPending && institutionId ? <LoadingBlock /> : null}
      {settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : null}
      {settings.data ? <HoursForm key={`${institutionId}-${settings.data.openingStart}-${settings.data.openingEnd}-${(settings.data.openingWeekdays ?? []).join()}`} institutionId={institutionId} start={settings.data.openingStart} end={settings.data.openingEnd} weekdays={settings.data.openingWeekdays} /> : null}
    </div>
  );
}

function HoursForm({ institutionId, start, end, weekdays }: { institutionId: string; start: string | null; end: string | null; weekdays: number[] | null }) {
  const t = useTranslations("v2Schedule.hours");
  const tDay = useTranslations("v2Schedule.weekdayLong");
  const update = useUpdateSchedulingSettings();
  const flash = useFlash();
  const [from, setFrom] = useState(start ?? "");
  const [to, setTo] = useState(end ?? "");
  const [days, setDays] = useState<number[]>(weekdays ?? []);
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(update.error);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const e2: FieldErrors = {};
    if ((from === "") !== (to === "")) e2.openingEnd = t("bothOrNone");
    else if (from && to && from >= to) e2.openingEnd = t("endAfterStart");
    const body = { institutionId, openingStart: from || null, openingEnd: to || null, openingWeekdays: days.length > 0 ? [...days].sort() : null };
    const v = validateWith(schedulingSettingsBodySchema, body);
    const all = { ...(v.ok ? {} : v.errors), ...e2 };
    setErrors(all);
    if (!v.ok || Object.keys(e2).length > 0) return;
    update.mutate(body, { onSuccess: () => flash.show(t("saved")) });
  }

  return (
    <form noValidate onSubmit={submit} aria-label={t("title")} className="max-w-xl space-y-4 rounded-2xl border border-white/10 bg-card/40 p-4">
      {flash.node}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("opening")} error={errors.openingStart ?? apiErrors.openingStart}>
          {(c) => <TextControl {...c} type="time" value={from} onChange={setFrom} />}
        </FormField>
        <FormField label={t("closing")} error={errors.openingEnd ?? apiErrors.openingEnd}>
          {(c) => <TextControl {...c} type="time" value={to} onChange={setTo} />}
        </FormField>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("days")}</legend>
        {DAYS.map((d) => (
          <CheckControl key={d} checked={days.includes(d)} onChange={(v) => setDays((l) => (v ? [...l, d] : l.filter((x) => x !== d)))} label={tDay(String(d))} />
        ))}
        <p className="text-xs text-muted-foreground">{t("daysHint")}</p>
      </fieldset>
      {start === null && end === null ? <Notice kind="info">{t("notSet")}</Notice> : null}
      {update.error && Object.keys(apiErrors).length === 0 ? <ErrorBlock error={update.error} /> : null}
      <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
        {t("save")}
      </button>
    </form>
  );
}
