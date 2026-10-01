"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { EmptyState, LoadingState, PageHeader, StatusBadge, type StatusTone } from "@ecoledigitale/ui";
import type { AuditLogEntryDto } from "@ecoledigitale/contracts/v2/audit";
import { ApiErrorState, useDateTime } from "../common";
import { useAuditEntry } from "./hooks";
import { countByKind, diffRows, displayPath, formatDiffValue, isMasked, type DiffKind, type DiffRow } from "./diff";
import { ApiError } from "@/platform/api/errors";

const KIND_TONE: Record<DiffKind, StatusTone> = { added: "success", removed: "danger", changed: "warning" };
const SEVERITY_TONE = { info: "neutral", notice: "info", warning: "warning", critical: "danger" } as const;

/** Valeur d'un côté du diff : texte brut préformaté ; valeur masquée = libellé explicite, jamais le contenu. */
function DiffValue({ present, value }: { present: boolean; value: unknown }) {
  const t = useTranslations("audit.detail");
  if (!present) return <span className="text-muted-foreground">{t("emptyValue")}</span>;
  if (isMasked(value)) return <span className="italic text-muted-foreground">{t("masked")}</span>;
  return <pre className="whitespace-pre-wrap break-words font-mono text-xs">{formatDiffValue(value)}</pre>;
}

export function DiffTable({ rows }: { rows: readonly DiffRow[] }) {
  const t = useTranslations("audit.detail");
  const counts = countByKind(rows);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("added")} : {counts.added} · {t("changed")} : {counts.changed} · {t("removed")} : {counts.removed}
      </p>
      <ul aria-label={t("diffCaption")} className="space-y-3">
        {rows.map((row) => (
          <li key={row.path} className="rounded-lg border p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone={KIND_TONE[row.kind]}>{t(row.kind)}</StatusBadge>
              <code className="break-all text-sm font-medium">{displayPath(row.path)}</code>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md bg-red-50 p-2">
                <p className="mb-1 text-xs font-medium text-red-900">{t("before")}</p>
                <DiffValue present={row.hasFrom} value={row.from} />
              </div>
              <div className="rounded-md bg-green-50 p-2">
                <p className="mb-1 text-xs font-medium text-green-900">{t("after")}</p>
                <DiffValue present={row.hasTo} value={row.to} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-3">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm sm:col-span-2">{children}</dd>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{formatDiffValue(value)}</pre>
    </details>
  );
}

export function AuditEntryView({ entry }: { entry: AuditLogEntryDto }) {
  const t = useTranslations("audit.detail");
  const tSeverity = useTranslations("audit.severity");
  const tActor = useTranslations("audit.actorType");
  const dateTime = useDateTime();
  const rows = diffRows(entry.diff);
  const dash = "—";

  return (
    <div className="space-y-6">
      <section aria-labelledby="audit-general" className="rounded-lg border p-4">
        <h2 id="audit-general" className="mb-2 text-base font-semibold">
          {t("general")}
        </h2>
        <dl className="divide-y">
          <Row label={t("action")}>
            <span className="font-mono">{entry.action}</span> <StatusBadge tone={SEVERITY_TONE[entry.severity]}>{tSeverity(entry.severity)}</StatusBadge>
          </Row>
          <Row label={t("occurredAt")}>
            <time dateTime={entry.occurredAt}>{dateTime(entry.occurredAt, "long")}</time>
          </Row>
          <Row label={t("recordedAt")}>
            <time dateTime={entry.recordedAt}>{dateTime(entry.recordedAt, "long")}</time>
          </Row>
          <Row label={t("sequence")}>{entry.seq}</Row>
          <Row label={t("entity")}>{entry.entity}</Row>
          <Row label={t("entityId")}>{entry.entityId ?? dash}</Row>
          <Row label={t("actor")}>
            {tActor(entry.actorType)}
            {entry.actorId ? <span className="block break-all text-xs text-muted-foreground">{entry.actorId}</span> : null}
          </Row>
          {entry.impersonatedBy ? <Row label={t("impersonatedBy")}>{entry.impersonatedBy}</Row> : null}
          {entry.reason ? <Row label={t("reason")}>{entry.reason}</Row> : null}
          <Row label={t("request")}>{entry.requestId ?? dash}</Row>
          <Row label={t("ip")}>{entry.ip ?? dash}</Row>
          <Row label={t("device")}>{entry.device ?? dash}</Row>
          {entry.userAgent ? <Row label={t("userAgent")}>{entry.userAgent}</Row> : null}
        </dl>
      </section>

      <section aria-labelledby="audit-changes" className="space-y-3">
        <h2 id="audit-changes" className="text-base font-semibold">
          {t("changes")}
        </h2>
        {rows.length > 0 ? <DiffTable rows={rows} /> : <EmptyState title={t("noChanges")} />}
        <JsonBlock label={t("rawBefore")} value={entry.before} />
        <JsonBlock label={t("rawAfter")} value={entry.after} />
        <JsonBlock label={t("metadata")} value={entry.metadata} />
      </section>

      <section aria-labelledby="audit-integrity" className="rounded-lg border p-4">
        <h2 id="audit-integrity" className="mb-2 text-base font-semibold">
          {t("hash")}
        </h2>
        <dl className="divide-y">
          <Row label={t("hashAlg")}>{entry.hashAlg}</Row>
          <Row label={t("hash")}>
            <code className="break-all text-xs">{entry.hash}</code>
          </Row>
          <Row label={t("prevHash")}>
            <code className="break-all text-xs">{entry.prevHash}</code>
          </Row>
        </dl>
      </section>
    </div>
  );
}

export function AuditDetailPage({ id }: { id: string }) {
  const t = useTranslations("audit.detail");
  const tu = useTranslations("ui");
  const query = useAuditEntry(id);

  return (
    <div className="space-y-4">
      <Link
        href="/v2/audit"
        className="inline-flex min-h-11 items-center gap-1 text-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <PageHeader title={t("title")} />
      {query.isPending ? <LoadingState label={tu("loading")} rows={4} /> : null}
      {query.isError ? (
        query.error instanceof ApiError && query.error.isNotFound ? (
          <EmptyState title={t("notFound")} />
        ) : (
          <ApiErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : null}
      {query.data ? <AuditEntryView entry={query.data} /> : null}
    </div>
  );
}
