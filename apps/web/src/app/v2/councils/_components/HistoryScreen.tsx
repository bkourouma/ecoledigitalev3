"use client";

import { useTranslations } from "next-intl";
import { useCouncil, useCouncilEvents, useUnlockRequests } from "@/platform/v2/councils";
import { PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock } from "@/platform/ui/states";
import { CouncilStatusBar } from "./CouncilParts";
import { CouncilSubNav, CouncilsBoundary, EnumLabel, PlaceholderBanner, ScrollTable, Section, TD, TH, councilTitle, useDateTime } from "./shared";

/** Historique : journal de séance (qui, quand, quoi, motif), demandes de déverrouillage et réouvertures. Lecture seule. */
export function HistoryScreen({ councilId }: { councilId: string }) {
  const t = useTranslations("v2Councils.history");
  const te = useTranslations("v2Councils.history.events");
  const tu = useTranslations("v2Councils.unlock");
  const dt = useDateTime();
  const council = useCouncil(councilId);
  const events = useCouncilEvents(councilId);
  const unlocks = useUnlockRequests(councilId);
  const list = [...(events.data ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const requests = unlocks.data ?? [];
  const label = (kind: string) => {
    const key = /^[A-Z_]+$/.test(kind) ? (kind === "RESULTS_REOPENED" ? "results_reopened" : `council_${kind.toLowerCase()}`) : kind.replace(/^councils\./, "").replace(/\./g, "_");
    return te.has(key) ? te(key) : kind;
  };
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={council.data ? councilTitle(council.data.council) : t("description")} />
      <CouncilSubNav councilId={councilId} current="history" />
      {council.data ? (
        <>
          <PlaceholderBanner ruleSourceKind={council.data.council.ruleSourceKind} />
          <CouncilStatusBar detail={council.data} compact />
          <p className="text-sm">
            <StatusBadge label={t("reopenCount", { count: council.data.council.reopenCount })} tone={council.data.council.reopenCount > 0 ? "warning" : "neutral"} />
          </p>
        </>
      ) : null}
      <Section id="hist-events" title={t("journal")}>
        <CouncilsBoundary query={events} isEmpty={list.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
          <ScrollTable caption={t("journalCaption")}>
            <thead>
              <tr className="border-b">
                <th scope="col" className={TH}>{t("when")}</th>
                <th scope="col" className={TH}>{t("what")}</th>
                <th scope="col" className={TH}>{t("who")}</th>
                <th scope="col" className={TH}>{t("reason")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((e) => (
                <tr key={e.id}>
                  <td className={TD}>{dt.dateTime(e.occurredAt)}</td>
                  <td className={TD}>{label(e.kind)}</td>
                  <td className={TD}>{e.actorKind ?? "—"}</td>
                  <td className={TD}>{e.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </CouncilsBoundary>
      </Section>
      <Section id="hist-unlocks" title={t("unlocks")}>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tu("none")}</p>
        ) : (
          <ScrollTable caption={tu("caption")}>
            <thead>
              <tr className="border-b">
                <th scope="col" className={TH}>{tu("requestedBy")}</th>
                <th scope="col" className={TH}>{tu("reason")}</th>
                <th scope="col" className={TH}>{tu("status")}</th>
                <th scope="col" className={TH}>{tu("decidedBy")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className={TD}>
                    {r.requestedByName}
                    <div className="text-xs text-muted-foreground">{dt.dateTime(r.requestedAt)}</div>
                  </td>
                  <td className={TD}>{r.reason}</td>
                  <td className={TD}><EnumLabel group="unlockStatus" value={r.status} /></td>
                  <td className={TD}>
                    {r.decidedByName ?? "—"}
                    {r.decisionNote ? <div className="text-xs text-muted-foreground">{r.decisionNote}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        )}
      </Section>
    </div>
  );
}
