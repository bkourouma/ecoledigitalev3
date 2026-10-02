"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ACADEMIC_PACKS,
  academicPutEducationLevelsBodySchema,
  academicPutGradeLevelsBodySchema,
  type AcademicEducationLevelDto,
  type AcademicGradeLevelDto,
} from "@ecoledigitale/contracts/v2/academic";
import { useReference } from "@/platform/v2/academic";
import { usePutReference } from "@/platform/v2/settings";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ActiveBadge, CardList, ItemCard, SettingsSection, stripItemPath } from "./shared";

/** Onglet « Niveaux » : cycles d'enseignement puis niveaux (libellés, ordre, niveau suivant, niveau final, examen terminal). */
export function LevelsTab({ canManage }: { canManage: boolean }) {
  return (
    <div className="space-y-10">
      <EducationLevelsSection canManage={canManage} />
      <GradeLevelsSection canManage={canManage} />
    </div>
  );
}

const byOrdinal = <T extends { ordinal: number; label: string }>(a: T, b: T) => a.ordinal - b.ordinal || a.label.localeCompare(b.label);

function EducationLevelsSection({ canManage }: { canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.levels.cycles");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const tPack = useTranslations("v2AcademicSettings.pack");
  const levels = useReference("education-levels");
  const put = usePutReference("education-levels");
  const flash = useFlash();
  const [editing, setEditing] = useState<AcademicEducationLevelDto | "new" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const list = useMemo(() => [...(levels.data ?? [])].sort(byOrdinal), [levels.data]);

  async function toggle(x: AcademicEducationLevelDto) {
    setActionError(null);
    try {
      await put.mutateAsync([{ code: x.code, label: x.label, ordinal: x.ordinal, pack: x.pack, calculationContract: x.calculationContract, active: !x.active }]);
      flash.show(t(x.active ? "deactivated" : "activated", { label: x.label }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <SettingsSection
      id="education-levels"
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
      {levels.isPending && levels.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {levels.isError ? <ErrorBlock error={levels.error} onRetry={() => void levels.refetch()} /> : null}
      {levels.data && list.length === 0 ? <EmptyBlock title={t("empty")} /> : null}
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
                  {x.pack ? <StatusBadge label={tPack(x.pack)} tone="info" /> : null}
                  <ActiveBadge active={x.active} on={tCommon("active")} off={tCommon("inactive")} />
                </>
              }
              meta={
                <>
                  <span>{t("order", { ordinal: x.ordinal })}</span>
                  {x.calculationContract ? <span className="block">{t("contract", { contract: x.calculationContract })}</span> : null}
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
      {editing ? <EducationLevelDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={(label) => flash.show(t("saved", { label }))} /> : null}
    </SettingsSection>
  );
}

function EducationLevelDialog({ initial, onClose, onDone }: { initial: AcademicEducationLevelDto | null; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2AcademicSettings.levels.cycles");
  const tPack = useTranslations("v2AcademicSettings.pack");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const put = usePutReference("education-levels");
  const [form, setForm] = useState({
    code: initial?.code ?? "",
    label: initial?.label ?? "",
    ordinal: String(initial?.ordinal ?? 0),
    pack: initial?.pack ?? "",
    calculationContract: initial?.calculationContract ?? "",
    active: initial?.active ?? true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const item = {
      code: form.code.trim(),
      label: form.label.trim(),
      ordinal: form.ordinal.trim() === "" ? Number.NaN : Number(form.ordinal),
      pack: form.pack === "" ? null : form.pack,
      calculationContract: form.calculationContract.trim() === "" ? null : form.calculationContract.trim(),
      active: form.active,
    };
    const v = validateWith(academicPutEducationLevelsBodySchema, { items: [item] });
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
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.ordinal")} hint={t("fields.ordinalHint")} required error={errors.ordinal}>
          {(c) => <TextControl {...c} type="number" min={0} inputMode="numeric" value={form.ordinal} onChange={set("ordinal")} />}
        </FormField>
        <FormField label={t("fields.pack")} error={errors.pack}>
          {(c) => <NativeSelect {...c} value={form.pack} onChange={(v) => set("pack")(v as typeof form.pack)} placeholder={t("fields.noPack")} options={ACADEMIC_PACKS.map((p) => ({ value: p, label: tPack(p) }))} />}
        </FormField>
      </div>
      <FormField label={t("fields.contract")} hint={t("fields.contractHint")} error={errors.calculationContract}>
        {(c) => <TextControl {...c} value={form.calculationContract} onChange={set("calculationContract")} placeholder="credit-semester@1" maxLength={60} />}
      </FormField>
      <CheckControl label={tCommon("activeLabel")} checked={form.active} onChange={set("active")} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Niveaux
// ---------------------------------------------------------------------------

function GradeLevelsSection({ canManage }: { canManage: boolean }) {
  const t = useTranslations("v2AcademicSettings.levels.grades");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const cycles = useReference("education-levels");
  const grades = useReference("grade-levels");
  const put = usePutReference("grade-levels");
  const flash = useFlash();
  const [editing, setEditing] = useState<AcademicGradeLevelDto | "new" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const cycleById = useMemo(() => new Map((cycles.data ?? []).map((c) => [c.id, c])), [cycles.data]);
  const gradeById = useMemo(() => new Map((grades.data ?? []).map((g) => [g.id, g])), [grades.data]);
  const groups = useMemo(() => {
    const out = new Map<string, AcademicGradeLevelDto[]>();
    for (const g of [...(grades.data ?? [])].sort(byOrdinal)) out.set(g.educationLevelId, [...(out.get(g.educationLevelId) ?? []), g]);
    return [...out.entries()].sort(([a], [b]) => (cycleById.get(a)?.ordinal ?? 0) - (cycleById.get(b)?.ordinal ?? 0));
  }, [grades.data, cycleById]);

  function toItem(g: AcademicGradeLevelDto, patch: Partial<{ active: boolean }> = {}) {
    return {
      code: g.code,
      label: g.label,
      shortLabel: g.shortLabel,
      educationLevelCode: cycleById.get(g.educationLevelId)?.code ?? "",
      ordinal: g.ordinal,
      nextGradeLevelCode: g.nextGradeLevelId ? (gradeById.get(g.nextGradeLevelId)?.code ?? null) : null,
      isFinal: g.isFinal,
      terminalExamRequired: g.terminalExamRequired,
      active: patch.active ?? g.active,
    };
  }

  async function toggle(g: AcademicGradeLevelDto) {
    setActionError(null);
    try {
      await put.mutateAsync([toItem(g, { active: !g.active })]);
      flash.show(t(g.active ? "deactivated" : "activated", { label: g.label }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <SettingsSection
      id="grade-levels"
      title={t("title")}
      description={t("description")}
      actions={
        canManage ? (
          <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")} disabled={(cycles.data ?? []).length === 0}>
            {t("add")}
          </button>
        ) : null
      }
    >
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {grades.isPending && grades.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {grades.isError ? <ErrorBlock error={grades.error} onRetry={() => void grades.refetch()} /> : null}
      {grades.data && grades.data.length === 0 ? <EmptyBlock title={t("empty")} /> : null}
      {groups.map(([cycleId, list]) => (
        <div key={cycleId} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{cycleById.get(cycleId)?.label ?? t("unknownCycle")}</h3>
          <CardList label={cycleById.get(cycleId)?.label ?? t("title")}>
            {list.map((g) => (
              <ItemCard
                key={g.id}
                title={g.label}
                code={g.code}
                inactive={!g.active}
                badges={
                  <>
                    {g.isFinal ? <StatusBadge label={t("final")} tone="warning" /> : null}
                    {g.terminalExamRequired ? <StatusBadge label={t("terminalExam")} tone="info" /> : null}
                    <ActiveBadge active={g.active} on={tCommon("active")} off={tCommon("inactive")} />
                  </>
                }
                meta={
                  <>
                    <span>{t("order", { ordinal: g.ordinal })}</span>
                    <span className="block">{g.nextGradeLevelId ? t("next", { label: gradeById.get(g.nextGradeLevelId)?.label ?? "—" }) : t("noNext")}</span>
                  </>
                }
                actions={
                  canManage ? (
                    <>
                      <button type="button" className={buttonClass.ghost} onClick={() => setEditing(g)} aria-label={`${tCommon("edit")} — ${g.label}`}>
                        {tCommon("edit")}
                      </button>
                      <button type="button" className={buttonClass.ghost} disabled={put.isPending} onClick={() => void toggle(g)} aria-label={`${g.active ? tCommon("deactivate") : tCommon("activate")} — ${g.label}`}>
                        {g.active ? tCommon("deactivate") : tCommon("activate")}
                      </button>
                    </>
                  ) : null
                }
              />
            ))}
          </CardList>
        </div>
      ))}
      {editing ? (
        <GradeLevelDialog
          initial={editing === "new" ? null : editing}
          cycles={cycles.data ?? []}
          grades={grades.data ?? []}
          toItem={toItem}
          onClose={() => setEditing(null)}
          onDone={(label) => flash.show(t("saved", { label }))}
        />
      ) : null}
    </SettingsSection>
  );
}

function GradeLevelDialog({
  initial,
  cycles,
  grades,
  toItem,
  onClose,
  onDone,
}: {
  initial: AcademicGradeLevelDto | null;
  cycles: ReadonlyArray<AcademicEducationLevelDto>;
  grades: ReadonlyArray<AcademicGradeLevelDto>;
  toItem: (g: AcademicGradeLevelDto) => { educationLevelCode: string; nextGradeLevelCode: string | null };
  onClose: () => void;
  onDone: (label: string) => void;
}) {
  const t = useTranslations("v2AcademicSettings.levels.grades");
  const tCommon = useTranslations("v2AcademicSettings.common");
  const put = usePutReference("grade-levels");
  const current = initial ? toItem(initial) : null;
  const [form, setForm] = useState({
    code: initial?.code ?? "",
    label: initial?.label ?? "",
    shortLabel: initial?.shortLabel ?? "",
    educationLevelCode: current?.educationLevelCode ?? cycles[0]?.code ?? "",
    ordinal: String(initial?.ordinal ?? 0),
    nextGradeLevelCode: current?.nextGradeLevelCode ?? "",
    isFinal: initial?.isFinal ?? false,
    terminalExamRequired: initial?.terminalExamRequired ?? false,
    active: initial?.active ?? true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const cycleId = cycles.find((c) => c.code === form.educationLevelCode)?.id;
  // Niveau suivant : un autre niveau (la cohérence du chaînage — pas de boucle — est vérifiée par l'API).
  const nextOptions = grades.filter((g) => g.code !== form.code && (g.educationLevelId === cycleId || g.code === form.nextGradeLevelCode)).map((g) => ({ value: g.code, label: `${g.label} (${g.code})` }));

  async function submit() {
    const item = {
      code: form.code.trim(),
      label: form.label.trim(),
      shortLabel: form.shortLabel.trim() === "" ? null : form.shortLabel.trim(),
      educationLevelCode: form.educationLevelCode,
      ordinal: form.ordinal.trim() === "" ? Number.NaN : Number(form.ordinal),
      nextGradeLevelCode: form.isFinal || form.nextGradeLevelCode === "" ? null : form.nextGradeLevelCode,
      isFinal: form.isFinal,
      terminalExamRequired: form.terminalExamRequired,
      active: form.active,
    };
    const v = validateWith(academicPutGradeLevelsBodySchema, { items: [item] });
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
    <FormDialog wide open onOpenChange={(o) => !o && onClose()} title={initial ? t("editTitle", { label: initial.label }) : t("addTitle")} submitLabel={tCommon("save")} onSubmit={() => void submit()} isPending={put.isPending} error={put.error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.code")} hint={t("fields.codeHint")} required error={errors.code}>
          {(c) => <TextControl {...c} value={form.code} onChange={(v) => set("code")(v.toUpperCase())} maxLength={40} disabled={initial !== null} />}
        </FormField>
        <FormField label={t("fields.cycle")} required error={errors.educationLevelCode}>
          {(c) => <NativeSelect {...c} value={form.educationLevelCode} onChange={set("educationLevelCode")} options={cycles.map((x) => ({ value: x.code, label: x.label }))} />}
        </FormField>
        <FormField label={t("fields.label")} required error={errors.label}>
          {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
        </FormField>
        <FormField label={t("fields.shortLabel")} error={errors.shortLabel}>
          {(c) => <TextControl {...c} value={form.shortLabel} onChange={set("shortLabel")} maxLength={40} />}
        </FormField>
        <FormField label={t("fields.ordinal")} hint={t("fields.ordinalHint")} required error={errors.ordinal}>
          {(c) => <TextControl {...c} type="number" min={0} inputMode="numeric" value={form.ordinal} onChange={set("ordinal")} />}
        </FormField>
        <FormField label={t("fields.next")} hint={t("fields.nextHint")} error={errors.nextGradeLevelCode}>
          {(c) => <NativeSelect {...c} value={form.isFinal ? "" : form.nextGradeLevelCode} disabled={form.isFinal} onChange={set("nextGradeLevelCode")} placeholder={t("noNext")} options={nextOptions} />}
        </FormField>
      </div>
      <CheckControl label={t("fields.isFinal")} hint={t("fields.isFinalHint")} checked={form.isFinal} onChange={set("isFinal")} />
      <CheckControl label={t("fields.terminalExam")} hint={t("fields.terminalExamHint")} checked={form.terminalExamRequired} onChange={set("terminalExamRequired")} />
      <CheckControl label={tCommon("activeLabel")} checked={form.active} onChange={set("active")} />
    </FormDialog>
  );
}
