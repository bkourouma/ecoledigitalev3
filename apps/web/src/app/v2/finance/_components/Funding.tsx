"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  FINANCE_FEE_CATEGORIES,
  FINANCE_FUNDING_TYPES,
  financeCreateScholarshipBodySchema,
  type financeScholarshipDtoSchema,
  type FinanceInvoiceSummaryDto,
} from "@ecoledigitale/contracts/v2/finance";
import type { z } from "zod";
import { useFeature } from "@/platform/access";
import { useCreateScholarship, useLearnerFunding, useLearnerStatement, useSetLearnerFunding, useSetScholarshipStatus } from "@/platform/v2/finance";
import { useStudentOptions } from "@/platform/v2/lookups";
import { Can, FeatureNotice } from "@/platform/ui/AccessGate";
import { DataTable } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, parsePercentToBps, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { InvoiceStatusBadge } from "./labels";
import { AcademicYearField, MoneyField, financeTone, useAmountErrors, useValidator } from "./shared";

type Scholarship = z.infer<typeof financeScholarshipDtoSchema>;
const FUNDER_KINDS = ["STATE", "COMPANY", "INSTITUTION", "FOUNDATION", "OTHER"] as const;

/**
 * Financement d'un apprenant : type de financement, bourses et prises en charge (part de l'État, d'une entreprise…), et la
 * RÉPARTITION des factures entre la famille et les financeurs, telle que calculée et émise par l'API (une facture liée par
 * financeur, payable séparément). Aucun partage n'est recalculé ici.
 */
export function FundingScreen({ initialLearnerId }: { initialLearnerId?: string }) {
  const t = useTranslations("v2Finance.funding");
  const [learner, setLearner] = useState<SelectOption | null>(initialLearnerId ? { value: initialLearnerId, label: initialLearnerId.slice(0, 8) } : null);
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <FormField label={t("learner")} required>
        {(c) => <SelectAsync {...c} value={learner} onChange={setLearner} useOptions={useStudentOptions} placeholder={t("learnerPlaceholder")} />}
      </FormField>
      {learner ? <LearnerFunding learnerId={learner.value} /> : <EmptyBlock title={t("pick")} description={t("pickHint")} />}
    </div>
  );
}

