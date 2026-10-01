"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { academicCreateProgramBodySchema, type AcademicProgramDto } from "@ecoledigitale/contracts/v2/academic";
import { useCreateProgram, usePrograms, useReference, useSetProgramGradeLevels, useUpdateProgram } from "@/platform/v2/academic";
import { usePermission } from "@/platform/access";
import { Can } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { TreeEditor } from "@/platform/ui/TreeEditor";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { InstitutionField, toneOf, useDefaultInstitutionId } from "./shared";
import { buildForest, type Forest } from "./tree-utils";

type ProgramNode = Forest<AcademicProgramDto>;
const getId = (n: ProgramNode) => n.item.id;
const getChildren = (n: ProgramNode) => n.children;

export function ProgramsScreen() {
  const t = useTranslations("v2Academic.programs");
  const programs = usePrograms();
  const levels = useReference("education-levels");
  const flash = useFlash();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; program: AcademicProgramDto } | null>(null);

  const forest = useMemo(() => buildForest(programs.data ?? [], (p) => p.id, (p) => p.parentProgramId, (a, b) => a.code.localeCompare(b.code)), [programs.data]);
  const levelLabel = useMemo(() => new Map((levels.data ?? []).map((l) => [l.id, l.label])), [levels.data]);
  const selected = (programs.data ?? []).find((p) => p.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="academic.program.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setDialog({ mode: "create" })}>
              {t("create")}
            </button>
          </Can>
        }
      />
      {flash.node}
      {programs.isPending && programs.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {programs.isError ? <ErrorBlock error={programs.error} onRetry={() => void programs.refetch()} /> : null}
      {programs.data && programs.data.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      {programs.data && programs.data.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section aria-labelledby="programs-tree-title" className="rounded-lg border p-3">
            <h2 id="programs-tree-title" className="mb-2 text-sm font-semibold">
              {t("treeTitle")}
            </h2>
            <TreeEditor
              roots={forest}
              getId={getId}
              getChildren={getChildren}
              selectedId={selectedId}
              onSelect={setSelectedId}
              ariaLabel={t("treeLabel")}
              renderLabel={(n) => (
                <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                  <span className="truncate font-medium">{n.item.label}</span>
                  <span className="text-xs text-muted-foreground">{n.item.code}</span>
                  {n.item.status === "ARCHIVED" ? <StatusBadge label={t("archived")} tone="neutral" /> : null}
                </span>
              )}
            />
          </section>
          <section aria-live="polite">
            {selected ? (
              <ProgramDetail program={selected} levelLabel={levelLabel.get(selected.educationLevelId) ?? ""} onEdit={() => setDialog({ mode: "edit", program: selected })} onFlash={flash.show} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("selectOne")}</p>
            )}
          </section>
        </div>
      ) : null}
      {dialog?.mode === "create" ? <ProgramDialog onClose={() => setDialog(null)} onDone={(label) => flash.show(t("created", { label }))} programs={programs.data ?? []} /> : null}
      {dialog?.mode === "edit" ? <ProgramDialog program={dialog.program} onClose={() => setDialog(null)} onDone={() => flash.show(t("updated"))} programs={programs.data ?? []} /> : null}
    </div>
  );
}

