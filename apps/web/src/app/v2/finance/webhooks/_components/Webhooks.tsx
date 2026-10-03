"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FINANCE_PROVIDER_NAMES, FINANCE_WEBHOOK_EVENT_STATUSES, type FinanceReplayWebhookEventResultDto, type FinanceWebhookEventDto } from "@ecoledigitale/contracts/v2/finance";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { useReplayWebhookEvent, useWebhookEvent, useWebhookEvents } from "@/platform/v2/finance-webhooks";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDescribeError } from "@/platform/ui/errors";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { StepUpDialog } from "@/platform/ui/StepUpDialog";
import { useStepUp } from "@/platform/ui/useStepUp";

const PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Codes de motif connus (le serveur n'expose que des codes courts) ; tout autre code retombe sur le libellé générique. */
const KNOWN_ERRORS = new Set([
  "finance.provider_amount_mismatch",
  "finance.provider_reference_mismatch",
  "finance.provider_failed",
  "finance.provider_unavailable",
  "finance.provider_not_configured",
  "finance.provider_disabled",
  "finance.simulated_payment_in_production",
  "payment_already_settled",
  "late_success_after_failure",
  "amount_missing",
]);

const STATUS_TONE: Record<FinanceWebhookEventDto["status"], Tone> = { RECEIVED: "info", PROCESSED: "success", IGNORED: "neutral", FAILED: "danger" };

/** Message d'erreur du rejeu : un message français par code connu, jamais le message brut d'une réponse inattendue. */
function useWebhookError(): (error: unknown) => string {
  const t = useTranslations("v2FinanceWebhooks.errors");
  const describe = useDescribeError();
  return (error) => {
    if (error instanceof ApiError) {
      if (error.code === "rbac.mfa_required" || error.code.endsWith(".mfa_required")) return t("mfaRequired");
      if (error.code === "finance.webhook_not_replayable") return t("notReplayable");
      if (error.code === "finance.not_found") return t("notFound");
      if (error.code === "finance.provider_unknown" || error.code === "finance.provider_not_configured" || error.code === "finance.provider_disabled") return t("providerUnavailable");
      if ([ClientErrorCode.NETWORK, ClientErrorCode.TIMEOUT, ClientErrorCode.TENANT_UNKNOWN, ClientErrorCode.RESPONSE_INVALID].includes(error.code as never)) return describe(error);
      if (error.status === 401 || error.status === 429 || error.status >= 500) return describe(error);
      if (error.status === 403) return t("forbidden");
      if (error.status === 404) return t("notFound");
      if (error.status === 409) return t("conflict");
      if (error.status >= 400) return t("rejected");
    }
    return t("generic");
  };
}

/**
 * « Webhooks en échec » : notifications authentiques de fournisseurs de paiement que le module n'a pas pu appliquer. L'écran
 * n'affiche JAMAIS de charge brute (l'API n'en renvoie pas). Le rejeu est une action sensible (authentification forte
 * contrôlée par l'API) : il ne renvoie pas la charge stockée, il interroge le fournisseur ; le web ne choisit aucune issue.
 */
export function WebhooksScreen() {
  const t = useTranslations("v2FinanceWebhooks");
  const date = useDateFormat();
  const [status, setStatus] = useState<(typeof FINANCE_WEBHOOK_EVENT_STATUSES)[number]>("FAILED");
  const [provider, setProvider] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [replayTarget, setReplayTarget] = useState<FinanceWebhookEventDto | null>(null);
  const [result, setResult] = useState<FinanceReplayWebhookEventResultDto | null>(null);

  const paymentFilter = paymentId.trim();
  const paymentInvalid = paymentFilter !== "" && !UUID.test(paymentFilter);
  const list = useWebhookEvents({
    status,
    provider: provider || undefined,
    paymentId: paymentFilter !== "" && !paymentInvalid ? paymentFilter : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  // Les clés de message n'ont pas de point (next-intl les lit comme des chemins) : `finance.x` devient `finance_x`.
  const errorLabel = (code: string | null): string => (code === null ? "—" : KNOWN_ERRORS.has(code) ? t(`reasons.${code.replaceAll(".", "_")}`) : t("reasons.unknown"));

  const columns: DataTableColumn<FinanceWebhookEventDto>[] = [
    { id: "received", header: t("columns.received"), rowHeader: true, cell: (r) => date.instant(r.receivedAt) },
    { id: "provider", header: t("columns.provider"), cell: (r) => r.provider },
    { id: "type", header: t("columns.type"), cell: (r) => r.eventType ?? "—", className: "hidden md:table-cell" },
    {
      id: "payment",
      header: t("columns.payment"),
      cell: (r) =>
        r.paymentId ? (
          <Link href={`/v2/finance/payments/${r.paymentId}`} className="text-primary underline-offset-4 hover:underline">
            {r.paymentId.slice(0, 8)}
          </Link>
        ) : (
          "—"
        ),
      className: "hidden sm:table-cell",
    },
    {
      id: "state",
      header: t("columns.state"),
      cell: (r) => (
        <div className="space-y-1">
          <StatusBadge label={t(`status.${r.status}`)} tone={STATUS_TONE[r.status]} />
          {r.error ? <p className="text-xs text-muted-foreground">{errorLabel(r.error)}</p> : null}
        </div>
      ),
    },
    { id: "attempts", header: t("columns.attempts"), align: "right", cell: (r) => <span className="tabular-nums">{r.attempts}</span>, className: "hidden md:table-cell" },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-1">
          <button type="button" className={buttonClass.secondary} onClick={() => setDetailId(r.id)}>
            {t("detail.open")}
            <span className="sr-only"> — {r.provider} {r.eventId}</span>
          </button>
          {r.status === "FAILED" ? (
            <Can permission="finance.webhook.replay">
              <button type="button" className={buttonClass.secondary} onClick={() => setReplayTarget(r)}>
                {t("replay.action")}
                <span className="sr-only"> — {r.provider} {r.eventId}</span>
              </button>
            </Can>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{t("noRawPayload")}</Notice>
      {result ? <ReplayResult result={result} onClose={() => setResult(null)} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("filters.status")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={status}
              onChange={(v) => (setStatus(v as typeof status), setPage(1))}
              options={FINANCE_WEBHOOK_EVENT_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
            />
          )}
        </FormField>
        <FormField label={t("filters.provider")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={provider}
              onChange={(v) => (setProvider(v), setPage(1))}
              options={[{ value: "", label: t("filters.allProviders") }, ...FINANCE_PROVIDER_NAMES.map((p) => ({ value: p, label: t(`providers.${p}`) }))]}
            />
          )}
        </FormField>
        <FormField label={t("filters.payment")} hint={t("filters.paymentHint")} error={paymentInvalid ? t("filters.paymentInvalid") : null}>
          {(c) => <TextControl {...c} value={paymentId} onChange={(v) => (setPaymentId(v), setPage(1))} maxLength={36} />}
        </FormField>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(r) => r.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={status === "FAILED" ? t("emptyFailed") : t("empty")}
        emptyDescription={status === "FAILED" ? t("emptyFailedHint") : undefined}
        pagination={{ page, pageSize: PAGE_SIZE, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
      {detailId ? <DetailDialog id={detailId} onClose={() => setDetailId(null)} errorLabel={errorLabel} /> : null}
      {replayTarget ? (
        <ReplayDialog
          target={replayTarget}
          onClose={() => setReplayTarget(null)}
          onDone={(r) => {
            setReplayTarget(null);
            setResult(r);
          }}
        />
      ) : null}
    </div>
  );
}

function DetailDialog({ id, onClose, errorLabel }: { id: string; onClose: () => void; errorLabel: (code: string | null) => string }) {
  const t = useTranslations("v2FinanceWebhooks.detail");
  const ts = useTranslations("v2FinanceWebhooks");
  const date = useDateFormat();
  const describe = useWebhookError();
  const query = useWebhookEvent(id);
  const e = query.data;
  return (
    <ModalDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")}>
      {query.isPending && query.fetchStatus !== "idle" ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {query.error ? <Notice kind="error">{describe(query.error)}</Notice> : null}
      {e ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto,1fr]">
          <dt className="text-muted-foreground">{ts("columns.provider")}</dt>
          <dd>{e.provider}</dd>
          <dt className="text-muted-foreground">{t("eventId")}</dt>
          <dd className="break-all"><code className="text-xs">{e.eventId}</code></dd>
          <dt className="text-muted-foreground">{ts("columns.type")}</dt>
          <dd>{e.eventType ?? "—"}</dd>
          <dt className="text-muted-foreground">{ts("columns.state")}</dt>
          <dd><StatusBadge label={ts(`status.${e.status}`)} tone={STATUS_TONE[e.status]} /></dd>
          <dt className="text-muted-foreground">{t("reason")}</dt>
          <dd>{errorLabel(e.error)}</dd>
          <dt className="text-muted-foreground">{ts("columns.payment")}</dt>
          <dd>
            {e.paymentId ? (
              <Link href={`/v2/finance/payments/${e.paymentId}`} className="text-primary underline-offset-4 hover:underline">{e.paymentId}</Link>
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-muted-foreground">{ts("columns.attempts")}</dt>
          <dd>{e.attempts}</dd>
          <dt className="text-muted-foreground">{ts("columns.received")}</dt>
          <dd>{date.instant(e.receivedAt)}</dd>
          <dt className="text-muted-foreground">{t("processedAt")}</dt>
          <dd>{e.processedAt ? date.instant(e.processedAt) : "—"}</dd>
        </dl>
      ) : null}
      <p className="mt-4 text-xs text-muted-foreground">{t("noRawPayload")}</p>
    </ModalDialog>
  );
}

function ReplayDialog({ target, onClose, onDone }: { target: FinanceWebhookEventDto; onClose: () => void; onDone: (result: FinanceReplayWebhookEventResultDto) => void }) {
  const t = useTranslations("v2FinanceWebhooks.replay");
  const describe = useWebhookError();
  const replay = useReplayWebhookEvent();
  const stepUp = useStepUp();
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const confirmError = submitted && !confirmed ? t("confirmRequired") : null;

  function submit() {
    setSubmitted(true);
    if (!confirmed) return;
    // Rejeu sensible refusé en `*.mfa_required` : confirmation d'identité (TOTP) puis relance unique de la même requête.
    void stepUp.run(() => replay.mutateAsync({ id: target.id, ...(note.trim() ? { note: note.trim() } : {}) })).then(onDone, () => undefined);
  }

  return (
    <>
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description", { provider: target.provider })} submitLabel={t("submit")} isPending={replay.isPending} onSubmit={submit}>
      <Notice kind="warning">{t("warning")}</Notice>
      <Notice kind="info">{t("mfa")}</Notice>
      <FormField label={t("note")} hint={t("noteHint")}>
        {(c) => <TextAreaControl {...c} value={note} onChange={setNote} maxLength={500} rows={2} />}
      </FormField>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} aria-describedby={confirmError ? "replay-confirm-error" : undefined} />
          <span>{t("confirm")}</span>
        </label>
        {confirmError ? <p id="replay-confirm-error" className="mt-1 text-sm text-destructive">{confirmError}</p> : null}
      </div>
      {replay.error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {describe(replay.error)}
        </p>
      ) : null}
    </FormDialog>
    <StepUpDialog {...stepUp.dialogProps} />
    </>
  );
}

function ReplayResult({ result, onClose }: { result: FinanceReplayWebhookEventResultDto; onClose: () => void }) {
  const t = useTranslations("v2FinanceWebhooks.result");
  const tc = useTranslations("actions");
  const kind = result.replayed ? "info" : result.resolved ? "success" : "warning";
  const message = result.replayed ? t("alreadyHandled") : result.resolved ? t("resolved") : t("stillFailed");
  return (
    <div role="status" className="space-y-2">
      <Notice kind={kind}>
        <span className="font-medium">{message}</span>
        {result.paymentStatus ? <span className="ml-1">{t("paymentStatus", { status: result.paymentStatus })}</span> : null}
      </Notice>
      <button type="button" className={buttonClass.secondary} onClick={onClose}>
        {tc("close")}
      </button>
    </div>
  );
}
