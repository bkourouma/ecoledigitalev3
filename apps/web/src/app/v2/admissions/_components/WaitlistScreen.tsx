"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAdmissionsSettings, useAdmissionsLookups, usePromoteFromWaitlist, useReorderWaitlist, useWaitlist } from "@/platform/v2/admissions";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { CampaignPicker, CopyableValue, useSelectedCampaign } from "./AdmissionsShell";
import { offerLink } from "./admissions-utils";

type Entry = NonNullable<ReturnType<typeof useWaitlist>["data"]>["entries"][number];

/**
 * Liste d'attente par niveau : l'ordre est une DÉCISION de la direction (Q-A03), jamais un calcul d'ancienneté. Les dossiers « à
 * classer » sont affichés après les classés ; l'ancienneté et la priorité ne sont que des informations. La direction (permission
 * `admission.waitlist.reorder`) réordonne par boutons monter / descendre (clavier), avec un motif facultatif, puis enregistre : le
 * rang est tracé côté serveur. La promotion émet une offre ; le lien de réponse n'est montré qu'à cet instant (seule son empreinte
 * est conservée).
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
  const reorder = useReorderWaitlist();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const [done, setDone] = useState<{ message: string; token: string | null } | null>(null);
  const grades = (selected?.capacities ?? []).map((c) => c.gradeLevelCode);
  const labels = new Map((lookups.data?.gradeLevels ?? []).map((g) => [g.code, g.label]));

  const serverIds = (list.data?.entries ?? []).map((e) => e.applicationId);
  const byId = new Map((list.data?.entries ?? []).map((e) => [e.applicationId, e]));
  // Ordre affiché : le brouillon (si la liste n'a pas changé côté serveur), sinon l'ordre de l'API.
  const draftValid = draft !== null && draft.length === serverIds.length && draft.every((id) => byId.has(id));
  const shown: Entry[] = draftValid ? draft.map((id) => byId.get(id) as Entry) : (list.data?.entries ?? []);

  function move(id: string, delta: -1 | 1) {
    const ids = shown.map((e) => e.applicationId);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, id);
    setSaved(false);
    setDraft(next);
  }

  function saveOrder() {
    if (!campaignId || !grade || !draftValid) return;
    reorder.mutate(
      { campaignId, grade, orderedApplicationIds: draft, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          setDraft(null);
          setReason("");
          setSaved(true);
        },
      },
    );
  }

  function run(applicationId?: string) {
    if (!campaignId || !grade) return;
    setDone(null);
    promote.mutate(
      { campaignId, grade, ...(applicationId ? { applicationId } : {}) },
      { onSuccess: (r) => setDone({ message: r.promoted ? t("promoted") : t("notPromoted", { reason: r.reason ?? "—" }), token: r.responseToken }) },
    );
  }

  const columns: DataTableColumn<Entry>[] = [
    { id: "position", header: t("columns.position"), headerLabel: t("columns.position"), cell: (e) => (draftValid ? shown.indexOf(e) + 1 : (e.manualRank ?? <span className="text-muted-foreground">{t("toRank")}</span>)) },
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
      cell: (e) => {
        const name = `${e.applicantFirstName} ${e.applicantLastName}`;
        const index = shown.indexOf(e);
        return (
          <div className="flex flex-wrap justify-end gap-2">
            <Can permission="admission.waitlist.reorder">
              <button type="button" className={buttonClass.secondary} disabled={reorder.isPending || index <= 0} onClick={() => move(e.applicationId, -1)} aria-label={t("moveUp", { name })}>
                {t("up")}
              </button>
              <button type="button" className={buttonClass.secondary} disabled={reorder.isPending || index >= shown.length - 1} onClick={() => move(e.applicationId, 1)} aria-label={t("moveDown", { name })}>
                {t("down")}
              </button>
            </Can>
            <button type="button" className={buttonClass.secondary} disabled={promote.isPending || draftValid} onClick={() => run(e.applicationId)} aria-label={t("promoteOne", { name })}>
              {t("promote")}
            </button>
          </div>
        );
      },
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
      {reorder.error ? <Notice kind="error" className="mb-3">{describe(reorder.error)}</Notice> : null}
      {saved ? <Notice kind="success" className="mb-3">{t("orderSaved")}</Notice> : null}
      {grade && list.data && list.data.entries.some((e) => e.manualRank === null) && !draftValid ? <Notice kind="info" className="mb-3">{t("unranked")}</Notice> : null}
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
              <button type="button" className={buttonClass.primary} disabled={promote.isPending || draftValid || (list.data?.entries.length ?? 0) === 0} onClick={() => run()}>
                {t("promoteFirst")}
              </button>
            </div>
          </Can>
          <Can permission="admission.waitlist.reorder">
            {/* Un seul dossier : il n'y a rien à monter ni descendre, mais il peut être classé (rang 1) pour ne plus être « à classer » (L-72). */}
            {!draftValid && shown.length === 1 ? (
              <div className="mb-3">
                <button type="button" className={buttonClass.secondary} onClick={() => { setSaved(false); setDraft([shown[0]!.applicationId]); }}>
                  {t("rankSingle")}
                </button>
              </div>
            ) : null}
            {draftValid ? (
              <div className="mb-3 grid gap-3 sm:max-w-xl" role="group" aria-label={t("reorderGroup")}>
                <FormField label={t("reason")} hint={t("reasonHint")}>
                  {(c) => <TextControl {...c} value={reason} onChange={setReason} maxLength={500} />}
                </FormField>
                <div className="flex gap-2">
                  <button type="button" className={buttonClass.primary} disabled={reorder.isPending} onClick={saveOrder}>
                    {t("saveOrder")}
                  </button>
                  <button
                    type="button"
                    className={buttonClass.secondary}
                    disabled={reorder.isPending}
                    onClick={() => {
                      setDraft(null);
                      setReason("");
                    }}
                  >
                    {t("cancelOrder")}
                  </button>
                </div>
              </div>
            ) : null}
          </Can>
          <DataTable
            caption={t("caption")}
            columns={columns}
            rows={shown}
            getRowId={(e) => e.applicationId}
            isLoading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
            emptyTitle={t("empty")}
          />
          {list.data && list.data.changes.length > 0 ? (
            <section className="mt-6" aria-labelledby="waitlist-changes">
              <h2 id="waitlist-changes" className="mb-2 text-sm font-semibold">
                {t("changesTitle")}
              </h2>
              <ul className="space-y-1 text-sm">
                {list.data.changes.map((c) => (
                  <li key={c.id}>
                    {t("changeLine", {
                      name: byId.has(c.applicationId) ? `${byId.get(c.applicationId)!.applicantFirstName} ${byId.get(c.applicationId)!.applicantLastName}` : t("changeOther"),
                      from: c.fromRank ?? "—",
                      to: c.toRank ?? "—",
                      date: fmt.instant(c.occurredAt),
                    })}
                    {c.reason ? ` — ${c.reason}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("pickGrade")}</p>
      )}
    </div>
  );
}
