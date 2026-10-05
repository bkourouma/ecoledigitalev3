"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarClock, FileText, Image as ImageIcon, Plus, Search } from "lucide-react";
import type { DocumentKind, DocumentSummaryDto } from "@ecoledigitale/contracts/v2/documents";
import { DOCUMENT_KINDS } from "@ecoledigitale/contracts/v2/documents";
import { useDocumentCategories, useDocumentsInfinite, useMyDocumentsContext, usePeopleOptions, type DocumentFilters } from "@/platform/v2/documents";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { formatFileSize } from "@/platform/ui/UploadDropzone";
import { useDebounced } from "@/platform/ui/useDebounced";
import { confidentialityTone, expiryTone } from "./documents-utils";
import { UploadDialog } from "./UploadDialog";

/** Pastille d'échéance : le texte porte le sens (la couleur seule ne suffit jamais). */
export function ExpiryBadge({ doc }: { doc: Pick<DocumentSummaryDto, "expiryState" | "daysToExpiry" | "expiresOn"> }) {
  const t = useTranslations("v2Documents.expiry");
  const date = useDateFormat();
  if (doc.expiryState === "NONE") return null;
  const label =
    doc.expiryState === "EXPIRED"
      ? t("expired", { date: date.civil(doc.expiresOn) })
      : doc.expiryState === "EXPIRING"
        ? t("expiring", { days: doc.daysToExpiry ?? 0 })
        : t("valid", { date: date.civil(doc.expiresOn) });
  return <StatusBadge label={label} tone={expiryTone(doc.expiryState)} />;
}