function LearnerFunding({ learnerId }: { learnerId: string }) {
  const t = useTranslations("v2Finance.funding");
  const tFunding = useTranslations("v2Finance.funding.type");
  const tFunder = useTranslations("v2Finance.funder");
  const tStatus = useTranslations("v2Finance.status.scholarship");
  const tCat = useTranslations("v2Finance.category");
  const money = useMoney();
  const funding = useLearnerFunding(learnerId);
  const statement = useLearnerStatement(learnerId);
  const stateFeature = useFeature("finance.state-assigned");
  const setStatus = useSetScholarshipStatus();
  const flash = useFlash();
  const [dialog, setDialog] = useState<"funding" | "scholarship" | null>(null);

  if (funding.isPending && funding.fetchStatus !== "idle") return <LoadingBlock />;
  if (funding.isError) return <ErrorBlock error={funding.error} onRetry={() => void funding.refetch()} />;
  if (!funding.data) return null;
  const { account, scholarships } = funding.data;
  const funderName = new Map(scholarships.map((s) => [s.id, s.funderName]));

  return (
    <div className="space-y-6">
      {flash.node}
      <section aria-labelledby="funding-type" className="space-y-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="funding-type" className="text-lg font-semibold">
            {t("typeTitle")}
          </h2>
          <Can permission="finance.fee.manage">
            <button type="button" className={buttonClass.secondary} onClick={() => setDialog("funding")}>
              {t("change")}
            </button>
          </Can>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("typeLabel")}</dt>
            <dd className="font-medium">{tFunding(account.fundingType)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("assignmentRef")}</dt>
            <dd>{account.assignmentRef ?? "—"}</dd>
          </div>
        </dl>
        {account.fundingType === "STATE_ASSIGNED" ? <p className="text-sm text-muted-foreground">{t("stateHint")}</p> : null}
      </section>

      <section aria-labelledby="funding-scholarships" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="funding-scholarships" className="text-lg font-semibold">
            {t("scholarships.title")}
          </h2>
          <Can permission="finance.fee.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setDialog("scholarship")}>
              {t("scholarships.new")}
            </button>
          </Can>
        </div>
        {setStatus.isError ? <ErrorBlock error={setStatus.error} /> : null}
        <DataTable
          caption={t("scholarships.caption")}
          columns={[
            { id: "funder", header: t("scholarships.funder"), rowHeader: true, cell: (s: Scholarship) => (<><span className="font-medium">{s.funderName}</span> <span className="text-xs text-muted-foreground">({tFunder(s.funderKind)})</span></>) },
            { id: "year", header: t("scholarships.year"), cell: (s) => s.academicYear, className: "hidden sm:table-cell" },
            { id: "coverage", header: t("scholarships.coverage"), align: "right", cell: (s) => (s.coverage.kind === "PERCENT" ? money.bps(s.coverage.bps) : money.of(s.coverage.amount)) },
            { id: "cap", header: t("scholarships.cap"), align: "right", cell: (s) => (s.capAmount ? money.of(s.capAmount) : "—"), className: "hidden md:table-cell" },
            { id: "categories", header: t("scholarships.categories"), cell: (s) => (s.categories ? s.categories.map((c) => tCat(c)).join(", ") : t("scholarships.allCategories")), className: "hidden lg:table-cell" },
            { id: "status", header: t("scholarships.status"), cell: (s) => <StatusBadge label={tStatus(s.status)} tone={financeTone(s.status)} /> },
            {
              id: "actions",
              header: <span className="sr-only">{t("scholarships.actions")}</span>,
              align: "right",
              cell: (s) => (
                <Can permission="finance.fee.manage">
                  <div className="flex justify-end gap-1">
                    {s.status !== "ACTIVE" ? (
                      <button type="button" className={buttonClass.ghost} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: s.id, status: "ACTIVE" }, { onSuccess: () => flash.show(t("scholarships.reactivated")) })}>
                        {t("scholarships.reactivate")}
                        <span className="sr-only"> — {s.funderName}</span>
                      </button>
                    ) : (
                      <button type="button" className={buttonClass.ghost} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: s.id, status: "SUSPENDED" }, { onSuccess: () => flash.show(t("scholarships.suspended")) })}>
                        {t("scholarships.suspend")}
                        <span className="sr-only"> — {s.funderName}</span>
                      </button>
                    )}
                    {s.status !== "ENDED" ? (
                      <button type="button" className={buttonClass.ghost} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: s.id, status: "ENDED" }, { onSuccess: () => flash.show(t("scholarships.ended")) })}>
                        {t("scholarships.end")}
                        <span className="sr-only"> — {s.funderName}</span>
                      </button>
                    ) : null}
                  </div>
                </Can>
              ),
            },
          ]}
          rows={scholarships}
          getRowId={(s) => s.id}
          emptyTitle={t("scholarships.empty")}
          emptyDescription={t("scholarships.emptyHint")}
        />
      </section>

      <section aria-labelledby="funding-split" className="space-y-2">
        <h2 id="funding-split" className="text-lg font-semibold">
          {t("split.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("split.hint")}</p>
        {statement.isPending && statement.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {statement.isError ? <Notice kind="info">{t("split.unavailable")}</Notice> : null}
        {statement.data ? (
          <DataTable
            caption={t("split.caption")}
            columns={[
              { id: "invoice", header: t("split.invoice"), rowHeader: true, cell: (i: FinanceInvoiceSummaryDto) => (<Link href={`/v2/finance/invoices/${i.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{i.number ?? t("split.draft")}</Link>) },
              { id: "payer", header: t("split.payer"), cell: (i) => (i.payerKind === "FUNDER" ? t("split.funderShare", { funder: (i.payerRef && funderName.get(i.payerRef)) || tFunder("OTHER") }) : t("split.familyShare")) },
              { id: "status", header: t("split.status"), cell: (i) => <InvoiceStatusBadge status={i.status} />, className: "hidden sm:table-cell" },
              { id: "total", header: t("split.total"), align: "right", cell: (i) => <span className="tabular-nums">{money.of(i.total)}</span> },
              { id: "balance", header: t("split.balance"), align: "right", cell: (i) => <span className="font-medium tabular-nums">{money.of(i.balance)}</span> },
            ]}
            rows={statement.data.invoices}
            getRowId={(i) => i.id}
            emptyTitle={t("split.empty")}
          />
        ) : null}
      </section>

      {dialog === "funding" ? (
        <FundingTypeDialog learnerId={learnerId} current={account.fundingType} currentRef={account.assignmentRef ?? ""} stateAllowed={stateFeature.allowed} onClose={() => setDialog(null)} onDone={() => flash.show(t("typeSaved"))} />
      ) : null}
      {dialog === "scholarship" ? <ScholarshipDialog learnerId={learnerId} stateAllowed={stateFeature.allowed} onClose={() => setDialog(null)} onDone={() => flash.show(t("scholarships.created"))} /> : null}
    </div>
  );
}

function FundingTypeDialog({ learnerId, current, currentRef, stateAllowed, onClose, onDone }: { learnerId: string; current: string; currentRef: string; stateAllowed: boolean; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Finance.funding.typeDialog");
  const tType = useTranslations("v2Finance.funding.type");
  const save = useSetLearnerFunding();
  const [fundingType, setFundingType] = useState(current);
  const [assignmentRef, setAssignmentRef] = useState(currentRef);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={save.isPending}
      error={save.error}
      onSubmit={() =>
        save.mutate(
          { learnerId, fundingType, ...(assignmentRef.trim() ? { assignmentRef: assignmentRef.trim() } : {}) },
          {
            onSuccess: () => {
              onDone();
              onClose();
            },
          },
        )
      }
    >
      <FormField label={t("type")} required>
        {(c) => <NativeSelect {...c} value={fundingType} onChange={setFundingType} options={FINANCE_FUNDING_TYPES.map((v) => ({ value: v, label: tType(v), disabled: v === "STATE_ASSIGNED" && !stateAllowed && v !== current }))} />}
      </FormField>
      {!stateAllowed ? <FeatureNotice>{t("stateOff")}</FeatureNotice> : null}
      <FormField label={t("ref")} hint={t("refHint")}>
        {(c) => <TextControl {...c} value={assignmentRef} onChange={setAssignmentRef} maxLength={120} />}
      </FormField>
    </FormDialog>
  );
}

function ScholarshipDialog({ learnerId, stateAllowed, onClose, onDone }: { learnerId: string; stateAllowed: boolean; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Finance.funding.scholarshipDialog");
  const tFunder = useTranslations("v2Finance.funder");
  const tCat = useTranslations("v2Finance.category");
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const create = useCreateScholarship();
  const [form, setForm] = useState({ academicYear: "", funderKind: "STATE", funderName: "", reference: "", coverageKind: "PERCENT", coverage: "", cap: "", priority: "" });
  const [categories, setCategories] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(create.error);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: string) => errors[k] ?? apiErrors[k];

  function submit() {
    const local: FieldErrors = {};
    let coverage: Record<string, unknown> | undefined;
    if (form.coverageKind === "PERCENT") {
      const pct = parsePercentToBps(form.coverage);
      if (!pct.ok) local.coverage = t(`percentErrors.${pct.reason}`);
      else coverage = { kind: "PERCENT", bps: pct.bps };
    } else {
      const amount = parseAmountInput(form.coverage);
      if (!amount.ok) local.coverage = describeAmount(amount) ?? "";
      else coverage = { kind: "FIXED", amount: amount.amount };
    }
    const body: Record<string, unknown> = {
      learnerId,
      academicYear: form.academicYear,
      funderKind: form.funderKind,
      funderName: form.funderName.trim(),
      ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
      coverage,
      ...(categories.length > 0 ? { categories } : {}),
      ...(form.priority.trim() ? { priority: Number(form.priority) } : {}),
    };
    if (form.cap.trim() !== "") {
      const cap = parseAmountInput(form.cap);
      if (!cap.ok) local.cap = describeAmount(cap) ?? "";
      else body.capAmount = cap.amount;
    }
    if (Object.keys(local).length > 0) return setErrors(local);
    const result = validate(financeCreateScholarshipBodySchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(result.data, {
      onSuccess: () => {
        onDone();
        onClose();
      },
    });
  }

  return (
    <FormDialog wide open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrors).length === 0 ? create.error : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("funderKind")} required error={err("funderKind")}>
          {(c) => <NativeSelect {...c} value={form.funderKind} onChange={set("funderKind")} options={FUNDER_KINDS.map((k) => ({ value: k, label: tFunder(k), disabled: k === "STATE" && !stateAllowed }))} />}
        </FormField>
        <FormField label={t("funderName")} required error={err("funderName")}>
          {(c) => <TextControl {...c} value={form.funderName} onChange={set("funderName")} maxLength={200} />}
        </FormField>
        <FormField label={t("reference")} error={err("reference")}>
          {(c) => <TextControl {...c} value={form.reference} onChange={set("reference")} maxLength={120} />}
        </FormField>
        <AcademicYearField label={t("year")} value={form.academicYear} onChange={set("academicYear")} required error={err("academicYear")} />
        <FormField label={t("coverageKind")} required>
          {(c) => (
            <NativeSelect
              {...c}
              value={form.coverageKind}
              onChange={(v) => setForm((f) => ({ ...f, coverageKind: v, coverage: "" }))}
              options={[
                { value: "PERCENT", label: t("kinds.PERCENT") },
                { value: "FIXED", label: t("kinds.FIXED") },
              ]}
            />
          )}
        </FormField>
        {form.coverageKind === "PERCENT" ? (
          <FormField label={t("percent")} required error={err("coverage")} hint={t("percentHint")}>
            {(c) => <TextControl {...c} value={form.coverage} onChange={set("coverage")} inputMode="decimal" />}
          </FormField>
        ) : (
          <MoneyField label={t("amount")} value={form.coverage} onChange={set("coverage")} required error={err("coverage")} />
        )}
        <MoneyField label={t("cap")} value={form.cap} onChange={set("cap")} error={err("cap") ?? err("capAmount")} hint={t("capHint")} />
        <FormField label={t("priority")} hint={t("priorityHint")} error={err("priority")}>
          {(c) => <TextControl {...c} type="number" min={0} max={1000} step={1} inputMode="numeric" value={form.priority} onChange={set("priority")} />}
        </FormField>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("categories")}</legend>
        <p className="text-xs text-muted-foreground">{t("categoriesHint")}</p>
        <div className="grid gap-x-4 sm:grid-cols-3">
          {FINANCE_FEE_CATEGORIES.map((c) => (
            <CheckControl key={c} checked={categories.includes(c)} onChange={(on) => setCategories((all) => (on ? [...all, c] : all.filter((x) => x !== c)))} label={tCat(c)} />
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}
