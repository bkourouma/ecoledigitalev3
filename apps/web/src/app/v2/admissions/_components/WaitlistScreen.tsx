"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAdmissionsSettings, useAdmissionsLookups, usePromoteFromWaitlist, useWaitlist } from "@/platform/v2/admissions";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { CampaignPicker, CopyableValue, useSelectedCampaign } from "./AdmissionsShell";
import { offerLink } from "./admissions-utils";

type Entry = NonNullable<ReturnType<typeof useWaitlist>["data"]>["entries"][number];

/**
 * Liste d'attente par niveau : l'ordre (priorité puis ancienneté) et le nombre de places libres sont ceux de l'API. La promotion
 * émet une offre ; le lien de réponse n'est montré qu'à cet instant (seule son empreinte est conservée).
 */
export function WaitlistScreen() {
  const t = useTranslations("v2Admissions.waitlist");
  const tc = useTranslations("v2Admissions.common");
  const fmt = useDateFormat();
  const describe = useDescribeError();
  const { campaigns, campaignId, selected, select } = useSelectedCampaign();
  const lookups = useAdmissionsLookups(selected?.institutionId);
  const settings = useAdmissionsSettings(selected?.institutionId);
  const [grade, setGrade] = useState("");
  const list = useWaitlist({ campaignId, grade: grade || null });
  const promote = usePromoteFromWaitlist();
  const [done, setDone] = useState<{ message: string; token: string | null } | null>(null);
  const grades = (selected?.capacities ?? []).map((c) => c.gradeLevelCode);
  const labels = new Map((lookups.data?.gradeLevels ?? []).map((g) => [g.code, g.label]));

  function run(applicationId?: string) {
    if (!campaignId || !grade) return;
    setDone(null);
    promote.mutate(
      { campaignId, grade, ...(applicationId ? { applicationId } : {}) },
      { onSuccess: (r) => setDone({ message: r.promoted ? t("promoted") : t("notPromoted", { reason: r.reason ?? "—" }), token: r.responseToken }) },
    );
  }

  const columns: DataTableColumn<Entry>[] = [
    { id: "position", header: t("columns.position"), headerLabel: t("columns.position"), cell: (e) => e.queuePosition },
    {
      id: "name",
      header: t("columns.name"),
      headerLabel: t("columns.name"),
      rowHeader: true,
      cell: (e) => (
        <Link href={`/v2/admissions/applications/${e.applicationId}`} className="font-medium text-primary hover:underline">
          {e.applicantFirstName} {e.applicantLastName}
        </Link>
      ),
    },
    { id: "priority", header: t("columns.priority"), headerLabel: t("columns.priority"), className: "hidden sm:table-cell", cell: (e) => e.priorityLabel ?? "—" },
    { id: "since", header: t("columns.since"), headerLabel: t("columns.since"), className: "hidden md:table-cell", cell: (e) => fmt.instant(e.waitlistEnteredAt) },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      headerLabel: t("columns.actions"),
      align: "right",
      cell: (e) => (
        <button type="button" className={buttonClass.secondary} disabled={promote.isPending} onClick={() => run(e.applicationId)} aria-label={t("promoteOne", { name: `${e.applicantFirstName} ${e.applicantLastName}` })}>
          {t("promote")}
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <CampaignPicker
          campaigns={campaigns}
          value={campaignId}
          onChange={(id) => {
            select(id);
            setGrade("");
          }}
        />
        <FormField label={tc("grade")}>
          {(c) => <NativeSelect {...c} value={grade} onChange={setGrade} placeholder={t("chooseGrade")} options={grades.map((g) => ({ value: g, label: labels.get(g) ?? g }))} />}
        </FormField>
      </div>
      {grade && list.data ? (
        <p className="mb-3 text-sm" role="status">
          {list.data.seatsLeft === null ? t("noCapacity") : t("seatsLeft", { count: list.data.seatsLeft })}
          {list.data.waitlistLimit !== null ? ` · ${t("limit", { count: list.data.waitlistLimit })}` : ""}
        </p>
      ) : null}
      {promote.error ? <Notice kind="error" className="mb-3">{describe(promote.error)}</Notice> : null}
      {done ? (
        <div className="mb-3 space-y-2">
          <Notice kind={done.token ? "success" : "info"}>{done.message}</Notice>
          {done.token && settings.data?.publicFormSlug ? <CopyableValue label={t("responseLink")} value={offerLink(window.location.origin, settings.data.publicFormSlug, done.token)} /> : null}
        </div>
      ) : null}
      {grade ? (
        <>
          <Can permission="admission.waitlist.manage">
            <div className="mb-3">
              <button type="button" className={buttonClass.primary} disabled={promote.isPending || (list.data?.entries.length ?? 0) === 0} onClick={() => run()}>
                {t("promoteFirst")}
              </button>
            </div>
          </Can>
          <DataTable
            caption={t("caption")}
            columns={columns}
            rows={list.data?.entries ?? []}
            getRowId={(e) => e.applicationId}
            isLoading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
            emptyTitle={t("empty")}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("pickGrade")}</p>
      )}
    </div>
  );
}
