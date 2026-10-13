"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, Paperclip } from "lucide-react";
import { fetchAttachmentUrl, useAcknowledgeAnnouncement, useAnnouncement, useAnnouncementReceipts, useDeleteAnnouncementDraft, useMarkAnnouncementRead, usePublishAnnouncement, useWithdrawAnnouncement } from "@/platform/v2/messaging";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { formatBytes, priorityTone } from "../../messages/_components/messaging-utils";
import { AntSelect } from "@/platform/ui/FormField";

const RECEIPT_STATES = ["all", "unread", "read", "acknowledged", "pending_ack"] as const;

function Receipts({ id }: { id: string }) {
  const t = useTranslations("v2MessagingAnnouncements");
  const date = useDateFormat();
  const [state, setState] = useState<(typeof RECEIPT_STATES)[number]>("all");
  const receipts = useAnnouncementReceipts(id, state);
  const items = receipts.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-labelledby="receipts-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="receipts-title" className="text-lg font-semibold">
          {t("receipts.title")}
        </h2>
        <label className="inline-flex items-center gap-2 text-sm">
          {t("receipts.filter")}
          <AntSelect value={state} onChange={(e) => setState(e.target.value as typeof state)} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
            {RECEIPT_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`receipts.states.${s}`)}
              </option>
            ))}
          </AntSelect>
        </label>
      </div>
      {receipts.isPending ? (
        <LoadingBlock />
      ) : receipts.isError ? (
        <ErrorBlock error={receipts.error} onRetry={() => void receipts.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock title={t("receipts.none")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("receipts.title")}</caption>
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("receipts.person")}</th>
                <th scope="col" className="px-3 py-2">{t("receipts.delivered")}</th>
                <th scope="col" className="px-3 py-2">{t("receipts.read")}</th>
                <th scope="col" className="px-3 py-2">{t("receipts.acknowledged")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((r) => (
                <tr key={r.userId}>
                  <th scope="row" className="px-3 py-2 font-medium">{r.displayName ?? r.userId.slice(0, 8)}</th>
                  <td className="px-3 py-2">{date.instant(r.deliveredAt)}</td>
                  <td className="px-3 py-2">{r.readAt ? date.instant(r.readAt) : "—"}</td>
                  <td className="px-3 py-2">{r.acknowledgedAt ? date.instant(r.acknowledgedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {receipts.hasNextPage ? (
        <button type="button" className={buttonClass.secondary} onClick={() => void receipts.fetchNextPage()}>
          {t("loadMore")}
        </button>
      ) : null}
    </section>
  );
}

/** Lecture d'une annonce (lue à l'ouverture, accusé de réception si demandé) et gestion pour l'auteur / les gestionnaires. */
export function AnnouncementDetailScreen({ announcementId }: { announcementId: string }) {
  const t = useTranslations("v2MessagingAnnouncements");
  const tp = useTranslations("v2Messaging.priority");
  const router = useRouter();
  const date = useDateFormat();
  const describe = useDescribeError();
  const flash = useFlash();
  const q = useAnnouncement(announcementId);
  const markRead = useMarkAnnouncementRead();
  const ack = useAcknowledgeAnnouncement();
  const publish = usePublishAnnouncement();
  const withdraw = useWithdrawAnnouncement();
  const remove = useDeleteAnnouncementDraft();
  const [withdrawing, setWithdrawing] = useState(false);
  const [attError, setAttError] = useState<string | null>(null);
  const readSent = useRef(false);

  const a = q.data;
  // Lecture explicite à l'ouverture (un POST : aucun GET n'écrit), seulement pour un destinataire.
  useEffect(() => {
    if (a && a.isRecipient && a.myReadAt === null && a.status === "PUBLISHED" && !readSent.current) {
      readSent.current = true;
      markRead.mutate({ id: a.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation stable
  }, [a?.id, a?.isRecipient, a?.myReadAt, a?.status]);

  async function openAttachment(id: string) {
    setAttError(null);
    try {
      const { url } = await fetchAttachmentUrl(id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setAttError(describe(e));
    }
  }

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const ann = q.data;
  const manager = ann.stats !== null;
  const editable = ann.status === "DRAFT" || ann.status === "SCHEDULED";

  return (
    <article className="space-y-6">
      <div>
        <Link href="/v2/announcements" className="inline-flex h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t("back")}
        </Link>
        <header className="mt-1 space-y-2">
          <h1 className="break-words text-2xl font-bold tracking-tight">{ann.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{ann.authorName}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={ann.publishedAt ?? ann.publishAt ?? undefined}>{date.instant(ann.publishedAt ?? ann.publishAt)}</time>
            {ann.priority !== "NORMAL" ? <StatusBadge label={tp(ann.priority)} tone={priorityTone(ann.priority)} /> : null}
            <StatusBadge label={t(`status.${ann.status}`)} tone={ann.status === "PUBLISHED" ? "success" : ann.status === "WITHDRAWN" ? "danger" : "warning"} />
            {ann.expired ? <StatusBadge label={t("expired")} /> : null}
            {ann.expiresAt && !ann.expired ? <span>{t("expiresOn", { date: date.instant(ann.expiresAt) })}</span> : null}
          </div>
        </header>
      </div>

      {flash.node}
      {[publish.error, withdraw.error, remove.error, ack.error].filter(Boolean).map((e, i) => (
        <Notice key={i} kind="error">
          {describe(e)}
        </Notice>
      ))}

      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{ann.body}</p>

      {ann.attachments.length > 0 ? (
        <section aria-labelledby="ann-att" className="space-y-2">
          <h2 id="ann-att" className="text-sm font-semibold">
            {t("attachments")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {ann.attachments.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => void openAttachment(f.id)} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  {f.fileName} <span className="text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
                </button>
              </li>
            ))}
          </ul>
          {attError ? <p role="alert" className="text-xs text-destructive">{attError}</p> : null}
        </section>
      ) : null}

      {ann.isRecipient && ann.requireAck && ann.status === "PUBLISHED" ? (
        <section aria-labelledby="ann-ack" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 id="ann-ack" className="text-sm font-semibold">
            {t("ack.title")}
          </h2>
          {ann.myAcknowledgedAt ? (
            <p className="mt-1 text-sm text-emerald-800">{t("ack.done", { date: date.instant(ann.myAcknowledgedAt) })}</p>
          ) : (
            <>
              <p className="mt-1 text-sm">{t("ack.hint")}</p>
              <button type="button" className={`${buttonClass.primary} mt-3`} disabled={ack.isPending} onClick={() => ack.mutate({ id: ann.id }, { onSuccess: () => flash.show(t("ack.thanks")) })}>
                {t("ack.button")}
              </button>
            </>
          )}
        </section>
      ) : null}

      {manager ? (
        <section aria-labelledby="ann-manage" className="space-y-4 rounded-lg border p-4">
          <h2 id="ann-manage" className="text-lg font-semibold">
            {t("manage.title")}
          </h2>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {([
              ["recipients", ann.stats!.recipients],
              ["read", ann.stats!.read],
              ["acknowledged", ann.stats!.acknowledged],
            ] as const).map(([k, v]) => (
              <div key={k} className="rounded-md bg-muted p-3">
                <dt className="text-xs text-muted-foreground">{t(`manage.${k}`)}</dt>
                <dd className="text-2xl font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          {ann.stats!.truncated ? <Notice kind="warning">{t("manage.truncated")}</Notice> : null}
          <div>
            <h3 className="text-sm font-semibold">{t("manage.audience")}</h3>
            <p className="text-sm text-muted-foreground">
              {ann.targets.map((tg) => t(`targets.${tg.kind}`) + (tg.ref ? ` (${tg.ref.slice(0, 8)}…)` : "")).join(" · ")} — {ann.audiences.map((x) => t(`audiences.${x}`)).join(", ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <Link href={`/v2/announcements/${ann.id}/edit`} className={buttonClass.secondary}>
                {t("manage.edit")}
              </Link>
            ) : null}
            {editable ? (
              <button type="button" className={buttonClass.primary} disabled={publish.isPending} onClick={() => publish.mutate({ id: ann.id }, { onSuccess: () => flash.show(t("manage.published")) })}>
                {t("manage.publishNow")}
              </button>
            ) : null}
            {ann.status === "PUBLISHED" || ann.status === "SCHEDULED" ? (
              <button type="button" className={buttonClass.danger} onClick={() => setWithdrawing(true)}>
                {t("manage.withdraw")}
              </button>
            ) : null}
            {ann.status === "DRAFT" ? (
              <button type="button" className={buttonClass.ghost} disabled={remove.isPending} onClick={() => remove.mutate({ id: ann.id }, { onSuccess: () => router.push("/v2/announcements") })}>
                {t("manage.deleteDraft")}
              </button>
            ) : null}
          </div>
          {ann.status === "PUBLISHED" ? <Receipts id={ann.id} /> : null}
        </section>
      ) : null}

      <ReasonDialog
        open={withdrawing}
        onOpenChange={setWithdrawing}
        title={t("withdrawDialog.title")}
        description={t("withdrawDialog.description")}
        reasonLabel={t("withdrawDialog.reason")}
        confirmLabel={t("withdrawDialog.confirm")}
        destructive
        minLength={3}
        isPending={withdraw.isPending}
        error={withdraw.error}
        onConfirm={(reason) => withdraw.mutate({ id: ann.id, reason }, { onSuccess: () => { setWithdrawing(false); flash.show(t("manage.withdrawn")); } })}
      />
    </article>
  );
}
