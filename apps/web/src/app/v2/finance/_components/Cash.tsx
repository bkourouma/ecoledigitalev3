"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { financeCloseCashSessionBodySchema, type financeCashSessionDtoSchema } from "@ecoledigitale/contracts/v2/finance";
import type { z } from "zod";
import { useCashRegisters, useCashSessionSummary, useCashSessions, useCloseCashSession, useCreateCashRegister, useMyCashSession, useOpenCashSession } from "@/platform/v2/finance";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ModalDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { financeTone, MoneyField, useAmountErrors, useCampusIndex, useValidator } from "./shared";

type CashSession = z.infer<typeof financeCashSessionDtoSchema>;

/**
 * Caisse : ouverture d'une session avec fonds de caisse, suivi des mouvements, CLÔTURE AVEC COMPTAGE. L'attendu et l'écart
 * (compté − attendu ; négatif = manquant) sont calculés par l'API à la clôture et affichés tels quels.
 */
export function CashScreen({ initialSessionId }: { initialSessionId?: string }) {
  const t = useTranslations("v2Finance.cash");
  const mine = useMyCashSession();
  const registers = useCashRegisters();
  const flash = useFlash();
  const [dialog, setDialog] = useState<"open" | "register" | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(initialSessionId ?? null);
  const [closed, setClosed] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="finance.fee.manage">
            <button type="button" className={buttonClass.secondary} onClick={() => setDialog("register")}>
              {t("newRegister")}
            </button>
          </Can>
        }
      />
      {flash.node}

      <section aria-labelledby="cash-mine" className="space-y-3">
        <h2 id="cash-mine" className="text-lg font-semibold">
          {t("mine.title")}
        </h2>
        {mine.isPending && mine.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {mine.isError ? <ErrorBlock error={mine.error} onRetry={() => void mine.refetch()} /> : null}
        {mine.isSuccess && mine.data ? <OpenSessionCard session={mine.data} registerName={registers.data?.find((r) => r.id === mine.data!.registerId)?.name} onClosed={(id) => (setClosed(id), flash.show(t("closed")))} /> : null}
        {mine.isSuccess && !mine.data ? (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm">{t("mine.none")}</p>
            {registers.isError ? <ErrorBlock error={registers.error} /> : null}
            {registers.data && registers.data.length === 0 ? <EmptyBlock title={t("registers.empty")} description={t("registers.emptyHint")} /> : null}
            <ul className="grid gap-3 sm:grid-cols-2" aria-label={t("registers.title")}>
              {(registers.data ?? [])
                .filter((r) => r.active)
                .map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{r.code}</p>
                    </div>
                    <button type="button" className={buttonClass.primary} onClick={() => (setOpenFor(r.id), setDialog("open"))}>
                      {t("mine.open")}
                      <span className="sr-only"> — {r.name}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </section>

      {closed ? <ClosedSummary sessionId={closed} onDismiss={() => setClosed(null)} /> : null}

      <SessionsHistory onDetail={setDetail} />

      {dialog === "open" && openFor ? <OpenDialog registerId={openFor} onClose={() => setDialog(null)} onDone={() => flash.show(t("opened"))} /> : null}
      {dialog === "register" ? <RegisterDialog onClose={() => setDialog(null)} onDone={() => flash.show(t("registerCreated"))} /> : null}
      {detail ? (
        <ModalDialog open onOpenChange={(o) => !o && setDetail(null)} title={t("detail.title")}>
          <SessionSummary sessionId={detail} />
        </ModalDialog>
      ) : null}
    </div>
  );
}

function OpenSessionCard({ session, registerName, onClosed }: { session: CashSession; registerName?: string; onClosed: (id: string) => void }) {
  const t = useTranslations("v2Finance.cash.mine");
  const money = useMoney();
  const date = useDateFormat();
  const summary = useCashSessionSummary(session.id);
  const [closing, setClosing] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border-2 border-primary/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
          {registerName ?? t("register")} <StatusBadge label={t("openBadge")} tone="success" />
        </h3>
        <Can permission="finance.cashregister.close">
          <button type="button" className={buttonClass.primary} onClick={() => setClosing(true)}>
            {t("close")}
          </button>
        </Can>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{t("openedAt")}</dt>
          <dd>{date.instant(session.openedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("float")}</dt>
          <dd className="tabular-nums">{money.of(session.openingFloat)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("received")}</dt>
          <dd className="tabular-nums">{summary.data ? money.of(summary.data.movements.received) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("refunded")}</dt>
          <dd className="tabular-nums">{summary.data ? money.of(summary.data.movements.refunded) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("paymentCount")}</dt>
          <dd>{summary.data ? summary.data.movements.paymentCount : "—"}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t("blindHint")}</p>
      <div className="flex flex-wrap gap-2">
        <Can permission="finance.payment.create">
          <Link href="/v2/finance/payments/new" className={buttonClass.secondary}>
            {t("collect")}
          </Link>
        </Can>
      </div>
      {closing ? <CloseDialog session={session} onClose={() => setClosing(false)} onDone={() => onClosed(session.id)} /> : null}
    </div>
  );
}

function OpenDialog({ registerId, onClose, onDone }: { registerId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Finance.cash.openDialog");
  const describeAmount = useAmountErrors();
  const open = useOpenCashSession();
  const [amount, setAmount] = useState("0");
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={open.isPending}
      error={open.error}
      onSubmit={() => {
        const parsed = parseAmountInput(amount, { allowZero: true });
        if (!parsed.ok) return setError(describeAmount(parsed));
        setError(null);
        open.mutate(
          { registerId, openingFloat: parsed.amount },
          {
            onSuccess: () => {
              onDone();
              onClose();
            },
          },
        );
      }}
    >
      <MoneyField label={t("float")} value={amount} onChange={setAmount} required allowZero error={error} hint={t("floatHint")} />
    </FormDialog>
  );
}

function CloseDialog({ session, onClose, onDone }: { session: CashSession; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Finance.cash.closeDialog");
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const close = useCloseCashSession();
  const [form, setForm] = useState({ counted: "", note: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(close.error);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={close.isPending}
      error={close.error && Object.keys(apiErrors).length === 0 ? close.error : undefined}
      onSubmit={() => {
        const counted = parseAmountInput(form.counted, { allowZero: true });
        if (!counted.ok) return setErrors({ counted: describeAmount(counted) ?? "" });
        const parsed = validate(financeCloseCashSessionBodySchema, { countedAmount: counted.amount, ...(form.note.trim() ? { note: form.note.trim() } : {}) });
        if (!parsed.ok) return setErrors(parsed.errors);
        setErrors({});
        close.mutate(
          { id: session.id, countedAmount: counted.amount, ...(form.note.trim() ? { note: form.note.trim() } : {}) },
          {
            onSuccess: () => {
              onDone();
              onClose();
            },
          },
        );
      }}
    >
      <MoneyField label={t("counted")} value={form.counted} onChange={(v) => setForm((f) => ({ ...f, counted: v }))} required allowZero error={errors.counted ?? apiErrors.countedAmount} hint={t("countedHint")} />
      <FormField label={t("note")} error={errors.note ?? apiErrors.note} hint={t("noteHint")}>
        {(c) => <TextAreaControl {...c} value={form.note} onChange={(v) => setForm((f) => ({ ...f, note: v }))} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}

function RegisterDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Finance.cash.registerDialog");
  const create = useCreateCashRegister();
  const campuses = useCampusIndex();
  const [form, setForm] = useState({ code: "", name: "", campusId: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(create.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      submitLabel={t("submit")}
      isPending={create.isPending}
      error={create.error && Object.keys(apiErrors).length === 0 ? create.error : undefined}
      onSubmit={() => {
        const next: FieldErrors = {};
        if (!form.code.trim()) next.code = t("required");
        if (!form.name.trim()) next.name = t("required");
        setErrors(next);
        if (Object.keys(next).length > 0) return;
        create.mutate(
          { code: form.code.trim(), name: form.name.trim(), ...(form.campusId ? { campusId: form.campusId } : {}) },
          {
            onSuccess: () => {
              onDone();
              onClose();
            },
          },
        );
      }}
    >
      <FormField label={t("code")} required error={err("code")}>
        {(c) => <TextControl {...c} value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} maxLength={40} />}
      </FormField>
      <FormField label={t("name")} required error={err("name")}>
        {(c) => <TextControl {...c} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} maxLength={200} />}
      </FormField>
      {campuses.campuses.length > 0 ? (
        <FormField label={t("campus")} error={err("campusId")}>
          {(c) => <NativeSelect {...c} value={form.campusId} onChange={(v) => setForm((f) => ({ ...f, campusId: v }))} placeholder={t("noCampus")} options={campuses.campuses.map((x) => ({ value: x.id, label: x.name }))} />}
        </FormField>
      ) : null}
    </FormDialog>
  );
}

/** Résultat de clôture : attendu, compté et écart renvoyés par l'API. */
function ClosedSummary({ sessionId, onDismiss }: { sessionId: string; onDismiss: () => void }) {
  const t = useTranslations("v2Finance.cash.closedSummary");
  return (
    <section aria-labelledby="cash-closed" className="space-y-3 rounded-lg border-2 border-primary/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="cash-closed" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <button type="button" className={buttonClass.ghost} onClick={onDismiss}>
          {t("dismiss")}
        </button>
      </div>
      <SessionSummary sessionId={sessionId} />
    </section>
  );
}

export function SessionSummary({ sessionId }: { sessionId: string }) {
  const t = useTranslations("v2Finance.cash.summary");
  const money = useMoney();
  const date = useDateFormat();
  const q = useCashSessionSummary(sessionId);
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const { session, movements } = q.data;
  const variance = session.variance;
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("opened")}</dt>
          <dd>{date.instant(session.openedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("closedAt")}</dt>
          <dd>{session.closedAt ? date.instant(session.closedAt) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("float")}</dt>
          <dd className="tabular-nums">{money.of(session.openingFloat)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("movements")}</dt>
          <dd className="tabular-nums">
            {t("movementsValue", { received: money.of(movements.received), refunded: money.of(movements.refunded), count: movements.paymentCount })}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("expected")}</dt>
          <dd className="tabular-nums">{session.expected ? money.of(session.expected) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("counted")}</dt>
          <dd className="tabular-nums">{session.counted ? money.of(session.counted) : "—"}</dd>
        </div>
      </dl>
      {variance ? (
        variance.amount === 0 ? (
          <Notice kind="success">{t("varianceZero")}</Notice>
        ) : (
          <Notice kind="warning">{variance.amount < 0 ? t("varianceMissing", { amount: money.fmt(Math.abs(variance.amount), variance.currency) }) : t("varianceExcess", { amount: money.fmt(variance.amount, variance.currency) })}</Notice>
        )
      ) : null}
      {session.closeNote ? <p className="text-sm">{t("note", { note: session.closeNote })}</p> : null}
    </div>
  );
}

function SessionsHistory({ onDetail }: { onDetail: (id: string) => void }) {
  const t = useTranslations("v2Finance.cash.history");
  const tStatus = useTranslations("v2Finance.status.cashSession");
  const money = useMoney();
  const date = useDateFormat();
  const [status, setStatus] = useState<"" | "OPEN" | "CLOSED">("");
  const list = useCashSessions({ status: status || undefined, limit: 50 });
  const registers = useCashRegisters();
  const registerName = new Map((registers.data ?? []).map((r) => [r.id, r.name]));

  const columns: DataTableColumn<CashSession>[] = [
    { id: "opened", header: t("columns.opened"), rowHeader: true, cell: (s) => date.instant(s.openedAt) },
    { id: "register", header: t("columns.register"), cell: (s) => registerName.get(s.registerId) ?? s.registerId.slice(0, 8), className: "hidden sm:table-cell" },
    { id: "status", header: t("columns.status"), cell: (s) => <StatusBadge label={tStatus(s.status)} tone={financeTone(s.status)} /> },
    { id: "expected", header: t("columns.expected"), align: "right", cell: (s) => <span className="tabular-nums">{s.expected ? money.of(s.expected) : "—"}</span>, className: "hidden md:table-cell" },
    { id: "counted", header: t("columns.counted"), align: "right", cell: (s) => <span className="tabular-nums">{s.counted ? money.of(s.counted) : "—"}</span>, className: "hidden md:table-cell" },
    { id: "variance", header: t("columns.variance"), align: "right", cell: (s) => <span className="font-medium tabular-nums">{s.variance ? money.fmt(s.variance.amount, s.variance.currency) : "—"}</span> },
    {
      id: "detail",
      header: <span className="sr-only">{t("columns.detail")}</span>,
      align: "right",
      cell: (s) => (
        <button type="button" className={buttonClass.ghost} onClick={() => onDetail(s.id)}>
          {t("details")}
          <span className="sr-only"> — {date.instant(s.openedAt)}</span>
        </button>
      ),
    },
  ];

  return (
    <section aria-labelledby="cash-history" className="space-y-3">
      <h2 id="cash-history" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <FormField label={t("filter")} className="sm:max-w-xs">
        {(c) => (
          <NativeSelect
            {...c}
            value={status}
            onChange={(v) => setStatus(v as "" | "OPEN" | "CLOSED")}
            placeholder={t("all")}
            options={[
              { value: "OPEN", label: tStatus("OPEN") },
              { value: "CLOSED", label: tStatus("CLOSED") },
            ]}
          />
        )}
      </FormField>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data ?? []}
        getRowId={(s) => s.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
      />
    </section>
  );
}
