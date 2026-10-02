"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { DocumentQuarantineDto } from "@ecoledigitale/contracts/v2/documents";
import { useDeleteQuarantine, useQuarantine, useReleaseQuarantine } from "@/platform/v2/documents";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { formatFileSize } from "@/platform/ui/UploadDropzone";

const STATUSES = ["HELD", "RELEASED", "DELETED", "ALL"] as const;
type Status = (typeof STATUSES)[number];

/**
 * Quarantaine : fichiers détectés infectés, jamais servis. Libérer (faux positif) rejoue le dépôt demandé sur décision MOTIVÉE
 * (audité, authentification forte) ; détruire supprime l'objet. Un fichier non traité est détruit automatiquement après la rétention.
 */
export function QuarantineScreen() {
  const t = useTranslations("v2Documents.quarantine");
  const date = useDateFormat();
  const [status, setStatus] = useState<Status>("HELD");
  const list = useQuarantine(status);
  const release = useReleaseQuarantine();
  const destroy = useDeleteQuarantine();
  const [deciding, setDeciding] = useState<{ item: DocumentQuarantineDto; action: "release" | "delete" } | null>(null);
  const flash = useFlash();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="warning">{t("warning")}</Notice>
      {flash.node}
      <div role="tablist" aria-label={t("tabs")} className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button key={s} type="button" role="tab" id={`q-tab-${s}`} aria-selected={status === s} aria-controls="q-panel" onClick={() => setStatus(s)} className={status === s ? buttonClass.primary : buttonClass.secondary}>
            {t(`status.${s}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="q-panel" aria-labelledby={`q-tab-${status}`} className="space-y-2">
        {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : items.length === 0 ? <EmptyBlock title={t("empty")} /> : (
          <ul aria-label={t("listLabel")} className="space-y-2">
            {items.map((q) => (
              <li key={q.id} className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{q.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(q.sizeBytes)} · {t("by", { name: q.uploadedByName ?? "—" })} · {date.instant(q.createdAt)}
                    </p>
                    <p className="text-xs">
                      <span className="font-medium">{t("signature")}</span> {q.signature} <span className="text-muted-foreground">({q.engine})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{q.intentKind === "CREATE" ? t("intentCreate") : t("intentVersion")}</p>
                  </div>
                  <StatusBadge label={t(`status.${q.status}`)} tone={q.status === "HELD" ? "danger" : q.status === "RELEASED" ? "warning" : "neutral"} />
                </div>
                {q.decisionNote ? <p className="text-xs text-muted-foreground">{t("decision", { note: q.decisionNote })}</p> : null}
                {q.releasedDocumentId ? <Link href={`/v2/documents/${q.releasedDocumentId}`} className="text-xs font-medium underline">{t("openDocument")}</Link> : null}
                {q.status === "HELD" ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setDeciding({ item: q, action: "release" })} aria-label={t("releaseFor", { name: q.fileName })} className={buttonClass.secondary}>{t("release")}</button>
                    <button type="button" onClick={() => setDeciding({ item: q, action: "delete" })} aria-label={t("deleteFor", { name: q.fileName })} className={buttonClass.danger}>{t("delete")}</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage ? <button type="button" onClick={() => void list.fetchNextPage()} className={buttonClass.secondary}>{t("more")}</button> : null}
      </div>
      <ReasonDialog
        open={deciding !== null}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.action === "release" ? t("releaseDialog.title") : t("deleteDialog.title")}
        description={deciding?.action === "release" ? t("releaseDialog.description") : t("deleteDialog.description")}
        reasonLabel={t("reason")}
        confirmLabel={deciding?.action === "release" ? t("releaseDialog.confirm") : t("deleteDialog.confirm")}
        destructive={deciding?.action === "delete"}
        minLength={3}
        isPending={release.isPending || destroy.isPending}
        error={release.error ?? destroy.error}
        onConfirm={(note) => {
          if (!deciding) return;
          const done = () => {
            flash.show(deciding.action === "release" ? t("released", { name: deciding.item.fileName }) : t("deleted", { name: deciding.item.fileName }));
            setDeciding(null);
          };
          if (deciding.action === "release") release.mutate({ id: deciding.item.id, note }, { onSuccess: done });
          else destroy.mutate({ id: deciding.item.id, note }, { onSuccess: done });
        }}
      />
    </div>
  );
}
