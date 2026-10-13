"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { higherUpdateSettingsBodySchema } from "@ecoledigitale/contracts/v2/higher";
import { usePermission } from "@/platform/access";
import { useStudentOptions } from "@/platform/v2/lookups";
import { useHigherSettings, useStudentCredits, useStudentPathway, useUpdateHigherSettings } from "@/platform/v2/higher";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat, showDecimal } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { validateWith } from "@/platform/ui/validation";
import { toneOfStatus } from "../../assessments/_components/shared";
import { shortId } from "./shared";

/** Registre de crédits (capitalisation par UE), dettes d'UE et rattrapages d'un étudiant. Les crédits d'une UE sont figés à son acquisition. */
export function CreditsScreen() {
  const t = useTranslations("v2Higher.credits");
  const [student, setStudent] = useState<SelectOption | null>(null);
  const credits = useStudentCredits(student?.value ?? null);
  const pathway = useStudentPathway(student?.value ?? null);
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <FormField label={t("student")} className="max-w-md">
        {(c) => <SelectAsync {...c} value={student} onChange={setStudent} useOptions={useStudentOptions} placeholder={t("studentPlaceholder")} />}
      </FormField>
      {!student ? <Notice kind="info">{t("choose")}</Notice> : <QueryBoundary query={credits}>{credits.data ? <CreditsBody data={credits.data} pathway={pathway.data ?? null} /> : null}</QueryBoundary>}
      <SettingsPanel />
    </div>
  );
}

type Credits = NonNullable<ReturnType<typeof useStudentCredits>["data"]>;
type Pathway = NonNullable<ReturnType<typeof useStudentPathway>["data"]>;

function CreditsBody({ data, pathway }: { data: Credits; pathway: Pathway | null }) {
  const t = useTranslations("v2Higher.credits");
  const tVia = useTranslations("v2Higher.acquiredVia");
  const tLedger = useTranslations("v2Higher.ledgerStatus");
  const tDebt = useTranslations("v2Higher.debtStatus");
  const tPhase = useTranslations("v2Higher.resitPhase");
  const date = useDateFormat();
  const s = data.summary;
  return (
    <div className="space-y-6">
      <section aria-label={t("summary")} className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("totalCredits")} value={String(s.totalCredits).replace(".", ",")} />
        <Stat label={t("acquiredUe")} value={s.acquiredUeCount} />
        <Stat label={t("openDebts")} value={s.openDebtCount} danger={s.openDebtCount > 0} />
      </section>

      <section aria-labelledby="ledger-h" className="space-y-2">
        <h2 id="ledger-h" className="text-lg font-semibold">
          {t("ledger")}
        </h2>
        {data.entries.length === 0 ? (
          <EmptyBlock title={t("noEntries")} />
        ) : (
          <div role="region" aria-label={t("ledgerCaption")} tabIndex={0} className="overflow-x-auto rounded-2xl border border-white/10 bg-card/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t("ledgerCaption")}</caption>
              <thead className="bg-white/[0.04] text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">{t("columns.ue")}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t("columns.credits")}</th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("columns.via")}</th>
                  <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">{t("columns.average")}</th>
                  <th scope="col" className="px-3 py-2">{t("columns.state")}</th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">{t("columns.validUntil")}</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-t border-white/5 transition-colors hover:bg-white/[0.04]">
                    <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-normal">{t("ueShort", { id: shortId(e.ueNodeId) })}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{String(e.credits).replace(".", ",")}</td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      {tVia(e.acquiredVia)} · {t("session", { n: e.sessionObtained })}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{showDecimal(e.averageExact)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge label={tLedger(e.status)} tone={toneOfStatus(e.status)} />
                      {e.revokeReason ? <span className="mt-1 block text-xs text-muted-foreground">{e.revokeReason}</span> : null}
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">{e.validUntil ? date.civil(e.validUntil) : t("noExpiry")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="debts-h" className="space-y-2">
        <h2 id="debts-h" className="text-lg font-semibold">
          {t("debts")}
        </h2>
        {data.debts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noDebts")}</p>
        ) : (
          <ul className="space-y-2">
            {data.debts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
                <span className="font-mono text-xs">{t("ueShort", { id: shortId(d.ueNodeId) })}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={tDebt(d.status)} tone={d.status === "OPEN" ? "warning" : "success"} />
                  <span className="text-xs text-muted-foreground">{d.clearedAt ? t("clearedOn", { date: date.instant(d.clearedAt) }) : t("detectedOn", { date: date.instant(d.detectedAt) })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pathway && pathway.resits.length > 0 ? (
        <section aria-labelledby="resits-h" className="space-y-2">
          <h2 id="resits-h" className="text-lg font-semibold">
            {t("resits")}
          </h2>
          <ul className="space-y-2">
            {pathway.resits.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
                <span>
                  <span className="font-mono text-xs">{t("ueShort", { id: shortId(r.ueNodeId) })}</span> — {t("window", { from: date.civil(r.opensOn), to: date.civil(r.closesOn) })}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={tPhase(r.phase)} tone={r.phase === "VALIDATED" ? "success" : r.phase === "NOT_VALIDATED" ? "warning" : "info"} />
                  {r.session1Average ? <span className="text-xs text-muted-foreground">{t("session1", { value: showDecimal(r.session1Average) })}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${danger ? "border-red-400/40 bg-red-400/10" : "border-white/10 bg-card/60"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${danger ? "text-red-200" : ""}`}>{value}</p>
    </div>
  );
}

function SettingsPanel() {
  const t = useTranslations("v2Higher.settings");
  const canManage = usePermission("higher.settings.manage");
  const query = useHigherSettings(canManage.allowed);
  const update = useUpdateHigherSettings();
  const flash = useFlash();
  const [months, setMonths] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!canManage.allowed) return null;
  if (query.isError) return <ErrorBlock error={query.error} />;
  const current = query.data?.creditValidityMonths ?? null;
  const shown = months ?? (current === null ? "" : String(current));

  async function save() {
    const value = shown.trim() === "" ? null : Number(shown);
    const v = validateWith(higherUpdateSettingsBodySchema, { creditValidityMonths: value });
    if (!v.ok) return setError(t("invalid"));
    setError(null);
    try {
      await update.mutateAsync(v.data);
      flash.show(t("saved"));
      setMonths(null);
    } catch {
      /* affichée ci-dessous */
    }
  }

  return (
    <section aria-labelledby="settings-h" className="max-w-xl space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 id="settings-h" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {flash.node}
      <FormField label={t("validity")} error={error} hint={t("validityHint")}>
        {(c) => <TextControl {...c} value={shown} onChange={setMonths} inputMode="numeric" />}
      </FormField>
      {update.error ? <ErrorBlock error={update.error} /> : null}
      <button type="button" className={buttonClass.secondary} onClick={() => void save()} disabled={update.isPending || months === null}>
        {t("save")}
      </button>
    </section>
  );
}
