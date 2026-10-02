"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ADMISSION_PROSPECT_STATUSES, admissionsConvertProspectBodySchema, admissionsCreateProspectBodySchema, type AdmissionsProspectDto } from "@ecoledigitale/contracts/v2/admissions";
import { useAdmissionsLookups, useConvertProspect, useCreateProspect, useProspects, useUpdateProspect } from "@/platform/v2/admissions";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { useDebounced } from "@/platform/ui/useDebounced";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CampaignPicker, useSelectedCampaign } from "./AdmissionsShell";
import { blankToUndefined } from "./admissions-utils";

const TONE = { NEW: "info", CONTACTED: "warning", CONVERTED: "success", LOST: "neutral" } as const;

/** Prospects (premiers contacts) : saisie, suivi, perte motivée et conversion en candidature. */
export function ProspectsScreen() {
  const t = useTranslations("v2Admissions.prospects");
  const ts = useTranslations("v2Admissions.prospectStatus");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim(), 300);
  const list = useProspects({ status: status || undefined, q: q || undefined, page, pageSize: 30 });
  const update = useUpdateProspect();
  const [creating, setCreating] = useState(false);
  const [converting, setConverting] = useState<AdmissionsProspectDto | null>(null);
  const [losing, setLosing] = useState<AdmissionsProspectDto | null>(null);

  const columns: DataTableColumn<AdmissionsProspectDto>[] = [
    { id: "name", header: t("columns.name"), headerLabel: t("columns.name"), rowHeader: true, cell: (p) => `${p.firstName} ${p.lastName}` },
    { id: "contact", header: t("columns.contact"), headerLabel: t("columns.contact"), className: "hidden sm:table-cell", cell: (p) => [p.contactPhone, p.contactEmail].filter(Boolean).join(" · ") || "—" },
    { id: "grade", header: t("columns.grade"), headerLabel: t("columns.grade"), className: "hidden md:table-cell", cell: (p) => p.interestedGradeLevelCode ?? "—" },
    { id: "status", header: t("columns.status"), headerLabel: t("columns.status"), cell: (p) => <StatusBadge label={ts(p.status)} tone={TONE[p.status]} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      headerLabel: t("columns.actions"),
      align: "right",
      cell: (p) => (
        <span className="flex flex-wrap justify-end gap-2">
          {p.status === "NEW" ? (
            <button type="button" className={buttonClass.ghost} disabled={update.isPending} onClick={() => update.mutate({ id: p.id, patch: { status: "CONTACTED" } })} aria-label={t("markContactedAria", { name: `${p.firstName} ${p.lastName}` })}>
              {t("markContacted")}
            </button>
          ) : null}
          {p.status === "NEW" || p.status === "CONTACTED" ? (
            <>
              <button type="button" className={buttonClass.secondary} onClick={() => setConverting(p)} aria-label={t("convertAria", { name: `${p.firstName} ${p.lastName}` })}>
                {t("convert")}
              </button>
              <button type="button" className={buttonClass.ghost} onClick={() => setLosing(p)} aria-label={t("loseAria", { name: `${p.firstName} ${p.lastName}` })}>
                {t("lose")}
              </button>
            </>
          ) : null}
          {p.convertedApplicationId ? (
            <Link href={`/v2/admissions/applications/${p.convertedApplicationId}`} className="text-sm text-primary hover:underline">
              {t("openApplication")}
            </Link>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
            {t("new")}
          </button>
        }
      />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl" role="search" aria-label={t("filters")} onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("status")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              placeholder={t("allStatuses")}
              options={ADMISSION_PROSPECT_STATUSES.map((s) => ({ value: s, label: ts(s) }))}
            />
          )}
        </FormField>
        <FormField label={t("search")}>
          {(c) => (
            <TextControl
              {...c}
              type="search"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              maxLength={120}
            />
          )}
        </FormField>
      </form>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(p) => p.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        pagination={{ page, pageSize: 30, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
      {creating ? <CreateDialog onClose={() => setCreating(false)} /> : null}
      {converting ? <ConvertDialog prospect={converting} onClose={() => setConverting(null)} /> : null}
      {losing ? (
        <ReasonDialog
          open
          onOpenChange={(o) => (!o ? setLosing(null) : undefined)}
          title={t("loseTitle", { name: `${losing.firstName} ${losing.lastName}` })}
          reasonLabel={t("loseReason")}
          confirmLabel={t("lose")}
          minLength={3}
          maxLength={300}
          isPending={update.isPending}
          error={update.error}
          onConfirm={(reason) => update.mutate({ id: losing.id, patch: { status: "LOST", lostReason: reason } }, { onSuccess: () => setLosing(null) })}
        />
      ) : null}
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("v2Admissions.prospects");
  const create = useCreateProspect();
  const lookups = useAdmissionsLookups();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [grade, setGrade] = useState("");
  const [source, setSource] = useState("WALK_IN");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(create.error), ...errors };

  function submit() {
    const body = {
      firstName: first,
      lastName: last,
      ...(blankToUndefined(phone) ? { contactPhone: phone.trim() } : {}),
      ...(blankToUndefined(email) ? { contactEmail: email.trim() } : {}),
      ...(grade ? { interestedGradeLevelCode: grade } : {}),
      sourceChannel: source,
      ...(blankToUndefined(notes) ? { notes: notes.trim() } : {}),
    };
    const checked = validateWith(admissionsCreateProspectBodySchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(checked.data, { onSuccess: onClose });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("newTitle")} submitLabel={t("save")} onSubmit={submit} isPending={create.isPending} error={Object.keys(apiErrorToFieldErrors(create.error)).length === 0 ? create.error : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("firstName")} required error={shown["firstName"]}>
          {(c) => <TextControl {...c} value={first} onChange={setFirst} maxLength={100} />}
        </FormField>
        <FormField label={t("lastName")} required error={shown["lastName"]}>
          {(c) => <TextControl {...c} value={last} onChange={setLast} maxLength={100} />}
        </FormField>
        <FormField label={t("phone")} hint={t("contactHint")} error={shown["contactPhone"]}>
          {(c) => <TextControl {...c} type="tel" value={phone} onChange={setPhone} maxLength={24} />}
        </FormField>
        <FormField label={t("email")} error={shown["contactEmail"]}>
          {(c) => <TextControl {...c} type="email" value={email} onChange={setEmail} maxLength={200} />}
        </FormField>
      </div>
      <FormField label={t("grade")} error={shown["interestedGradeLevelCode"]}>
        {(c) => <NativeSelect {...c} value={grade} onChange={setGrade} placeholder={t("unspecified")} options={(lookups.data?.gradeLevels ?? []).map((g) => ({ value: g.code, label: g.label }))} />}
      </FormField>
      <FormField label={t("source")} error={shown["sourceChannel"]}>
        {(c) => <NativeSelect {...c} value={source} onChange={setSource} options={["WALK_IN", "PHONE", "REFERRAL", "SOCIAL", "WEBSITE", "EVENT", "OTHER"].map((s) => ({ value: s, label: t(`sources.${s}`) }))} />}
      </FormField>
      <FormField label={t("notes")} error={shown["notes"]}>
        {(c) => <TextAreaControl {...c} value={notes} onChange={setNotes} maxLength={2000} />}
      </FormField>
    </FormDialog>
  );
}

function ConvertDialog({ prospect, onClose }: { prospect: AdmissionsProspectDto; onClose: () => void }) {
  const t = useTranslations("v2Admissions.prospects");
  const router = useRouter();
  const convert = useConvertProspect();
  const lookups = useAdmissionsLookups(prospect.institutionId);
  const { campaigns, campaignId, select } = useSelectedCampaign();
  const [first, setFirst] = useState("");
  const [birth, setBirth] = useState("");
  const [grade, setGrade] = useState(prospect.interestedGradeLevelCode ?? "");
  const [relationship, setRelationship] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const shown = { ...apiErrorToFieldErrors(convert.error), ...errors };

  function submit() {
    const body = { campaignId: campaignId ?? "", birthDate: birth, desiredGradeLevelCode: grade, applicantFirstName: first, ...(relationship ? { guardianRelationshipCode: relationship } : {}), applicantLastName: prospect.lastName };
    const checked = validateWith(admissionsConvertProspectBodySchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    convert.mutate({ id: prospect.id, body: checked.data }, { onSuccess: (r) => router.push(`/v2/admissions/applications/${r.applicationId}`) });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={t("convertTitle", { name: `${prospect.firstName} ${prospect.lastName}` })} description={t("convertDescription")} submitLabel={t("convert")} onSubmit={submit} isPending={convert.isPending} error={Object.keys(apiErrorToFieldErrors(convert.error)).length === 0 ? convert.error : undefined}>
      <CampaignPicker campaigns={campaigns} value={campaignId} onChange={select} />
      <FormField label={t("applicantFirstName")} required error={shown["applicantFirstName"]}>
        {(c) => <TextControl {...c} value={first} onChange={setFirst} maxLength={100} />}
      </FormField>
      <FormField label={t("birthDate")} required error={shown["birthDate"]}>
        {(c) => <TextControl {...c} type="date" value={birth} onChange={setBirth} />}
      </FormField>
      <FormField label={t("grade")} required error={shown["desiredGradeLevelCode"]}>
        {(c) => <NativeSelect {...c} value={grade} onChange={setGrade} placeholder={t("choose")} options={(lookups.data?.gradeLevels ?? []).map((g) => ({ value: g.code, label: g.label }))} />}
      </FormField>
      <FormField label={t("relationship")} error={shown["guardianRelationshipCode"]}>
        {(c) => <NativeSelect {...c} value={relationship} onChange={setRelationship} placeholder={t("relationshipDefault")} options={(lookups.data?.relationships ?? []).map((r) => ({ value: r.code, label: r.label }))} />}
      </FormField>
    </FormDialog>
  );
}
