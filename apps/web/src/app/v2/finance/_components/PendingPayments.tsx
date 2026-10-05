"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { FinancePendingPaymentDto, FinanceResolutionDto } from "@ecoledigitale/contracts/v2/finance";
import { useVerifyPayment } from "@/platform/v2/finance";
import { useApproveResolution, usePendingPayments, useRejectResolution, useRequestResolution, useResolutions } from "@/platform/v2/finance-reconciliation";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { StepUpDialog } from "@/platform/ui/StepUpDialog";
import { ErrorBlock, Notice, useFlash } from "@/platform/ui/states";
import { useStepUp } from "@/platform/ui/useStepUp";

/** Motifs de signalement connus (codes courts de l'API) ; tout autre code retombe sur le libellé générique. */
const KNOWN_REASONS = new Set([
  "unverifiable_no_provider_ref",
  "attempts_exhausted",
  "provider_unavailable",
  "provider_amount_mismatch",
  "provider_reference_mismatch",
  "provider_failed",
  "simulated_payment_in_production",
]);

type Filter = "all" | "flagged" | "progress";

/**
 * « Paiements à rapprocher » : les paiements en ligne restés EN ATTENTE (webhook perdu, session abandonnée, réponse
 * d'initiation perdue). Le job de rapprochement du worker les interroge seul ; ceux qu'il ne peut pas conclure sont SIGNALÉS
 * et apparaissent en tête. Une personne peut alors vérifier à nouveau, ou demander une résolution MANUELLE motivée avec
 * preuve (permission sensible). Q-PAY-38 : UNE seule personne habilitée tranche, après une MFA RÉCENTE (l'API répond
 * `finance.mfa_required` : le dialogue de confirmation par code est alors proposé, puis la même requête est rejouée une fois).
 * Le web ne conclut jamais seul : seule l'API écrit.
 */
