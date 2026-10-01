"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { callKey, type CallTarget } from "@/platform/offline/attendance-outbox";
import { useOutboxManager, useOutboxStatus } from "@/platform/offline/OutboxProvider";
import { usePermission } from "@/platform/access";
import { buttonClass } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";

/** Codes d'erreur de séance/soumission que l'écran sait expliquer ; tout autre code est affiché tel quel. */
const KNOWN_CODES = ["attendance.unmarked_students", "attendance.occurrence_cancelled", "attendance.forbidden", "attendance.session_locked", "local.invalid_batch"] as const;

/**
 * Ce que l'API a renvoyé pour l'appel de CET appareil : pointages en conflit (soumis à l'arbitrage de la direction),
 * pointages refusés, séance rejetée ou soumission refusée. Rien n'est jamais perdu en silence : la personne voit
 * ce qui n'a pas été appliqué et peut réessayer, abandonner ou prendre acte.
 */
export function CallOutcomeBanner({ target, names }: { target: CallTarget; names: ReadonlyMap<string, string> }) {
  const t = useTranslations("v2Attendance.outcome");
  const manager = useOutboxManager();
  const status = useOutboxStatus();
  const canArbitrate = usePermission("attendance.manage").allowed;
  const call = status.calls.find((c) => c.key === callKey(target));
  if (!call) return null;
  const nameOf = (id: string) => names.get(id) ?? t("student", { id: id.slice(-4) });
  const hasNotes = call.conflicts.length > 0 || call.rejected.length > 0 || call.lastError !== null;
  if (!hasNotes) return null;
  const pending = Object.keys(call.records).length > 0 || call.submit !== null;

  return (
    <div className="space-y-2" data-testid="call-outcome">
      {call.conflicts.length > 0 ? (
        <Notice kind="warning">
          <p className="font-medium">{t("conflictsTitle", { count: call.conflicts.length })}</p>
          <p className="mt-1">{t("conflictsBody")}</p>
          <ul className="mt-1 list-disc pl-5">
            {call.conflicts.map((c) => (
              <li key={`${c.studentId}-${c.conflictId ?? ""}`}>{nameOf(c.studentId)}</li>
            ))}
          </ul>
          {canArbitrate ? (
            <Link href="/v2/attendance/conflicts" className="mt-2 inline-block font-medium underline underline-offset-4">
              {t("openConflicts")}
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {call.rejected.length > 0 ? (
        <Notice kind="error">
          <p className="font-medium">{t("rejectedTitle", { count: call.rejected.length })}</p>
          <ul className="mt-1 list-disc pl-5">
            {call.rejected.map((r) => (
              <li key={r.studentId}>
                {nameOf(r.studentId)}
                {r.code ? ` (${r.code})` : ""}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {call.lastError ? (
        <Notice kind="error">
          <p className="font-medium">{(KNOWN_CODES as readonly string[]).includes(call.lastError.code) ? t(`codes.${call.lastError.code.replace(/\./g, "_")}`) : t("errorGeneric", { code: call.lastError.code })}</p>
          <p className="mt-1">{pending ? t("errorKept") : t("errorSessionOnly")}</p>
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {call.lastError && pending ? (
          <button type="button" className={buttonClass.secondary} onClick={() => void manager.retry(target)}>
            {t("retry")}
          </button>
        ) : null}
        {call.lastError && pending ? (
          <button type="button" className={buttonClass.ghost} onClick={() => void manager.discard(target)}>
            {t("discard")}
          </button>
        ) : null}
        {!pending ? (
          <button type="button" className={buttonClass.secondary} onClick={() => void manager.dismiss(target)}>
            {t("acknowledge")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
