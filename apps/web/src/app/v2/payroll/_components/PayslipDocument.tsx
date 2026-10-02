"use client";

import { useTranslations } from "next-intl";
import { z } from "zod";
import type { payrollPayslipDataDtoSchema } from "@ecoledigitale/contracts/v2/payroll";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";

type PayslipData = z.infer<typeof payrollPayslipDataDtoSchema>;

/** Lecture tolérante de l'instantané figé à l'arrêt du montant (`PayslipSnapshot` v1) : les champs inconnus sont ignorés. */
const documentSchema = z
  .object({
    staff: z.object({ displayName: z.string(), matricule: z.string().nullable().optional() }),
    period: z.object({ name: z.string(), startDate: z.string(), endDate: z.string() }),
    currency: z.string().optional(),
    amounts: z.object({ salary: z.number(), regularHours: z.number(), overtime: z.number(), bonus: z.number(), deduction: z.number(), total: z.number() }),
    minutes: z.object({ regular: z.number(), overtime: z.number() }).optional(),
    adjustments: z.array(z.object({ kind: z.enum(["BONUS", "DEDUCTION"]), amount: z.number(), label: z.string() })).optional(),
    approvedAt: z.string().optional(),
    approvedByName: z.string().optional(),
  })
  .passthrough();

/**
 * Bulletin arrêté : montants FIGÉS à l'arrêt (instantané + empreinte SHA-256 vérifiée par l'API), filigrane tant que le
 * bulletin n'est pas versé. Le rendu PDF côté serveur n'existe pas encore : « Imprimer » ouvre la boîte d'impression.
 */
export function PayslipDocument({ data }: { data: PayslipData }) {
  const t = useTranslations("v2Payroll.document");
  const tMethod = useTranslations("v2Payroll.method");
  const money = useMoney();
  const date = useDateFormat();
  const parsed = documentSchema.safeParse(data.document);
  const doc = parsed.success ? parsed.data : null;
  const cur = doc?.currency ?? "XOF";

  return (
    <section aria-labelledby="slip-document" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="slip-document" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t("title")}
          {data.watermark ? <StatusBadge label={data.watermark} tone="warning" /> : null}
          {data.intact === true ? <StatusBadge label={t("intact")} tone="success" /> : null}
          {data.intact === false ? <StatusBadge label={t("tampered")} tone="danger" /> : null}
        </h2>
        <button type="button" className={`${buttonClass.secondary} print:hidden`} onClick={() => window.print()}>
          {t("print")}
        </button>
      </div>
      {data.intact === false ? <Notice kind="error">{t("tamperedNotice")}</Notice> : null}
      {!doc ? <Notice kind="info">{t("unreadable")}</Notice> : null}
      {doc ? (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("staff")}</dt>
              <dd>
                {doc.staff.displayName}
                {doc.staff.matricule ? ` (${doc.staff.matricule})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("period")}</dt>
              <dd>{t("periodValue", { name: doc.period.name, from: date.civil(doc.period.startDate), to: date.civil(doc.period.endDate) })}</dd>
            </div>
          </dl>
          <table className="w-full max-w-md text-sm">
            <caption className="sr-only">{t("amountsCaption")}</caption>
            <tbody>
              {(
                [
                  ["salary", doc.amounts.salary],
                  ["regularHours", doc.amounts.regularHours],
                  ["overtime", doc.amounts.overtime],
                  ["bonus", doc.amounts.bonus],
                  ["deduction", doc.amounts.deduction],
                ] as const
              ).map(([k, v]) => (
                <tr key={k} className="border-b">
                  <th scope="row" className="py-1.5 pr-4 text-left font-normal text-muted-foreground">
                    {t(`amounts.${k}`)}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{money.fmt(v, cur)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-2 pr-4 text-left text-base font-semibold">
                  {t("amounts.total")}
                </th>
                <td className="py-2 text-right text-base font-semibold tabular-nums">{money.fmt(doc.amounts.total, cur)}</td>
              </tr>
            </tbody>
          </table>
          {doc.minutes ? (
            <p className="text-sm text-muted-foreground">{t("minutes", { regular: money.minutes(doc.minutes.regular), overtime: money.minutes(doc.minutes.overtime) })}</p>
          ) : null}
        </>
      ) : null}
      {data.payment ? (
        <p className="text-sm">
          {t("payment", { date: date.instant(data.payment.paidAt), name: data.payment.paidByName, method: tMethod(data.payment.method) })}
          {data.payment.reference ? ` · ${data.payment.reference}` : ""}
        </p>
      ) : null}
      {data.snapshotHash ? (
        <p className="break-all font-mono text-xs text-muted-foreground">
          {t("hash")} {data.snapshotHash}
        </p>
      ) : null}
    </section>
  );
}
