"use client";

import { useId, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DocumentKind, DocumentOwnerType, DocumentSummaryDto } from "@ecoledigitale/contracts/v2/documents";
import { useDocumentCategories, useDocumentsInfinite, useUploadDocument } from "@/platform/v2/documents";
import { buttonClass } from "./PageHeader";
import { FormField, TextControl } from "./FormField";
import { ModalDialog } from "./ModalDialog";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "./states";
import { formatFileSize, UploadDropzone } from "./UploadDropzone";
import { useDebounced } from "./useDebounced";

/** Ce que l'écran appelant retient d'un document choisi : son identifiant (le seul lien durable) et de quoi l'afficher. */
export interface DocumentRef {
  id: string;
  title: string;
  fileName: string;
}

export interface DocumentPickerProps {
  value: DocumentRef | null;
  onChange: (value: DocumentRef | null) => void;
  /** Nom du champ (libellé visible, relié au bouton). */
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Restreint la liste proposée (la visibilité réelle reste décidée par l'API). */
  filter?: { kind?: DocumentKind; categoryId?: string; ownerType?: DocumentOwnerType; ownerId?: string };
  /** Autorise le dépôt d'un NOUVEAU document depuis le sélecteur : catégorie et propriétaire sont imposés par l'écran appelant. */
  upload?: { categoryId: string; ownerType: DocumentOwnerType; ownerId?: string | null; defaultTitle?: string };
}

const toRef = (d: Pick<DocumentSummaryDto, "id" | "title" | "fileName">): DocumentRef => ({ id: d.id, title: d.title, fileName: d.fileName });

/**
 * Sélecteur de document réutilisable pour les autres écrans (fiche élève, justificatif d'absence, contrat…) : choisir un document
 * existant (recherche, filtres imposés par l'écran) ou en déposer un nouveau (glisser-déposer ou sélecteur de fichier, tous deux
 * accessibles au clavier). Il ne décide d'aucun droit : la liste et le dépôt sont ceux de l'API (`/api/v1/documents`).
 */
export function DocumentPicker({ value, onChange, label, hint, error, required, disabled, filter, upload }: DocumentPickerProps) {
  const t = useTranslations("v2DocumentsUi.picker");
  const generated = useId();
  const [open, setOpen] = useState(false);
  const labelId = `dp-label-${generated}`;
  const hintId = hint ? `dp-hint-${generated}` : undefined;
  const errorId = error ? `dp-error-${generated}` : undefined;
  return (
    // Groupe nommé par son libellé : les boutons gardent leur propre nom (« Choisir un document », « Retirer… »).
    <div role="group" aria-labelledby={labelId} aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined} className="space-y-1.5">
      <span id={labelId} className="block text-sm font-medium leading-none">
        {label}
        {required ? <span className="sr-only"> ({t("required")})</span> : null}
      </span>
      {value ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm" data-testid="picker-selection">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{value.title}</p>
            <p className="truncate text-xs text-muted-foreground">{value.fileName}</p>
          </div>
          <button type="button" disabled={disabled} onClick={() => onChange(null)} aria-label={t("remove", { title: value.title })} className={buttonClass.ghost}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} aria-haspopup="dialog" className={buttonClass.secondary}>
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {value ? t("change") : t("choose")}
      </button>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {open ? (
        <PickerDialog
          open={open}
          onOpenChange={setOpen}
          filter={filter}
          upload={upload}
          onPick={(doc) => {
            onChange(toRef(doc));
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function PickerDialog({ open, onOpenChange, filter, upload, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; filter: DocumentPickerProps["filter"]; upload: DocumentPickerProps["upload"]; onPick: (doc: Pick<DocumentSummaryDto, "id" | "title" | "fileName">) => void }) {
  const t = useTranslations("v2DocumentsUi.picker");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const list = useDocumentsInfinite({ ...(q ? { q } : {}), ...(filter ?? {}), status: "ACTIVE", sort: "updatedAt", dir: "desc" });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <ModalDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")}>
      <div className="space-y-5">
        <section aria-labelledby="picker-existing" className="space-y-3">
          <h3 id="picker-existing" className="text-sm font-semibold">
            {t("existing")}
          </h3>
          <FormField label={t("search")}>{(c) => <TextControl {...c} type="search" value={text} onChange={setText} placeholder={t("searchPlaceholder")} />}</FormField>
          {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : items.length === 0 ? <EmptyBlock title={t("none")} /> : (
            <ul role="listbox" aria-label={t("existing")} className="max-h-64 space-y-1 overflow-y-auto">
              {items.map((d) => (
                <li key={d.id} role="presentation">
                  <button type="button" role="option" aria-selected="false" onClick={() => onPick(d)} className="flex w-full flex-col items-start rounded-md border p-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="font-medium">{d.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.categoryLabel} · {d.fileName} · {formatFileSize(d.sizeBytes)}
                      {d.ownerName ? ` · ${d.ownerName}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.hasNextPage ? (
            <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className={buttonClass.secondary}>
              {t("more")}
            </button>
          ) : null}
        </section>
        {upload ? <UploadNew upload={upload} onDone={onPick} /> : null}
      </div>
    </ModalDialog>
  );
}

function UploadNew({ upload, onDone }: { upload: NonNullable<DocumentPickerProps["upload"]>; onDone: (doc: Pick<DocumentSummaryDto, "id" | "title" | "fileName">) => void }) {
  const t = useTranslations("v2DocumentsUi.picker");
  const categories = useDocumentCategories();
  const category = categories.data?.items.find((c) => c.id === upload.categoryId);
  const mutation = useUploadDocument();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(upload.defaultTitle ?? "");
  const allowed = category?.canUpload !== false;
  const effectiveTitle = title.trim() || (file ? file.name.replace(/\.[^.]+$/, "") : "");

  function submit(): void {
    if (!file || !effectiveTitle) return;
    mutation.mutate(
      { fields: { categoryId: upload.categoryId, title: effectiveTitle, ownerType: upload.ownerType, ownerId: upload.ownerId ?? null }, file },
      { onSuccess: (doc) => onDone({ id: doc.id, title: doc.title, fileName: doc.fileName }) },
    );
  }

  return (
    <section aria-labelledby="picker-upload" className="space-y-3 border-t pt-4">
      <h3 id="picker-upload" className="text-sm font-semibold">
        {t("uploadNew")}
      </h3>
      {!allowed ? <Notice kind="info">{t("cannotUpload")}</Notice> : null}
      <FormField label={t("titleLabel")} hint={t("titleHint")}>{(c) => <TextControl {...c} value={title} onChange={setTitle} maxLength={200} disabled={!allowed} />}</FormField>
      <UploadDropzone
        onFile={(f) => setFile(f)}
        extensions={category?.allowedExtensions}
        maxBytes={category?.maxBytes ?? undefined}
        busy={mutation.isPending}
        disabled={!allowed}
        selectedName={file?.name ?? null}
      />
      {mutation.isError ? <ErrorBlock error={mutation.error} /> : null}
      <button type="button" disabled={!file || !effectiveTitle || mutation.isPending || !allowed} onClick={submit} className={buttonClass.primary}>
        {mutation.isPending ? t("uploading") : t("uploadAndSelect")}
      </button>
    </section>
  );
}
