"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ADMISSION_CLOSURE_KINDS,
  ADMISSION_STATUSES,
  admissionsCreateWorkflowBodySchema,
  admissionsReplaceStagesBodySchema,
  admissionsReplaceTransitionsBodySchema,
  type AdmissionsStageDto,
  type AdmissionsWorkflowViewDto,
} from "@ecoledigitale/contracts/v2/admissions";
import { useCreateWorkflow, useDeleteWorkflow, useNewWorkflowVersion, usePublishWorkflow, useReplaceStages, useReplaceTransitions, useWorkflow, useWorkflows } from "@/platform/v2/admissions";
import { usePermission } from "@/platform/access";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { parseInteger } from "./admissions-utils";

const TONE = { DRAFT: "warning", PUBLISHED: "success", ARCHIVED: "neutral" } as const;

/**
 * Workflow d'admission de l'établissement : étapes (rattachées aux huit statuts canoniques), transitions et permissions.
 * Un brouillon est modifiable ; la PUBLICATION est validée par la base (une étape initiale, étapes atteignables, un statut
 * final...) puis le workflow est GELÉ : toute évolution passe par une nouvelle version, sans toucher aux dossiers en cours.
 */
export function WorkflowScreen() {
  const t = useTranslations("v2Admissions.workflow");
  const ts = useTranslations("v2Admissions.workflowStatus");
  const list = useWorkflows();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const items = list.data?.items ?? [];
  const current = selectedId ?? items.find((w) => w.status === "DRAFT")?.id ?? items.find((w) => w.status === "PUBLISHED")?.id ?? items[0]?.id ?? null;

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
            {t("new")}
          </button>
        }
      />
      <QueryBoundary query={list} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <nav aria-label={t("listLabel")}>
            <ul className="space-y-2">
              {items.map((w) => (
                <li key={w.id}>
                  <button type="button" aria-current={w.id === current ? "true" : undefined} onClick={() => setSelectedId(w.id)} className={`w-full rounded-xl border p-3 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${w.id === current ? "border-primary bg-accent" : ""}`}>
                    <span className="block font-medium">{w.label}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>v{w.version}</span>
                      <StatusBadge label={ts(w.status)} tone={TONE[w.status]} />
                      <span>{t("stageCount", { count: w.stageCount })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div>{current ? <WorkflowDetail id={current} onSelect={setSelectedId} /> : null}</div>
        </div>
      </QueryBoundary>
      {creating ? <CreateDialog items={items} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id); }} /> : null}
    </div>
  );
}

function CreateDialog({ items, onClose, onCreated }: { items: ReadonlyArray<{ id: string; label: string; version: number }>; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations("v2Admissions.workflow");
  const create = useCreateWorkflow();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState("TEMPLATE");
  const [source, setSource] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(create.error), ...errors };

  function submit() {
    const checked = validateWith(admissionsCreateWorkflowBodySchema, { code: code.trim().toUpperCase(), label, from, ...(from === "COPY" ? { fromWorkflowId: source } : {}) });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(checked.data, { onSuccess: (w) => onCreated(w.id) });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("newTitle")} submitLabel={t("create")} onSubmit={submit} isPending={create.isPending} error={Object.keys(apiErrorToFieldErrors(create.error)).length === 0 ? create.error : undefined}>
      <FormField label={t("code")} required error={shown["code"]}>
        {(c) => <TextControl {...c} value={code} onChange={setCode} maxLength={40} />}
      </FormField>
      <FormField label={t("label")} required error={shown["label"]}>
        {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={160} />}
      </FormField>
      <FormField label={t("from")} error={shown["from"]}>
        {(c) => <NativeSelect {...c} value={from} onChange={setFrom} options={[{ value: "TEMPLATE", label: t("fromTemplate") }, { value: "COPY", label: t("fromCopy") }, { value: "EMPTY", label: t("fromEmpty") }]} />}
      </FormField>
      {from === "COPY" ? (
        <FormField label={t("source")} required error={shown["fromWorkflowId"]}>
          {(c) => <NativeSelect {...c} value={source} onChange={setSource} placeholder={t("choose")} options={items.map((w) => ({ value: w.id, label: `${w.label} (v${w.version})` }))} />}
        </FormField>
      ) : null}
    </FormDialog>
  );
}

