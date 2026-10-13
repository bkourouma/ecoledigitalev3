"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ACADEMIC_ENROLLMENT_STATUSES,
  ACADEMIC_FUNDING_CODES,
  ACADEMIC_OUTCOME_KINDS,
  academicPutFundingTypesBodySchema,
  academicPutOutcomesBodySchema,
  type AcademicEnrollmentOutcomeDto,
  type AcademicFundingTypeDto,
} from "@ecoledigitale/contracts/v2/academic";
import { PEOPLE_STUDENT_STATUSES } from "@ecoledigitale/contracts/v2/people";
import { useReference } from "@/platform/v2/academic";
import { usePutReference } from "@/platform/v2/settings";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ActiveBadge, CardList, ItemCard, SettingsSection, stripItemPath } from "./shared";

/** Onglet « Statuts et financements » : types de financement, issues de fin d'année, puis (lecture seule) les états gérés par le serveur. */
export function FundingTab({ canManage }: { canManage: boolean }) {
  return (
    <div className="space-y-10">
      <FundingTypesSection canManage={canManage} />
      <OutcomesSection canManage={canManage} />
      <ReadOnlyStatuses />
    </div>
  );
}

function FundingTypesSection({ canManage }: { canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.funding.types");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const types = useReference("funding-types");
  const put = usePutReference("funding-types");
  const flash = useFlash();
  const [editing, setEditing] = useState<AcademicFundingTypeDto | "new" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const list = useMemo(() => [...(types.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)), [types.data]);
  const unused = ACADEMIC_FUNDING_CODES.filter((c) => !(types.data ?? []).some((x) => x.code === c));

  async function toggle(x: AcademicFundingTypeDto) {
    setActionError(null);
    try {
      await put.mutateAsync([{ code: x.code, label: x.label, requiresReference: x.requiresReference, requiresFunder: x.requiresFunder, sortOrder: x.sortOrder, active: !x.active }]);
      flash.show(t(x.active ? "deactivated" : "activated", { label: x.label }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <SettingsSection
      id="funding-types"
      title={t("title")}
      description={t("description")}
      actions={
        canManage ? (
          <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")} disabled={unused.length === 0 && types.data !== undefined}>
            {t("add")}
          </button>
        ) : null
      }
    >
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {types.isPending && types.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {types.isError ? <ErrorBlock error={types.error} onRetry={() => void types.refetch()} /> : null}
      {types.data && list.length === 0 ? <EmptyBlock title={t("empty")} /> : null}
      {list.length > 0 ? (
        <CardList label={t("title")}>
          {list.map((x) => (
            <ItemCard
              key={x.id}
              title={x.label}
              code={x.code}
              inactive={!x.active}
              badges={
                <>
                  {x.requiresReference ? <StatusBadge label={t("requiresReference")} tone="info" /> : null}
                  {x.requiresFunder ? <StatusBadge label={t("requiresFunder")} tone="info" /> : null}
                  <ActiveBadge active={x.active} on={tCommon("active")} off={tCommon("inactive")} />
                </>
              }
              actions={
                canManage ? (
                  <>
                    <button type="button" className={buttonClass.ghost} onClick={() => setEditing(x)} aria-label={`${tCommon("edit")} — ${x.label}`}>
                      {tCommon("edit")}
                    </button>
                    <button type="button" className={buttonClass.ghost} disabled={put.isPending} onClick={() => void toggle(x)} aria-label={`${x.active ? tCommon("deactivate") : tCommon("activate")} — ${x.label}`}>
                      {x.active ? tCommon("deactivate") : tCommon("activate")}
                    </button>
                  </>
                ) : null
              }
            />
          ))}
        </CardList>
      ) : null}
      {editing ? <FundingTypeDialog initial={editing === "new" ? null : editing} unusedCodes={unused} onClose={() => setEditing(null)} onDone={(label) => flash.show(t("saved", { label }))} /> : null}
    </SettingsSection>
  );
}

function FundingTypeDialog({ initial, unusedCodes, onClose, onDone }: { initial: AcademicFundingTypeDto | null; unusedCodes: ReadonlyArray<string>; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2AcademicSettings.funding.types");
  const tCode = useTranslations("v2Enrollments.funding");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const put = usePutReference("funding-types");
  const [form, setForm] = useState({
    code: initial?.code ?? unusedCodes[0] ?? "",
    label: initial?.label ?? "",
    requiresReference: initial?.requiresReference ?? false,
    requiresFunder: initial?.requiresFunder ?? false,
    sortOrder: String(initial?.sortOrder ?? 0),
    active: initial?.active ?? true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const codes = initial ? [initial.code] : unusedCodes;

  async function submit() {
    const item = {
      code: form.code,
      label: form.label.trim(),
      requiresReference: form.requiresReference,
      requiresFunder: form.requiresFunder,
      sortOrder: form.sortOrder.trim() === "" ? Number.NaN : Number(form.sortOrder),
      active: form.active,
    };
    const v = validateWith(academicPutFundingTypesBodySchema, { items: [item] });
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
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={initial ? t("editTitle", { label: initial.label }) : t("addTitle")} submitLabel={tCommon("save")} onSubmit={() => void submit()} isPending={put.isPending} error={put.error}>
      <FormField label={t("fields.code")} hint={t("fields.codeHint")} required error={errors.code}>
        {(c) => <NativeSelect {...c} value={form.code} disabled={initial !== null} onChange={set("code")} options={codes.map((x) => ({ value: x, label: `${tCode(x as (typeof ACADEMIC_FUNDING_CODES)[number])} (${x})` }))} />}
      </FormField>
      <FormField label={t("fields.label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
      </FormField>
      <FormField label={t("fields.sortOrder")} hint={t("fields.sortOrderHint")} required error={errors.sortOrder}>
        {(c) => <TextControl {...c} type="number" inputMode="numeric" value={form.sortOrder} onChange={set("sortOrder")} />}
      </FormField>
      <CheckControl label={t("fields.requiresReference")} hint={t("fields.requiresReferenceHint")} checked={form.requiresReference} onChange={set("requiresReference")} />
      <CheckControl label={t("fields.requiresFunder")} hint={t("fields.requiresFunderHint")} checked={form.requiresFunder} onChange={set("requiresFunder")} />
      <CheckControl label={tCommon("activeLabel")} checked={form.active} onChange={set("active")} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Issues de fin d'année
// ---------------------------------------------------------------------------

function OutcomesSection({ canManage }: { canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.funding.outcomes");
  const tKind = useTranslations("v2AcademicSettings.funding.outcomeKind");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const outcomes = useReference("enrollment-outcomes");
  const put = usePutReference("enrollment-outcomes");
  const flash = useFlash();
  const [editing, setEditing] = useState<AcademicEnrollmentOutcomeDto | "new" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  async function toggle(x: AcademicEnrollmentOutcomeDto) {
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
      id="enrollment-outcomes"
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
      {outcomes.isPending && outcomes.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {outcomes.isError ? <ErrorBlock error={outcomes.error} onRetry={() => void outcomes.refetch()} /> : null}
      {outcomes.data && outcomes.data.length === 0 ? <EmptyBlock title={t("empty")} /> : null}
      {outcomes.data && outcomes.data.length > 0 ? (
        <CardList label={t("title")}>
          {outcomes.data.map((x) => (
            <ItemCard
              key={x.id}
              title={x.label}
              code={x.code}
              inactive={!x.active}
              badges={
                <>
                  <StatusBadge label={tKind(x.kind)} tone={x.kind === "ADVANCE" ? "success" : x.kind === "EXIT" ? "danger" : "info"} />
                  <ActiveBadge active={x.active} on={tCommon("active")} off={tCommon("inactive")} />
                </>
              }
              actions={
                canManage ? (
                  <>
                    <button type="button" className={buttonClass.ghost} onClick={() => setEditing(x)} aria-label={`${tCommon("edit")} — ${x.label}`}>
                      {tCommon("edit")}
                    </button>
                    <button type="button" className={buttonClass.ghost} disabled={put.isPending} onClick={() => void toggle(x)} aria-label={`${x.active ? tCommon("deactivate") : tCommon("activate")} — ${x.label}`}>
                      {x.active ? tCommon("deactivate") : tCommon("activate")}
                    </button>
                  </>
                ) : null
              }
            />
          ))}
        </CardList>
      ) : null}
      {editing ? <OutcomeDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={(label) => flash.show(t("saved", { label }))} /> : null}
    </SettingsSection>
  );
}

function OutcomeDialog({ initial, onClose, onDone }: { initial: AcademicEnrollmentOutcomeDto | null; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2AcademicSettings.funding.outcomes");
  const tKind = useTranslations("v2AcademicSettings.funding.outcomeKind");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const put = usePutReference("enrollment-outcomes");
  const [form, setForm] = useState({ code: initial?.code ?? "", label: initial?.label ?? "", kind: initial?.kind ?? "ADVANCE", active: initial?.active ?? true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const item = { code: form.code.trim(), label: form.label.trim(), kind: form.kind, active: form.active };
    const v = validateWith(academicPutOutcomesBodySchema, { items: [item] });
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
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={initial ? t("editTitle", { label: initial.label }) : t("addTitle")} submitLabel={tCommon("save")} onSubmit={() => void submit()} isPending={put.isPending} error={put.error}>
      <FormField label={t("fields.code")} hint={t("fields.codeHint")} required error={errors.code}>
        {(c) => <TextControl {...c} value={form.code} onChange={(v) => set("code")(v.toUpperCase())} maxLength={40} disabled={initial !== null} />}
      </FormField>
      <FormField label={t("fields.label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
      </FormField>
      <FormField label={t("fields.kind")} hint={t("fields.kindHint")} required error={errors.kind}>
        {(c) => <NativeSelect {...c} value={form.kind} onChange={(v) => set("kind")(v as typeof form.kind)} options={ACADEMIC_OUTCOME_KINDS.map((k) => ({ value: k, label: `${tKind(k)} — ${t(`kindHelp.${k}`)}` }))} />}
      </FormField>
      <CheckControl label={tCommon("activeLabel")} checked={form.active} onChange={set("active")} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// États gérés par le serveur (lecture seule)
// ---------------------------------------------------------------------------

function ReadOnlyStatuses() {
  const t = useTranslations("v2AcademicSettings.funding.statuses");
  const tEnr = useTranslations("v2Enrollments.status");
  const tStu = useTranslations("v2Students.status");
  return (
    <SettingsSection id="read-only-statuses" title={t("title")} description={t("description")}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-card/40 p-3">
          <h3 className="mb-2 text-base font-medium">{t("enrollment")}</h3>
          <ul className="flex flex-wrap gap-2" aria-label={t("enrollment")}>
            {ACADEMIC_ENROLLMENT_STATUSES.map((s) => (
              <li key={s}>
                <StatusBadge label={tEnr(s)} />
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-card/40 p-3">
          <h3 className="mb-2 text-base font-medium">{t("learner")}</h3>
          <ul className="flex flex-wrap gap-2" aria-label={t("learner")}>
            {PEOPLE_STUDENT_STATUSES.map((s) => (
              <li key={s}>
                <StatusBadge label={tStu(s)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SettingsSection>
  );
}
