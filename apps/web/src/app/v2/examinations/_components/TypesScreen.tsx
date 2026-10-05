"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { examCreatePaperBodySchema, examCreateTrackBodySchema, examCreateTypeBodySchema, type ExamTypeDetailDto, type ExamTypeDto } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { FormField, NativeSelect, TextControl, CheckControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { showDecimal } from "@/platform/ui/format";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useCreateExamType, useCreatePaper, useCreateTrack, useExamType, useExamTypes, useInstantiatePack } from "@/platform/v2/examinations";
import { ExamAdmissionTransfer } from "./ExamAdmissionTransfer";
import { ExamFeeItemsPanel } from "./ExamFeeItemsPanel";
import { DemoBanner, StatusPill, useExamLabels } from "./shared";

const SOURCES = ["regulation", "institution", "platform", "placeholder"] as const;

function CreateTypeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Examinations.types.create");
  const labels = useExamLabels();
  const create = useCreateExamType();
  const [form, setForm] = useState({ code: "", label: "", educationLevelCode: "", gradeLevelCode: "", sourceKind: "institution", sourceReference: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  async function submit() {
    const parsed = validateWith(examCreateTypeBodySchema, {
      code: form.code.trim().toUpperCase(),
      label: form.label.trim(),
      educationLevelCode: form.educationLevelCode.trim().toUpperCase(),
      gradeLevelCode: form.gradeLevelCode.trim() ? form.gradeLevelCode.trim().toUpperCase() : null,
      sourceKind: form.sourceKind,
      sourceReference: form.sourceReference.trim() ? form.sourceReference.trim() : null,
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    try {
      await create.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={Object.keys(errors).length === 0 ? create.error : undefined}>
      <div className="space-y-3">
        <FormField label={t("code")} required hint={t("codeHint")} error={errors.code ?? null}>{(c) => <TextControl {...c} value={form.code} onChange={set("code")} maxLength={20} />}</FormField>
        <FormField label={t("label")} required error={errors.label ?? null}>{(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}</FormField>
        <FormField label={t("educationLevel")} required hint={t("educationLevelHint")} error={errors.educationLevelCode ?? null}>{(c) => <TextControl {...c} value={form.educationLevelCode} onChange={set("educationLevelCode")} maxLength={40} />}</FormField>
        <FormField label={t("gradeLevel")} error={errors.gradeLevelCode ?? null}>{(c) => <TextControl {...c} value={form.gradeLevelCode} onChange={set("gradeLevelCode")} maxLength={40} />}</FormField>
        <FormField label={t("source")}>{(c) => <NativeSelect {...c} value={form.sourceKind} options={SOURCES.map((s) => ({ value: s, label: labels.source(s) }))} onChange={set("sourceKind")} />}</FormField>
        <FormField label={t("sourceReference")} error={errors.sourceReference ?? null}>{(c) => <TextControl {...c} value={form.sourceReference} onChange={set("sourceReference")} maxLength={500} />}</FormField>
      </div>
    </FormDialog>
  );
}

function AddTrackDialog({ typeId, open, onOpenChange }: { typeId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Examinations.types.track");
  const create = useCreateTrack(typeId);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  async function submit() {
    const parsed = validateWith(examCreateTrackBodySchema, { code: code.trim().toUpperCase(), label: label.trim(), sourceKind: "institution" });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    try {
      await create.mutateAsync(parsed.data);
      setCode("");
      setLabel("");
      onOpenChange(false);
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={Object.keys(errors).length === 0 ? create.error : undefined}>
      <div className="space-y-3">
        <FormField label={t("code")} required error={errors.code ?? null}>{(c) => <TextControl {...c} value={code} onChange={setCode} maxLength={20} />}</FormField>
        <FormField label={t("label")} required error={errors.label ?? null}>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={200} />}</FormField>
      </div>
    </FormDialog>
  );
}

function AddPaperDialog({ type, open, onOpenChange }: { type: ExamTypeDetailDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Examinations.types.paper");
  const create = useCreatePaper(type.id);
  const [form, setForm] = useState({ code: "", label: "", trackCode: "", coefficient: "1", scaleMax: "20", ordinal: String(type.papers.length + 1), isOptional: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: "code" | "label" | "trackCode" | "coefficient" | "scaleMax" | "ordinal") => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  async function submit() {
    const parsed = validateWith(examCreatePaperBodySchema, {
      code: form.code.trim().toUpperCase(),
      label: form.label.trim(),
      trackCode: form.trackCode || null,
      coefficient: form.coefficient.trim().replace(",", "."),
      scaleMax: form.scaleMax.trim().replace(",", "."),
      ordinal: Number(form.ordinal),
      isOptional: form.isOptional,
      sourceKind: "institution",
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    try {
      await create.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={Object.keys(errors).length === 0 ? create.error : undefined}>
      <div className="space-y-3">
        <FormField label={t("code")} required error={errors.code ?? null}>{(c) => <TextControl {...c} value={form.code} onChange={set("code")} maxLength={30} />}</FormField>
        <FormField label={t("label")} required error={errors.label ?? null}>{(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}</FormField>
        <FormField label={t("track")} hint={t("trackHint")}>{(c) => <NativeSelect {...c} value={form.trackCode} placeholder={t("allTracks")} options={type.tracks.map((x) => ({ value: x.code, label: `${x.code} — ${x.label}` }))} onChange={set("trackCode")} />}</FormField>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t("coefficient")} required error={errors.coefficient ?? null}>{(c) => <TextControl {...c} inputMode="decimal" value={form.coefficient} onChange={set("coefficient")} />}</FormField>
          <FormField label={t("scaleMax")} required error={errors.scaleMax ?? null}>{(c) => <TextControl {...c} inputMode="decimal" value={form.scaleMax} onChange={set("scaleMax")} />}</FormField>
          <FormField label={t("ordinal")} required error={errors.ordinal ?? null}>{(c) => <TextControl {...c} type="number" min={1} value={form.ordinal} onChange={set("ordinal")} />}</FormField>
        </div>
        <CheckControl checked={form.isOptional} onChange={(v) => setForm((f) => ({ ...f, isOptional: v }))} label={t("optional")} />
      </div>
    </FormDialog>
  );
}

function TypeDetail({ id }: { id: string }) {
  const t = useTranslations("v2Examinations.types.detail");
  const labels = useExamLabels();
  const query = useExamType(id);
  const [track, setTrack] = useState(false);
  const [paper, setPaper] = useState(false);
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  const d = query.data;
  return (
    <div className="space-y-5 rounded-md border p-4" data-testid="type-detail">
      <DemoBanner visible={d.placeholder} />
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">{t("contract")}</dt><dd className="font-medium">{d.resultContractId}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("numberPattern")}</dt><dd className="font-mono text-sm">{d.candidateNumberPattern}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("educationLevel")}</dt><dd className="font-medium">{d.educationLevelCode}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("source")}</dt><dd className="font-medium">{labels.source(d.sourceKind)}</dd></div>
      </dl>

      <section aria-labelledby={`tracks-${d.id}`} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id={`tracks-${d.id}`} className="font-semibold">{t("tracks")}</h3>
          <Can permission="exam.type.manage"><button type="button" className={buttonClass.secondary} onClick={() => setTrack(true)}>{t("addTrack")}</button></Can>
        </div>
        {d.tracks.length === 0 ? <p className="text-sm text-muted-foreground">{t("noTracks")}</p> : (
          <ul className="flex flex-wrap gap-2">{d.tracks.map((x) => <li key={x.id}><StatusPill label={`${x.code} — ${x.label}`} tone={x.active ? "info" : "neutral"} /></li>)}</ul>
        )}
      </section>

      <section aria-labelledby={`papers-${d.id}`} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id={`papers-${d.id}`} className="font-semibold">{t("papers")}</h3>
          <Can permission="exam.type.manage"><button type="button" className={buttonClass.secondary} onClick={() => setPaper(true)}>{t("addPaper")}</button></Can>
        </div>
        {d.papers.length === 0 ? <p className="text-sm text-muted-foreground">{t("noPapers")}</p> : (
          <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("papers")}>
            <table className="w-full text-sm">
              <caption className="sr-only">{t("papers")}</caption>
              <thead className="bg-muted/50 text-left"><tr>
                <th scope="col" className="px-3 py-2">{t("code")}</th><th scope="col" className="px-3 py-2">{t("label")}</th>
                <th scope="col" className="px-3 py-2 text-right">{t("coefficient")}</th><th scope="col" className="px-3 py-2 text-right">{t("scaleMax")}</th>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">{t("source")}</th>
              </tr></thead>
              <tbody>{d.papers.map((p) => (
                <tr key={p.id} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium">{p.code}</th>
                  <td className="px-3 py-2">{p.label}{p.trackCode ? <span className="ml-2 text-xs text-muted-foreground">[{p.trackCode}]</span> : null}</td>
                  <td className="px-3 py-2 text-right">{showDecimal(p.coefficient)}</td>
                  <td className="px-3 py-2 text-right">{showDecimal(p.scaleMax)}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{labels.source(p.sourceKind)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby={`req-${d.id}`} className="space-y-2">
        <h3 id={`req-${d.id}`} className="font-semibold">{t("requirements")}</h3>
        {d.requirements.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRequirements")}</p> : (
          <ul className="list-disc pl-5 text-sm">{d.requirements.map((r) => <li key={r.id}>{r.label}{r.required ? "" : ` (${t("optional")})`}</li>)}</ul>
        )}
      </section>
      <ExamAdmissionTransfer typeId={d.id} enabled={d.transmitsToAdmission} />
      <Can permission="exam.fee.read"><ExamFeeItemsPanel typeId={d.id} /></Can>
      <AddTrackDialog typeId={d.id} open={track} onOpenChange={setTrack} />
      <AddPaperDialog type={d} open={paper} onOpenChange={setPaper} />
    </div>
  );
}

/** Types d'examens (CEPE, BEPC, BAC, BTS…) : DONNÉES paramétrables ; le CEPE livré est FICTIF (bandeau de démonstration). */
export function TypesScreen() {
  const t = useTranslations("v2Examinations.types");
  const labels = useExamLabels();
  const types = useExamTypes();
  const pack = useInstantiatePack();
  const flash = useFlash();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function instantiate() {
    flash.show(null);
    try {
      const out = await pack.mutateAsync({ pack: "PRIMARY" });
      flash.show(t("packDone", { created: out.createdTypes.length, existing: out.existingTypes.length }));
    } catch {
      /* erreur affichée sous le bouton */
    }
  }

  const items: ExamTypeDto[] = types.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="exam.type.manage">
            <button type="button" className={buttonClass.secondary} disabled={pack.isPending} onClick={() => void instantiate()}>{t("instantiatePack")}</button>
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>{t("create.open")}</button>
          </Can>
        }
      />
      {flash.node}
      {pack.isError ? <ErrorBlock error={pack.error} /> : null}
      {pack.data ? <Notice kind="warning">{pack.data.notice}</Notice> : null}
      {types.isPending ? <LoadingBlock /> : types.isError ? <ErrorBlock error={types.error} onRetry={() => void types.refetch()} /> : items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((x) => (
            <li key={x.id} className="rounded-md border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{x.code} — {x.label}</h2>
                <div className="flex gap-2">
                  {x.placeholder ? <StatusPill label={t("demo")} tone="warning" /> : null}
                  <StatusPill label={t(`status.${x.status}` as never)} tone={x.status === "ACTIVE" ? "success" : "neutral"} />
                </div>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{labels.source(x.sourceKind)}</p>
              <button type="button" className={`${buttonClass.secondary} mt-3`} aria-expanded={selected === x.id} onClick={() => setSelected(selected === x.id ? null : x.id)}>
                {selected === x.id ? t("hide") : t("show")}
              </button>
              {selected === x.id ? <div className="mt-3"><TypeDetail id={x.id} /></div> : null}
            </li>
          ))}
        </ul>
      )}
      <CreateTypeDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