function WorkflowDetail({ id, onSelect }: { id: string; onSelect: (id: string | null) => void }) {
  const query = useWorkflow(id);
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  return <Detail key={`${query.data.id}-${query.dataUpdatedAt}`} workflow={query.data} onSelect={onSelect} />;
}

function Detail({ workflow, onSelect }: { workflow: AdmissionsWorkflowViewDto; onSelect: (id: string | null) => void }) {
  const t = useTranslations("v2Admissions.workflow");
  const ts = useTranslations("v2Admissions.workflowStatus");
  const describe = useDescribeError();
  const canPublish = usePermission("admission.workflow.publish").allowed;
  const publish = usePublishWorkflow(workflow.id);
  const newVersion = useNewWorkflowVersion();
  const remove = useDeleteWorkflow();
  const flash = useFlash();
  const [deleting, setDeleting] = useState(false);
  const draft = workflow.status === "DRAFT";

  return (
    <div className="space-y-4">
      <section aria-labelledby="wf-title" className="rounded-2xl border border-white/10 bg-card/40 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="wf-title" className="text-base font-semibold">
              {workflow.label} <span className="text-xs font-normal text-muted-foreground">({workflow.code} · v{workflow.version})</span>
            </h2>
            <p className="mt-1">
              <StatusBadge label={ts(workflow.status)} tone={TONE[workflow.status]} />
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {draft && canPublish ? (
              <button type="button" className={buttonClass.primary} disabled={publish.isPending} onClick={() => publish.mutate(undefined, { onSuccess: () => flash.show(t("published")) })}>
                {t("publish")}
              </button>
            ) : null}
            {draft ? (
              <button type="button" className={buttonClass.secondary} onClick={() => setDeleting(true)}>
                {t("delete")}
              </button>
            ) : null}
            {workflow.status === "PUBLISHED" ? (
              <button type="button" className={buttonClass.secondary} disabled={newVersion.isPending} onClick={() => newVersion.mutate(workflow.id, { onSuccess: (w) => onSelect(w.id) })}>
                {t("newVersion")}
              </button>
            ) : null}
          </div>
        </div>
        {flash.node}
        {publish.error ? <Notice kind="error" className="mt-3">{describe(publish.error)}</Notice> : null}
        {newVersion.error ? <Notice kind="error" className="mt-3">{describe(newVersion.error)}</Notice> : null}
        {workflow.status === "PUBLISHED" ? <p className="mt-3 text-sm text-muted-foreground">{t("frozen")}</p> : null}
        {draft && workflow.defects.length > 0 ? (
          <div className="mt-3">
            <Notice kind="warning">
              <p className="font-medium">{t("defects")}</p>
              <ul className="mt-1 list-disc pl-5">
                {workflow.defects.map((d) => (
                  <li key={d.code + (d.stages ?? []).join(",")}>
                    {d.message}
                    {d.stages && d.stages.length > 0 ? ` (${d.stages.join(", ")})` : ""}
                  </li>
                ))}
              </ul>
            </Notice>
          </div>
        ) : null}
      </section>
      {draft ? <StagesEditor workflow={workflow} /> : <StagesTable stages={workflow.stages} />}
      {draft ? <TransitionsEditor workflow={workflow} /> : <TransitionsTable workflow={workflow} />}
      {deleting ? (
        <ReasonDialog
          open
          onOpenChange={(o) => (!o ? setDeleting(false) : undefined)}
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          reasonLabel={t("deleteReason")}
          confirmLabel={t("delete")}
          destructive
          reasonRequired={false}
          isPending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(workflow.id, { onSuccess: () => { setDeleting(false); onSelect(null); } })}
        />
      ) : null}
    </div>
  );
}

