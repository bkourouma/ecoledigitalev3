"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ACADEMIC_PERIOD_KINDS,
  academicPutPeriodPlansBodySchema,
  academicPutPeriodTypesBodySchema,
  type AcademicPeriodPlanDto,
  type AcademicPeriodTypeDto,
} from "@ecoledigitale/contracts/v2/academic";
import { useReference } from "@/platform/v2/academic";
import { usePutReference } from "@/platform/v2/settings";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ActiveBadge, CardList, ItemCard, SettingsSection, stripItemPath } from "./shared";

/** Onglet « Périodes » : types de périodes puis plans de périodes (upsert par code, activation / désactivation, jamais de suppression). */
export function PeriodsTab({ canManage }: { canManage: boolean }) {
  return (
    <div className="space-y-10">
      <PeriodTypesSection canManage={canManage} />
      <PeriodPlansSection canManage={canManage} />
    </div>
  );
}

function PeriodTypesSection({ canManage }: { canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.periods.types");
  const tActive = useTranslations("v2AcademicSettings.common");
  const tKind = useTranslations("v2AcademicSettings.periods.kind");
  const types = useReference("period-types");
  const put = usePutReference("period-types");
  const flash = useFlash();
  const [editing, setEditing] = useState<AcademicPeriodTypeDto | "new" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  async function toggle(x: AcademicPeriodTypeDto) {
    setActionError(null);
    try {
      await put.mutateAsync([{ code: x.code, label: x.label, kind: x.kind, active: !x.active }]);
      flash.show(t(x.active ? "deactivated" : "activated", { label: x.label }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <SettingsSection
      id="period-types"
      title={t("title")}
      description={t("description")}
      actions={
        canManage ? (
          <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")}>
            {t("add")}
          </button>
        ) : null
      }
    >
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {types.isPending && types.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {types.isError ? <ErrorBlock error={types.error} onRetry={() => void types.refetch()} /> : null}
      {types.data && types.data.length === 0 ? <EmptyBlock title={t("empty")} /> : null}
      {types.data && types.data.length > 0 ? (
        <CardList label={t("title")}>
          {types.data.map((x) => (
            <ItemCard
              key={x.id}
              title={x.label}
              code={x.code}
              inactive={!x.active}
              badges={<ActiveBadge active={x.active} on={tActive("active")} off={tActive("inactive")} />}
              meta={tKind(x.kind)}
              actions={
                canManage ? (
                  <>
                    <button type="button" className={buttonClass.ghost} onClick={() => setEditing(x)} aria-label={`${tActive("edit")} — ${x.label}`}>
                      {tActive("edit")}
                    </button>
                    <button type="button" className={buttonClass.ghost} disabled={put.isPending} onClick={() => void toggle(x)} aria-label={`${x.active ? tActive("deactivate") : tActive("activate")} — ${x.label}`}>
                      {x.active ? tActive("deactivate") : tActive("activate")}
                    </button>
                  </>
                ) : null
              }
            />
          ))}
        </CardList>
      ) : null}
      {editing ? <PeriodTypeDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={(label) => flash.show(t("saved", { label }))} /> : null}
    </SettingsSection>
  );
}

function PeriodTypeDialog({ initial, onClose, onDone }: { initial: AcademicPeriodTypeDto | null; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2AcademicSettings.periods.types");
  const tKind = useTranslations("v2AcademicSettings.periods.kind");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const put = usePutReference("period-types");
  const [form, setForm] = useState({ code: initial?.code ?? "", label: initial?.label ?? "", kind: initial?.kind ?? "TEACHING_PERIOD", active: initial?.active ?? true });
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const item = { code: form.code.trim(), label: form.label.trim(), kind: form.kind, active: form.active };
    const v = validateWith(academicPutPeriodTypesBodySchema, { items: [item] });
    if (!v.ok) return setErrors(stripItemPath(v.errors));
    setErrors({});
    try {
      await put.mutateAsync(v.data.items);
      onDone(item.label);
      onClose();
    } catch (e) {
      setErrors(stripItemPath(apiErrorToFieldErrors(e)));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={initial ? t("editTitle", { label: initial.label }) : t("addTitle")} description={t("dialogHint")} submitLabel={tCommon("save")} onSubmit={() => void submit()} isPending={put.isPending} error={put.error}>
      <FormField label={t("fields.code")} hint={t("fields.codeHint")} required error={errors.code}>
        {(c) => <TextControl {...c} value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} maxLength={40} disabled={initial !== null} />}
      </FormField>
      <FormField label={t("fields.label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} maxLength={200} />}
      </FormField>
      <FormField label={t("fields.kind")} required error={errors.kind}>
        {(c) => <NativeSelect {...c} value={form.kind} onChange={(v) => setForm((f) => ({ ...f, kind: v as typeof f.kind }))} options={ACADEMIC_PERIOD_KINDS.map((k) => ({ value: k, label: tKind(k) }))} />}
      </FormField>
      <CheckControl label={tCommon("activeLabel")} checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Plans de périodes
// ---------------------------------------------------------------------------

function PeriodPlansSection({ canManage }: { canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.periods.plans");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const plans = useReference("period-plans");
  const put = usePutReference("period-plans");
  const flash = useFlash();
  const [editing, setEditing] = useState<AcademicPeriodPlanDto | "new" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  async function toggle(p: AcademicPeriodPlanDto) {
    setActionError(null);
    try {
      await put.mutateAsync([{ code: p.code, label: p.label, slots: p.slots, active: !p.active }]);
      flash.show(t(p.active ? "deactivated" : "activated", { label: p.label }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <SettingsSection
      id="period-plans"
      title={t("title")}
      description={t("description")}
      actions={
        canManage ? (
          <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")}>
            {t("add")}
          </button>
        ) : null
      }
    >
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {plans.isPending && plans.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {plans.isError ? <ErrorBlock error={plans.error} onRetry={() => void plans.refetch()} /> : null}
      {plans.data && plans.data.length === 0 ? <EmptyBlock title={t("empty")} /> : null}
      {plans.data && plans.data.length > 0 ? (
        <CardList label={t("title")}>
          {plans.data.map((p) => (
            <ItemCard
              key={p.id}
              title={p.label}
              code={p.code}
              inactive={!p.active}
              badges={<ActiveBadge active={p.active} on={tCommon("active")} off={tCommon("inactive")} />}
              meta={
                <>
                  <span className="font-medium">{t("slotCount", { count: p.slots.length })}</span>
                  {" : "}
                  {p.slots.map((s) => s.label).join(" · ")}
                </>
              }
              actions={
                canManage ? (
                  <>
                    <button type="button" className={buttonClass.ghost} onClick={() => setEditing(p)} aria-label={`${tCommon("edit")} — ${p.label}`}>
                      {tCommon("edit")}
                    </button>
                    <button type="button" className={buttonClass.ghost} disabled={put.isPending} onClick={() => void toggle(p)} aria-label={`${p.active ? tCommon("deactivate") : tCommon("activate")} — ${p.label}`}>
                      {p.active ? tCommon("deactivate") : tCommon("activate")}
                    </button>
                  </>
                ) : null
              }
            />
          ))}
        </CardList>
      ) : null}
      {editing ? <PeriodPlanDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={(label) => flash.show(t("saved", { label }))} /> : null}
    </SettingsSection>
  );
}

interface SlotRow {
  type: string;
  ordinal: string;
  label: string;
  weight: string;
}

function PeriodPlanDialog({ initial, onClose, onDone }: { initial: AcademicPeriodPlanDto | null; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2AcademicSettings.periods.plans");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const types = useReference("period-types");
  const put = usePutReference("period-plans");
  const [form, setForm] = useState({ code: initial?.code ?? "", label: initial?.label ?? "", active: initial?.active ?? true });
  const [slots, setSlots] = useState<SlotRow[]>(
    initial ? initial.slots.map((s) => ({ type: s.type, ordinal: String(s.ordinal), label: s.label, weight: s.weight === undefined ? "" : String(s.weight) })) : [{ type: "", ordinal: "1", label: "", weight: "" }],
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const setSlot = (i: number, patch: Partial<SlotRow>) => setSlots((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const typeOptions = (types.data ?? []).filter((x) => x.active || slots.some((s) => s.type === x.code)).map((x) => ({ value: x.code, label: `${x.label} (${x.code})` }));

  async function submit() {
    const item = {
      code: form.code.trim(),
      label: form.label.trim(),
      slots: slots.map((s) => ({ type: s.type, ordinal: Number(s.ordinal), label: s.label.trim(), ...(s.weight.trim() !== "" ? { weight: Number(s.weight) } : {}) })),
      active: form.active,
    };
    const v = validateWith(academicPutPeriodPlansBodySchema, { items: [item] });
    if (!v.ok) return setErrors(stripItemPath(v.errors));
    setErrors({});
    try {
      await put.mutateAsync(v.data.items);
      onDone(item.label);
      onClose();
    } catch (e) {
      setErrors(stripItemPath(apiErrorToFieldErrors(e)));
    }
  }

  return (
    <FormDialog wide open onOpenChange={(o) => !o && onClose()} title={initial ? t("editTitle", { label: initial.label }) : t("addTitle")} description={t("dialogHint")} submitLabel={tCommon("save")} onSubmit={() => void submit()} isPending={put.isPending} error={put.error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.code")} hint={t("fields.codeHint")} required error={errors.code}>
          {(c) => <TextControl {...c} value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} maxLength={40} disabled={initial !== null} />}
        </FormField>
        <FormField label={t("fields.label")} required error={errors.label}>
          {(c) => <TextControl {...c} value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} maxLength={200} />}
        </FormField>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("slots.legend")}</legend>
        <p className="text-xs text-muted-foreground">{t("slots.hint")}</p>
        {errors.slots ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {errors.slots}
          </p>
        ) : null}
        <ul className="space-y-3">
          {slots.map((s, i) => (
            <li key={i} className="space-y-3 rounded-md border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t("slots.type")} required error={errors[`slots.${i}.type`]}>
                  {(c) => <NativeSelect {...c} value={s.type} placeholder={tCommon("choose")} onChange={(v) => setSlot(i, { type: v })} options={typeOptions} />}
                </FormField>
                <FormField label={t("slots.label")} required error={errors[`slots.${i}.label`]}>
                  {(c) => <TextControl {...c} value={s.label} onChange={(v) => setSlot(i, { label: v })} maxLength={200} />}
                </FormField>
                <FormField label={t("slots.ordinal")} required error={errors[`slots.${i}.ordinal`]}>
                  {(c) => <TextControl {...c} type="number" min={1} max={99} inputMode="numeric" value={s.ordinal} onChange={(v) => setSlot(i, { ordinal: v })} />}
                </FormField>
                <FormField label={t("slots.weight")} hint={t("slots.weightHint")} error={errors[`slots.${i}.weight`]}>
                  {(c) => <TextControl {...c} type="number" min={1} max={1000} inputMode="numeric" value={s.weight} onChange={(v) => setSlot(i, { weight: v })} />}
                </FormField>
              </div>
              {slots.length > 1 ? (
                <button type="button" className={buttonClass.ghost} onClick={() => setSlots((rows) => rows.filter((_, j) => j !== i))} aria-label={t("slots.remove", { n: i + 1 })}>
                  {t("slots.removeLabel")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <button type="button" className={buttonClass.secondary} onClick={() => setSlots((rows) => [...rows, { type: rows[rows.length - 1]?.type ?? "", ordinal: String(rows.length + 1), label: "", weight: "" }])}>
          {t("slots.add")}
        </button>
      </fieldset>
      <CheckControl label={tCommon("activeLabel")} checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} />
    </FormDialog>
  );
}
