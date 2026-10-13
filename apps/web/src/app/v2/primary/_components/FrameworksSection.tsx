"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { primaryCreateFrameworkBodySchema, primaryStructureBodySchema, type PrimaryFrameworkDetailDto } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, LoadingBlock, QueryBoundary, useFlash } from "@/platform/ui/states";
import { validateWith, type FieldErrors } from "@/platform/ui/validation";
import {
  useCreatePrimaryFramework,
  useDeletePrimaryFramework,
  useNewPrimaryFrameworkVersion,
  usePrimaryFramework,
  usePrimaryFrameworks,
  usePrimaryScales,
  usePublishPrimaryFramework,
  usePutPrimaryStructure,
} from "@/platform/v2/primary";
import { ConfirmActionDialog, PrimaryError, useCodeLabels } from "./shared";

interface CompetencyRow {
  code: string;
  label: string;
}
interface DomainRow {
  code: string;
  label: string;
  competencies: CompetencyRow[];
}

/**
 * Référentiels de compétences : brouillon -> structure -> publication. Un référentiel PUBLIÉ est IMMUABLE : on crée une « nouvelle
 * version » (copie en brouillon). Les manques de publication sont affichés tels que renvoyés par l'API.
 */
export function FrameworksSection() {
  const t = useTranslations("v2PrimarySettings.frameworks");
  const label = useCodeLabels();
  const list = usePrimaryFrameworks();
  const canManage = usePermission("primary.framework.manage").allowed;
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const flash = useFlash();
  return (
    <section aria-labelledby="primary-frameworks" className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="primary-frameworks" className="text-lg font-semibold">
          {t("title")}
        </h2>
        {canManage ? (
          <button type="button" className={buttonClass.secondary} onClick={() => setCreating(true)}>
            {t("create")}
          </button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {flash.node}
      <QueryBoundary query={list} isEmpty={(list.data ?? []).length === 0} empty={<EmptyBlock title={t("empty")} />}>
        <ul className="space-y-2">
          {(list.data ?? []).map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {f.label} <span className="text-xs text-muted-foreground">{t("version", { n: f.version })}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={label("frameworkStatus", f.status)} tone={f.status === "PUBLISHED" ? "success" : f.status === "DRAFT" ? "info" : "neutral"} />
                  {f.sourceKind === "placeholder" ? <StatusBadge label={t("placeholder")} tone="warning" /> : null}
                  <span className="text-xs text-muted-foreground">{t("competencyCount", { count: f.competencyCount })}</span>
                </div>
              </div>
              <button type="button" className={buttonClass.secondary} aria-expanded={selected === f.id} onClick={() => setSelected(selected === f.id ? null : f.id)} aria-label={t("openFor", { label: f.label, n: f.version })}>
                {selected === f.id ? t("close") : t("open")}
              </button>
              {selected === f.id ? (
                <div className="basis-full">
                  <FrameworkDetail id={f.id} onDone={(msg) => flash.show(msg)} onNewVersion={(id) => setSelected(id)} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {creating ? <CreateFrameworkDialog onClose={() => setCreating(false)} onCreated={(id) => { flash.show(t("created")); setSelected(id); }} /> : null}
    </section>
  );
}

function FrameworkDetail({ id, onDone, onNewVersion }: { id: string; onDone: (message: string) => void; onNewVersion: (id: string) => void }) {
  const t = useTranslations("v2PrimarySettings.frameworks");
  const fw = usePrimaryFramework(id);
  const canManage = usePermission("primary.framework.manage").allowed;
  const canPublish = usePermission("primary.framework.publish").allowed;
  const publish = usePublishPrimaryFramework();
  const newVersion = useNewPrimaryFrameworkVersion();
  const remove = useDeletePrimaryFramework();
  const [editing, setEditing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (fw.isPending) return <LoadingBlock />;
  if (fw.isError) return <PrimaryError error={fw.error} />;
  const d: PrimaryFrameworkDetailDto = fw.data;
  const draft = d.status === "DRAFT";
  return (
    <div className="space-y-3 border-t pt-3">
      {d.status === "PUBLISHED" ? <p className="text-sm font-medium">{t("immutable")}</p> : null}
      <ul className="space-y-2">
        {d.domains.map((dom) => (
          <li key={dom.id}>
            <p className="text-sm font-semibold">{`${dom.code} — ${dom.label}`}</p>
            <ul className="ml-4 list-disc text-sm">
              {dom.competencies.map((c) => (
                <li key={c.id}>{`${c.code} — ${c.label}`}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("scaleLine", { levels: d.scale.levels.map((l) => l.code).join(", ") })}</p>
      {d.publishBlockers.length > 0 ? (
        <div role="note" className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
          <p className="font-medium">{t("blockers")}</p>
          <ul className="mt-1 list-disc pl-5">
            {d.publishBlockers.map((b, i) => (
              <li key={`${b.code}-${i}`}>{b.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {draft && canManage ? (
          <button type="button" className={buttonClass.secondary} onClick={() => setEditing(true)}>
            {t("editStructure")}
          </button>
        ) : null}
        {draft && canPublish ? (
          <button type="button" className={buttonClass.primary} onClick={() => setConfirmPublish(true)}>
            {t("publish")}
          </button>
        ) : null}
        {draft && canManage ? (
          <button type="button" className={buttonClass.ghost} onClick={() => setConfirmDelete(true)}>
            {t("delete")}
          </button>
        ) : null}
        {d.status === "PUBLISHED" && canPublish ? (
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={newVersion.isPending}
            onClick={() => newVersion.mutate({ id }, { onSuccess: (nv) => { onDone(t("newVersionDone", { n: nv.version })); onNewVersion(nv.id); } })}
          >
            {t("newVersion")}
          </button>
        ) : null}
      </div>
      <PrimaryError error={newVersion.error} />
      {editing ? <StructureDialog detail={d} onClose={() => setEditing(false)} onSaved={() => onDone(t("structureSaved"))} /> : null}
      <ConfirmActionDialog
        open={confirmPublish}
        onOpenChange={(o) => {
          setConfirmPublish(o);
          if (!o) publish.reset();
        }}
        title={t("publishDialog.title")}
        description={t("publishDialog.description")}
        confirmLabel={t("publishDialog.confirm")}
        ackLabel={t("publishDialog.ack")}
        isPending={publish.isPending}
        error={publish.error}
        onConfirm={() => publish.mutate({ id }, { onSuccess: () => { setConfirmPublish(false); onDone(t("published")); } })}
      />
      <ConfirmActionDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          setConfirmDelete(o);
          if (!o) remove.reset();
        }}
        title={t("deleteDialog.title")}
        description={t("deleteDialog.description")}
        confirmLabel={t("deleteDialog.confirm")}
        destructive
        isPending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate({ id }, { onSuccess: () => { setConfirmDelete(false); onDone(t("deleted")); } })}
      />
    </div>
  );
}

function StructureDialog({ detail, onClose, onSaved }: { detail: PrimaryFrameworkDetailDto; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("v2PrimarySettings.frameworks.structure");
  const put = usePutPrimaryStructure();
  const [domains, setDomains] = useState<DomainRow[]>(() => detail.domains.map((d) => ({ code: d.code, label: d.label, competencies: d.competencies.map((c) => ({ code: c.code, label: c.label })) })));
  const [errors, setErrors] = useState<FieldErrors>({});
  const patchDomain = (i: number, p: Partial<DomainRow>) => setDomains((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const patchCompetency = (i: number, k: number, p: Partial<CompetencyRow>) => setDomains((ds) => ds.map((d, j) => (j === i ? { ...d, competencies: d.competencies.map((c, m) => (m === k ? { ...c, ...p } : c)) } : d)));

  async function submit() {
    const v = validateWith(primaryStructureBodySchema, {
      domains: domains.map((d) => ({ code: d.code.trim().toUpperCase(), label: d.label, competencies: d.competencies.map((c) => ({ code: c.code.trim().toUpperCase(), label: c.label })) })),
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await put.mutateAsync({ id: detail.id, structure: v.data });
      onSaved();
      onClose();
    } catch {
      /* affichée par FormDialog */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("save")} onSubmit={() => void submit()} isPending={put.isPending} error={put.error} wide>
      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {Object.values(errors)[0]}
        </p>
      ) : null}
      {domains.map((d, i) => (
        <fieldset key={i} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <legend className="px-1 text-sm font-medium">{t("domain", { n: i + 1 })}</legend>
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
            <FormField label={t("domainCode", { n: i + 1 })}>{(c) => <TextControl {...c} value={d.code} onChange={(v) => patchDomain(i, { code: v })} maxLength={40} />}</FormField>
            <FormField label={t("domainLabel", { n: i + 1 })}>{(c) => <TextControl {...c} value={d.label} onChange={(v) => patchDomain(i, { label: v })} maxLength={200} />}</FormField>
          </div>
          {d.competencies.map((c, k) => (
            <div key={k} className="grid gap-2 sm:grid-cols-[8rem_1fr]">
              <FormField label={t("competencyCode", { d: i + 1, n: k + 1 })}>{(f) => <TextControl {...f} value={c.code} onChange={(v) => patchCompetency(i, k, { code: v })} maxLength={40} />}</FormField>
              <FormField label={t("competencyLabel", { d: i + 1, n: k + 1 })}>{(f) => <TextControl {...f} value={c.label} onChange={(v) => patchCompetency(i, k, { label: v })} maxLength={200} />}</FormField>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => patchDomain(i, { competencies: [...d.competencies, { code: "", label: "" }] })}>
              {t("addCompetency")}
            </button>
            <button type="button" className={buttonClass.ghost} onClick={() => setDomains((ds) => ds.filter((_, j) => j !== i))}>
              {t("removeDomain", { n: i + 1 })}
            </button>
          </div>
        </fieldset>
      ))}
      <button type="button" className={buttonClass.secondary} onClick={() => setDomains((ds) => [...ds, { code: "", label: "", competencies: [{ code: "", label: "" }] }])}>
        {t("addDomain")}
      </button>
    </FormDialog>
  );
}

function CreateFrameworkDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations("v2PrimarySettings.frameworks.form");
  const scales = usePrimaryScales();
  const create = useCreatePrimaryFramework();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [scaleId, setScaleId] = useState("");
  const [grades, setGrades] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const v = validateWith(primaryCreateFrameworkBodySchema, {
      code: code.trim().toUpperCase(),
      label,
      scaleId,
      gradeLevelCodes: grades
        .split(",")
        .map((g) => g.trim().toUpperCase())
        .filter(Boolean),
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const created = await create.mutateAsync(v.data);
      onCreated(created.id);
      onClose();
    } catch {
      /* affichée par FormDialog */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={create.error}>
      <FormField label={t("code")} required hint={t("codeHint")} error={errors.code}>
        {(c) => <TextControl {...c} value={code} onChange={setCode} maxLength={40} />}
      </FormField>
      <FormField label={t("label")} required error={errors.label}>
        {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={200} />}
      </FormField>
      <FormField label={t("scale")} required error={errors.scaleId}>
        {(c) => <NativeSelect {...c} value={scaleId} onChange={setScaleId} placeholder={t("chooseScale")} options={(scales.data ?? []).filter((s) => s.status === "ACTIVE").map((s) => ({ value: s.id, label: s.label }))} />}
      </FormField>
      <FormField label={t("grades")} hint={t("gradesHint")} error={errors.gradeLevelCodes}>
        {(c) => <TextControl {...c} value={grades} onChange={setGrades} />}
      </FormField>
    </FormDialog>
  );
}
