"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  PEOPLE_STUDENT_DOCUMENT_TYPES,
  peopleRemoveStudentDocumentBodySchema,
  peopleReplaceStudentDocumentQuerySchema,
  peopleUpdateStudentDocumentBodySchema,
  peopleUploadStudentDocumentQuerySchema,
  type PeopleStudentDocumentDto,
  type PeopleStudentDocumentType,
} from "@ecoledigitale/contracts/v2/people";
import { usePermission } from "@/platform/access";
import { ApiError } from "@/platform/api/errors";
import {
  DOCUMENT_CONTENT_TYPES,
  MAX_DOCUMENT_BYTES,
  requestStudentDocumentUrl,
  useRemoveStudentDocument,
  useReplaceStudentDocument,
  useStudentDocuments,
  useUpdateStudentDocument,
  useUploadStudentDocument,
  type DocumentExpiryFilter,
} from "@/platform/v2/documents";
import { Can } from "@/platform/ui/AccessGate";
import { useDescribeError } from "@/platform/ui/errors";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, nullifyEmpty, validateWith, type FieldErrors } from "@/platform/ui/validation";

/** Taille lisible (affichage seulement). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

const EXPIRY_TONE: Record<PeopleStudentDocumentDto["expiryState"], Tone> = { NO_EXPIRY: "neutral", VALID: "success", EXPIRING: "warning", EXPIRED: "danger" };

/** Contrôle de COMMODITÉ d'un fichier choisi (un fichier, type, taille) : le serveur décide du type réel par les octets. */
export function checkFile(file: File | null): "required" | "badType" | "tooLarge" | null {
  if (!file) return "required";
  if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) return "badType";
  if (file.size > MAX_DOCUMENT_BYTES) return "tooLarge";
  return null;
}

/**
 * Onglet « Pièces » d'un élève : dépôt, remplacement (nouvelle version), dates, retrait motivé, consultation par URL signée.
 * Lecture : `student.sensitive.read` (sensible, auditée) ; écriture : `student.update`. Les états d'échéance viennent du serveur.
 */
export function DocumentsTab({ studentId }: { studentId: string }) {
  const t = useTranslations("v2StudentDocuments");
  const canRead = usePermission("student.sensitive.read");
  if (canRead.isLoading) return <LoadingBlock />;
  if (!canRead.allowed) return <Restricted message={null} />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("audited")}</p>
      <DocumentsContent studentId={studentId} />
    </div>
  );
}

function Restricted({ message }: { message: string | null }) {
  const t = useTranslations("v2StudentDocuments.restricted");
  return (
    <Notice kind="info">
      <p className="font-medium">{t("title")}</p>
      <p>{t("body")}</p>
      {message ? <p className="mt-1 text-xs">{message}</p> : null}
    </Notice>
  );
}

