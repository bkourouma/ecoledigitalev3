"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FINANCE_REFUND_STATUSES, type FinanceRefundDto } from "@ecoledigitale/contracts/v2/finance";
import { useApproveRefund, useCompleteRefund, useRefunds, useRejectRefund } from "@/platform/v2/finance";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice, useFlash } from "@/platform/ui/states";
import { RefundStatusBadge } from "./labels";

/**
 * Remboursements à QUATRE YEUX : une personne demande (fiche du paiement), une AUTRE approuve puis exécute. Le web ne
 * décide pas de qui peut approuver : l'API refuse l'auto-approbation avec un message clair, affiché tel quel.
 */
export function RefundsScreen() {
  const t = useTranslations("v2Finance.refunds");
  const tStatus = useTranslations("v2Finance.status.refund");
  const money = useMoney();
  const date = useDateFormat();
  const [status, setStatus] = useState("");
  const list = useRefunds({ status: status || undefined, limit: 100 });
  const flash = useFlash();
  const complete = useCompleteRefund();
  const [target, setTarget] = useState<{ kind: "approve" | "reject"; refund: FinanceRefundDto } | null>(null);
  const approve = useApproveRefund();
  const reject = useRejectRefund();
  const [executeNow, setExecuteNow] = useState(true);

  const columns: DataTableColumn<FinanceRefundDto>[] = [
    { id: "requested", header: t("columns.requested"), rowHeader: true, cell: (r) => date.instant(r.requestedAt) },
    {
      id: "payment",
      header: t("columns.payment"),
      cell: (r) => (
        <Link href={`/v2/finance/payments/${r.paymentId}`} className="text-primary underline-offset-4 hover:underline">
          {r.paymentId.slice(0, 8)}
        </Link>
      ),
      className: "hidden sm:table-cell",
    },
    { id: "amount", header: t("columns.amount"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.of(r.amount)}</span> },
    { id: "reason", header: t("columns.reason"), cell: (r) => <span className="line-clamp-2">{r.reason}</span>, className: "hidden md:table-cell" },
    { id: "status", header: t("columns.status"), cell: (r) => <RefundStatusBadge status={r.status} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) => (
        <Can permission="finance.payment.refund">
          <div className="flex flex-wrap justify-end gap-1">
            {r.status === "REQUESTED" ? (
              <>
                <button type="button" className={buttonClass.ghost} onClick={() => (approve.reset(), setExecuteNow(true), setTarget({ kind: "approve", refund: r }))}>
                  {t("approve")}
                  <span className="sr-only"> — {money.of(r.amount)}</span>
                </button>
                <button type="button" className={buttonClass.ghost} onClick={() => (reject.reset(), setTarget({ kind: "reject", refund: r }))}>
                  {t("reject")}
                  <span className="sr-only"> — {money.of(r.amount)}</span>
                </button>
              </>
            ) : null}
            {r.status === "APPROVED" ? (
              <button type="button" className={buttonClass.ghost} disabled={complete.isPending} onClick={() => complete.mutate({ id: r.id }, { onSuccess: () => flash.show(t("completed")) })}>
                {t("execute")}
                <span className="sr-only"> — {money.of(r.amount)}</span>
              </button>
            ) : null}
          </div>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{t("fourEyes")}</Notice>
      {flash.node}
      {complete.isError ? <ErrorBlock error={complete.error} /> : null}
      <FormField label={t("filters.status")} className="sm:max-w-xs">
        {(c) => <NativeSelect {...c} value={status} onChange={setStatus} placeholder={t("filters.all")} options={FINANCE_REFUND_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
      </FormField>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data ?? []}
        getRowId={(r) => r.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {target?.kind === "approve" ? (
        <FormDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          title={t("approveDialog.title")}
          description={t("approveDialog.description", { amount: money.of(target.refund.amount) })}
          submitLabel={t("approveDialog.submit")}
          isPending={approve.isPending}
          error={approve.error}
          onSubmit={() =>
            approve.mutate(
              { id: target.refund.id, complete: executeNow },
              {
                onSuccess: () => {
                  flash.show(executeNow ? t("approvedAndCompleted") : t("approved"));
                  setTarget(null);
                },
              },
            )
          }
        >
          <p className="text-sm text-muted-foreground">{t("approveDialog.reason", { reason: target.refund.reason })}</p>
          <CheckControl checked={executeNow} onChange={setExecuteNow} label={t("approveDialog.executeNow")} hint={t("approveDialog.executeNowHint")} />
        </FormDialog>
      ) : null}
      {target?.kind === "reject" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          title={t("rejectDialog.title")}
          description={t("rejectDialog.description")}
          reasonLabel={t("rejectDialog.reason")}
          confirmLabel={t("rejectDialog.confirm")}
          destructive
          isPending={reject.isPending}
          error={reject.error}
          onConfirm={(reason) =>
            reject.mutate(
              { id: target.refund.id, reason },
              {
                onSuccess: () => {
                  flash.show(t("rejected"));
                  setTarget(null);
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}