function StagesTable({ stages }: { stages: ReadonlyArray<AdmissionsStageDto> }) {
  const t = useTranslations("v2Admissions.workflow");
  const ts = useTranslations("v2Admissions.status");
  return (
    <section aria-labelledby="wf-stages" className="rounded-2xl border border-white/10 bg-card/40 p-4">
      <h2 id="wf-stages" className="mb-3 text-base font-semibold">
        {t("stages")}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("stages")}</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-medium">{t("columns.order")}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t("columns.stage")}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t("columns.status")}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t("columns.rules")}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t("columns.sla")}</th>
            </tr>
          </thead>
          <tbody>
            {[...stages].sort((a, b) => a.ordinal - b.ordinal).map((s) => (
              <tr key={s.id} className="border-t align-top">
                <td className="py-1 pr-3">{s.ordinal}</td>
                <th scope="row" className="py-1 pr-3 text-left font-medium">{s.label} <span className="text-xs font-normal text-muted-foreground">({s.code})</span></th>
                <td className="py-1 pr-3">{ts(s.canonicalStatus)}</td>
                <td className="py-1 pr-3 text-xs">
                  {(["isInitial", "isTerminal", "holdsSeat", "requiresConsent", "requiresDocumentsComplete", "requiresInterviewDone", "requiresDecision", "createsEnrollment"] as const).filter((k) => s[k]).map((k) => t(`flags.${k}`)).join(", ") || "—"}
                </td>
                <td className="py-1 pr-3">{s.slaHours ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TransitionsTable({ workflow }: { workflow: AdmissionsWorkflowViewDto }) {
  const t = useTranslations("v2Admissions.workflow");
  const label = new Map(workflow.stages.map((s) => [s.id, s.label]));
  return (
    <section aria-labelledby="wf-transitions" className="rounded-2xl border border-white/10 bg-card/40 p-4">
      <h2 id="wf-transitions" className="mb-3 text-base font-semibold">
        {t("transitions")}
      </h2>
      <ul className="divide-y text-sm">
        {workflow.transitions.map((x) => (
          <li key={x.id} className="py-2">
            {label.get(x.fromStageId)} → {label.get(x.toStageId)} <span className="text-xs text-muted-foreground">({x.permissionKey}{x.requiresReason ? ` · ${t("needsReason")}` : ""}{x.isAutomatic ? ` · ${t("automatic")}` : ""})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type StageRow = { code: string; label: string; canonicalStatus: string; isInitial: boolean; isTerminal: boolean; holdsSeat: boolean; requiresConsent: boolean; requiresDocumentsComplete: boolean; requiresInterviewDone: boolean; requiresDecision: boolean; createsEnrollment: boolean; closureKind: string; slaHours: string; notifyTemplateCode: string };

const FLAGS = ["isInitial", "isTerminal", "holdsSeat", "requiresConsent", "requiresDocumentsComplete", "requiresInterviewDone", "requiresDecision", "createsEnrollment"] as const;

function StagesEditor({ workflow }: { workflow: AdmissionsWorkflowViewDto }) {
  const t = useTranslations("v2Admissions.workflow");
  const ts = useTranslations("v2Admissions.status");
  const tclosure = useTranslations("v2Admissions.closureKind");
  const save = useReplaceStages(workflow.id);
  const describe = useDescribeError();
  const flash = useFlash();
  const [rows, setRows] = useState<StageRow[]>(
    [...workflow.stages].sort((a, b) => a.ordinal - b.ordinal).map((s) => ({ ...s, closureKind: s.closureKind ?? "", slaHours: s.slaHours === null ? "" : String(s.slaHours), notifyTemplateCode: s.notifyTemplateCode ?? "" })),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(save.error), ...errors };

  const patch = (i: number, p: Partial<StageRow>) => setRows((list) => list.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const stages = rows.map((r, i) => ({
      code: r.code.trim().toUpperCase(),
      label: r.label,
      canonicalStatus: r.canonicalStatus,
      ordinal: i + 1,
      isInitial: r.isInitial,
      isTerminal: r.isTerminal,
      holdsSeat: r.holdsSeat,
      requiresConsent: r.requiresConsent,
      requiresDocumentsComplete: r.requiresDocumentsComplete,
      requiresInterviewDone: r.requiresInterviewDone,
      requiresDecision: r.requiresDecision,
      createsEnrollment: r.createsEnrollment,
      closureKind: r.closureKind || null,
      slaHours: r.slaHours.trim() === "" ? null : (parseInteger(r.slaHours, 1, 8760) ?? 0),
      notifyTemplateCode: r.notifyTemplateCode.trim() === "" ? null : r.notifyTemplateCode.trim().toUpperCase(),
    }));
    const checked = validateWith(admissionsReplaceStagesBodySchema, { stages });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(checked.data, { onSuccess: () => flash.show(t("stagesSaved")) });
  }

  return (
    <form noValidate onSubmit={submit} aria-label={t("stages")} className="space-y-4 rounded-2xl border border-white/10 bg-card/40 p-4">
      <h2 className="text-base font-semibold">{t("stages")}</h2>
      {flash.node}
      <ol className="space-y-3">
        {rows.map((r, i) => (
          <li key={i}>
            <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <legend className="px-1 text-sm font-medium">{t("stageN", { n: i + 1, label: r.label || r.code })}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t("code")} required error={shown[`stages.${i}.code`]}>
                  {(c) => <TextControl {...c} value={r.code} onChange={(v) => patch(i, { code: v })} maxLength={40} />}
                </FormField>
                <FormField label={t("label")} required error={shown[`stages.${i}.label`]}>
                  {(c) => <TextControl {...c} value={r.label} onChange={(v) => patch(i, { label: v })} maxLength={120} />}
                </FormField>
                <FormField label={t("canonicalStatus")} hint={t("canonicalStatusHint")} error={shown[`stages.${i}.canonicalStatus`]}>
                  {(c) => <NativeSelect {...c} value={r.canonicalStatus} onChange={(v) => patch(i, { canonicalStatus: v })} options={ADMISSION_STATUSES.map((s) => ({ value: s, label: ts(s) }))} />}
                </FormField>
                <FormField label={t("closureKind")} error={shown[`stages.${i}.closureKind`]}>
                  {(c) => <NativeSelect {...c} value={r.closureKind} onChange={(v) => patch(i, { closureKind: v })} placeholder={t("noClosure")} options={ADMISSION_CLOSURE_KINDS.map((k) => ({ value: k, label: tclosure(k) }))} />}
                </FormField>
                <FormField label={t("slaHours")} hint={t("slaHint")} error={shown[`stages.${i}.slaHours`]}>
                  {(c) => <TextControl {...c} inputMode="numeric" value={r.slaHours} onChange={(v) => patch(i, { slaHours: v })} />}
                </FormField>
                <FormField label={t("notifyTemplate")} error={shown[`stages.${i}.notifyTemplateCode`]}>
                  {(c) => <TextControl {...c} value={r.notifyTemplateCode} onChange={(v) => patch(i, { notifyTemplateCode: v })} maxLength={60} />}
                </FormField>
              </div>
              <div className="grid gap-x-4 sm:grid-cols-2">
                {FLAGS.map((f) => (
                  <CheckControl key={f} checked={r[f]} onChange={(v) => patch(i, { [f]: v } as Partial<StageRow>)} label={t(`flags.${f}`)} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass.ghost} disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("moveUp", { label: r.label || r.code })}>
                  {t("up")}
                </button>
                <button type="button" className={buttonClass.ghost} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t("moveDown", { label: r.label || r.code })}>
                  {t("down")}
                </button>
                <button type="button" className={buttonClass.ghost} onClick={() => setRows((list) => list.filter((_, k) => k !== i))} aria-label={t("removeStage", { label: r.label || r.code })}>
                  {t("remove")}
                </button>
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {shown["stages"] ? <Notice kind="error">{shown["stages"]}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass.secondary} onClick={() => setRows((list) => [...list, { code: "", label: "", canonicalStatus: "UNDER_REVIEW", isInitial: false, isTerminal: false, holdsSeat: false, requiresConsent: false, requiresDocumentsComplete: false, requiresInterviewDone: false, requiresDecision: false, createsEnrollment: false, closureKind: "", slaHours: "", notifyTemplateCode: "" }])}>
          {t("addStage")}
        </button>
        <button type="submit" className={buttonClass.primary} disabled={save.isPending}>
          {t("saveStages")}
        </button>
      </div>
      {save.error && Object.keys(apiErrorToFieldErrors(save.error)).length === 0 ? <Notice kind="error">{describe(save.error)}</Notice> : null}
    </form>
  );
}

type TransitionRow = { fromStage: string; toStage: string; permissionKey: string; requiresReason: boolean; isAutomatic: boolean };

function TransitionsEditor({ workflow }: { workflow: AdmissionsWorkflowViewDto }) {
  const t = useTranslations("v2Admissions.workflow");
  const save = useReplaceTransitions(workflow.id);
  const describe = useDescribeError();
  const flash = useFlash();
  const codeOf = new Map(workflow.stages.map((s) => [s.id, s.code]));
  const stageOptions = workflow.stages.map((s) => ({ value: s.code, label: s.label }));
  const [rows, setRows] = useState<TransitionRow[]>(workflow.transitions.map((x) => ({ fromStage: codeOf.get(x.fromStageId) ?? "", toStage: codeOf.get(x.toStageId) ?? "", permissionKey: x.permissionKey, requiresReason: x.requiresReason, isAutomatic: x.isAutomatic })));
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(save.error), ...errors };
  const patch = (i: number, p: Partial<TransitionRow>) => setRows((list) => list.map((r, k) => (k === i ? { ...r, ...p } : r)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const checked = validateWith(admissionsReplaceTransitionsBodySchema, { transitions: rows.map((r) => ({ ...r, permissionKey: r.permissionKey.trim() })) });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(checked.data, { onSuccess: () => flash.show(t("transitionsSaved")) });
  }

  return (
    <form noValidate onSubmit={submit} aria-label={t("transitions")} className="space-y-4 rounded-2xl border border-white/10 bg-card/40 p-4">
      <h2 className="text-base font-semibold">{t("transitions")}</h2>
      <p className="text-sm text-muted-foreground">{t("transitionsHint")}</p>
      {flash.node}
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label={t("from")} error={shown[`transitions.${i}.fromStage`]}>
                {(c) => <NativeSelect {...c} value={r.fromStage} onChange={(v) => patch(i, { fromStage: v })} placeholder={t("choose")} options={stageOptions} />}
              </FormField>
              <FormField label={t("to")} error={shown[`transitions.${i}.toStage`]}>
                {(c) => <NativeSelect {...c} value={r.toStage} onChange={(v) => patch(i, { toStage: v })} placeholder={t("choose")} options={stageOptions} />}
              </FormField>
              <FormField label={t("permission")} hint={t("permissionHint")} error={shown[`transitions.${i}.permissionKey`]}>
                {(c) => <TextControl {...c} value={r.permissionKey} onChange={(v) => patch(i, { permissionKey: v })} maxLength={80} />}
              </FormField>
            </div>
            <div className="flex flex-wrap items-center gap-x-4">
              <CheckControl checked={r.requiresReason} onChange={(v) => patch(i, { requiresReason: v })} label={t("needsReason")} />
              <CheckControl checked={r.isAutomatic} onChange={(v) => patch(i, { isAutomatic: v })} label={t("automatic")} />
              <button type="button" className={buttonClass.ghost} onClick={() => setRows((list) => list.filter((_, k) => k !== i))} aria-label={t("removeTransition", { n: i + 1 })}>
                {t("remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass.secondary} onClick={() => setRows((list) => [...list, { fromStage: "", toStage: "", permissionKey: "admission.update", requiresReason: false, isAutomatic: false }])}>
          {t("addTransition")}
        </button>
        <button type="submit" className={buttonClass.primary} disabled={save.isPending}>
          {t("saveTransitions")}
        </button>
      </div>
      {save.error && Object.keys(apiErrorToFieldErrors(save.error)).length === 0 ? <Notice kind="error">{describe(save.error)}</Notice> : null}
    </form>
  );
}
