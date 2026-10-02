"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ACADEMIC_HOLIDAY_KINDS,
  academicCreateHolidayBodySchema,
  academicUpdateHolidayBodySchema,
  type AcademicHolidayDto,
  type AcademicYearDto,
} from "@ecoledigitale/contracts/v2/academic";
import { useAcademicYears } from "@/platform/v2/academic";
import { useCreateHoliday, useDeleteHoliday, useHolidays, useUpdateHoliday } from "@/platform/v2/rollover";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CardList, ItemCard, SettingsSection } from "./shared";

/**
 * Onglet « Calendrier » : jours fériés, vacances et fermetures de l'établissement, par année. Les fêtes fixes (« se répète
 * chaque année ») sont reportées par la reconduction ; les fêtes mobiles se ressaisissent chaque année.
 */
export function CalendarTab({ institutionId, canManage }: { institutionId: string | null; canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.calendar");
  const tKind = useTranslations("v2Rollover.holidayKind");
  const date = useDateFormat();
  const years = useAcademicYears(institutionId ? { institutionId } : {});
  const [yearId, setYearId] = useState("");
  const list = useMemo<AcademicYearDto[]>(() => [...(years.data ?? [])].sort((a, b) => b.startsOn.localeCompare(a.startsOn)), [years.data]);
  useEffect(() => {
    if (!yearId && list.length > 0) setYearId((list.find((y) => y.isCurrent) ?? list[0])!.id);
  }, [list, yearId]);
  const year = list.find((y) => y.id === yearId) ?? null;
  const holidays = useHolidays({ institutionId: year ? year.institutionId : null, from: year?.startsOn, to: year?.endsOn });
  const del = useDeleteHoliday();
  const flash = useFlash();
  const [editing, setEditing] = useState<AcademicHolidayDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<AcademicHolidayDto | null>(null);
  const rows = useMemo(() => [...(holidays.data ?? [])].sort((a, b) => a.startsOn.localeCompare(b.startsOn)), [holidays.data]);

  const range = (h: AcademicHolidayDto) => (h.startsOn === h.endsOn ? date.civil(h.startsOn) : `${date.civil(h.startsOn)} → ${date.civil(h.endsOn)}`);

  return (
    <SettingsSection
      id="holidays"
      title={t("title")}
      description={t("description")}
      actions={
        canManage && year ? (
          <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")}>
            {t("add")}
          </button>
        ) : null
      }
    >
      <Notice kind="info">{t("movableNote")}</Notice>
      {flash.node}
      {years.isError ? <ErrorBlock error={years.error} onRetry={() => void years.refetch()} /> : null}
      {years.data && list.length === 0 ? <EmptyBlock title={t("noYear")} description={t("noYearHint")} /> : null}
      {list.length > 0 ? (
        <FormField label={t("year")} className="max-w-md">
          {(c) => <NativeSelect {...c} value={yearId} onChange={setYearId} options={list.map((y) => ({ value: y.id, label: `${y.label} (${date.civil(y.startsOn)} → ${date.civil(y.endsOn)})` }))} />}
        </FormField>
      ) : null}
      {holidays.isPending && holidays.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {holidays.isError ? <ErrorBlock error={holidays.error} onRetry={() => void holidays.refetch()} /> : null}
      {year && holidays.data && rows.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      {rows.length > 0 ? (
        <CardList label={t("listLabel", { year: year?.label ?? "" })}>
          {rows.map((h) => (
            <ItemCard
              key={h.id}
              title={h.label}
              badges={
                <>
                  <StatusBadge label={tKind(h.kind)} tone={h.kind === "CLOSURE" ? "danger" : h.kind === "BREAK" ? "info" : "warning"} />
                  {h.recursYearly ? <StatusBadge label={t("recurs")} tone="success" /> : <StatusBadge label={t("oneOff")} tone="neutral" />}
                </>
              }
              meta={
                <>
                  <span>{range(h)}</span>
                  <span className="block">{h.blocksTeaching ? t("blocksTeaching") : t("noBlock")}</span>
                </>
              }
              actions={
                canManage ? (
                  <>
                    <button type="button" className={buttonClass.ghost} onClick={() => setEditing(h)} aria-label={`${t("edit")} — ${h.label}`}>
                      {t("edit")}
                    </button>
                    <button type="button" className={buttonClass.ghost} onClick={() => setDeleting(h)} aria-label={`${t("delete")} — ${h.label}`}>
                      {t("delete")}
                    </button>
                  </>
                ) : null
              }
            />
          ))}
        </CardList>
      ) : null}
      {editing && year ? <HolidayDialog year={year} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={(label) => flash.show(t("saved", { label }))} /> : null}
      {deleting ? (
        <ModalDialog open onOpenChange={(o) => !o && setDeleting(null)} title={t("deleteTitle", { label: deleting.label })} description={t("deleteDescription")}>
          <div className="space-y-4">
            {del.error ? <ErrorBlock error={del.error} /> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={buttonClass.secondary} onClick={() => setDeleting(null)} disabled={del.isPending}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className={buttonClass.danger}
                disabled={del.isPending}
                onClick={async () => {
                  try {
                    await del.mutateAsync({ id: deleting.id });
                    flash.show(t("deleted", { label: deleting.label }));
                    setDeleting(null);
                  } catch {
                    /* affichée dans la boîte de dialogue */
                  }
                }}
              >
                {t("confirmDelete")}
              </button>
            </div>
          </div>
        </ModalDialog>
      ) : null}
    </SettingsSection>
  );
}

function HolidayDialog({ year, initial, onClose, onDone }: { year: AcademicYearDto; initial: AcademicHolidayDto | null; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2AcademicSettings.calendar");
  const tKind = useTranslations("v2Rollover.holidayKind");
  const create = useCreateHoliday();
  const update = useUpdateHoliday();
  const [form, setForm] = useState({
    label: initial?.label ?? "",
    kind: initial?.kind ?? "HOLIDAY",
    startsOn: initial?.startsOn ?? "",
    // Un seul jour : la fin reste vide (l'API la prend égale au début).
    endsOn: initial && initial.endsOn !== initial.startsOn ? initial.endsOn : "",
    recursYearly: initial?.recursYearly ?? false,
    blocksTeaching: initial?.blocksTeaching ?? true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const pending = create.isPending || update.isPending;
  const apiError = create.error ?? update.error;

  async function submit() {
    try {
      if (initial === null) {
        const body = {
          institutionId: year.institutionId,
          label: form.label.trim(),
          kind: form.kind,
          startsOn: form.startsOn,
          ...(form.endsOn !== "" ? { endsOn: form.endsOn } : {}),
          recursYearly: form.recursYearly,
          blocksTeaching: form.blocksTeaching,
        };
        const v = validateWith(academicCreateHolidayBodySchema, body);
        if (!v.ok) return setErrors(v.errors);
        setErrors({});
        await create.mutateAsync(v.data);
      } else {
        const patch: Record<string, unknown> = {};
        if (form.label.trim() !== initial.label) patch.label = form.label.trim();
        if (form.kind !== initial.kind) patch.kind = form.kind;
        if (form.startsOn !== initial.startsOn) patch.startsOn = form.startsOn;
        const endsOn = form.endsOn !== "" ? form.endsOn : form.startsOn;
        if (endsOn !== initial.endsOn) patch.endsOn = endsOn;
        if (form.recursYearly !== initial.recursYearly) patch.recursYearly = form.recursYearly;
        if (form.blocksTeaching !== initial.blocksTeaching) patch.blocksTeaching = form.blocksTeaching;
        if (Object.keys(patch).length === 0) return onClose();
        const v = validateWith(academicUpdateHolidayBodySchema, patch);
        if (!v.ok) return setErrors(v.errors);
        setErrors({});
        await update.mutateAsync({ id: initial.id, patch: v.data });
      }
      onDone(form.label.trim());
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial ? t("editTitle", { label: initial.label }) : t("addTitle", { year: year.label })}
      description={t("dialogHint")}
      submitLabel={t("save")}
      onSubmit={() => void submit()}
      isPending={pending}
      error={apiError}
    >
      <FormField label={t("fields.label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} maxLength={200} onChange={set("label")} />}
      </FormField>
      <FormField label={t("fields.kind")} required error={errors.kind}>
        {(c) => <NativeSelect {...c} value={form.kind} onChange={(v) => set("kind")(v as typeof form.kind)} options={ACADEMIC_HOLIDAY_KINDS.map((k) => ({ value: k, label: tKind(k) }))} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.startsOn")} required error={errors.startsOn}>
          {(c) => <TextControl {...c} type="date" value={form.startsOn} onChange={set("startsOn")} />}
        </FormField>
        <FormField label={t("fields.endsOn")} hint={t("fields.endsOnHint")} error={errors.endsOn}>
          {(c) => <TextControl {...c} type="date" value={form.endsOn} min={form.startsOn || undefined} onChange={set("endsOn")} />}
        </FormField>
      </div>
      <CheckControl label={t("fields.recursYearly")} hint={t("fields.recursYearlyHint")} checked={form.recursYearly} onChange={set("recursYearly")} />
      <CheckControl label={t("fields.blocksTeaching")} hint={t("fields.blocksTeachingHint")} checked={form.blocksTeaching} onChange={set("blocksTeaching")} />
    </FormDialog>
  );
}