export function PendingPaymentsScreen() {
  const t = useTranslations("v2FinancePending");
  const money = useMoney();
  const date = useDateFormat();
  const flash = useFlash();
  const [filter, setFilter] = useState<Filter>("all");
  const list = usePendingPayments({ ...(filter === "all" ? {} : { flagged: filter === "flagged" }), limit: 100 });
  const requests = useResolutions({ status: "REQUESTED", limit: 100 });
  const verify = useVerifyPayment();
  const [resolveTarget, setResolveTarget] = useState<FinancePendingPaymentDto | null>(null);
  const [decision, setDecision] = useState<{ kind: "approve" | "reject"; resolution: FinanceResolutionDto } | null>(null);

  const reasonLabel = (code: string | null): string => (code && KNOWN_REASONS.has(code) ? t(`reasons.${code}`) : t("reasons.unknown"));

  const columns: DataTableColumn<FinancePendingPaymentDto>[] = [
    {
      id: "received",
      header: t("columns.received"),
      rowHeader: true,
      cell: (r) => (
        <Link href={`/v2/finance/payments/${r.payment.id}`} className="text-primary underline-offset-4 hover:underline">
          {date.instant(r.payment.receivedAt)}
        </Link>
      ),
    },
    { id: "provider", header: t("columns.provider"), cell: (r) => r.payment.provider ?? "—", className: "hidden sm:table-cell" },
    { id: "amount", header: t("columns.amount"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.of(r.payment.amount)}</span> },
    {
      id: "state",
      header: t("columns.state"),
      cell: (r) =>
        r.reconciliation?.flaggedAt ? (
          <div className="space-y-1">
            <StatusBadge label={t("state.flagged")} tone="danger" />
            <p className="text-xs text-muted-foreground">{reasonLabel(r.reconciliation.flagReason)}</p>
          </div>
        ) : r.reconciliation && r.reconciliation.attempts > 0 ? (
          <div className="space-y-1">
            <StatusBadge label={t("state.checking")} tone="info" />
            <p className="text-xs text-muted-foreground">{t("attempts", { count: r.reconciliation.attempts })}</p>
          </div>
        ) : (
          <StatusBadge label={t("state.waiting")} tone="neutral" />
        ),
    },
    {
      id: "next",
      header: t("columns.next"),
      cell: (r) => (r.reconciliation && !r.reconciliation.flaggedAt ? date.instant(r.reconciliation.nextAttemptAt) : "—"),
      className: "hidden md:table-cell",
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Can permission="finance.payment.create">
            <button type="button" className={buttonClass.ghost} disabled={verify.isPending} onClick={() => verify.mutate({ id: r.payment.id }, { onSuccess: (v) => flash.show(v.payment.status === "PENDING" ? t("verifiedStillPending") : t("verifiedSettled")) })}>
              {t("verify")}
              <span className="sr-only"> — {money.of(r.payment.amount)}</span>
            </button>
          </Can>
          <Can permission="finance.payment.reconcile">
            {r.openResolutionId ? (
              <StatusBadge label={t("resolutionPending")} tone="warning" />
            ) : (
              <button type="button" className={buttonClass.ghost} onClick={() => setResolveTarget(r)}>
                {t("resolveAction")}
                <span className="sr-only"> — {money.of(r.payment.amount)}</span>
              </button>
            )}
          </Can>
        </div>
      ),
    },
  ];

  const requestColumns: DataTableColumn<FinanceResolutionDto>[] = [
    { id: "requested", header: t("requests.columns.requested"), rowHeader: true, cell: (r) => date.instant(r.requestedAt) },
    {
      id: "subject",
      header: t("requests.columns.subject"),
      cell: (r) =>
        r.paymentId ? (
          <Link href={`/v2/finance/payments/${r.paymentId}`} className="text-primary underline-offset-4 hover:underline">
            {t("requests.payment", { id: r.paymentId.slice(0, 8) })}
          </Link>
        ) : (
          <Link href="/v2/finance/refunds" className="text-primary underline-offset-4 hover:underline">
            {t("requests.refund", { id: (r.refundId ?? "").slice(0, 8) })}
          </Link>
        ),
    },
    { id: "outcome", header: t("requests.columns.outcome"), cell: (r) => <StatusBadge label={t(`outcome.${r.outcome}`)} tone={r.outcome === "SUCCEEDED" ? "success" : "danger"} /> },
    { id: "reason", header: t("requests.columns.reason"), cell: (r) => <span className="line-clamp-2">{r.reason}</span>, className: "hidden md:table-cell" },
    { id: "evidence", header: t("requests.columns.evidence"), cell: (r) => <code className="text-xs">{r.evidenceRef}</code>, className: "hidden sm:table-cell" },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) => (
        <Can permission="finance.payment.reconcile">
          <div className="flex flex-wrap justify-end gap-1">
            <button type="button" className={buttonClass.ghost} onClick={() => setDecision({ kind: "approve", resolution: r })}>
              {t("requests.approve")}
              <span className="sr-only"> — {r.evidenceRef}</span>
            </button>
            <button type="button" className={buttonClass.ghost} onClick={() => setDecision({ kind: "reject", resolution: r })}>
              {t("requests.reject")}
              <span className="sr-only"> — {r.evidenceRef}</span>
            </button>
          </div>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{t("singleActor")}</Notice>
      {flash.node}
      {verify.isError ? <ErrorBlock error={verify.error} /> : null}
      <FormField label={t("filters.state")} className="sm:max-w-xs">
        {(c) => (
          <NativeSelect
            {...c}
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={[
              { value: "all", label: t("filters.all") },
              { value: "flagged", label: t("filters.flagged") },
              { value: "progress", label: t("filters.progress") },
            ]}
          />
        )}
      </FormField>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(r) => r.payment.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />

      <section aria-labelledby="pending-requests-title" className="space-y-3">
        <h2 id="pending-requests-title" className="text-lg font-semibold">
          {t("requests.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("requests.description")}</p>
        <DataTable
          caption={t("requests.caption")}
          columns={requestColumns}
          rows={requests.data ?? []}
          getRowId={(r) => r.id}
          isLoading={requests.isPending && requests.fetchStatus !== "idle"}
          error={requests.error}
          onRetry={() => void requests.refetch()}
          emptyTitle={t("requests.empty")}
        />
      </section>

      {resolveTarget ? <ResolveDialog target={resolveTarget} onClose={() => setResolveTarget(null)} onDone={() => (setResolveTarget(null), flash.show(t("resolve.requested")))} /> : null}
      {decision ? <DecisionDialog decision={decision} onClose={() => setDecision(null)} onDone={(message) => (setDecision(null), flash.show(message))} /> : null}
    </div>
  );
}

function ResolveDialog({ target, onClose, onDone }: { target: FinancePendingPaymentDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2FinancePending.resolve");
  const money = useMoney();
  const request = useRequestResolution();
  const stepUp = useStepUp();
  const [outcome, setOutcome] = useState<"SUCCEEDED" | "FAILED">("SUCCEEDED");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const reasonError = submitted && reason.trim().length < 10 ? t("errors.reason") : null;
  const evidenceError = submitted && evidence.trim().length < 3 ? t("errors.evidence") : null;

  function submit() {
    setSubmitted(true);
    if (reason.trim().length < 10 || evidence.trim().length < 3) return;
    // Q-PAY-38 : refusée en `*.mfa_required` faute de MFA récente => code TOTP, puis la même requête est rejouée UNE fois.
    void stepUp.run(() => request.mutateAsync({ paymentId: target.payment.id, outcome, reason: reason.trim(), evidenceRef: evidence.trim() })).then(onDone, () => undefined);
  }

  return (
    <>
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description", { amount: money.of(target.payment.amount) })} submitLabel={t("submit")} isPending={request.isPending} error={request.error} onSubmit={submit}>
      <FormField label={t("outcome")} required>
        {(c) => (
          <NativeSelect
            {...c}
            value={outcome}
            onChange={(v) => setOutcome(v as "SUCCEEDED" | "FAILED")}
            options={[
              { value: "SUCCEEDED", label: t("outcomes.SUCCEEDED") },
              { value: "FAILED", label: t("outcomes.FAILED") },
            ]}
          />
        )}
      </FormField>
      <FormField label={t("reason")} hint={t("reasonHint")} error={reasonError} required>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}
      </FormField>
      <FormField label={t("evidence")} hint={t("evidenceHint")} error={evidenceError} required>
        {(c) => <TextControl {...c} value={evidence} onChange={setEvidence} maxLength={120} />}
      </FormField>
      <Notice kind="warning">{t("warning")}</Notice>
    </FormDialog>
    <StepUpDialog {...stepUp.dialogProps} />
    </>
  );
}

function DecisionDialog({ decision, onClose, onDone }: { decision: { kind: "approve" | "reject"; resolution: FinanceResolutionDto }; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2FinancePending.decision");
  const approve = useApproveResolution();
  const reject = useRejectResolution();
  const stepUp = useStepUp();
  const [note, setNote] = useState("");
  const action = decision.kind === "approve" ? approve : reject;
  const r = decision.resolution;

  return (
    <>
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`${decision.kind}.title`)}
      description={t(`${decision.kind}.description`, { outcome: t(`outcomes.${r.outcome}`), evidence: r.evidenceRef })}
      submitLabel={t(`${decision.kind}.submit`)}
      isPending={action.isPending}
      error={action.error}
      onSubmit={() => void stepUp.run(() => action.mutateAsync({ id: r.id, ...(note.trim() ? { note: note.trim() } : {}) })).then(() => onDone(t(`${decision.kind}.done`)), () => undefined)}
    >
      <p className="text-sm text-muted-foreground">{t("reason", { reason: r.reason })}</p>
      <FormField label={t("note")}>{(c) => <TextAreaControl {...c} value={note} onChange={setNote} maxLength={500} rows={2} />}</FormField>
    </FormDialog>
    <StepUpDialog {...stepUp.dialogProps} />
    </>
  );
}