export function DocumentRow({ doc }: { doc: DocumentSummaryDto }) {
  const t = useTranslations("v2Documents");
  const date = useDateFormat();
  const Icon = doc.previewKind === "IMAGE" ? ImageIcon : FileText;
  return (
    <li>
      <Link href={`/v2/documents/${doc.id}`} className="flex gap-3 rounded-lg border p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-semibold">{doc.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {doc.categoryLabel}
            {doc.ownerName ? ` · ${doc.ownerName}` : ""}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {doc.fileName} · {formatFileSize(doc.sizeBytes)}
            {doc.versionCount > 1 ? ` · ${t("list.versions", { count: doc.versionCount })}` : ""}
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            {doc.confidentiality !== "INTERNAL" ? <StatusBadge label={t(`confidentiality.${doc.confidentiality}`)} tone={confidentialityTone(doc.confidentiality)} /> : null}
            {doc.visibility !== "INHERIT" ? <StatusBadge label={t(`visibility.${doc.visibility}`)} /> : null}
            {doc.status === "ARCHIVED" ? <StatusBadge label={t("status.ARCHIVED")} tone="warning" /> : null}
            <ExpiryBadge doc={doc} />
          </div>
        </div>
        <time className="shrink-0 text-xs text-muted-foreground" dateTime={doc.updatedAt}>
          {date.instant(doc.updatedAt)}
        </time>
      </Link>
    </li>
  );
}

const SCOPES = ["all", "mine", "shared", "child", "self", "own"] as const;

/**
 * Explorateur : recherche (titre, étiquettes, métadonnées, nom du fichier, catégorie, propriétaire), filtres par catégorie, type,
 * propriétaire, portée, échéance et état. Ce qui est listé est ce que l'API autorise : aucun filtre ne fait office de droit.
 */
export function ExplorerScreen() {
  const t = useTranslations("v2Documents");
  const ctx = useMyDocumentsContext();
  const categories = useDocumentCategories();
  const [text, setText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [kind, setKind] = useState("");
  const [scope, setScope] = useState("all");
  const [expiry, setExpiry] = useState("any");
  const [status, setStatus] = useState("ACTIVE");
  const [ownerType, setOwnerType] = useState("");
  const [owner, setOwner] = useState<SelectOption | null>(null);
  const [uploading, setUploading] = useState(false);
  const q = useDebounced(text.trim(), 300);

  const filters: DocumentFilters = useMemo(
    () => ({
      ...(q ? { q } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(kind ? { kind: kind as DocumentKind } : {}),
      ...(scope !== "all" ? { scope: scope as DocumentFilters["scope"] } : {}),
      ...(expiry !== "any" ? { expiry: expiry as DocumentFilters["expiry"] } : {}),
      ...(status !== "ACTIVE" ? { status: status as DocumentFilters["status"] } : {}),
      ...(ownerType ? { ownerType: ownerType as DocumentFilters["ownerType"] } : {}),
      ...(owner ? { ownerId: owner.value } : {}),
    }),
    [q, categoryId, kind, scope, expiry, status, ownerType, owner],
  );
  const list = useDocumentsInfinite(filters);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const caps = ctx.data?.caps;
  const links = ctx.data?.links;
  const canDeposit = Boolean(categories.data?.items.some((c) => c.canUpload));
  const canSearchOwners = Boolean(caps && (caps.upload || caps.manage));
  const scopeOptions = SCOPES.filter((s) => s === "all" || s === "mine" || s === "shared" || (s === "child" && (links?.children.length ?? 0) > 0) || (s === "self" && links?.studentId) || (s === "own" && links?.staffId));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("explorer.title")}
        description={t("explorer.description")}
        actions={
          <>
            <Link href="/v2/documents/search" className={buttonClass.secondary}>
              <Search className="h-4 w-4" aria-hidden="true" />
              {t("explorer.contentSearch")}
            </Link>
            <Link href="/v2/documents/expirations" className={buttonClass.secondary}>
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              {t("explorer.expirations")}
            </Link>
            {canDeposit ? (
              <button type="button" onClick={() => setUploading(true)} className={buttonClass.primary}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("explorer.upload")}
              </button>
            ) : null}
          </>
        }
      />

      <section aria-label={t("explorer.filters")} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t("explorer.search")} className="sm:col-span-2">{(c) => <TextControl {...c} type="search" value={text} onChange={setText} placeholder={t("explorer.searchPlaceholder")} />}</FormField>
        <FormField label={t("explorer.category")}>
          {(c) => <NativeSelect {...c} value={categoryId} placeholder={t("explorer.all")} options={(categories.data?.items ?? []).map((x) => ({ value: x.id, label: x.label }))} onChange={setCategoryId} />}
        </FormField>
        <FormField label={t("explorer.kind")}>
          {(c) => <NativeSelect {...c} value={kind} placeholder={t("explorer.all")} options={DOCUMENT_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))} onChange={setKind} />}
        </FormField>
        <FormField label={t("explorer.scope")}>{(c) => <NativeSelect {...c} value={scope} options={scopeOptions.map((s) => ({ value: s, label: t(`scope.${s}`) }))} onChange={setScope} />}</FormField>
        <FormField label={t("explorer.expiry")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={expiry}
              options={(["any", "expiring", "expired", "dated", "missing"] as const).map((x) => ({ value: x, label: t(`explorer.expiryOptions.${x}`) }))}
              onChange={setExpiry}
            />
          )}
        </FormField>
        {canSearchOwners ? (
          <>
            <FormField label={t("explorer.ownerType")}>
              {(c) => (
                <NativeSelect
                  {...c}
                  value={ownerType}
                  placeholder={t("explorer.all")}
                  options={(["STUDENT", "STAFF", "NONE"] as const).map((x) => ({ value: x, label: t(`ownerType.${x}`) }))}
                  onChange={(v) => {
                    setOwnerType(v);
                    setOwner(null);
                  }}
                />
              )}
            </FormField>
            {ownerType === "STUDENT" || ownerType === "STAFF" ? (
              <FormField label={t("explorer.owner")}>
                {(c) => <SelectAsync {...c} value={owner} onChange={setOwner} useOptions={(s, enabled) => usePeopleOptions(ownerType === "STUDENT" ? "STUDENT" : "STAFF", s, enabled)} placeholder={t("explorer.ownerSearch")} />}
              </FormField>
            ) : null}
          </>
        ) : null}
        {caps?.manage ? (
          <FormField label={t("explorer.status")}>
            {(c) => (
              <NativeSelect
                {...c}
                value={status}
                options={(["ACTIVE", "ARCHIVED", "ALL"] as const).map((x) => ({ value: x, label: t(`explorer.statusOptions.${x}`) }))}
                onChange={setStatus}
              />
            )}
          </FormField>
        ) : null}
      </section>

      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock title={t("explorer.empty")} description={canDeposit ? t("explorer.emptyHint") : undefined} />
      ) : (
        <>
          <ul aria-label={t("explorer.listLabel")} className="space-y-2">
            {items.map((d) => (
              <DocumentRow key={d.id} doc={d} />
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="flex justify-center">
              <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className={buttonClass.secondary}>
                {list.isFetchingNextPage ? t("explorer.loading") : t("explorer.more")}
              </button>
            </div>
          ) : null}
        </>
      )}
      {uploading ? <UploadDialog open={uploading} onOpenChange={setUploading} /> : null}
    </div>
  );
}