function DocumentsContent({ studentId }: { studentId: string }) {
  const t = useTranslations("v2StudentDocuments");
  const tType = useTranslations("v2StudentDocuments.type");
  const describe = useDescribeError();
  const [history, setHistory] = useState(false);
  const [expiry, setExpiry] = useState<DocumentExpiryFilter>("");
  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState<PeopleStudentDocumentDto | null>(null);
  const [editing, setEditing] = useState<PeopleStudentDocumentDto | null>(null);
  const [removing, setRemoving] = useState<PeopleStudentDocumentDto | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const flash = useFlash();
  const list = useStudentDocuments(studentId, { includeHistory: history, expiry });
  const remove = useRemoveStudentDocument();

  const groups = useMemo(() => {
    const out = new Map<PeopleStudentDocumentType, PeopleStudentDocumentDto[]>();
    for (const d of [...(list.data ?? [])].sort((a, b) => b.version - a.version)) out.set(d.typeCode, [...(out.get(d.typeCode) ?? []), d]);
    return PEOPLE_STUDENT_DOCUMENT_TYPES.filter((x) => out.has(x)).map((x) => ({ type: x, items: out.get(x)! }));
  }, [list.data]);

  async function open(doc: PeopleStudentDocumentDto) {
    setOpenError(null);
    setOpening(doc.id);
    try {
      // L'URL signée est ouverte aussitôt, jamais conservée ni affichée.
      const signed = await requestStudentDocumentUrl(studentId, doc.id);
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setOpenError(describe(e));
    } finally {
      setOpening(null);
    }
  }

  if (list.isError && list.error instanceof ApiError && list.error.status === 403) return <Restricted message={list.error.message} />;

  return (
    <section aria-labelledby="documents-title" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="documents-title" className="text-lg font-semibold">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Can permission="student.update">
          <button type="button" className={buttonClass.primary} onClick={() => setUploading(true)}>
            {t("upload")}
          </button>
        </Can>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField label={t("filter.label")} className="sm:w-64">
          {(c) => (
            <NativeSelect
              {...c}
              value={expiry}
              onChange={(v) => setExpiry(v as DocumentExpiryFilter)}
              options={[
                { value: "", label: t("filter.all") },
                { value: "EXPIRING", label: t("filter.expiring") },
                { value: "EXPIRED", label: t("filter.expired") },
              ]}
            />
          )}
        </FormField>
        <CheckControl label={t("history")} hint={t("historyHint")} checked={history} onChange={setHistory} />
      </div>

      {flash.node}
      {openError ? <Notice kind="error">{openError}</Notice> : null}
      {list.isPending && list.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : null}
      {remove.error && !removing ? <ErrorBlock error={remove.error} /> : null}
      {list.data && groups.length === 0 ? <EmptyBlock title={expiry ? t("emptyFiltered") : t("empty")} description={expiry ? undefined : t("emptyHint")} /> : null}

      {groups.map((g) => (
        <section key={g.type} aria-labelledby={`doc-type-${g.type}`} className="space-y-2">
          <h3 id={`doc-type-${g.type}`} className="text-base font-semibold">
            {tType(g.type)}
          </h3>
          <ul className="grid gap-3 md:grid-cols-2" aria-label={tType(g.type)}>
            {g.items.map((d) => (
              <DocumentCard key={d.id} doc={d} opening={opening === d.id} onOpen={() => void open(d)} onReplace={() => setReplacing(d)} onEdit={() => setEditing(d)} onRemove={() => setRemoving(d)} />
            ))}
          </ul>
        </section>
      ))}

      {uploading ? <UploadDialog studentId={studentId} documents={list.data ?? []} onClose={() => setUploading(false)} onDone={(label, replaced) => flash.show(t(replaced ? "replaced" : "uploaded", { label }))} /> : null}
      {replacing ? <ReplaceDialog studentId={studentId} doc={replacing} onClose={() => setReplacing(null)} onDone={(label) => flash.show(t("replaced", { label }))} /> : null}
      {editing ? <EditDialog studentId={studentId} doc={editing} onClose={() => setEditing(null)} onDone={() => flash.show(t("updated"))} /> : null}
      {removing ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t("removeTitle", { label: removing.title ?? removing.fileName })}
          description={t("removeDescription")}
          reasonLabel={t("reason")}
          confirmLabel={t("remove")}
          destructive
          isPending={remove.isPending}
          error={remove.error}
          onConfirm={async (reason) => {
            const v = validateWith(peopleRemoveStudentDocumentBodySchema, { reason });
            if (!v.ok) return;
            try {
              await remove.mutateAsync({ studentId, documentId: removing.id, reason: v.data.reason });
              flash.show(t("removed", { label: removing.title ?? removing.fileName }));
              setRemoving(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </section>
  );
}

function DocumentCard({ doc, opening, onOpen, onReplace, onEdit, onRemove }: { doc: PeopleStudentDocumentDto; opening: boolean; onOpen: () => void; onReplace: () => void; onEdit: () => void; onRemove: () => void }) {
  const t = useTranslations("v2StudentDocuments");
  const tExpiry = useTranslations("v2StudentDocuments.expiry");
  const tStatus = useTranslations("v2StudentDocuments.status");
  const date = useDateFormat();
  const name = doc.title ?? doc.fileName;
  const active = doc.status === "ACTIVE";
  return (
    <li className={`flex flex-col gap-2 rounded-lg border p-3 ${active ? "" : "bg-muted/40"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">{name}</p>
          {doc.title ? <p className="break-all text-xs text-muted-foreground">{doc.fileName}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <StatusBadge label={t("version", { n: doc.version })} tone="info" />
          {active ? <StatusBadge label={tExpiry(doc.expiryState)} tone={EXPIRY_TONE[doc.expiryState]} /> : <StatusBadge label={tStatus(doc.status)} tone={doc.status === "REMOVED" ? "danger" : "neutral"} />}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t("size")}</dt>
          <dd>{formatBytes(doc.sizeBytes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("uploadedAt")}</dt>
          <dd>{date.instant(doc.uploadedAt)}</dd>
        </div>
        {doc.issuedOn ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("issuedOn")}</dt>
            <dd>{date.civil(doc.issuedOn)}</dd>
          </div>
        ) : null}
        {doc.expiresOn ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("expiresOn")}</dt>
            <dd>
              {date.civil(doc.expiresOn)}
              {active && doc.daysLeft !== null ? <span className="block text-xs text-muted-foreground">{doc.daysLeft >= 0 ? t("daysLeft", { count: doc.daysLeft }) : t("daysOver", { count: Math.abs(doc.daysLeft) })}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {doc.status === "REMOVED" && doc.removedReason ? <p className="text-sm text-muted-foreground">{t("removedReason", { reason: doc.removedReason })}</p> : null}
      {doc.status === "REPLACED" ? <p className="text-xs text-muted-foreground">{t("replacedNote")}</p> : null}
      <div className="mt-auto flex flex-wrap gap-1">
        {doc.status !== "REMOVED" ? (
          <button type="button" className={buttonClass.secondary} disabled={opening} onClick={onOpen} aria-label={`${t("open")} — ${name} (${t("version", { n: doc.version })})`}>
            {t("open")}
          </button>
        ) : null}
        {active ? (
          <Can permission="student.update">
            <button type="button" className={buttonClass.ghost} onClick={onReplace} aria-label={`${t("replace")} — ${name}`}>
              {t("replace")}
            </button>
            <button type="button" className={buttonClass.ghost} onClick={onEdit} aria-label={`${t("edit")} — ${name}`}>
              {t("edit")}
            </button>
            <button type="button" className={buttonClass.ghost} onClick={onRemove} aria-label={`${t("remove")} — ${name}`}>
              {t("remove")}
            </button>
          </Can>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Formulaires
// ---------------------------------------------------------------------------

function FilePicker({ error, onPick }: { error?: string | null; onPick: (file: File | null) => void }) {
  const t = useTranslations("v2StudentDocuments.file");
  return (
    <FormField label={t("label")} hint={t("hint")} required error={error}>
      {(c) => (
        <input
          {...c}
          type="file"
          accept={`${DOCUMENT_CONTENT_TYPES.join(",")},.pdf,.jpg,.jpeg,.png,.webp`}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="block w-full max-w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-sm file:font-medium"
        />
      )}
    </FormField>
  );
}

function MetaFields({ form, set, errors }: { form: { title: string; issuedOn: string; expiresOn: string }; set: (k: "title" | "issuedOn" | "expiresOn") => (v: string) => void; errors: FieldErrors }) {
  const t = useTranslations("v2StudentDocuments.fields");
  return (
    <>
      <FormField label={t("title")} hint={t("titleHint")} error={errors.title}>
        {(c) => <TextControl {...c} value={form.title} onChange={set("title")} maxLength={200} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("issuedOn")} error={errors.issuedOn}>
          {(c) => <TextControl {...c} type="date" value={form.issuedOn} onChange={set("issuedOn")} />}
        </FormField>
        <FormField label={t("expiresOn")} hint={t("expiresOnHint")} error={errors.expiresOn}>
          {(c) => <TextControl {...c} type="date" value={form.expiresOn} min={form.issuedOn || undefined} onChange={set("expiresOn")} />}
        </FormField>
      </div>
    </>
  );
}

function useMetaForm(initial: { title: string; issuedOn: string; expiresOn: string }) {
  const [form, setForm] = useState(initial);
  return { form, set: (k: "title" | "issuedOn" | "expiresOn") => (v: string) => setForm((f) => ({ ...f, [k]: v })) };
}

function UploadDialog({ studentId, documents, onClose, onDone }: { studentId: string; documents: ReadonlyArray<PeopleStudentDocumentDto>; onClose: () => void; onDone: (label: string, replaced?: boolean) => void }) {
  const t = useTranslations("v2StudentDocuments.uploadDialog");
  const tFile = useTranslations("v2StudentDocuments.file");
  const tType = useTranslations("v2StudentDocuments.type");
  const upload = useUploadStudentDocument();
  const replace = useReplaceStudentDocument();
  const { form, set } = useMetaForm({ title: "", issuedOn: "", expiresOn: "" });
  const [typeCode, setTypeCode] = useState<PeopleStudentDocumentType | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const existing = documents.find((d) => d.typeCode === typeCode && d.status === "ACTIVE") ?? null;

  function fileMessage(key: ReturnType<typeof checkFile>) {
    return key ? tFile(`error.${key}`) : null;
  }

  async function submit() {
    setDuplicate(null);
    const fileKey = checkFile(file);
    const meta = { title: form.title.trim(), issuedOn: form.issuedOn, expiresOn: form.expiresOn };
    const query = { typeCode, fileName: file?.name ?? "", ...(meta.title ? { title: meta.title } : {}), ...(meta.issuedOn ? { issuedOn: meta.issuedOn } : {}), ...(meta.expiresOn ? { expiresOn: meta.expiresOn } : {}) };
    const v = validateWith(peopleUploadStudentDocumentQuerySchema, query);
    setFileError(fileMessage(fileKey));
    if (!v.ok || fileKey || !file) return setErrors(v.ok ? {} : v.errors);
    setErrors({});
    try {
      await upload.mutateAsync({ studentId, file, typeCode: v.data.typeCode, title: v.data.title, issuedOn: v.data.issuedOn, expiresOn: v.data.expiresOn });
      onDone(v.data.title ?? file.name);
      onClose();
    } catch (e) {
      // Doublon : le serveur refuse un second dépôt du même type ; on propose de REMPLACER la pièce active.
      if (e instanceof ApiError && e.status === 409 && e.code === "people.document_exists") return setDuplicate(e.message);
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  async function replaceExisting() {
    if (!file || !existing) return;
    try {
      await replace.mutateAsync({ studentId, documentId: existing.id, file, title: form.title.trim() || undefined, issuedOn: form.issuedOn || undefined, expiresOn: form.expiresOn || undefined });
      onDone(form.title.trim() || file.name, true);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  const apiError = duplicate ? null : (upload.error ?? replace.error);
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={upload.isPending || replace.isPending} error={apiError}>
      <FormField label={t("type")} required error={errors.typeCode}>
        {(c) => <NativeSelect {...c} value={typeCode} onChange={(v) => setTypeCode(v as PeopleStudentDocumentType | "")} placeholder={t("chooseType")} options={PEOPLE_STUDENT_DOCUMENT_TYPES.map((x) => ({ value: x, label: tType(x) }))} />}
      </FormField>
      <FilePicker
        error={fileError ?? errors.fileName}
        onPick={(f) => {
          setFile(f);
          setFileError(f ? fileMessage(checkFile(f)) : null);
        }}
      />
      <MetaFields form={form} set={set} errors={errors} />
      {duplicate ? (
        <Notice kind="warning">
          <p className="font-medium">{duplicate}</p>
          {existing ? (
            <>
              <p className="text-sm">{t("duplicateHint")}</p>
              <button type="button" className={`${buttonClass.primary} mt-2`} disabled={replace.isPending} onClick={() => void replaceExisting()}>
                {t("replaceExisting")}
              </button>
            </>
          ) : null}
        </Notice>
      ) : null}
    </FormDialog>
  );
}

function ReplaceDialog({ studentId, doc, onClose, onDone }: { studentId: string; doc: PeopleStudentDocumentDto; onClose: () => void; onDone: (label: string) => void }) {
  const t = useTranslations("v2StudentDocuments.replaceDialog");
  const tFile = useTranslations("v2StudentDocuments.file");
  const replace = useReplaceStudentDocument();
  const { form, set } = useMetaForm({ title: doc.title ?? "", issuedOn: "", expiresOn: "" });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const fileKey = checkFile(file);
    const title = form.title.trim();
    const query = { fileName: file?.name ?? "", ...(title ? { title } : {}), ...(form.issuedOn ? { issuedOn: form.issuedOn } : {}), ...(form.expiresOn ? { expiresOn: form.expiresOn } : {}) };
    const v = validateWith(peopleReplaceStudentDocumentQuerySchema, query);
    setFileError(fileKey ? tFile(`error.${fileKey}`) : null);
    if (!v.ok || fileKey || !file) return setErrors(v.ok ? {} : v.errors);
    setErrors({});
    try {
      await replace.mutateAsync({ studentId, documentId: doc.id, file, title: v.data.title, issuedOn: v.data.issuedOn, expiresOn: v.data.expiresOn });
      onDone(doc.title ?? doc.fileName);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title", { label: doc.title ?? doc.fileName })} description={t("description", { n: doc.version + 1 })} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={replace.isPending} error={replace.error}>
      <FilePicker
        error={fileError ?? errors.fileName}
        onPick={(f) => {
          setFile(f);
          setFileError(f && checkFile(f) ? tFile(`error.${checkFile(f)}`) : null);
        }}
      />
      <MetaFields form={form} set={set} errors={errors} />
    </FormDialog>
  );
}

function EditDialog({ studentId, doc, onClose, onDone }: { studentId: string; doc: PeopleStudentDocumentDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2StudentDocuments.editDialog");
  const update = useUpdateStudentDocument();
  const initial = { title: doc.title ?? "", issuedOn: doc.issuedOn ?? "", expiresOn: doc.expiresOn ?? "" };
  const { form, set } = useMetaForm(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const changed: Record<string, string> = {};
    (Object.keys(initial) as Array<keyof typeof initial>).forEach((k) => {
      if (form[k].trim() !== initial[k]) changed[k] = form[k].trim();
    });
    if (Object.keys(changed).length === 0) return onClose();
    const v = validateWith(peopleUpdateStudentDocumentBodySchema, nullifyEmpty(changed));
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await update.mutateAsync({ studentId, documentId: doc.id, patch: v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title", { label: doc.title ?? doc.fileName })} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={update.isPending} error={update.error}>
      <MetaFields form={form} set={set} errors={errors} />
    </FormDialog>
  );
}
