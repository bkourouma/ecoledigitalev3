"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { reportcardsCreateSignatoryBodySchema, reportcardsPatchSignatoryBodySchema } from "@ecoledigitale/contracts/v2/reportcards";
import type { z } from "zod";
import type { reportcardsSignatoryDtoSchema } from "@ecoledigitale/contracts/v2/reportcards";
import { useStaffOptions } from "@/platform/v2/lookups";
import { useCreateSignatory, useSignatories, useUpdateSignatory } from "@/platform/v2/reportcards";
import { CheckControl, FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ImageUploadField } from "./ImageUpload";

type Signatory = z.infer<typeof reportcardsSignatoryDtoSchema>;

function useSignatoryStaffOptions(search: string, enabled: boolean) {
  return useStaffOptions(search, enabled, { status: "ACTIVE" });
}

/** Registre des signataires : aucun nom par défaut, tout vient des données de l'établissement ; période de validité facultative. */
export function SignatoriesScreen() {
  const t = useTranslations("v2Reportcards.signatories");
  const query = useSignatories();
  const update = useUpdateSignatory();
  const date = useDateFormat();
  const flash = useFlash();
  const [editing, setEditing] = useState<Signatory | "new" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const items = query.data ?? [];

  async function toggle(s: Signatory) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: s.id, patch: { active: !s.active } });
      flash.show(t(s.active ? "deactivated" : "activated", { name: s.fullName }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")}>
            {t("create")}
          </button>
        }
      />
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      {items.length > 0 ? (
        <ul className="space-y-3" aria-label={t("listLabel")}>
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
              <div>
                <p className="font-semibold">
                  {s.fullName} <StatusBadge label={s.active ? t("active") : t("inactive")} tone={s.active ? "success" : "neutral"} />
                </p>
                {s.title ? <p>{s.title}</p> : null}
                {s.jobFunction ? <p className="text-muted-foreground">{s.jobFunction}</p> : null}
                <p className="text-xs text-muted-foreground">
                  {s.validFrom || s.validTo ? t("validity", { from: s.validFrom ? date.civil(s.validFrom) : "—", to: s.validTo ? date.civil(s.validTo) : t("openEnded") }) : t("noValidity")}
                  {s.signatureObjectKey ? ` · ${t("hasSignature")}` : ` · ${t("noSignature")}`}
                </p>
              </div>
              <span className="flex flex-wrap gap-1">
                <button type="button" className={buttonClass.secondary} onClick={() => setEditing(s)} aria-label={t("editOf", { name: s.fullName })}>
                  {t("edit")}
                </button>
                <button type="button" className={buttonClass.ghost} onClick={() => void toggle(s)} disabled={update.isPending} aria-label={t(s.active ? "deactivateOf" : "activateOf", { name: s.fullName })}>
                  {s.active ? t("deactivate") : t("activate")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? <SignatoryDialog signatory={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={(name) => flash.show(t("saved", { name }))} /> : null}
    </div>
  );
}

function SignatoryDialog({ signatory, onClose, onDone }: { signatory: Signatory | null; onClose: () => void; onDone: (name: string) => void }) {
  const t = useTranslations("v2Reportcards.signatories");
  const create = useCreateSignatory();
  const update = useUpdateSignatory();
  const [form, setForm] = useState({
    fullName: signatory?.fullName ?? "",
    title: signatory?.title ?? "",
    jobFunction: signatory?.jobFunction ?? "",
    validFrom: signatory?.validFrom ?? "",
    validTo: signatory?.validTo ?? "",
    signatureObjectKey: signatory?.signatureObjectKey ?? "",
    active: signatory?.active ?? true,
  });
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = signatory ? update : create;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const nullable = (v: string) => (v.trim() === "" ? null : v.trim());

  async function submit() {
    const base = {
      fullName: form.fullName,
      title: nullable(form.title),
      jobFunction: nullable(form.jobFunction),
      validFrom: nullable(form.validFrom),
      validTo: nullable(form.validTo),
      signatureObjectKey: nullable(form.signatureObjectKey),
      ...(staff ? { staffId: staff.value } : {}),
    };
    try {
      if (signatory) {
        const v = validateWith(reportcardsPatchSignatoryBodySchema, { ...base, active: form.active });
        if (!v.ok) return setErrors(v.errors);
        setErrors({});
        const saved = await update.mutateAsync({ id: signatory.id, patch: v.data });
        onDone(saved.fullName);
      } else {
        const v = validateWith(reportcardsCreateSignatoryBodySchema, base);
        if (!v.ok) return setErrors(v.errors);
        setErrors({});
        const saved = await create.mutateAsync(v.data);
        onDone(saved.fullName);
      }
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open wide onOpenChange={(o) => !o && onClose()} title={signatory ? t("editTitle", { name: signatory.fullName }) : t("createTitle")} description={t("dialogDescription")} submitLabel={signatory ? t("save") : t("submitCreate")} onSubmit={() => void submit()} isPending={mutation.isPending} error={Object.keys(errors).length === 0 ? mutation.error : null}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fullName")} required error={errors.fullName}>
          {(c) => <TextControl {...c} value={form.fullName} onChange={set("fullName")} maxLength={160} />}
        </FormField>
        <FormField label={t("titleField")} error={errors.title} hint={t("titleHint")}>
          {(c) => <TextControl {...c} value={form.title} onChange={set("title")} maxLength={160} />}
        </FormField>
        <FormField label={t("jobFunction")} error={errors.jobFunction}>
          {(c) => <TextControl {...c} value={form.jobFunction} onChange={set("jobFunction")} maxLength={300} />}
        </FormField>
        <FormField label={t("staff")} error={errors.staffId} hint={t("staffHint")}>
          {(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useSignatoryStaffOptions} placeholder={t("staffPlaceholder")} />}
        </FormField>
        <FormField label={t("validFrom")} error={errors.validFrom}>
          {(c) => <TextControl {...c} type="date" value={form.validFrom} onChange={set("validFrom")} />}
        </FormField>
        <FormField label={t("validTo")} error={errors.validTo}>
          {(c) => <TextControl {...c} type="date" value={form.validTo} onChange={set("validTo")} />}
        </FormField>
      </div>
      <ImageUploadField kind="signature" label={t("signature")} value={form.signatureObjectKey} onChange={set("signatureObjectKey")} />
      {signatory ? <CheckControl checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} label={t("activeLabel")} /> : null}
    </FormDialog>
  );
}
