"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useCapacityReport, useFunnelReport, useRejectionsReport, useSlaReport, useSourcesReport } from "@/platform/v2/admissions";
import { PageHeader } from "@/platform/ui/PageHeader";
import { QueryBoundary } from "@/platform/ui/states";
import { CampaignPicker, useSelectedCampaign } from "./AdmissionsShell";

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border p-4">
      <h2 id={id} className="mb-3 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            {head.map((h) => (
              <th key={h} scope="col" className="py-1 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-t">
              {cells.map((cell, k) => (k === 0 ? <th key={k} scope="row" className="py-1 pr-3 text-left font-medium">{cell}</th> : <td key={k} className="py-1 pr-3">{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tableaux de bord de la campagne : entonnoir par statut canonique, capacités, délais par étape, sources, motifs de refus. */
export function ReportsScreen() {
  const t = useTranslations("v2Admissions.reports");
  const ts = useTranslations("v2Admissions.status");
  const { campaigns, campaignId, select } = useSelectedCampaign();
  const funnel = useFunnelReport(campaignId);
  const capacity = useCapacityReport(campaignId);
  const sla = useSlaReport(campaignId);
  const sources = useSourcesReport(campaignId);
  const rejections = useRejectionsReport(campaignId);

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="max-w-md">
        <CampaignPicker campaigns={campaigns} value={campaignId} onChange={select} />
      </div>
      {campaignId === null ? <p className="text-sm text-muted-foreground">{t("noCampaign")}</p> : null}
      <div className={campaignId === null ? "hidden" : "grid gap-4 lg:grid-cols-2"}>
        <Card id="rep-funnel" title={t("funnel")}>
          <QueryBoundary query={funnel}>
            {funnel.data ? (
              <div className="space-y-3">
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("received")}</dt>
                    <dd className="text-lg font-semibold">{funnel.data.received}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("processed")}</dt>
                    <dd className="text-lg font-semibold">{funnel.data.processed}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("averageHours")}</dt>
                    <dd className="text-lg font-semibold">{funnel.data.averageProcessingHours === null ? "—" : Math.round(funnel.data.averageProcessingHours)}</dd>
                  </div>
                </dl>
                <Table caption={t("funnel")} head={[t("status"), t("count")]} rows={funnel.data.byStatus.map((s) => [ts(s.status), s.count])} />
              </div>
            ) : null}
          </QueryBoundary>
        </Card>
        <Card id="rep-capacity" title={t("capacity")}>
          <QueryBoundary query={capacity}>
            {capacity.data ? (
              <Table
                caption={t("capacity")}
                head={[t("grade"), t("seats"), t("seatsLeft"), t("held"), t("waitlist")]}
                rows={capacity.data.rows.map((r) => [r.gradeLevelCode, r.configured ? (r.seats ?? "—") : t("notConfigured"), r.seatsLeft ?? "—", r.held, r.waitlist])}
              />
            ) : null}
          </QueryBoundary>
        </Card>
        <Card id="rep-sla" title={t("sla")}>
          <QueryBoundary query={sla}>
            {sla.data ? <Table caption={t("sla")} head={[t("stage"), t("slaHours"), t("inStage"), t("overdue"), t("averageStageHours")]} rows={sla.data.rows.map((r) => [r.stageLabel, r.slaHours ?? "—", r.inStage, r.overdue, r.averageHours === null ? "—" : Math.round(r.averageHours)])} /> : null}
          </QueryBoundary>
        </Card>
        <Card id="rep-sources" title={t("sources")}>
          <QueryBoundary query={sources}>
            {sources.data ? <Table caption={t("sources")} head={[t("source"), t("received"), t("enrolled")]} rows={sources.data.rows.map((r) => [r.sourceChannel, r.received, r.enrolled])} /> : null}
          </QueryBoundary>
        </Card>
        <Card id="rep-rejections" title={t("rejections")}>
          <QueryBoundary query={rejections}>
            {rejections.data ? <Table caption={t("rejections")} head={[t("reason"), t("count")]} rows={rejections.data.rows.map((r) => [r.label ?? r.reasonCode ?? t("noReason"), r.count])} /> : null}
          </QueryBoundary>
        </Card>
      </div>
    </div>
  );
}
