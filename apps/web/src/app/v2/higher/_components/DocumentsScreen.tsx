"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { HIGHER_DOCUMENT_KINDS, HIGHER_DOCUMENT_STATUSES, type HigherDocumentDto } from "@ecoledigitale/contracts/v2/higher";
import { usePermission } from "@/platform/access";
import { useDocument, useDocuments, usePublishDocument, useRevokeDocument } from "@/platform/v2/higher";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, QueryBoundary, useFlash } from "@/platform/ui/states";
import { shortHash } from "../../results/_components/shared";
import { toneOfStatus } from "../../assessments/_components/shared";
import { StudentName } from "./shared";

/** Documents officiels émis (diplômes, attestations) : états, scellement, publication, révocation. Les PDF sont produits par le module bulletins. */
export function DocumentsScreen() {
  const t = useTranslations("v2Higher.documents");
  const tKind = useTranslations("v2Higher.documentKind");
  const tStatus = useTranslations("v2Higher.documentStatus");
  const tRender = useTranslations("v2Reportcards.renderStatus");
  const date = useDateFormat();
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const query = useDocuments({ kind, status });
  const publish = usePublishDocument();
  const revoke = useRevokeDocument();
  const canIssue = usePermission("higher.document.issue");
  const canRevoke = usePermission("higher.award.revoke");
  const [revoking, setRevoking] = useState<HigherDocumentDto | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const flash = useFlash();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  async function doPublish(d: HigherDocumentDto) {
    setActionError(null);
    try {
      await publish.mutateAsync({ id: d.id });
      flash.show(t("published", { reference: d.reference }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("filters")} onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("kind")}>
          {(c) => <NativeSelect {...c} value={kind} onChange={setKind} placeholder={t("allKinds")} options={HIGHER_DOCUMENT_KINDS.map((k) => ({ value: k, label: tKind(k) }))} />}
        </FormField>
        <FormField label={t("status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("allStatuses")} options={HIGHER_DOCUMENT_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
      </form>
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && !query.isError && items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      {items.length > 0 ? (
        <div role="region" aria-label={t("tableCaption")} tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("columns.document")}</th>
                <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("columns.student")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.state")}</th>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">{t("columns.issued")}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">{t("columns.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-t align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {tKind(d.documentKind)}
                    <span className="block font-mono text-xs font-normal text-muted-foreground">
                      {d.reference} · {t("version", { n: d.version })}
                    </span>
                  </th>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <StudentName studentId={d.studentId} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      <StatusBadge label={tStatus(d.status)} tone={toneOfStatus(d.status)} />
                      <StatusBadge label={d.publishedAt ? t("publishedBadge") : t("unpublished")} tone={d.publishedAt ? "success" : "neutral"} />
                      <StatusBadge label={d.sealed ? t("sealed") : t("notSealed")} tone={d.sealed ? "success" : "warning"} />
                      <StatusBadge label={tRender(d.renderStatus)} tone={toneOfStatus(d.renderStatus)} />
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    {date.instant(d.issuedAt)}
                    <span className="block text-xs text-muted-foreground">{d.issuedByName}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="flex flex-wrap justify-end gap-1">
                      <button type="button" className={buttonClass.ghost} onClick={() => setDetail(d.id)} aria-label={t("detailOf", { reference: d.reference })}>
                        {t("detail")}
                      </button>
                      {d.status === "ISSUED" && !d.publishedAt && canIssue.allowed ? (
                        <button type="button" className={buttonClass.secondary} onClick={() => void doPublish(d)} disabled={publish.isPending} aria-label={t("publishOf", { reference: d.reference })}>
                          {t("publish")}
                        </button>
                      ) : null}
                      {d.status === "ISSUED" && canRevoke.allowed ? (
                        <button type="button" className={buttonClass.danger} onClick={() => setRevoking(d)} aria-label={t("revokeOf", { reference: d.reference })}>
                          {t("revoke")}
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {query.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {t("more")}
          </button>
        </div>
      ) : null}
      {detail ? <DetailDialog id={detail} onClose={() => setDetail(null)} /> : null}
      {revoking ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setRevoking(null)}
          title={t("revokeTitle", { reference: revoking.reference })}
          description={t("revokeDescription")}
          reasonLabel={t("revokeReason")}
          minLength={10}
          maxLength={1000}
          confirmLabel={t("revoke")}
          destructive
          isPending={revoke.isPending}
          error={revoke.error}
          onConfirm={async (reason) => {
            try {
              await revoke.mutateAsync({ id: revoking.id, reason });
              flash.show(t("revoked", { reference: revoking.reference }));
              setRevoking(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </div>
  );
}

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations("v2Higher.documents");
  const query = useDocument(id);
  const d = query.data;
  return (
    <ModalDialog open onOpenChange={(o) => !o && onClose()} title={t("detailTitle")} className="sm:max-w-2xl">
      <QueryBoundary query={query}>
        {d ? (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("reference")}</dt>
              <dd className="font-mono">{d.reference}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("verificationCode")}</dt>
              <dd className="font-mono">{d.verificationCode}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("hash")}</dt>
              <dd className="font-mono text-xs" title={d.snapshotHash}>
                {shortHash(d.snapshotHash)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("verifyPage")}</dt>
              <dd>
                <Link href={`/v2/verify/${d.verificationCode}`} className="text-primary underline-offset-4 hover:underline">
                  {t("openVerify")}
                </Link>
              </dd>
            </div>
            {d.revokeReason ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("revokedReason")}</dt>
                <dd>{d.revokeReason}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("snapshot")}</dt>
              <dd>
                <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(d.snapshot, null, 2)}</pre>
              </dd>
            </div>
          </dl>
        ) : null}
      </QueryBoundary>
    </ModalDialog>
  );
}
