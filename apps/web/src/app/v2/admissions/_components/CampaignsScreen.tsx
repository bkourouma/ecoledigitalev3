"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { admissionsCreateCampaignBodySchema, type AdmissionsCampaignDto } from "@ecoledigitale/contracts/v2/admissions";
import { useAcademicYears } from "@/platform/v2/academic";
import { useAdmissionsLookups, useCampaignAction, useCampaigns, useCreateCampaign, useUpsertCapacities, useWorkflows } from "@/platform/v2/admissions";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, QueryBoundary, Notice } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { DateTimeControl } from "./DateTimeControl";
import { localInputToInstant, parseInteger } from "./admissions-utils";

const TONE = { DRAFT: "neutral", OPEN: "success", CLOSED: "warning", ARCHIVED: "neutral" } as const;

/** Campagnes d'admission : ouverture / clôture et capacités par niveau (places, limite de la liste d'attente). */
export function CampaignsScreen() {
  const t = useTranslations("v2Admissions.campaigns");
  const ts = useTranslations("v2Admissions.campaignStatus");
  const fmt = useDateFormat();
  const describe = useDescribeError();
  const campaigns = useCampaigns();
  const action = useCampaignAction();
  const [creating, setCreating] = useState(false);
  const [capacitiesOf, setCapacitiesOf] = useState<AdmissionsCampaignDto | null>(null);
  const items = campaigns.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="admission.campaign.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("new")}
            </button>
          </Can>
        }
      />
      {action.error ? <Notice kind="error" className="mb-3">{describe(action.error)}</Notice> : null}
      <QueryBoundary query={campaigns} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ul className="space-y-4">
          {items.map((c) => (
            <li key={c.id} className="rounded-2xl border border-white/10 bg-card/40 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">
                    {c.label} <span className="text-xs font-normal text-muted-foreground">({c.code})</span>
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("period", { from: fmt.instant(c.opensAt), to: fmt.instant(c.closesAt) })}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={ts(c.status)} tone={TONE[c.status]} />
                  <Can permission="admission.campaign.manage">
                    {c.status === "DRAFT" ? (
                      <button type="button" className={buttonClass.primary} disabled={action.isPending} onClick={() => action.mutate({ id: c.id, action: "open" })} aria-label={t("openAria", { label: c.label })}>
                        {t("open")}
                      </button>
                    ) : null}
                    {c.status === "OPEN" ? (
                      <button type="button" className={buttonClass.secondary} disabled={action.isPending} onClick={() => action.mutate({ id: c.id, action: "close" })} aria-label={t("closeAria", { label: c.label })}>
                        {t("close")}
                      </button>
                    ) : null}
                    {c.status === "DRAFT" || c.status === "OPEN" ? (
                      <button type="button" className={buttonClass.secondary} onClick={() => setCapacitiesOf(c)} aria-label={t("capacitiesAria", { label: c.label })}>
                        {t("capacities")}
                      </button>
                    ) : null}
                  </Can>
                </div>
              </div>
              {c.capacities.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t("capacitiesCaption", { label: c.label })}</caption>
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th scope="col" className="py-1 pr-3 font-medium">{t("grade")}</th>
                        <th scope="col" className="py-1 pr-3 font-medium">{t("seats")}</th>
                        <th scope="col" className="py-1 pr-3 font-medium">{t("seatsLeft")}</th>
                        <th scope="col" className="py-1 pr-3 font-medium">{t("waitlist")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.capacities.map((cap) => (
                        <tr key={cap.id} className="border-t">
                          <th scope="row" className="py-1 pr-3 text-left font-medium">{cap.gradeLevelCode}</th>
                          <td className="py-1 pr-3">{cap.seats}</td>
                          <td className="py-1 pr-3">{cap.seatsLeft ?? "—"}</td>
                          <td className="py-1 pr-3">{cap.waitlistLimit === null ? cap.waitlistCount : `${cap.waitlistCount} / ${cap.waitlistLimit}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">{t("noCapacity")}</p>
              )}
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {creating ? <CreateDialog onClose={() => setCreating(false)} /> : null}
      {capacitiesOf ? <CapacitiesDialog campaign={capacitiesOf} onClose={() => setCapacitiesOf(null)} /> : null}
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("v2Admissions.campaigns");
  const create = useCreateCampaign();
  const years = useAcademicYears();
  const workflows = useWorkflows();
  const [yearId, setYearId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [opens, setOpens] = useState("");
  const [closes, setCloses] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(create.error), ...errors };
  const published = (workflows.data?.items ?? []).filter((w) => w.status === "PUBLISHED");

  function submit() {
    const checked = validateWith(admissionsCreateCampaignBodySchema, { academicYearId: yearId, workflowId, code: code.trim().toUpperCase(), label, opensAt: localInputToInstant(opens) ?? "", closesAt: localInputToInstant(closes) ?? "" });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    if (Date.parse(checked.data.closesAt) <= Date.parse(checked.data.opensAt)) {
      setErrors({ closesAt: t("closesAfterOpens") });
      return;
    }
    setErrors({});
    create.mutate(checked.data, { onSuccess: onClose });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("newTitle")} submitLabel={t("create")} onSubmit={submit} isPending={create.isPending} error={Object.keys(apiErrorToFieldErrors(create.error)).length === 0 ? create.error : undefined}>
      <FormField label={t("year")} required error={shown["academicYearId"]}>
        {(c) => <NativeSelect {...c} value={yearId} onChange={setYearId} placeholder={t("choose")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
      </FormField>
      <FormField label={t("workflow")} hint={published.length === 0 ? t("noPublishedWorkflow") : undefined} required error={shown["workflowId"]}>
        {(c) => <NativeSelect {...c} value={workflowId} onChange={setWorkflowId} placeholder={t("choose")} options={published.map((w) => ({ value: w.id, label: `${w.label} (v${w.version})` }))} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("code")} required error={shown["code"]}>
          {(c) => <TextControl {...c} value={code} onChange={setCode} maxLength={40} />}
        </FormField>
        <FormField label={t("label")} required error={shown["label"]}>
          {(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={160} />}
        </FormField>
        <FormField label={t("opensAt")} required error={shown["opensAt"]}>
          {(c) => <DateTimeControl {...c} value={opens} onChange={setOpens} />}
        </FormField>
        <FormField label={t("closesAt")} required error={shown["closesAt"]}>
          {(c) => <DateTimeControl {...c} value={closes} onChange={setCloses} />}
        </FormField>
      </div>
    </FormDialog>
  );
}

interface CapacityRow {
  gradeLevelCode: string;
  seats: string;
  waitlistLimit: string;
}

function CapacitiesDialog({ campaign, onClose }: { campaign: AdmissionsCampaignDto; onClose: () => void }) {
  const t = useTranslations("v2Admissions.campaigns");
  const save = useUpsertCapacities(campaign.id);
  const lookups = useAdmissionsLookups(campaign.institutionId);
  const [rows, setRows] = useState<CapacityRow[]>(campaign.capacities.map((c) => ({ gradeLevelCode: c.gradeLevelCode, seats: String(c.seats), waitlistLimit: c.waitlistLimit === null ? "" : String(c.waitlistLimit) })));
  const [error, setError] = useState<string | null>(null);
  const known = new Set(rows.map((r) => r.gradeLevelCode));
  const available = (lookups.data?.gradeLevels ?? []).filter((g) => !known.has(g.code));
  const [adding, setAdding] = useState("");

  function submit() {
    const capacities: Array<{ gradeLevelCode: string; seats: number; waitlistLimit: number | null }> = [];
    for (const r of rows) {
      const seats = parseInteger(r.seats, 0, 100000);
      const limit = r.waitlistLimit.trim() === "" ? null : parseInteger(r.waitlistLimit, 0, 100000);
      if (seats === null || (r.waitlistLimit.trim() !== "" && limit === null)) {
        setError(t("capacityInvalid", { grade: r.gradeLevelCode }));
        return;
      }
      capacities.push({ gradeLevelCode: r.gradeLevelCode, seats, waitlistLimit: limit });
    }
    setError(null);
    save.mutate({ capacities }, { onSuccess: onClose });
  }

  return (
    <FormDialog open wide onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("capacitiesTitle", { label: campaign.label })} description={t("capacitiesDescription")} submitLabel={t("save")} onSubmit={submit} isPending={save.isPending} error={save.error}>
      {rows.map((r, i) => (
        <fieldset key={r.gradeLevelCode} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <legend className="sr-only">{r.gradeLevelCode}</legend>
          <p className="text-sm font-medium">{r.gradeLevelCode}</p>
          <FormField label={t("seats")}>
            {(c) => <TextControl {...c} inputMode="numeric" value={r.seats} onChange={(v) => setRows((list) => list.map((x, k) => (k === i ? { ...x, seats: v } : x)))} />}
          </FormField>
          <FormField label={t("waitlistLimit")}>
            {(c) => <TextControl {...c} inputMode="numeric" value={r.waitlistLimit} onChange={(v) => setRows((list) => list.map((x, k) => (k === i ? { ...x, waitlistLimit: v } : x)))} placeholder={t("unlimited")} />}
          </FormField>
          <button type="button" className={buttonClass.ghost} onClick={() => setRows((list) => list.filter((_, k) => k !== i))} aria-label={t("removeGrade", { grade: r.gradeLevelCode })}>
            {t("remove")}
          </button>
        </fieldset>
      ))}
      {available.length > 0 ? (
        <div className="flex items-end gap-2">
          <FormField label={t("addGrade")} className="flex-1">
            {(c) => <NativeSelect {...c} value={adding} onChange={setAdding} placeholder={t("choose")} options={available.map((g) => ({ value: g.code, label: g.label }))} />}
          </FormField>
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={!adding}
            onClick={() => {
              setRows((list) => [...list, { gradeLevelCode: adding, seats: "0", waitlistLimit: "" }]);
              setAdding("");
            }}
          >
            {t("add")}
          </button>
        </div>
      ) : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
    </FormDialog>
  );
}
