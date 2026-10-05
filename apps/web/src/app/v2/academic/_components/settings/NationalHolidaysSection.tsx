"use client";

import { useTranslations } from "next-intl";
import type { AcademicNationalHolidayDto } from "@ecoledigitale/contracts/v2/academic";
import { useNationalHolidays, useSetNationalHolidayEnabled } from "@/platform/v2/national-holidays";
import { StatusBadge, buttonClass } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { CardList, ItemCard, SettingsSection } from "./shared";

/**
 * Décision O-10 : calendrier national des jours fériés préchargé par la plateforme. Chaque établissement peut activer ou
 * désactiver une fête nationale ; pour en AJOUTER (ou saisir la date d'une fête mobile) il utilise le calendrier de
 * l'établissement juste en dessous. Les dates livrées sont des valeurs de démonstration « à confirmer » : l'écran le dit.
 */
const MONTH_KEYS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

export function NationalHolidaysSection({ institutionId, canManage }: { institutionId: string | null; canManage: boolean }) {
  const t = useTranslations("v2NationalHolidays");
  const list = useNationalHolidays(institutionId);
  const toggle = useSetNationalHolidayEnabled();
  const flash = useFlash();
  const rows = list.data ?? [];

  const dateOf = (h: AcademicNationalHolidayDto): string => (h.recurrence === "FIXED_DATE" && h.month !== null && h.day !== null ? t("fixedDate", { day: h.day, month: t(`months.${MONTH_KEYS[h.month - 1]!}`) }) : t("movable"));

  return (
    <SettingsSection id="national-holidays" title={t("title")} description={t("description")}>
      <Notice kind="info">{t("toConfirmNote")}</Notice>
      {flash.node}
      {list.isPending && list.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : null}
      {toggle.error ? <ErrorBlock error={toggle.error} /> : null}
      {list.data && rows.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      {rows.length > 0 ? (
        <CardList label={t("listLabel")}>
          {rows.map((h) => (
            <ItemCard
              key={h.code}
              title={h.label}
              code={h.code}
              inactive={!h.enabled}
              badges={
                <>
                  {h.needsConfirmation ? <StatusBadge label={t("toConfirm")} tone="warning" /> : <StatusBadge label={t("confirmed")} tone="success" />}
                  <StatusBadge label={h.enabled ? t("enabled") : t("disabled")} tone={h.enabled ? "success" : "neutral"} />
                </>
              }
              meta={
                <>
                  <span>{dateOf(h)}</span>
                  {h.recurrence === "MOVABLE" ? <span className="block">{t("movableHint")}</span> : null}
                </>
              }
              actions={
                canManage && institutionId ? (
                  <button
                    type="button"
                    className={buttonClass.ghost}
                    disabled={toggle.isPending}
                    aria-label={`${h.enabled ? t("disable") : t("enable")} — ${h.label}`}
                    onClick={() => void toggle.mutateAsync({ code: h.code, institutionId, enabled: !h.enabled }).then(() => flash.show(h.enabled ? t("disabledDone", { label: h.label }) : t("enabledDone", { label: h.label }))).catch(() => undefined)}
                  >
                    {h.enabled ? t("disable") : t("enable")}
                  </button>
                ) : null
              }
            />
          ))}
        </CardList>
      ) : null}
    </SettingsSection>
  );
}
