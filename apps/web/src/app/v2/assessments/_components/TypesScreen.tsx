"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { assessTypeCreateBodySchema, ASSESS_PUBLICATION_MODES, type AssessTypeDto } from "@ecoledigitale/contracts/v2/assess";
import { usePermission } from "@/platform/access";
import { useAssessSettings, useAssessmentTypes, useCreateAssessmentType, useUpdateAssessmentType, useUpdateAssessSettings } from "@/platform/v2/assess";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";

export function TypesScreen() {
  const t = useTranslations("v2Assess.types");
  const tMode = useTranslations("v2Assess.publicationMode");
  const types = useAssessmentTypes({ includeInactive: true });
  const [editing, setEditing] = useState<AssessTypeDto | "new" | null>(null);
  const flash = useFlash();
  const update = useUpdateAssessmentType();
  const [actionError, setActionError] = useState<unknown>(null);
  const manage = usePermission("assessment.type.manage");

  const columns: DataTableColumn<AssessTypeDto>[] = [
    { id: "label", header: t("columns.label"), rowHeader: true, cell: (x) => <span className="font-medium">{x.label}</span> },
    { id: "code", header: t("columns.code"), cell: (x) => x.code, className: "hidden sm:table-cell" },
    { id: "group", header: t("columns.group"), cell: (x) => x.aggregationGroup, className: "hidden md:table-cell" },
    { id: "scale", header: t("columns.scale"), cell: (x) => `/${x.defaultScaleMax.replace(".", ",")}`, align: "right" },
    { id: "weight", header: t("columns.weight"), cell: (x) => x.defaultWeight.replace(".", ","), align: "right", className: "hidden sm:table-cell" },
    { id: "mode", header: t("columns.mode"), cell: (x) => tMode(x.publicationMode), className: "hidden md:table-cell" },
    {
      id: "state",
      header: t("columns.state"),
      cell: (x) => (
        <span className="flex flex-wrap gap-1">
          <StatusBadge label={x.active ? t("active") : t("inactive")} tone={x.active ? "success" : "neutral"} />
          {x.isSystem ? <StatusBadge label={t("system")} tone="info" /> : null}
          {x.visibleToStudents ? null : <StatusBadge label={t("hidden")} tone="warning" />}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (x) =>
        manage.allowed ? (
          <span className="flex flex-wrap justify-end gap-1">
            <button type="button" className={buttonClass.ghost} onClick={() => setEditing(x)} aria-label={`${t("edit")} — ${x.label}`}>
              {t("edit")}
            </button>
            <button
              type="button"
              className={buttonClass.ghost}
              disabled={update.isPending}
              aria-label={`${x.active ? t("deactivate") : t("activate")} — ${x.label}`}
              onClick={async () => {
                setActionError(null);
                try {
                  await update.mutateAsync({ id: x.id, patch: { active: !x.active } });
                  flash.show(t(x.active ? "deactivated" : "activated", { label: x.label }));
                } catch (e) {
                  setActionError(e);
                }
              }}
            >
              {x.active ? t("deactivate") : t("activate")}
            </button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="assessment.type.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")}>
              {t("create")}
            </button>
          </Can>
        }
      />
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={types.data ?? []}
        getRowId={(x) => x.id}
        isLoading={types.isPending && types.fetchStatus !== "idle"}
        error={types.error}
        onRetry={() => void types.refetch()}
        emptyTitle={t("empty")}
      />
      <SettingsCard />
      {editing ? <TypeDialog type={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={(label) => flash.show(t("saved", { label }))} /> : null}
    </div>
  );
}

function TypeDialog({ type, onClose, onDone }: { type: AssessTypeDto | null; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2Assess.types");
  const tMode = useTranslations("v2Assess.publicationMode");
  const create = useCreateAssessmentType();
  const update = useUpdateAssessmentType();
  const [form, setForm] = useState({
    code: type?.code ?? "",
    label: type?.label ?? "",
    aggregationGroup: type?.aggregationGroup ?? "",
    defaultScaleMax: type?.defaultScaleMax ?? "20",
    defaultWeight: type?.defaultWeight ?? "1",
    publicationMode: type?.publicationMode ?? "MANUAL",
    visibleToStudents: type?.visibleToStudents ?? true,
    allowsSession2: type?.allowsSession2 ?? false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = type ? update : create;
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    try {
      if (type) {
        const { code: _code, ...patch } = form;
        void _code;
        const saved = await update.mutateAsync({ id: type.id, patch: compact(patch) });
        onDone(saved.label);
      } else {
        const v = validateWith(assessTypeCreateBodySchema, compact(form));
        if (!v.ok) return setErrors(v.errors);
        setErrors({});
        const saved = await create.mutateAsync(v.data);
        onDone(saved.label);
      }
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={type ? t("editTitle", { label: type.label }) : t("createTitle")} description={t("dialogDescription")} submitLabel={type ? t("save") : t("submitCreate")} onSubmit={() => void submit()} isPending={mutation.isPending} error={Object.keys(errors).length === 0 ? mutation.error : null}>
      <FormField label={t("fields.code")} required error={errors.code} hint={t("fields.codeHint")}>
        {(c) => <TextControl {...c} value={form.code} onChange={set("code")} disabled={type !== null} maxLength={32} />}
      </FormField>
      <FormField label={t("fields.label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={80} />}
      </FormField>
      <FormField label={t("fields.group")} required error={errors.aggregationGroup} hint={t("fields.groupHint")}>
        {(c) => <TextControl {...c} value={form.aggregationGroup} onChange={set("aggregationGroup")} maxLength={32} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.scale")} error={errors.defaultScaleMax}>
          {(c) => <TextControl {...c} value={form.defaultScaleMax} onChange={set("defaultScaleMax")} inputMode="decimal" />}
        </FormField>
        <FormField label={t("fields.weight")} error={errors.defaultWeight}>
          {(c) => <TextControl {...c} value={form.defaultWeight} onChange={set("defaultWeight")} inputMode="decimal" />}
        </FormField>
      </div>
      <FormField label={t("fields.mode")} error={errors.publicationMode}>
        {(c) => <NativeSelect {...c} value={form.publicationMode} onChange={(v) => set("publicationMode")(v as "MANUAL" | "AUTO_ON_APPROVAL")} options={ASSESS_PUBLICATION_MODES.map((m) => ({ value: m, label: tMode(m) }))} />}
      </FormField>
      <CheckControl checked={form.visibleToStudents} onChange={set("visibleToStudents")} label={t("fields.visible")} hint={t("fields.visibleHint")} />
      <CheckControl checked={form.allowsSession2} onChange={set("allowsSession2")} label={t("fields.session2")} />
    </FormDialog>
  );
}

function SettingsCard() {
  const t = useTranslations("v2Assess.settings");
  const settings = useAssessSettings();
  const update = useUpdateAssessSettings();
  const manage = usePermission("assessment.type.manage");
  const flash = useFlash();
  if (settings.isError) return null;
  const s = settings.data;
  if (!s) return null;
  async function patch(body: { requireSeparateReviewer?: boolean; requireSeparateApprover?: boolean; maxScoreDecimals?: number }) {
    try {
      await update.mutateAsync(body);
      flash.show(t("saved"));
    } catch {
      /* affichée ci-dessous */
    }
  }
  return (
    <section aria-labelledby="settings-h" className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 id="settings-h" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {flash.node}
      {update.error ? <ErrorBlock error={update.error} /> : null}
      <CheckControl checked={s.requireSeparateReviewer} disabled={!manage.allowed || update.isPending} onChange={(v) => void patch({ requireSeparateReviewer: v })} label={t("separateReviewer")} hint={t("separateReviewerHint")} />
      <CheckControl checked={s.requireSeparateApprover} disabled={!manage.allowed || update.isPending} onChange={(v) => void patch({ requireSeparateApprover: v })} label={t("separateApprover")} hint={t("separateApproverHint")} />
      <FormField label={t("decimals")} hint={t("decimalsHint")} className="max-w-xs">
        {(c) => <NativeSelect {...c} value={String(s.maxScoreDecimals)} disabled={!manage.allowed || update.isPending} onChange={(v) => void patch({ maxScoreDecimals: Number(v) })} options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))} />}
      </FormField>
      {!manage.allowed ? <Notice kind="info">{t("readOnly")}</Notice> : null}
    </section>
  );
}
