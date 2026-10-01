"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { usePayment, useVerifyPayment } from "@/platform/v2/finance";
import { Can } from "@/platform/ui/AccessGate";
import { useMoney } from "@/platform/ui/money";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { PaymentStatusBadge } from "./labels";

/**
 * Suivi d'un paiement en ligne : tant que le statut est « En attente », l'écran interroge le fournisseur (via l'API,
 * `POST /payments/:id/verify`) à intervalle régulier, au plus UNE vérification à la fois, et s'arrête dès que le statut
 * est définitif ou après `maxMs`. L'issue (confirmé / échoué) est celle de l'API ; le web ne conclut jamais seul.
 */
export function PaymentTracker({ paymentId, intervalMs = 5000, maxMs = 10 * 60_000 }: { paymentId: string; intervalMs?: number; maxMs?: number }) {
  const t = useTranslations("v2Finance.tracker");
  const money = useMoney();
  const view = usePayment(paymentId);
  const verify = useVerifyPayment();
  const status = view.data?.payment.status;
  const startedAt = useRef(Date.now());
  const busy = useRef(false);
  const verifyRef = useRef(verify);
  verifyRef.current = verify;

  useEffect(() => {
    if (status !== "PENDING") return;
    const handle = setInterval(() => {
      if (busy.current || Date.now() - startedAt.current > maxMs) return;
      busy.current = true;
      verifyRef.current.mutate({ id: paymentId }, { onSettled: () => (busy.current = false) });
    }, intervalMs);
    return () => clearInterval(handle);
  }, [status, paymentId, intervalMs, maxMs]);

  function checkNow() {
    if (busy.current) return;
    busy.current = true;
    verify.mutate({ id: paymentId }, { onSettled: () => (busy.current = false) });
  }

  if (view.isPending && view.fetchStatus !== "idle") return <LoadingBlock />;
  if (view.isError) return <ErrorBlock error={view.error} onRetry={() => void view.refetch()} />;
  if (!view.data) return null;
  const { payment } = view.data;

  return (
    <section aria-labelledby="tracker-title" className="space-y-3 rounded-lg border p-4" aria-live="polite">
      <h2 id="tracker-title" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        {t("title")} <PaymentStatusBadge status={payment.status} />
      </h2>
      <p className="text-sm">{t("amount", { amount: money.of(payment.amount) })}</p>
      {payment.status === "PENDING" ? (
        <>
          <Notice kind="info">{t("pending")}</Notice>
          <Can permission="finance.payment.create">
            <button type="button" className={buttonClass.secondary} onClick={checkNow} disabled={verify.isPending}>
              {t("checkNow")}
            </button>
          </Can>
        </>
      ) : null}
      {payment.status === "CONFIRMED" ? <Notice kind="success">{t("confirmed")}</Notice> : null}
      {payment.status === "FAILED" ? <Notice kind="error">{t("failed", { reason: payment.failureReason ?? "—" })}</Notice> : null}
      {payment.simulated ? <Notice kind="warning">{t("simulated")}</Notice> : null}
      {verify.isError ? <ErrorBlock error={verify.error} /> : null}
    </section>
  );
}
