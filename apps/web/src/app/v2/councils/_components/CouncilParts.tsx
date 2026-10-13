"use client";

import { useTranslations } from "next-intl";
import type { CouncilsCouncilDetailDto } from "@ecoledigitale/contracts/v2/councils";
import { StatusBadge } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { EnumLabel, useDateTime } from "./shared";

/**
 * Bandeau d'état de la séance : statut, date, lieu et quorum. Le quorum est CELUI DE L'API (présents, minimum, rôles
 * manquants, président) : le web ne recalcule rien.
 */
export function CouncilStatusBar({ detail, compact = false }: { detail: CouncilsCouncilDetailDto; compact?: boolean }) {
  const t = useTranslations("v2Councils.statusBar");
  const dt = useDateTime();
  const { council, quorum } = detail;
  return (
    <div role="status" aria-label={t("label")} className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <EnumLabel group="status" value={council.status} />
        <StatusBadge label={quorum.met ? t("quorumMet") : t("quorumNotMet")} tone={quorum.met ? "success" : "danger"} />
        <span className="text-sm">
          {quorum.requiredMin !== null ? t("present", { present: quorum.presentCount, required: quorum.requiredMin }) : t("presentNoMin", { present: quorum.presentCount })}
        </span>
        {council.reopenCount > 0 ? <StatusBadge label={t("reopened", { count: council.reopenCount })} tone="warning" /> : null}
        {council.quorumWaived ? <StatusBadge label={t("waived")} tone="warning" /> : null}
      </div>
      {compact ? null : (
        <p className="text-sm text-muted-foreground">
          {council.heldOn ? t("heldOn", { date: dt.date(council.heldOn) }) : council.scheduledAt ? t("scheduledAt", { date: dt.dateTime(council.scheduledAt) }) : t("noDate")}
          {council.location ? ` · ${council.location}` : ""}
        </p>
      )}
      {!quorum.met && quorum.missingRoles.length > 0 ? (
        <p className="text-sm">
          {t("missingRoles")} : {quorum.missingRoles.join(", ")}
        </p>
      ) : null}
      {!quorum.presidentPresent ? <p className="text-sm">{t("presidentAbsent")}</p> : null}
      {council.quorumWaived && council.quorumWaiverReason ? (
        <p className="text-sm">
          {t("waiverReason")} : {council.quorumWaiverReason}
        </p>
      ) : null}
      {council.cancelReason ? (
        <p className="text-sm">
          {t("cancelReason")} : {council.cancelReason}
        </p>
      ) : null}
    </div>
  );
}

/** Avertissements non bloquants renvoyés par l'API (assiduité indisponible, élèves non préparés…). */
export function CouncilWarnings({ warnings }: { warnings: ReadonlyArray<{ code: string; message: string }> }) {
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <Notice key={w.code} kind="info">
          {w.message}
        </Notice>
      ))}
    </div>
  );
}
