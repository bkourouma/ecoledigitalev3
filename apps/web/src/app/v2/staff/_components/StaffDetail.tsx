"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { PEOPLE_STAFF_STATUSES, peopleChangeStaffStatusBodySchema, peopleUpdateStaffBodySchema, type PeopleStaffDetailDto } from "@ecoledigitale/contracts/v2/people";
import { useChangeStaffStatus, useInvitePortalAccess, useStaff, useStaffCategories, useStaffHistory, useUpdateStaff } from "@/platform/v2/people";
import { useInstitutions } from "@/platform/v2/lookups";
import { usePermission } from "@/platform/access";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IdentityFields, identityOf, identityPatch, type IdentityValue } from "../../students/_components/identity";
import { AvailabilitiesTab, CompetenciesTab, ContractsTab, LoadTab, QualificationsTab } from "./StaffTabs";
import { staffTone } from "./StaffScreen";

export function StaffDetail({ id }: { id: string }) {
  const t = useTranslations("v2Staff.detail");
  const tStatus = useTranslations("v2Staff.status");
  const staff = useStaff(id);
  const categories = useStaffCategories();
  const invite = useInvitePortalAccess();
  const flash = useFlash();
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [inviteError, setInviteError] = useState<unknown>(null);
  const contractsAllowed = usePermission("staff.contract.read");
  const teachingAllowed = usePermission("teaching.read");

  if (staff.isPending && staff.fetchStatus !== "idle") return <LoadingBlock />;
  if (staff.isError) return <ErrorBlock error={staff.error} onRetry={() => void staff.refetch()} />;
  if (!staff.data) return null;
  const s = staff.data;
  const category = (categories.data ?? []).find((c) => c.code === s.categoryCode)?.label ?? s.categoryCode;

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.displayName}
        description={t("subtitle", { number: s.staffNumber, category, jobTitle: s.jobTitle ?? "—" })}
        actions={
          <>
            <Link href="/v2/staff" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            <Can permission="staff.update">
              <button type="button" className={buttonClass.secondary} onClick={() => setEditing(true)}>
                {t("edit")}
              </button>
              {s.portalAccount === "NONE" ? (
                <button
                  type="button"
                  className={buttonClass.secondary}
                  disabled={invite.isPending}
                  onClick={() => {
                    setInviteError(null);
                    void invite.mutateAsync({ personId: s.personId, quality: "STAFF" }).then(() => flash.show(t("invited"))).catch(setInviteError);
                  }}
                >
                  {t("invite")}
                </button>
              ) : null}
            </Can>
            <Can permission="staff.status.update">
              <button type="button" className={buttonClass.secondary} onClick={() => setChanging(true)}>
                {t("changeStatus")}
              </button>
            </Can>
          </>
        }
      />
      {flash.node}
      {inviteError ? <ErrorBlock error={inviteError} /> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge label={tStatus(s.status)} tone={staffTone(s.status)} />
      </div>

      <Tabs defaultValue="identity">
        <div className="overflow-x-auto">
          <TabsList className="w-max justify-start">
            <TabsTrigger value="identity">{t("tabs.identity")}</TabsTrigger>
            {contractsAllowed.allowed ? <TabsTrigger value="contracts">{t("tabs.contracts")}</TabsTrigger> : null}
            <TabsTrigger value="qualifications">{t("tabs.qualifications")}</TabsTrigger>
            <TabsTrigger value="competencies">{t("tabs.competencies")}</TabsTrigger>
            <TabsTrigger value="availabilities">{t("tabs.availabilities")}</TabsTrigger>
            {teachingAllowed.allowed ? <TabsTrigger value="load">{t("tabs.load")}</TabsTrigger> : null}
            <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="identity">
          <IdentityTab staff={s} />
        </TabsContent>
        <TabsContent value="contracts">
          <ContractsTab staffId={s.id} />
        </TabsContent>
        <TabsContent value="qualifications">
          <QualificationsTab staffId={s.id} />
        </TabsContent>
        <TabsContent value="competencies">
          <CompetenciesTab staffId={s.id} />
        </TabsContent>
        <TabsContent value="availabilities">
          <AvailabilitiesTab staffId={s.id} />
        </TabsContent>
        <TabsContent value="load">
          <LoadTab staffId={s.id} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab staffId={s.id} />
        </TabsContent>
      </Tabs>

      {editing ? <EditDialog staff={s} onClose={() => setEditing(false)} onDone={() => flash.show(t("updated"))} /> : null}
      {changing ? <StatusDialog staff={s} onClose={() => setChanging(false)} onDone={() => flash.show(t("statusChanged"))} /> : null}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children || "—"}</dd>
    </div>
  );
}

