"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FinanceReceiptDto } from "@ecoledigitale/contracts/v2/finance";
import { useTenantProfile } from "@/platform/admin/tenancy/hooks";
import { useReceipt, useReceipts } from "@/platform/v2/finance";
import { useStudentOptions } from "@/platform/v2/lookups";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { LearnerName, useLearnerLabels } from "./shared";

const PAGE_SIZE = 25;

export function ReceiptsScreen() {
  const t = useTranslations("v2Finance.receipts");
  const tMethod = useTranslations("v2Finance.method");
  const money = useMoney();
  const date = useDateFormat();
  const [learner, setLearner] = useState<SelectOption | null>(null);
  const [page, setPage] = useState(1);
  const list = useReceipts({ learnerId: learner?.value, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const labels = useLearnerLabels(list.data?.items.map((r) => r.learnerId) ?? []);

  const columns: DataTableColumn<FinanceReceiptDto>[] = [
    {
      id: "number",
      header: t("columns.number"),
      rowHeader: true,
      cell: (r) => (
        <Link href={`/v2/finance/receipts/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {r.number}
        </Link>
      ),
    },
    { id: "date", header: t("columns.date"), cell: (r) => date.instant(r.issuedAt), className: "hidden sm:table-cell" },
    { id: "learner", header: t("columns.learner"), cell: (r) => <LearnerName id={r.learnerId} labels={labels} /> },
    { id: "method", header: t("columns.method"), cell: (r) => tMethod(r.snapshot.method), className: "hidden md:table-cell" },
    { id: "amount", header: t("columns.amount"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.of(r.amount)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <FormField label={t("filters.learner")} className="sm:max-w-md">
        {(c) => (
          <SelectAsync
            {...c}
            value={learner}
            onChange={(o) => {
              setLearner(o);
              setPage(1);
            }}
            useOptions={useStudentOptions}
            placeholder={t("filters.learnerPlaceholder")}
          />
        )}
      </FormField>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(r) => r.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={{ page, pageSize: PAGE_SIZE, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
    </div>
  );
}

/**
 * Reçu imprimable. Le contenu est l'instantané IMMUABLE émis par l'API au moment de l'encaissement (numéro, montant,
 * imputations, solde après paiement) : le web ne le recompose pas. « Imprimer » ouvre la boîte d'impression du navigateur
 * (enregistrement en PDF possible) ; le rendu PDF côté serveur n'existe pas encore dans l'API.
 */
export function ReceiptDetailScreen({ id, backHref = "/v2/finance/receipts" }: { id: string; backHref?: string }) {
  const t = useTranslations("v2Finance.receiptDetail");
  const tMethod = useTranslations("v2Finance.method");
  const tPayer = useTranslations("v2Finance.payer");
  const money = useMoney();
  const date = useDateFormat();
  const receipt = useReceipt(id);
  const profile = useTenantProfile();
  const labels = useLearnerLabels(receipt.data ? [receipt.data.learnerId] : []);

  if (receipt.isPending && receipt.fetchStatus !== "idle") return <LoadingBlock />;
  if (receipt.isError) return <ErrorBlock error={receipt.error} onRetry={() => void receipt.refetch()} />;
  if (!receipt.data) return null;
  const r = receipt.data;
  const s = r.snapshot;
  const school = profile.data?.tradeName ?? profile.data?.legalName ?? null;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={t("title", { number: r.number })}
          actions={
            <>
              <Link href={backHref} className={buttonClass.secondary}>
                {t("back")}
              </Link>
              <button type="button" className={buttonClass.primary} onClick={() => window.print()}>
                {t("print")}
              </button>
            </>
          }
        />
      </div>

      <article aria-label={t("document")} className="mx-auto max-w-2xl space-y-4 rounded-lg border bg-background p-6 print:max-w-none print:border-0 print:p-0">
        <header className="space-y-1 border-b pb-4 text-center">
          {school ? <p className="text-lg font-semibold">{school}</p> : null}
          <h2 className="text-xl font-bold uppercase tracking-wide">{t("heading")}</h2>
          <p className="font-mono text-sm">{s.number}</p>
        </header>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("date")}</dt>
            <dd>{date.instant(s.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("learner")}</dt>
            <dd>{labels.get(r.learnerId) ?? r.learnerId.slice(0, 8)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("payer")}</dt>
            <dd>
              {s.payer.name ?? "—"} <span className="text-xs text-muted-foreground">({tPayer(s.payer.kind)})</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("method")}</dt>
            <dd>
              {tMethod(s.method)}
              {s.reference ? ` · ${s.reference}` : ""}
            </dd>
          </div>
        </dl>
        <DataTable
          caption={t("allocations")}
          columns={[
            { id: "invoice", header: t("invoice"), rowHeader: true, cell: (a) => a.invoiceNumber ?? "—" },
            { id: "label", header: t("label"), cell: (a) => a.label },
            { id: "amount", header: t("amount"), align: "right", cell: (a) => <span className="tabular-nums">{money.fmt(a.amount, r.amount.currency)}</span> },
          ]}
          rows={s.allocations}
          getRowId={(a) => a.installmentId}
          emptyTitle={t("noAllocations")}
        />
        <dl className="space-y-1 border-t pt-3 text-sm">
          {s.unallocated.amount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("unallocated")}</dt>
              <dd className="tabular-nums">{money.of(s.unallocated)}</dd>
            </div>
          ) : null}
          {s.balanceAfter ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("balanceAfter")}</dt>
              <dd className="tabular-nums">{money.of(s.balanceAfter)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-semibold">
            <dt>{t("total")}</dt>
            <dd className="tabular-nums">{money.of(r.amount)}</dd>
          </div>
        </dl>
        <footer className="pt-6 text-xs text-muted-foreground">{t("footer")}</footer>
      </article>
    </div>
  );
}
