"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Archive, ArrowLeft, Download, Pencil, Share2, Upload, Undo2 } from "lucide-react";
import type { DocumentDetailDto, DocumentVersionDto } from "@ecoledigitale/contracts/v2/documents";
import {
  fetchDownloadUrl,
  useAddVersion,
  useArchiveDocument,
  useDocument,
  useDocumentCategories,
  useDocumentHistory,
  useGuardianUsers,
  useMyDocumentsContext,
  usePeopleOptions,
  useRestoreDocument,
  useShareDocument,
  useUnshareDocument,
  useUpdateDocument,
} from "@/platform/v2/documents";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { formatFileSize, UploadDropzone } from "@/platform/ui/UploadDropzone";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";
import { confidentialityTone, parseTags, startDownload } from "./documents-utils";
import { ExpiryBadge } from "./ExplorerScreen";
import { PreviewPanel } from "./PreviewPanel";

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Téléchargement (URL signée courte, suivie aussitôt)
// ---------------------------------------------------------------------------

function DownloadButton({ documentId, version, label, variant = "secondary" }: { documentId: string; version: DocumentVersionDto; label: string; variant?: "primary" | "secondary" | "ghost" }) {
  const [state, setState] = useState<{ pending: boolean; error: unknown }>({ pending: false, error: null });
  async function run(): Promise<void> {
    setState({ pending: true, error: null });
    try {
      const signed = await fetchDownloadUrl(documentId, version.versionNo);
      startDownload(signed.url, signed.fileName);
      setState({ pending: false, error: null });
    } catch (error) {
      setState({ pending: false, error });
    }
  }
  return (
    <>
      <button type="button" onClick={() => void run()} disabled={state.pending || version.state === "PURGED"} className={buttonClass[variant]}>
        <Download className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>
      {state.error ? <ErrorBlock error={state.error} className="mt-2 w-full" /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modifier les descripteurs
// ---------------------------------------------------------------------------

function EditDialog({ doc, open, onOpenChange, staffLike }: { doc: DocumentDetailDto; open: boolean; onOpenChange: (o: boolean) => void; staffLike: boolean }) {
  const t = useTranslations("v2Documents.edit");
  const categories = useDocumentCategories();
  const mutation = useUpdateDocument(doc.id);
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description ?? "");
  const [tagsText, setTagsText] = useState(doc.tags.join(", "));
  const [expiresOn, setExpiresOn] = useState(doc.expiresOn ?? "");
  const [visibility, setVisibility] = useState(doc.visibility);
  const [categoryId, setCategoryId] = useState(doc.categoryId);
  const errors = apiErrorToFieldErrors(mutation.error);
  const sameKind = (categories.data?.items ?? []).filter((c) => c.kind === doc.kind && (c.canUpload || c.id === doc.categoryId) && c.status === "ACTIVE");

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    mutation.mutate(
      {
        title: title.trim() || doc.title,
        description: description.trim() ? description.trim() : null,
        tags: parseTags(tagsText),
        ...(expiresOn !== (doc.expiresOn ?? "") ? { expiresOn: expiresOn || null } : {}),
        ...(staffLike && visibility !== doc.visibility ? { visibility } : {}),
        ...(categoryId !== doc.categoryId ? { categoryId } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormField label={t("titleLabel")} error={errors.title ?? null}>{(c) => <TextControl {...c} value={title} onChange={setTitle} maxLength={200} />}</FormField>
        <FormField label={t("descriptionLabel")}>{(c) => <TextAreaControl {...c} value={description} onChange={setDescription} maxLength={2000} rows={2} />}</FormField>
        <FormField label={t("tags")} hint={t("tagsHint")}>{(c) => <TextControl {...c} value={tagsText} onChange={setTagsText} />}</FormField>
        <FormField label={t("expiresOn")} error={errors.expiresOn ?? null}>{(c) => <TextControl {...c} type="date" value={expiresOn} onChange={setExpiresOn} />}</FormField>
        {sameKind.length > 1 ? (
          <FormField label={t("category")}>{(c) => <NativeSelect {...c} value={categoryId} options={sameKind.map((x) => ({ value: x.id, label: x.label }))} onChange={setCategoryId} />}</FormField>
        ) : null}
        {staffLike ? (
          <FormField label={t("visibility")} hint={t("visibilityHint")}>
            {(c) => <NativeSelect {...c} value={visibility} options={(["INHERIT", "STAFF_ONLY", "PRIVATE"] as const).map((v) => ({ value: v, label: t(`visibilities.${v}`) }))} onChange={(v) => setVisibility(v as typeof visibility)} />}
          </FormField>
        ) : null}
        {mutation.isError ? <ErrorBlock error={mutation.error} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className={buttonClass.secondary}>{t("cancel")}</button>
          <button type="submit" disabled={mutation.isPending} className={buttonClass.primary}>{mutation.isPending ? t("saving") : t("save")}</button>
        </div>
      </form>
    </ModalDialog>
  );
}

// ---------------------------------------------------------------------------
// Nouvelle version
// ---------------------------------------------------------------------------

function VersionDialog({ doc, open, onOpenChange }: { doc: DocumentDetailDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Documents.newVersion");
  const categories = useDocumentCategories();
  const ctx = useMyDocumentsContext();
  const category = categories.data?.items.find((c) => c.id === doc.categoryId);
  const mutation = useAddVersion(doc.id);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  const needsExpiry = Boolean(category?.requiresExpiry);
  const missingFile = submitted && !file;
  const missingExpiry = submitted && needsExpiry && !expiresOn && (doc.expiryState === "EXPIRED" || doc.expiresOn === null);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmitted(true);
    if (!file || (needsExpiry && !expiresOn && (doc.expiryState === "EXPIRED" || doc.expiresOn === null))) return;
    mutation.mutate({ file, ...(note.trim() ? { note } : {}), ...(expiresOn ? { expiresOn } : {}), baseVersion: doc.currentVersionNo }, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description", { version: doc.currentVersionNo + 1 })}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("file")}<span className="sr-only"> ({t("required")})</span></p>
          <UploadDropzone
            onFile={setFile}
            extensions={category?.allowedExtensions}
            maxBytes={Math.min(category?.maxBytes ?? ctx.data?.upload.defaultMaxBytes ?? 15 * 1024 * 1024, ctx.data?.upload.hardMaxBytes ?? 50 * 1024 * 1024)}
            busy={mutation.isPending}
            selectedName={file?.name ?? null}
          />
          {missingFile ? <p role="alert" className="text-xs font-medium text-destructive">{t("errors.file")}</p> : null}
        </div>
        <FormField label={t("note")} hint={t("noteHint")}>{(c) => <TextControl {...c} value={note} onChange={setNote} maxLength={500} />}</FormField>
        <FormField label={t("expiresOn")} required={needsExpiry} hint={needsExpiry ? t("expiryRequired") : t("expiryOptional")} error={missingExpiry ? t("errors.expiry") : (errors.expiresOn ?? null)}>
          {(c) => <TextControl {...c} type="date" value={expiresOn} onChange={setExpiresOn} />}
        </FormField>
        {mutation.isError ? <ErrorBlock error={mutation.error} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className={buttonClass.secondary}>{t("cancel")}</button>
          <button type="submit" disabled={mutation.isPending} className={buttonClass.primary}>{mutation.isPending ? t("submitting") : t("submit")}</button>
        </div>
      </form>
    </ModalDialog>
  );
}

// ---------------------------------------------------------------------------
// Partages
// ---------------------------------------------------------------------------

function SharesSection({ doc }: { doc: DocumentDetailDto }) {
  const t = useTranslations("v2Documents.shares");
  const date = useDateFormat();
  const share = useShareDocument(doc.id);
  const unshare = useUnshareDocument(doc.id);
  const guardians = useGuardianUsers(doc.ownerType === "STUDENT" ? doc.ownerId : null);
  const [person, setPerson] = useState<SelectOption | null>(null);
  const [level, setLevel] = useState<"READ" | "WRITE">("READ");
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const flash = useFlash();
  const shares = doc.shares ?? [];
  const active = shares.filter((s) => s.active);

  function send(userId: string, name: string): void {
    share.mutate(
      { userId, level, ...(until ? { expiresAt: new Date(`${until}T23:59:59`).toISOString() } : {}), ...(note.trim() ? { note } : {}) },
      { onSuccess: () => { flash.show(t("shared", { name })); setPerson(null); setNote(""); setUntil(""); } },
    );
  }

  return (
    <section aria-labelledby="shares-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="shares-title" className="flex items-center gap-2 text-base font-semibold">
        <Share2 className="h-4 w-4" aria-hidden="true" />
        {t("title")}
      </h2>
      {flash.node}
      {active.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : (
        <ul aria-label={t("listLabel")} className="space-y-2">
          {active.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{s.userName ?? t("unknownPerson")}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`levels.${s.level}`)} · {s.expiresAt ? t("until", { date: date.instant(s.expiresAt) }) : t("noEnd")}
                  {s.note ? ` · ${s.note}` : ""}
                </p>
              </div>
              <button type="button" disabled={unshare.isPending} onClick={() => unshare.mutate(s.id)} aria-label={t("removeFor", { name: s.userName ?? t("unknownPerson") })} className={buttonClass.ghost}>
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {unshare.isError ? <ErrorBlock error={unshare.error} /> : null}
      <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
        <FormField label={t("person")} className="sm:col-span-2">
          {(c) => <SelectAsync {...c} value={person} onChange={setPerson} useOptions={(s, enabled) => usePeopleOptions("USER", s, enabled)} placeholder={t("personSearch")} />}
        </FormField>
        <FormField label={t("level")}>
          {(c) => <NativeSelect {...c} value={level} options={(["READ", "WRITE"] as const).map((l) => ({ value: l, label: t(`levels.${l}`) }))} onChange={(v) => setLevel(v as typeof level)} />}
        </FormField>
        <FormField label={t("endDate")} hint={t("endDateHint")}>{(c) => <TextControl {...c} type="date" value={until} onChange={setUntil} />}</FormField>
        <FormField label={t("note")} className="sm:col-span-2">{(c) => <TextControl {...c} value={note} onChange={setNote} maxLength={500} />}</FormField>
        <div className="sm:col-span-2">
          <button type="button" disabled={!person || share.isPending} onClick={() => person && send(person.value, person.label)} className={buttonClass.primary}>
            {share.isPending ? t("sharing") : t("share")}
          </button>
        </div>
      </div>
      {guardians.data && guardians.data.items.length > 0 ? (
        <div className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-medium">{t("guardians")}</h3>
          <ul className="space-y-1">
            {guardians.data.items.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{g.displayName}</span>
                <button type="button" disabled={share.isPending} onClick={() => send(g.id, g.displayName)} aria-label={t("shareWith", { name: g.displayName })} className={buttonClass.secondary}>
                  {t("share")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {share.isError ? <ErrorBlock error={share.error} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

function HistorySection({ documentId }: { documentId: string }) {
  const t = useTranslations("v2Documents.history");
  const date = useDateFormat();
  const history = useDocumentHistory(documentId);
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-labelledby="history-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="history-title" className="text-base font-semibold">{t("title")}</h2>
      {history.isPending ? <LoadingBlock /> : history.isError ? <ErrorBlock error={history.error} onRetry={() => void history.refetch()} /> : items.length === 0 ? <EmptyBlock title={t("empty")} /> : (
        <ol aria-label={t("title")} className="space-y-1.5 text-sm">
          {items.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2">
              <time dateTime={e.occurredAt} className="text-muted-foreground">{date.instant(e.occurredAt)}</time>
              <span className="font-medium">{t(`actions.${e.action}`)}</span>
              {e.versionNo ? <span className="text-muted-foreground">{t("version", { version: e.versionNo })}</span> : null}
              <span className="text-muted-foreground">{e.actorName ? t("by", { name: e.actorName }) : t("system")}</span>
            </li>
          ))}
        </ol>
      )}
      {history.hasNextPage ? <button type="button" onClick={() => void history.fetchNextPage()} className={buttonClass.secondary}>{t("more")}</button> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Écran
// ---------------------------------------------------------------------------

/** Détail d'un document : descripteurs, versions (historique complet), prévisualisation, téléchargement, partages, historique. */
export function DocumentDetailScreen({ documentId }: { documentId: string }) {
  const t = useTranslations("v2Documents");
  const date = useDateFormat();
  const query = useDocument(documentId);
  const ctx = useMyDocumentsContext();
  const archive = useArchiveDocument(documentId);
  const restore = useRestoreDocument(documentId);
  // Version dont l'aperçu est demandé (aucune requête tant que l'utilisateur n'a pas cliqué : chaque aperçu est un accès journalisé).
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const flash = useFlash();

  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  const doc = query.data;
  const current = doc.versions.find((v) => v.current) ?? doc.versions[0]!;
  const shown = previewing === null ? null : (doc.versions.find((v) => v.versionNo === previewing) ?? null);
  const staffLike = Boolean(ctx.data?.caps.upload || ctx.data?.caps.manage);
  const manager = Boolean(ctx.data?.caps.manage);
  const archived = doc.status === "ARCHIVED";

  return (
    <div className="space-y-5">
      <Link href="/v2/documents" className={`${buttonClass.ghost} -ml-3`}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("detail.back")}
      </Link>
      <PageHeader
        title={doc.title}
        description={doc.description ?? undefined}
        actions={
          <>
            <DownloadButton documentId={doc.id} version={current} label={t("detail.download")} variant="primary" />
            {doc.access.write && !archived ? (
              <button type="button" onClick={() => setVersioning(true)} className={buttonClass.secondary}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                {t("detail.newVersion")}
              </button>
            ) : null}
            {doc.access.write && !archived ? (
              <button type="button" onClick={() => setEditing(true)} className={buttonClass.secondary}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {t("detail.edit")}
              </button>
            ) : null}
            {doc.access.archive && !archived ? (
              <button type="button" onClick={() => setArchiving(true)} className={buttonClass.secondary}>
                <Archive className="h-4 w-4" aria-hidden="true" />
                {t("detail.archive")}
              </button>
            ) : null}
            {manager && archived ? (
              <button type="button" disabled={restore.isPending} onClick={() => restore.mutate(undefined, { onSuccess: () => flash.show(t("detail.restored")) })} className={buttonClass.secondary}>
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                {t("detail.restore")}
              </button>
            ) : null}
          </>
        }
      />
      {flash.node}
      {restore.isError ? <ErrorBlock error={restore.error} /> : null}
      {archive.isSuccess ? <Notice kind="success">{t("detail.archived")}</Notice> : null}
      {archived ? <Notice kind="warning">{t("detail.archivedNotice", { reason: doc.archiveReason ?? "" })}</Notice> : null}

      <div className="flex flex-wrap gap-1.5">
        <StatusBadge label={t(`kind.${doc.kind}`)} />
        <StatusBadge label={t(`confidentiality.${doc.confidentiality}`)} tone={confidentialityTone(doc.confidentiality)} />
        {doc.visibility !== "INHERIT" ? <StatusBadge label={t(`visibility.${doc.visibility}`)} /> : null}
        <ExpiryBadge doc={doc} />
        {doc.textIndex ? <StatusBadge label={t(`textIndex.status.${doc.textIndex.status}`)} tone={doc.textIndex.status === "INDEXED" ? "success" : doc.textIndex.status === "FAILED" ? "danger" : "warning"} /> : null}
      </div>
      {doc.textIndex?.status === "NO_TEXT" ? <Notice kind="info">{t("textIndex.noTextHint")}</Notice> : null}
      {doc.textIndex?.status === "INDEXED" && doc.textIndex.truncated ? <Notice kind="info">{t("textIndex.truncatedHint", { read: doc.textIndex.pagesIndexed ?? 0, total: doc.textIndex.pageCount ?? 0 })}</Notice> : null}
      {doc.textIndex?.status === "FAILED" ? <Notice kind="warning">{t("textIndex.failedHint", { cause: doc.textIndex.errorCode && t.has(`textIndex.errors.${doc.textIndex.errorCode}`) ? t(`textIndex.errors.${doc.textIndex.errorCode}`) : (doc.textIndex.errorCode ?? "") })}</Notice> : null}

      <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Meta label={t("detail.category")}>{doc.categoryLabel}</Meta>
        <Meta label={t("detail.owner")}>{doc.ownerName ?? t("ownerType.NONE")}</Meta>
        <Meta label={t("detail.uploadedBy")}>{doc.createdByName ?? "—"}</Meta>
        <Meta label={t("detail.expiresOn")}>{doc.expiresOn ? date.civil(doc.expiresOn) : t("detail.noExpiry")}</Meta>
        <Meta label={t("detail.file")}>
          {current.fileName} · {formatFileSize(current.sizeBytes)}
        </Meta>
        <Meta label={t("detail.updatedAt")}>{date.instant(doc.updatedAt)}</Meta>
        <Meta label={t("detail.tags")}>{doc.tags.length > 0 ? doc.tags.join(", ") : "—"}</Meta>
        {Object.entries(doc.metadata).map(([k, v]) => (
          <Meta key={k} label={k}>{String(v)}</Meta>
        ))}
        <Meta label={t("detail.integrity")}>
          <code className="break-all text-xs">{current.sha256}</code>
        </Meta>
      </dl>

      <section aria-labelledby="versions-title" className="space-y-3 rounded-lg border p-4">
        <h2 id="versions-title" className="text-base font-semibold">{t("versions.title", { count: doc.versions.length })}</h2>
        <ol aria-label={t("versions.title", { count: doc.versions.length })} className="space-y-2">
          {doc.versions.map((v) => (
            <li key={v.versionNo} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {t("versions.version", { version: v.versionNo })}
                  {v.current ? ` · ${t("versions.current")}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {v.fileName} · {formatFileSize(v.sizeBytes)} · {date.instant(v.createdAt)}
                  {v.uploadedByName ? ` · ${v.uploadedByName}` : ""}
                </p>
                {v.note ? <p className="text-xs">{v.note}</p> : null}
                <div className="flex gap-1 pt-1">
                  {v.scanStatus === "UNSCANNED" ? <StatusBadge label={t("versions.unscanned")} tone="warning" /> : <StatusBadge label={t("versions.clean")} tone="success" />}
                  {v.state === "PURGED" ? <StatusBadge label={t("versions.purged")} /> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={previewing === v.versionNo} onClick={() => setPreviewing(v.versionNo)} className={buttonClass.ghost}>
                  {t("versions.select", { version: v.versionNo })}
                </button>
                <DownloadButton documentId={doc.id} version={v} label={t("versions.download", { version: v.versionNo })} variant="ghost" />
              </div>
            </li>
          ))}
        </ol>
        {shown ? <PreviewPanel documentId={doc.id} version={shown} /> : null}
      </section>

      {doc.shares !== null && !archived ? <SharesSection doc={doc} /> : null}
      {doc.access.history ? <HistorySection documentId={doc.id} /> : null}

      {editing ? <EditDialog doc={doc} open={editing} onOpenChange={setEditing} staffLike={staffLike} /> : null}
      {versioning ? <VersionDialog doc={doc} open={versioning} onOpenChange={setVersioning} /> : null}
      <ReasonDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("archiveDialog.title")}
        description={t("archiveDialog.description")}
        reasonLabel={t("archiveDialog.reason")}
        confirmLabel={t("archiveDialog.confirm")}
        destructive
        minLength={3}
        isPending={archive.isPending}
        error={archive.error}
        onConfirm={(reason) => archive.mutate({ reason }, { onSuccess: () => setArchiving(false) })}
      />
    </div>
  );
}

