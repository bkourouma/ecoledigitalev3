"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { payrollMyDisputeBodySchema } from "@ecoledigitale/contracts/v2/payroll";
import { usePermission } from "@/platform/access";
import { useMyPayslipData, useMyPayslips } from "@/platform/v2/payroll";
import { myPayslipPdfPath, useDisputeMyPayslip } from "@/platform/v2/teaching";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { PdfButton } from "@/platform/ui/PdfButton";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { PayslipDocument } from "../../payroll/_components/PayslipDocument";
import { PayslipStatusBadge } from "../../payroll/_components/shared";
import { teacherHref } from "./hrefs";

const PAGE = 20;

/** « Mes bulletins de paie » : seuls les montants ARRÊTÉS, filtrés par l'API sur le compte connecté. */
export function TeacherPayslips() {
  const t = useTranslations("v2Portal.teacher.payslips");
  const tMy = useTranslations("v2Payroll.my");
  const money = useMoney();
  const date = useDateFormat();
  const [page, setPage] = useState(1);
  const list = useMyPayslips({ limit: PAGE, offset: (page - 1) * PAGE });

  const columns: DataTableColumn<NonNullable<typeof list.data>["items"][number]>[] = [
    {
      id: "date",
      header: tMy("columns.date"),
      rowHeader: true,
      cell: (p) => (
        <Link href={teacherHref.payslip(p.id)} className="font-medium text-primary underline-offset-4 hover:underline">
          {date.instant(p.approvedAt ?? p.calculatedAt)}
        </Link>
      ),
    },
    { id: "status", header: tMy("columns.status"), cell: (p) => <PayslipStatusBadge status={p.status} /> },
    { id: "bonus", header: tMy("columns.bonus"), align: "right", cell: (p) => <span className="tabular-nums">{money.fmt(p.bonusAmount, p.currency)}</span>, className: "hidden md:table-cell" },
    { id: "deduction", header: tMy("columns.deduction"), align: "right", cell: (p) => <span className="tabular-nums">{money.fmt(p.deductionAmount, p.currency)}</span>, className: "hidden md:table-cell" },
    { id: "total", header: tMy("columns.total"), align: "right", cell: (p) => <span className="font-medium tabular-nums">{money.fmt(p.totalAmount, p.currency)}</span> },
    { id: "paid", header: tMy("columns.paid"), cell: (p) => (p.paidAt ? date.instant(p.paidAt) : tMy("notPaid")), className: "hidden sm:table-cell" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{tMy("visibility")}</Notice>
      <DataTable
        caption={tMy("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(p) => p.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={tMy("empty")}
        emptyDescription={tMy("emptyHint")}
        pagination={{ page, pageSize: PAGE, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
      {(list.data?.items ?? []).some((p) => p.status === "DISPUTED") ? <Notice kind="warning">{tMy("disputedNotice")}</Notice> : null}
    </div>
  );
}

/**
 * Un bulletin de paie de l'enseignant : document figé, PDF scellé, et CONTESTATION motivée (3 à 500 caractères) tant que le
 * bulletin est arrêté et non versé. La décision d'accepter la contestation reste à la gestion de la paie.
 */
export function TeacherPayslip({ id }: { id: string }) {
  const t = useTranslations("v2Portal.teacher.payslips.detail");
  const data = useMyPayslipData(id);
  const canDispute = usePermission("payroll.my.dispute").allowed;
  const dispute = useDisputeMyPayslip();
  const flash = useFlash();
  const [open, setOpen] = useState(false);

  async function confirm(reason: string) {
    const v = payrollMyDisputeBodySchema.safeParse({ reason });
    if (!v.success) return;
    try {
      await dispute.mutateAsync({ id, reason: v.data.reason });
      setOpen(false);
      flash.show(t("disputed"));
    } catch {
      /* refus de l'API (409, 404) : affiché dans la fenêtre par `error` */
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        actions={
          <>
            <Link href="/v2/teacher/payslips" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            {data.data ? <PdfButton path={myPayslipPdfPath(id)} fileName={`bulletin-de-paie-${id.slice(0, 8)}.pdf`} label={t("pdf")} variant="primary" /> : null}
            {data.data?.status === "APPROVED" && canDispute ? (
              <button type="button" className={buttonClass.secondary} onClick={() => (dispute.reset(), setOpen(true))}>
                {t("dispute")}
              </button>
            ) : null}
          </>
        }
      />
      {flash.node}
      {data.isPending && data.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {data.isError ? <ErrorBlock error={data.error} onRetry={() => void data.refetch()} /> : null}
      {data.data ? (
        <>
          {data.data.status === "DISPUTED" ? <Notice kind="warning">{t("disputedState")}</Notice> : null}
          <PayslipDocument data={data.data} />
          {data.data.status === "APPROVED" && canDispute ? <p className="text-sm text-muted-foreground">{t("disputeHint")}</p> : null}
        </>
      ) : null}
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={t("disputeTitle")}
        description={t("disputeDescription")}
        reasonLabel={t("disputeReason")}
        confirmLabel={t("disputeConfirm")}
        minLength={3}
        maxLength={500}
        isPending={dispute.isPending}
        error={dispute.error}
        onConfirm={confirm}
      />
    </div>
  );
}
