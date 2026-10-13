"use client";

import Link from "next/link";
import { AlertTriangle, CalendarClock, ClipboardCheck, Hourglass, UserX, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDashboard } from "@/platform/v2/schoollife";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, QueryBoundary } from "@/platform/ui/states";
import { Can } from "@/platform/ui/AccessGate";
import { KindLabel, StatusLabel, useDateTime } from "./shared";

/**
 * Tableau de bord de la vie scolaire : comptages et files d'attente renvoyés par l'API (déjà bornés par l'habilitation de
 * confidentialité de l'utilisateur : un élément confidentiel n'apparaît que masqué). Aucun calcul ici.
 */
export function DashboardScreen() {
  const t = useTranslations("v2Schoollife.dashboard");
  const dt = useDateTime();
  const q = useDashboard();
  const d = q.data;
  const cards: Array<{ key: string; value: number; href: string | null; icon: LucideIcon }> = d
    ? [
        { key: "openIncidents", value: d.openIncidents, href: null, icon: AlertTriangle },
        { key: "measuresToValidate", value: d.measuresToValidate, href: "/v2/schoollife/validations", icon: ClipboardCheck },
        { key: "activeExclusions", value: d.activeExclusions, href: null, icon: UserX },
        { key: "convocationsToHold", value: d.convocationsToHold, href: "/v2/schoollife/convocations", icon: CalendarClock },
        { key: "effectsAwaitingHuman", value: d.effectsAwaitingHuman, href: "/v2/schoollife/validations", icon: Hourglass },
      ]
    : [];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="schoollife.incident.write">
            <Link href="/v2/schoollife/saisie" className={buttonClass.primary}>
              {t("quickEntry")}
            </Link>
          </Can>
        }
      />
      <QueryBoundary query={q}>
        {d ? (
          <>
            <ul aria-label={t("countsLabel")} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {cards.map((c) => (
                <li key={c.key} className="relative rounded-2xl border border-white/10 bg-card/60 p-4 transition-colors hover:border-violet-400/30">
                  <span aria-hidden="true" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
                    <c.icon className="h-[18px] w-[18px]" />
                  </span>
                  <p className="text-3xl font-semibold tabular-nums tracking-tight">{c.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {c.href ? (
                      <Link href={c.href} className="underline-offset-4 hover:underline">
                        {t(`cards.${c.key}`)}
                      </Link>
                    ) : (
                      t(`cards.${c.key}`)
                    )}
                  </p>
                </li>
              ))}
            </ul>

            <section aria-labelledby="sl-recent" className="space-y-2">
              <h2 id="sl-recent" className="text-lg font-semibold">
                {t("recentIncidents")}
              </h2>
              {d.recentIncidents.length === 0 ? (
                <EmptyBlock title={t("noIncidents")} />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {d.recentIncidents.map((i) => {
                    const studentId = i.involvements[0]?.studentId;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                        <StatusLabel status={i.status} />
                        <span className="min-w-0 flex-1">
                          {i.masked ? <em className="text-muted-foreground">{t("masked")}</em> : (i.description ?? "")}
                          <span className="block text-xs text-muted-foreground">
                            {dt.dateTime(i.occurredAt)} · {i.reportedByName}
                            {i.involvements.length > 0 ? ` · ${i.involvements.map((v) => v.studentName ?? "—").join(", ")}` : ""}
                          </span>
                        </span>
                        {studentId ? (
                          <Link href={`/v2/schoollife/eleves/${studentId}`} className={buttonClass.ghost}>
                            {t("openFile")}
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="sl-pending" className="space-y-2">
              <h2 id="sl-pending" className="text-lg font-semibold">
                {t("pendingMeasures")}
              </h2>
              {d.pendingMeasures.length === 0 ? (
                <EmptyBlock title={t("noPending")} />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {d.pendingMeasures.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 p-3">
                      <KindLabel kind={m.kind} />
                      <span className="min-w-0 flex-1">
                        {m.studentName ?? "—"}
                        <span className="block text-xs text-muted-foreground">
                          {m.masked ? t("masked") : (m.typeLabel ?? "")} · {m.proposedByName} · {dt.dateTime(m.proposedAt)}
                        </span>
                      </span>
                      <Link href={`/v2/schoollife/eleves/${m.studentId}`} className={buttonClass.ghost}>
                        {t("openFile")}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="sl-conv" className="space-y-2">
              <h2 id="sl-conv" className="text-lg font-semibold">
                {t("upcomingConvocations")}
              </h2>
              {d.upcomingConvocations.length === 0 ? (
                <EmptyBlock title={t("noConvocations")} />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {d.upcomingConvocations.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                      <StatusLabel status={c.status} />
                      <span className="min-w-0 flex-1">
                        {c.studentName ?? "—"}
                        <span className="block text-xs text-muted-foreground">
                          {dt.dateTime(c.scheduledAt)}
                          {c.masked || !c.location ? "" : ` · ${c.location}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}
