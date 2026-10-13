"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { higherCreateFromCurriculumBodySchema, HIGHER_DIPLOMA_STATUSES } from "@ecoledigitale/contracts/v2/higher";
import { Can } from "@/platform/ui/AccessGate";
import { useCreateDiplomaFromCurriculum, useDiplomas } from "@/platform/v2/higher";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CurriculumNodePicker } from "./shared";

export function DiplomasScreen() {
  const t = useTranslations("v2Higher.diplomas");
  const tStatus = useTranslations("v2Higher.diplomaStatus");
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const query = useDiplomas({ status, q: text.trim() });
  const [creating, setCreating] = useState(false);
  const flash = useFlash();
  const items = query.data ?? [];
  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="higher.diploma.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("create")}
            </button>
          </Can>
        }
      />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("filters")} onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("search")}>{(c) => <TextControl {...c} type="search" value={text} onChange={setText} />}</FormField>
        <FormField label={t("status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("allStatuses")} options={HIGHER_DIPLOMA_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
      </form>
      {flash.node}
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      {items.length > 0 ? (
        <div role="region" aria-label={t("tableCaption")} tabIndex={0} className="overflow-x-auto rounded-2xl border border-white/10 bg-card/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="bg-white/[0.04] text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("columns.diploma")}</th>
                <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("columns.grade")}</th>
                <th scope="col" className="px-3 py-2 text-right">{t("columns.uv")}</th>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">{t("columns.auto")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.status")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-t border-white/5 transition-colors hover:bg-white/[0.04]">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <Link href={`/v2/higher/diplomas/${d.id}`} className="text-primary underline-offset-4 hover:underline">
                      {d.label}
                    </Link>
                    <span className="block font-mono text-xs font-normal text-muted-foreground">{d.code}</span>
                  </th>
                  <td className="hidden px-3 py-2 sm:table-cell">{d.gradeCode}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{String(d.uvRequired).replace(".", ",")}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{d.autoAward ? t("autoYes") : t("autoNo")}</td>
                  <td className="px-3 py-2">
                    <StatusBadge label={tStatus(d.status)} tone={d.status === "ACTIVE" ? "success" : "neutral"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {creating ? <CreateDiplomaDialog onClose={() => setCreating(false)} onDone={(label) => flash.show(t("created", { label }))} /> : null}
    </div>
  );
}

function CreateDiplomaDialog({ onClose, onDone }: { onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2Higher.diplomas");
  const create = useCreateDiplomaFromCurriculum();
  const [nodeId, setNodeId] = useState("");
  const [form, setForm] = useState({ gradeCode: "", code: "", label: "", uvRequired: "", autoAward: false, description: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const body = {
      curriculumNodeId: nodeId,
      gradeCode: form.gradeCode.trim().toUpperCase(),
      ...(form.code.trim() ? { code: form.code.trim().toUpperCase() } : {}),
      ...(form.label.trim() ? { label: form.label.trim() } : {}),
      ...(form.uvRequired.trim() ? { uvRequired: Number(form.uvRequired.replace(",", ".")) } : {}),
      ...(form.autoAward ? { autoAward: true } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    };
    const v = validateWith(higherCreateFromCurriculumBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const created = await create.mutateAsync(v.data);
      onDone(created.diploma.label);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open wide onOpenChange={(o) => !o && onClose()} title={t("createTitle")} description={t("createDescription")} submitLabel={t("createSubmit")} onSubmit={() => void submit()} isPending={create.isPending} error={Object.keys(errors).length === 0 ? create.error : null}>
      <CurriculumNodePicker value={nodeId} onChange={(id) => setNodeId(id)} label={t("cycleNode")} error={errors.curriculumNodeId} hint={t("cycleNodeHint")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("gradeCode")} required error={errors.gradeCode} hint={t("gradeCodeHint")}>
          {(c) => <TextControl {...c} value={form.gradeCode} onChange={set("gradeCode")} maxLength={32} />}
        </FormField>
        <FormField label={t("code")} error={errors.code} hint={t("optionalHint")}>
          {(c) => <TextControl {...c} value={form.code} onChange={set("code")} maxLength={50} />}
        </FormField>
        <FormField label={t("label")} error={errors.label} hint={t("optionalHint")}>
          {(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={200} />}
        </FormField>
        <FormField label={t("uvRequired")} error={errors.uvRequired} hint={t("uvHint")}>
          {(c) => <TextControl {...c} value={form.uvRequired} onChange={set("uvRequired")} inputMode="decimal" />}
        </FormField>
      </div>
      <FormField label={t("descriptionField")} error={errors.description}>
        {(c) => <TextControl {...c} value={form.description} onChange={set("description")} maxLength={2000} />}
      </FormField>
      <CheckControl checked={form.autoAward} onChange={(v) => setForm((f) => ({ ...f, autoAward: v }))} label={t("autoAward")} hint={t("autoAwardHint")} />
    </FormDialog>
  );
}
