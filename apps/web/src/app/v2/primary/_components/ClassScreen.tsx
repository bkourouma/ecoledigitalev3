"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, Unlock } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, QueryBoundary } from "@/platform/ui/states";
import { useMyPrimaryClassrooms } from "@/platform/v2/primary";
import { DailyCall } from "./DailyCall";
import { classLabel, RuleBanner } from "./shared";

/**
 * « Ma classe » (instituteur, mobile d'abord) : pour chaque classe, effectif, titulaire oui/non, périodes (verrouillée ou ouverte),
 * et accès en un geste à l'appel du jour, aux compétences et au conseil. Les liens non permis sont MASQUÉS ; l'API reste la barrière.
 */
export function ClassScreen() {
  const t = useTranslations("v2PrimaryClass");
  const classes = useMyPrimaryClassrooms();
  const canCall = usePermission("attendance.take").allowed;
  const competencyRead = usePermission("primary.competency.read").allowed;
  const competencyRecord = usePermission("primary.competency.record").allowed;
  const councilRead = usePermission("primary.council.read").allowed;
  const councilPrepare = usePermission("primary.council.prepare").allowed;
  const canCompetencies = competencyRead || competencyRecord;
  const canCouncil = councilRead || councilPrepare;
  const [callFor, setCallFor] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <RuleBanner />
      <QueryBoundary query={classes} isEmpty={(classes.data ?? []).length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ul className="space-y-4" aria-label={t("list")}>
          {(classes.data ?? []).map((c) => {
            const name = classLabel(c);
            const headingId = `class-${c.classroomId}`;
            return (
              <li key={c.classroomId}>
                <section aria-labelledby={headingId} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 id={headingId} className="text-lg font-semibold">
                        {name}
                      </h2>
                      <p className="text-sm text-muted-foreground">{c.gradeLevelCode ?? ""}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={t("students", { count: c.studentCount })} tone="neutral" />
                      <StatusBadge label={c.isHomeroom ? t("homeroomYes") : t("homeroomNo")} tone={c.isHomeroom ? "success" : "warning"} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">{t("periods")}</h3>
                    {c.periods.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("noPeriod")}</p>
                    ) : (
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {c.periods.map((p) => (
                          <li key={p.id} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm">
                            {p.locked ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Unlock className="h-4 w-4" aria-hidden="true" />}
                            <span>{p.label}</span>
                            <span className="text-xs font-medium">{p.locked ? t("periodLocked") : t("periodOpen")}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {canCall ? (
                      <button type="button" className={buttonClass.primary} aria-expanded={callFor === c.classroomId} onClick={() => setCallFor(callFor === c.classroomId ? null : c.classroomId)}>
                        {t("dailyCall")}
                      </button>
                    ) : null}
                    {canCompetencies ? (
                      <Link href={`/v2/primary/competences?classe=${c.classroomId}`} className={buttonClass.secondary}>
                        {t("competencies")}
                      </Link>
                    ) : null}
                    {canCouncil ? (
                      <Link href={`/v2/primary/conseil?classe=${c.classroomId}`} className={buttonClass.secondary}>
                        {t("council")}
                      </Link>
                    ) : null}
                  </div>
                  {callFor === c.classroomId ? <DailyCall classroomId={c.classroomId} onClose={() => setCallFor(null)} /> : null}
                </section>
              </li>
            );
          })}
        </ul>
      </QueryBoundary>
    </div>
  );
}
