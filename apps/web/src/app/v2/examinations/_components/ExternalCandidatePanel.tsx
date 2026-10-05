"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ExamSessionDetailDto } from "@ecoledigitale/contracts/v2/examinations";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice } from "@/platform/ui/states";
import { useCreateExternalBatch, useCreateExternalCandidate, type ExternalCandidateInput } from "@/platform/v2/examinations-external";
import { BatchReport } from "./shared";
import { parseExternalCsv, type ParsedRow } from "./external-csv";

const BLANK = {
  lastName: "", firstName: "", birthDate: "", birthPlace: "", sex: "", phone: "", email: "", address: "", pieceKind: "", pieceNumber: "",
  guardianName: "", guardianRelation: "", guardianPhone: "", guardianEmail: "", inExamGrade: false, priorAttempts: "0",
};

const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);

function toInput(f: typeof BLANK): ExternalCandidateInput {
  return {
    identity: { lastName: f.lastName.trim(), firstName: f.firstName.trim(), birthDate: f.birthDate, birthPlace: orNull(f.birthPlace), sex: f.sex as "F" | "M" },
    profile: {
      contactPhone: orNull(f.phone), contactEmail: orNull(f.email), addressLine: orNull(f.address), idPieceKind: orNull(f.pieceKind) ? f.pieceKind.trim().toUpperCase() : null, idPieceNumber: orNull(f.pieceNumber),
      guardianName: orNull(f.guardianName), guardianRelation: orNull(f.guardianRelation), guardianPhone: orNull(f.guardianPhone), guardianEmail: orNull(f.guardianEmail),
      declaredInExamGrade: f.inExamGrade, declaredPriorAttempts: Number(f.priorAttempts) || 0,
    },
  };
}

function FreeCandidateDialog({ sessionId, open, onOpenChange }: { sessionId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2ExaminationsExternal.form");
  const create = useCreateExternalCandidate(sessionId);
  const [f, setF] = useState(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof BLANK>(key: K) => (value: (typeof BLANK)[K]) => setF((prev) => ({ ...prev, [key]: value }));

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!f.lastName.trim()) next.lastName = t("errors.required");
    if (!f.firstName.trim()) next.firstName = t("errors.required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate)) next.birthDate = t("errors.birthDate");
    if (f.sex !== "F" && f.sex !== "M") next.sex = t("errors.required");
    if (!f.phone.trim() && !f.email.trim() && !f.guardianPhone.trim() && !f.guardianEmail.trim()) next.phone = t("errors.contact");
    if (Boolean(f.pieceKind.trim()) !== Boolean(f.pieceNumber.trim())) next.pieceNumber = t("errors.piece");
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  async function submit() {
    if (!validate()) return;
    try {
      await create.mutateAsync(toInput(f));
      setF(BLANK);
      onOpenChange(false);
    } catch {
      /* erreur affichée dans la fenêtre */
    }
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={create.error} wide>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t("identity")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("lastName")} required error={errors.lastName ?? null}>{(c) => <TextControl {...c} value={f.lastName} onChange={set("lastName")} maxLength={120} autoComplete="off" />}</FormField>
          <FormField label={t("firstName")} required error={errors.firstName ?? null}>{(c) => <TextControl {...c} value={f.firstName} onChange={set("firstName")} maxLength={120} autoComplete="off" />}</FormField>
          <FormField label={t("birthDate")} required error={errors.birthDate ?? null}>{(c) => <TextControl {...c} type="date" value={f.birthDate} onChange={set("birthDate")} />}</FormField>
          <FormField label={t("birthPlace")}>{(c) => <TextControl {...c} value={f.birthPlace} onChange={set("birthPlace")} maxLength={120} />}</FormField>
          <FormField label={t("sex")} required error={errors.sex ?? null}>{(c) => <NativeSelect {...c} value={f.sex} placeholder={t("choose")} options={[{ value: "F", label: t("sexF") }, { value: "M", label: t("sexM") }]} onChange={set("sex")} />}</FormField>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t("contact")}</legend>
        <p className="text-xs text-muted-foreground">{t("contactHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("phone")} error={errors.phone ?? null}>{(c) => <TextControl {...c} type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} maxLength={40} autoComplete="off" />}</FormField>
          <FormField label={t("email")}>{(c) => <TextControl {...c} type="email" inputMode="email" value={f.email} onChange={set("email")} maxLength={200} autoComplete="off" />}</FormField>
          <FormField label={t("address")} className="sm:col-span-2">{(c) => <TextControl {...c} value={f.address} onChange={set("address")} maxLength={300} autoComplete="off" />}</FormField>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t("piece")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("pieceKind")} hint={t("pieceKindHint")}>{(c) => <TextControl {...c} value={f.pieceKind} onChange={set("pieceKind")} maxLength={40} />}</FormField>
          <FormField label={t("pieceNumber")} error={errors.pieceNumber ?? null}>{(c) => <TextControl {...c} value={f.pieceNumber} onChange={set("pieceNumber")} maxLength={60} autoComplete="off" />}</FormField>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t("guardian")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("guardianName")}>{(c) => <TextControl {...c} value={f.guardianName} onChange={set("guardianName")} maxLength={120} autoComplete="off" />}</FormField>
          <FormField label={t("guardianRelation")}>{(c) => <TextControl {...c} value={f.guardianRelation} onChange={set("guardianRelation")} maxLength={60} />}</FormField>
          <FormField label={t("guardianPhone")}>{(c) => <TextControl {...c} type="tel" inputMode="tel" value={f.guardianPhone} onChange={set("guardianPhone")} maxLength={40} autoComplete="off" />}</FormField>
          <FormField label={t("guardianEmail")}>{(c) => <TextControl {...c} type="email" inputMode="email" value={f.guardianEmail} onChange={set("guardianEmail")} maxLength={200} autoComplete="off" />}</FormField>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t("facts")}</legend>
        <p className="text-xs text-muted-foreground">{t("factsHint")}</p>
        <CheckControl checked={f.inExamGrade} onChange={set("inExamGrade")} label={t("inExamGrade")} />
        <FormField label={t("priorAttempts")}>{(c) => <TextControl {...c} type="number" inputMode="numeric" min={0} max={50} value={f.priorAttempts} onChange={set("priorAttempts")} />}</FormField>
      </fieldset>
    </FormDialog>
  );
}

