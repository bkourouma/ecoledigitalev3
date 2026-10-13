"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ExamCandidateFeeDto } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useMoney } from "@/platform/ui/money";
import { useCandidateFee, useConfirmRefund, useSyncCandidateFee } from "@/platform/v2/examinations-fees";
import { StatusPill } from "./shared";
import type { Tone } from "@/platform/ui/PageHeader";

const statusTone = (s: ExamCandidateFeeDto["status"]): Tone =>
  s === "INVOICED" || s === "REFUND_DONE" ? "success" : s === "PENDING_INVOICE" || s === "AWAITING_MANUAL_INVOICE" || s === "REFUND_DUE" ? "warning" : "neutral";
const paymentTone = (s: ExamCandidateFeeDto["payment"]["status"]): Tone => (s === "PAID" ? "success" : s === "PARTIAL" ? "warning" : s === "UNPAID" ? "danger" : "neutral");

function FeeBody({ fee, candidateId }: { fee: ExamCandidateFeeDto; candidateId: string }) {
  const t = useTranslations("v2ExaminationsFees.candidate");
  const money = useMoney();
  const sync = useSyncCandidateFee(candidateId);
  const refund = useConfirmRefund(candidateId);
  const [refunding, setRefunding] = useState(false);
  const currency = fee.currency ?? "XOF";
  return (
    <div className="space-y-3" data-testid="candidate-fee">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={t(`status.${fee.status}` as never)} tone={statusTone(fee.status)} />
        {fee.payment.status !== "NONE" ? <StatusPill label={t(`payment.${fee.payment.status}` as never)} tone={paymentTone(fee.payment.status)} /> : null}
        {fee.invoiceNumber ? <span className="text-sm text-muted-foreground">{t("invoice", { number: fee.invoiceNumber })}</span> : null}
      </div>
      {fee.lines.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {fee.lines.map((l) => (
            <li key={l.feeId} className="flex justify-between gap-3"><span>{l.label ?? l.feeId}</span><span className="font-medium">{l.amountMinor === null ? t("amountPending") : money.fmt(l.amountMinor, currency)}</span></li>
          ))}
        </ul>
      ) : null}
      {fee.totalMinor !== null ? <p className="text-sm font-semibold">{t("total", { amount: money.fmt(fee.totalMinor, currency) })}{fee.payment.paidMinor !== null ? <span className="ml-2 font-normal text-muted-foreground">{t("paid", { amount: money.fmt(fee.payment.paidMinor, currency) })}</span> : null}</p> : null}
      {fee.status === "AWAITING_MANUAL_INVOICE" ? <Notice kind="warning">{t("manualInvoice")}</Notice> : null}
      {fee.status === "REFUND_DUE" ? <Notice kind="warning">{t("refundDue")}</Notice> : null}
      {fee.note && fee.status !== "AWAITING_MANUAL_INVOICE" && fee.status !== "REFUND_DUE" ? <p className="text-sm text-muted-foreground">{fee.note}</p> : null}
      {fee.lastErrorCode ? <Notice kind="error">{t("lastError", { code: fee.lastErrorCode })}</Notice> : null}
      <Can permission="exam.fee.manage">
        <div className="flex flex-wrap gap-2">
          {fee.status === "PENDING_INVOICE" || (fee.lastErrorCode && fee.status === "INVOICED") ? (
            <button type="button" className={buttonClass.secondary} disabled={sync.isPending} onClick={() => sync.mutate()}>{t("retry")}</button>
          ) : null}
          {fee.status === "REFUND_DUE" ? <button type="button" className={buttonClass.primary} onClick={() => setRefunding(true)}>{t("refundDone")}</button> : null}
        </div>
      </Can>
      {sync.isError ? <ErrorBlock error={sync.error} /> : null}
      <ReasonDialog
        open={refunding}
        onOpenChange={setRefunding}
        title={t("refundDialog.title")}
        description={t("refundDialog.description")}
        reasonLabel={t("refundDialog.note")}
        confirmLabel={t("refundDialog.confirm")}
        minLength={5}
        isPending={refund.isPending}
        error={refund.error}
        onConfirm={async (note) => {
          try {
            await refund.mutateAsync({ note });
            setRefunding(false);
          } catch {
            /* erreur affichée dans la fenêtre */
          }
        }}
      />
    </div>
  );
}

/**
 * Frais d'examen d'un candidat (Q-E13) : statut de la facturation et du paiement (relu en direct auprès de la comptabilité), facture
 * à établir pour un candidat libre, remboursement manuel à confirmer après désinscription. Visible avec `exam.fee.read`.
 */
export function CandidateFeeSection({ candidateId }: { candidateId: string }) {
  const t = useTranslations("v2ExaminationsFees.candidate");
  const query = useCandidateFee(candidateId, true);
  return (
    <section aria-labelledby="exam-fee" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 id="exam-fee" className="text-lg font-semibold">{t("title")}</h2>
      {query.isPending ? <LoadingBlock /> : query.isError ? (
        (query.error as { code?: string }).code === "examinations.fee_not_found" ? <p className="text-sm text-muted-foreground">{t("none")}</p> : <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : <FeeBody fee={query.data} candidateId={candidateId} />}
    </section>
  );
}