function ProgramDetail({ program, levelLabel, onEdit, onFlash }: { program: AcademicProgramDto; levelLabel: string; onEdit: () => void; onFlash: (message: string) => void }) {
  const t = useTranslations("v2Academic.programs");
  const tStatus = useTranslations("v2Academic.status.program");
  const grades = useReference("grade-levels");
  const setGrades = useSetProgramGradeLevels();
  const update = useUpdateProgram();
  const manage = usePermission("academic.program.manage").allowed;
  const [draft, setDraft] = useState<string[] | null>(null);
  const covered = draft ?? program.gradeLevelIds;
  const candidates = useMemo(() => [...(grades.data ?? [])].filter((g) => g.educationLevelId === program.educationLevelId && g.active).sort((a, b) => a.ordinal - b.ordinal), [grades.data, program.educationLevelId]);
  const dirty = draft !== null;

  function toggle(id: string, on: boolean) {
    const current = new Set(covered);
    if (on) current.add(id);
    else current.delete(id);
    setDraft([...current]);
  }

  async function saveGrades() {
    if (!draft) return;
    try {
      await setGrades.mutateAsync({ id: program.id, gradeLevelIds: draft });
      setDraft(null);
      onFlash(t("gradesSaved"));
    } catch {
      /* affichée ci-dessous */
    }
  }

  async function toggleArchive() {
    try {
      await update.mutateAsync({ id: program.id, patch: { status: program.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" } });
      onFlash(program.status === "ACTIVE" ? t("archivedDone") : t("restoredDone"));
    } catch {
      /* affichée ci-dessous */
    }
  }

  return (
    <article className="space-y-4 rounded-lg border p-4" aria-labelledby="program-title">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="program-title" className="text-lg font-semibold">
            {program.label}
          </h2>
          <p className="text-sm text-muted-foreground">
            {program.code} · {levelLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={tStatus(program.status)} tone={toneOf(program.status)} />
          <Can permission="academic.program.manage">
            <button type="button" className={buttonClass.secondary} onClick={onEdit}>
              {t("edit")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => void toggleArchive()} disabled={update.isPending}>
              {program.status === "ACTIVE" ? t("archive") : t("restore")}
            </button>
          </Can>
        </div>
      </header>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("fields.kindCode")}</dt>
          <dd>{program.kindCode}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("fields.domainCode")}</dt>
          <dd>{program.domainCode ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("fields.durationMonths")}</dt>
          <dd>{program.durationMonths === null ? "—" : t("months", { count: program.durationMonths })}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{t("fields.description")}</dt>
          <dd>{program.description ?? "—"}</dd>
        </div>
      </dl>
      {update.error ? <ErrorBlock error={update.error} /> : null}

      <fieldset className="space-y-1 border-t pt-3" disabled={setGrades.isPending}>
        <legend className="text-sm font-semibold">{t("gradeLevels")}</legend>
        <p className="text-xs text-muted-foreground">{t("gradeLevelsHint")}</p>
        {candidates.length === 0 ? <p className="text-sm text-muted-foreground">{t("noGradeLevels")}</p> : null}
        <div className="grid gap-x-4 sm:grid-cols-2">
          {candidates.map((g) => (
            <CheckControl key={g.id} checked={covered.includes(g.id)} onChange={(on) => toggle(g.id, on)} label={g.label} hint={g.shortLabel ?? undefined} disabled={!manage} />
          ))}
        </div>
        {setGrades.error ? <ErrorBlock error={setGrades.error} /> : null}
        <Can permission="academic.program.manage">
          <div className="pt-2">
            <button type="button" className={buttonClass.primary} disabled={!dirty || setGrades.isPending || (draft ?? []).length === 0} onClick={() => void saveGrades()}>
              {t("saveGradeLevels")}
            </button>
          </div>
        </Can>
      </fieldset>
    </article>
  );
}

function ProgramDialog({ program, programs, onClose, onDone }: { program?: AcademicProgramDto; programs: ReadonlyArray<AcademicProgramDto>; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2Academic.programs");
  const levels = useReference("education-levels");
  const create = useCreateProgram();
  const update = useUpdateProgram();
  const [institution, setInstitution] = useState("");
  const { institutionId } = useDefaultInstitutionId(institution);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState({
    code: program?.code ?? "",
    label: program?.label ?? "",
    educationLevelId: program?.educationLevelId ?? "",
    parentProgramId: program?.parentProgramId ?? "",
    kindCode: program?.kindCode ?? "",
    domainCode: program?.domainCode ?? "",
    durationMonths: program?.durationMonths ? String(program.durationMonths) : "",
    description: program?.description ?? "",
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const pending = create.isPending || update.isPending;

  async function submit() {
    setErrors({});
    try {
      if (program) {
        const patch = {
          label: form.label,
          kindCode: form.kindCode || undefined,
          domainCode: form.domainCode || null,
          description: form.description || null,
          durationMonths: form.durationMonths ? Number(form.durationMonths) : null,
        };
        await update.mutateAsync({ id: program.id, patch: JSON.parse(JSON.stringify(patch)) as Record<string, unknown> });
        onDone(form.label);
        return onClose();
      }
      const body = {
        institutionId,
        ...compact({ code: form.code, label: form.label, educationLevelId: form.educationLevelId, parentProgramId: form.parentProgramId, kindCode: form.kindCode, domainCode: form.domainCode, description: form.description }),
        ...(form.durationMonths ? { durationMonths: Number(form.durationMonths) } : {}),
      };
      const v = validateWith(academicCreateProgramBodySchema, body);
      if (!v.ok) return setErrors(v.errors);
      await create.mutateAsync(v.data);
      onDone(form.label);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={program ? t("editTitle", { label: program.label }) : t("createTitle")} submitLabel={program ? t("save") : t("create")} onSubmit={() => void submit()} isPending={pending} error={create.error ?? update.error} wide>
      {!program ? <InstitutionField value={institution} onChange={setInstitution} error={errors.institutionId} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.code")} hint={t("fields.codeHint")} required error={errors.code}>
          {(c) => <TextControl {...c} value={form.code} onChange={(v) => set("code")(v.toUpperCase())} disabled={!!program} maxLength={40} />}
        </FormField>
        <FormField label={t("fields.label")} required error={errors.label}>
          {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.educationLevel")} required error={errors.educationLevelId}>
          {(c) => <NativeSelect {...c} value={form.educationLevelId} onChange={set("educationLevelId")} disabled={!!program} placeholder={t("choose")} options={(levels.data ?? []).filter((l) => l.active).map((l) => ({ value: l.id, label: l.label }))} />}
        </FormField>
        <FormField label={t("fields.parent")} hint={t("fields.parentHint")} error={errors.parentProgramId}>
          {(c) => (
            <NativeSelect
              {...c}
              value={form.parentProgramId}
              onChange={set("parentProgramId")}
              disabled={!!program}
              placeholder={t("noParent")}
              options={programs.filter((p) => p.id !== program?.id).map((p) => ({ value: p.id, label: `${p.label} (${p.code})` }))}
            />
          )}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t("fields.kindCode")} error={errors.kindCode}>
          {(c) => <TextControl {...c} value={form.kindCode} onChange={(v) => set("kindCode")(v.toUpperCase())} maxLength={40} />}
        </FormField>
        <FormField label={t("fields.domainCode")} error={errors.domainCode}>
          {(c) => <TextControl {...c} value={form.domainCode} onChange={(v) => set("domainCode")(v.toUpperCase())} maxLength={40} />}
        </FormField>
        <FormField label={t("fields.durationMonths")} error={errors.durationMonths}>
          {(c) => <TextControl {...c} type="number" min={1} max={240} inputMode="numeric" value={form.durationMonths} onChange={set("durationMonths")} />}
        </FormField>
      </div>
      <FormField label={t("fields.description")} error={errors.description}>
        {(c) => <TextAreaControl {...c} value={form.description} onChange={set("description")} maxLength={1000} />}
      </FormField>
      {Object.keys(errors).length > 0 && !errors.code && !errors.label ? <Notice kind="warning">{t("checkFields")}</Notice> : null}
    </FormDialog>
  );
}