const REASON_KEYS: Record<NonNullable<ParsedRow["error"]>, string> = {
  MISSING_FIELD: "missingField", BAD_DATE: "badDate", BAD_SEX: "badSex", BAD_BOOLEAN: "badBoolean", BAD_NUMBER: "badNumber", NO_CONTACT: "noContact",
};

function CsvImport({ sessionId }: { sessionId: string }) {
  const t = useTranslations("v2ExaminationsExternal.import");
  const batch = useCreateExternalBatch(sessionId);
  const [parsed, setParsed] = useState<ReturnType<typeof parseExternalCsv> | null>(null);
  const [fileName, setFileName] = useState("");
  const valid = (parsed?.rows ?? []).filter((r) => r.value !== null);
  const invalid = (parsed?.rows ?? []).filter((r) => r.value === null);

  async function onFile(file: File | undefined) {
    setParsed(null);
    batch.reset();
    if (!file) return;
    setFileName(file.name);
    setParsed(parseExternalCsv(await file.text()));
  }
  async function send() {
    try {
      await batch.mutateAsync({ source: "IMPORTED", items: valid.map((r) => r.value as ExternalCandidateInput) });
    } catch {
      /* erreur affichée */
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <FormField label={t("file")}>{(c) => <input {...c} type="file" accept=".csv,text/csv" className="block w-full text-sm" onChange={(e) => void onFile(e.target.files?.[0])} />}</FormField>
      {parsed && parsed.missingHeaders.length > 0 ? <Notice kind="error">{t("missingHeaders", { columns: parsed.missingHeaders.join(", ") })}</Notice> : null}
      {parsed && parsed.unknownHeaders.length > 0 ? <Notice kind="info">{t("unknownHeaders", { columns: parsed.unknownHeaders.join(", ") })}</Notice> : null}
      {parsed && parsed.missingHeaders.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm" data-testid="csv-summary">{t("summary", { file: fileName, valid: valid.length, invalid: invalid.length })}</p>
          {invalid.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {invalid.map((r) => <li key={r.line}>{t("lineError", { line: r.line, reason: t(`reasons.${REASON_KEYS[r.error as NonNullable<ParsedRow["error"]>]}` as never), field: r.field ?? "" })}</li>)}
            </ul>
          ) : null}
          <button type="button" className={buttonClass.primary} disabled={valid.length === 0 || batch.isPending} onClick={() => void send()}>{t("send", { count: valid.length })}</button>
        </div>
      ) : null}
      {batch.isError ? <ErrorBlock error={batch.error} /> : null}
      {batch.data ? <BatchReport summary={t("report", { created: batch.data.created.length })} failures={batch.data.failed.map((f) => ({ id: String(f.index + 1), message: f.message, code: f.code }))} /> : null}
    </div>
  );
}

/** Candidats LIBRES (sans dossier élève, Q-E15) : saisie d'un candidat ou import d'un fichier CSV. Visible avec `exam.external.manage`. */
export function ExternalCandidatePanel({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2ExaminationsExternal.panel");
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  if (session.sessionKind !== "OFFICIAL") return <Notice kind="info">{t("officialOnly")}</Notice>;
  return (
    <section aria-labelledby="external-title" className="space-y-3 rounded-md border p-4">
      <h2 id="external-title" className="text-base font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass.primary} onClick={() => setOpen(true)}>{t("add")}</button>
        <button type="button" className={buttonClass.secondary} aria-expanded={importing} onClick={() => setImporting((v) => !v)}>{t("import")}</button>
      </div>
      {importing ? <CsvImport sessionId={session.id} /> : null}
      <FreeCandidateDialog sessionId={session.id} open={open} onOpenChange={setOpen} />
    </section>
  );
}
