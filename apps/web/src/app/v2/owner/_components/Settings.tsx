"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { AnalyticsSettingsData } from "@ecoledigitale/contracts/v2/analytics";
import { useAnalyticsSettings, useAnalyticsUpdateSettings } from "@/platform/v2/analytics";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { parsePercentToBps } from "@/platform/ui/money";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { Section } from "./kit";

/** Points de base -> saisie en pourcentage (« 85 », « 87,5 ») : lecture de chaîne, sans flottant. */
function bpsToText(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const cents = bps % 100;
  return cents === 0 ? String(whole) : `${whole},${String(cents).padStart(2, "0").replace(/0$/, "")}`;
}

type Draft = { collectionGood: string; collectionWarning: string; attendanceGood: string; attendanceWarning: string; staleHours: string };

const toDraft = (s: AnalyticsSettingsData): Draft => ({
  collectionGood: bpsToText(s.collectionGoodBps),
  collectionWarning: bpsToText(s.collectionWarningBps),
  attendanceGood: bpsToText(s.attendanceGoodBps),
  attendanceWarning: bpsToText(s.attendanceWarningBps),
  staleHours: String(Math.max(1, Math.round(s.staleAfterSeconds / 3600))),
});

/**
 * Seuils de LECTURE (état « Bon / À surveiller / Critique ») et délai de fraîcheur de l'établissement. Aucun de ces réglages ne
 * change un chiffre ; les pourcentages sont convertis en points de base par lecture de chaîne (`parsePercentToBps`).
 */
export function SettingsPanel() {
  const t = useTranslations("v2Owner.settings");
  const query = useAnalyticsSettings();
  const update = useAnalyticsUpdateSettings();
  const flash = useFlash();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  useEffect(() => {
    if (query.data && draft === null) setDraft(toDraft(query.data));
  }, [query.data, draft]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const next: Partial<Record<keyof Draft, string>> = {};
    const bps = (key: Exclude<keyof Draft, "staleHours">): number | null => {
      const r = parsePercentToBps(draft[key]);
      if (!r.ok && draft[key].trim() !== "0") next[key] = t("invalidPercent");
      return r.ok ? r.bps : draft[key].trim() === "0" ? 0 : null;
    };
    const cg = bps("collectionGood");
    const cw = bps("collectionWarning");
    const ag = bps("attendanceGood");
    const aw = bps("attendanceWarning");
    if (cg !== null && cw !== null && cw > cg) next.collectionWarning = t("inverted");
    if (ag !== null && aw !== null && aw > ag) next.attendanceWarning = t("inverted");
    const hours = /^\d{1,3}$/.test(draft.staleHours.trim()) ? Number(draft.staleHours.trim()) : NaN;
    if (!(hours >= 1 && hours <= 168)) next.staleHours = t("invalidHours");
    setErrors(next);
    if (Object.keys(next).length > 0 || cg === null || cw === null || ag === null || aw === null) return;
    update.mutate(
      { collectionGoodBps: cg, collectionWarningBps: cw, attendanceGoodBps: ag, attendanceWarningBps: aw, staleAfterSeconds: hours * 3600 },
      { onSuccess: (saved) => { setDraft(toDraft(saved)); flash.show(t("saved")); } },
    );
  }

  const field = (key: keyof Draft, label: string, hint?: string) => (
    <FormField label={label} hint={hint} error={errors[key] ?? null}>
      {(c) => <TextControl {...c} inputMode="decimal" value={draft?.[key] ?? ""} onChange={(v) => setDraft((d) => (d ? { ...d, [key]: v } : d))} />}
    </FormField>
  );

  return (
    <Section id="hub-settings" title={t("title")}>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && draft ? (
        <form className="space-y-4" noValidate onSubmit={submit} aria-label={t("title")}>
          <p className="text-xs text-muted-foreground">{query.data.source === "TENANT" ? t("sourceTenant") : t("sourceDefault")}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {field("collectionGood", t("collectionGood"), t("percentHint"))}
            {field("collectionWarning", t("collectionWarning"))}
            {field("attendanceGood", t("attendanceGood"))}
            {field("attendanceWarning", t("attendanceWarning"))}
            {field("staleHours", t("staleHours"))}
          </div>
          {update.isError ? <ErrorBlock error={update.error} /> : null}
          {flash.node}
          <button type="submit" className={buttonClass.primary} disabled={update.isPending}>
            {t("save")}
          </button>
        </form>
      ) : null}
    </Section>
  );
}