function IdentityTab({ staff: s }: { staff: PeopleStaffDetailDto }) {
  const t = useTranslations("v2Staff.detail.identity");
  const tId = useTranslations("v2Students.identity");
  const date = useDateFormat();
  const institutions = useInstitutions();
  const institutionName = (id: string) => (institutions.data ?? []).find((i) => i.id === id)?.name ?? id.slice(0, 8);
  return (
    <div className="space-y-5">
      <section aria-labelledby="sid-civil" className="rounded-lg border p-4">
        <h2 id="sid-civil" className="mb-3 text-lg font-semibold">
          {t("civil")}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Item label={tId("lastName")}>{s.lastName}</Item>
          <Item label={tId("firstName")}>{s.firstName}</Item>
          <Item label={tId("otherNames")}>{s.otherNames}</Item>
          <Item label={tId("sex")}>{s.sex ? tId(s.sex === "F" ? "sexF" : "sexM") : ""}</Item>
          <Item label={t("hiredOn")}>{s.hiredOn ? date.civil(s.hiredOn) : ""}</Item>
          <Item label={t("leftOn")}>{s.leftOn ? date.civil(s.leftOn) : ""}</Item>
          <Item label={tId("email")}>{s.email}</Item>
          <Item label={tId("phone")}>{s.phone}</Item>
          <Item label={tId("phoneAlt")}>{s.phoneAlt}</Item>
          <Item label={tId("addressLine")}>{s.addressLine}</Item>
          <Item label={tId("city")}>{s.city}</Item>
          <Item label={t("portalAccount")}>{s.portalAccount === "NONE" ? t("noPortal") : s.portalAccount}</Item>
        </dl>
      </section>
      <section aria-labelledby="sid-aff" className="rounded-lg border p-4">
        <h2 id="sid-aff" className="mb-2 text-lg font-semibold">
          {t("affiliations")}
        </h2>
        {s.affiliations.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAffiliations")}</p> : null}
        <ul className="divide-y text-sm">
          {s.affiliations.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 py-2">
              <span className="font-medium">{institutionName(a.institutionId)}</span>
              <span className="text-muted-foreground">
                {date.civil(a.validFrom)} → {a.validTo ? date.civil(a.validTo) : t("ongoing")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function HistoryTab({ staffId }: { staffId: string }) {
  const t = useTranslations("v2Staff.detail.history");
  const tStatus = useTranslations("v2Staff.status");
  const date = useDateFormat();
  const history = useStaffHistory(staffId);
  const label = (v: string) => ((PEOPLE_STAFF_STATUSES as readonly string[]).includes(v) ? tStatus(v) : v);
  const columns: DataTableColumn<NonNullable<typeof history.data>[number]>[] = [
    { id: "when", header: t("when"), rowHeader: true, cell: (h) => date.civil(h.effectiveOn) },
    { id: "change", header: t("change"), cell: (h) => `${h.fromStatus ? label(h.fromStatus) : "—"} → ${label(h.toStatus)}` },
    { id: "reason", header: t("reason"), cell: (h) => h.reasonText ?? "—", className: "hidden sm:table-cell" },
  ];
  return <DataTable caption={t("caption")} columns={columns} rows={history.data ?? []} getRowId={(h) => h.id} isLoading={history.isFetching} error={history.error} onRetry={() => void history.refetch()} emptyTitle={t("empty")} />;
}

function EditDialog({ staff, onClose, onDone }: { staff: PeopleStaffDetailDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Staff.detail");
  const categories = useStaffCategories();
  const initial = identityOf(staff as unknown as Partial<Record<keyof IdentityValue, string | null>>);
  const [value, setValue] = useState<IdentityValue>(initial);
  const [job, setJob] = useState({ categoryCode: staff.categoryCode, jobTitle: staff.jobTitle ?? "", hiredOn: staff.hiredOn ?? "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = useUpdateStaff();

  async function submit() {
    const patch: Record<string, unknown> = {};
    const person = identityPatch(value, initial);
    if (Object.keys(person).length > 0) patch.person = person;
    if (job.categoryCode !== staff.categoryCode) patch.categoryCode = job.categoryCode;
    if (job.jobTitle.trim() !== (staff.jobTitle ?? "")) patch.jobTitle = job.jobTitle.trim() || null;
    if (job.hiredOn !== (staff.hiredOn ?? "")) patch.hiredOn = job.hiredOn || null;
    if (Object.keys(patch).length === 0) return onClose();
    const v = validateWith(peopleUpdateStaffBodySchema, patch);
    if (!v.ok) return setErrors(v.errors);
    try {
      await update.mutateAsync({ id: staff.id, patch: v.data as Record<string, unknown> });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle", { name: staff.displayName })} submitLabel={t("save")} onSubmit={() => void submit()} isPending={update.isPending} error={update.error} wide>
      <IdentityFields value={value} onChange={setValue} errors={errors} sexRequired={false} />
      <fieldset className="grid gap-4 border-t pt-4 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold">{t("job")}</legend>
        <FormField label={t("category")} required error={errors.categoryCode}>
          {(c) => <NativeSelect {...c} value={job.categoryCode} onChange={(v) => setJob((j) => ({ ...j, categoryCode: v }))} options={(categories.data ?? []).filter((x) => x.active || x.code === staff.categoryCode).map((x) => ({ value: x.code, label: x.label }))} />}
        </FormField>
        <FormField label={t("jobTitle")} error={errors.jobTitle}>
          {(c) => <TextControl {...c} value={job.jobTitle} onChange={(v) => setJob((j) => ({ ...j, jobTitle: v }))} maxLength={160} />}
        </FormField>
        <FormField label={t("hiredOn")} error={errors.hiredOn}>
          {(c) => <TextControl {...c} type="date" value={job.hiredOn} onChange={(v) => setJob((j) => ({ ...j, hiredOn: v }))} />}
        </FormField>
      </fieldset>
    </FormDialog>
  );
}

function StatusDialog({ staff, onClose, onDone }: { staff: PeopleStaffDetailDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Staff.detail.statusDialog");
  const tStatus = useTranslations("v2Staff.status");
  const change = useChangeStaffStatus();
  const [form, setForm] = useState({ status: "", reasonText: "", effectiveOn: "", leftOn: "" });
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const body: Record<string, string> = { status: form.status };
    if (form.reasonText.trim()) body.reasonText = form.reasonText.trim();
    if (form.effectiveOn) body.effectiveOn = form.effectiveOn;
    if (form.status === "LEFT" && form.leftOn) body.leftOn = form.leftOn;
    const v = validateWith(peopleChangeStaffStatusBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    try {
      await change.mutateAsync({ id: staff.id, body: v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title", { name: staff.displayName })} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={change.isPending} error={change.error}>
      <FormField label={t("status")} required error={errors.status}>
        {(c) => <NativeSelect {...c} value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))} placeholder={t("choose")} options={PEOPLE_STAFF_STATUSES.filter((x) => x !== staff.status).map((x) => ({ value: x, label: tStatus(x) }))} />}
      </FormField>
      <FormField label={t("reason")} error={errors.reasonText}>
        {(c) => <TextAreaControl {...c} value={form.reasonText} onChange={(v) => setForm((f) => ({ ...f, reasonText: v }))} maxLength={1000} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("effectiveOn")} error={errors.effectiveOn}>
          {(c) => <TextControl {...c} type="date" value={form.effectiveOn} onChange={(v) => setForm((f) => ({ ...f, effectiveOn: v }))} />}
        </FormField>
        {form.status === "LEFT" ? (
          <FormField label={t("leftOn")} error={errors.leftOn}>
            {(c) => <TextControl {...c} type="date" value={form.leftOn} onChange={(v) => setForm((f) => ({ ...f, leftOn: v }))} />}
          </FormField>
        ) : null}
      </div>
    </FormDialog>
  );
}
