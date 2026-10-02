"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { peopleEmergencyContactPatchSchema, type PeopleEmergencyContactDto } from "@ecoledigitale/contracts/v2/people";
import { usePermission } from "@/platform/access";
import { ChildScope } from "@/platform/portal/ChildScope";
import { useChildEnrollments } from "@/platform/v2/academic";
import { useMyChild, useUpdateChildEmergencyContact } from "@/platform/v2/people";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { PortalScreen } from "../../attendance/_components/PortalScreen";
import { enrollmentTone } from "../../enrollments/_components/labels";
import { FamilyDocuments } from "../../_family/FamilyDocuments";
import { FamilyFinance, FamilyReceiptDetail } from "../../_family/FamilyFinance";
import { FamilyReportCards } from "../../_family/FamilyReportCards";
import { FamilyResults } from "../../_family/FamilyResults";
import { FamilySchedule } from "../../_family/FamilySchedule";
import { FamilyUpcoming } from "../../_family/FamilyUpcoming";

const back = (childId: string, segment: string) => `/v2/parent/children/${childId}/${segment}`;

export function ChildResults({ childId }: { childId: string }) {
  const t = useTranslations("v2Portal.parent.titles");
  return <ChildScope childId={childId}>{(c) => <FamilyResults subject={{ kind: "child", id: c.id }} title={t("results", { name: c.displayName })} />}</ChildScope>;
}

export function ChildReportCards({ childId }: { childId: string }) {
  const t = useTranslations("v2Portal.parent.titles");
  return <ChildScope childId={childId}>{(c) => <FamilyReportCards subject={{ kind: "child", id: c.id }} title={t("reportcards", { name: c.displayName })} />}</ChildScope>;
}

export function ChildSchedule({ childId }: { childId: string }) {
  const t = useTranslations("v2Portal.parent.titles");
  return <ChildScope childId={childId}>{(c) => <FamilySchedule subject={{ kind: "child", id: c.id }} title={t("schedule", { name: c.displayName })} />}</ChildScope>;
}

export function ChildUpcoming({ childId }: { childId: string }) {
  const t = useTranslations("v2Portal.parent.titles");
  return <ChildScope childId={childId}>{(c) => <FamilyUpcoming subject={{ kind: "child", id: c.id }} title={t("upcoming", { name: c.displayName })} />}</ChildScope>;
}

export function ChildAttendance({ childId }: { childId: string }) {
  return <ChildScope childId={childId}>{(c) => <PortalScreen via="child" studentId={c.id} />}</ChildScope>;
}

export function ChildFinance({ childId }: { childId: string }) {
  const t = useTranslations("v2Portal.parent.titles");
  return (
    <ChildScope childId={childId}>
      {(c) => <FamilyFinance learnerId={c.id} title={t("finance", { name: c.displayName })} receiptHref={(id) => `${back(c.id, "finance")}/receipts/${id}`} />}
    </ChildScope>
  );
}

export function ChildReceipt({ childId, id }: { childId: string; id: string }) {
  return <ChildScope childId={childId}>{(c) => <FamilyReceiptDetail learnerId={c.id} id={id} backHref={back(c.id, "finance")} />}</ChildScope>;
}

export function ChildDocuments({ childId }: { childId: string }) {
  const t = useTranslations("v2Portal.parent.titles");
  return (
    <ChildScope childId={childId}>
      {(c) => <FamilyDocuments subject={{ kind: "child", id: c.id }} title={t("documents", { name: c.displayName })} receiptHref={(id) => `${back(c.id, "finance")}/receipts/${id}`} />}
    </ChildScope>
  );
}

/** Dossier de l'enfant : identité, tuteurs, inscriptions et contacts d'urgence (modifiables par le parent : `student.child.update`). */
export function ChildFile({ childId }: { childId: string }) {
  return <ChildScope childId={childId}>{(c) => <ChildFileBody id={c.id} />}</ChildScope>;
}

function ChildFileBody({ id }: { id: string }) {
  const t = useTranslations("v2Portal.parent.file");
  const tStatus = useTranslations("v2Students.status");
  const tEnr = useTranslations("v2Enrollments.status");
  const date = useDateFormat();
  const child = useMyChild(id);
  const enrollments = useChildEnrollments(id);
  const canEdit = usePermission("student.child.update").allowed;
  const flash = useFlash();
  const [editing, setEditing] = useState<PeopleEmergencyContactDto | null>(null);

  if (child.isPending) return <LoadingBlock />;
  if (child.isError) return <ErrorBlock error={child.error} onRetry={() => void child.refetch()} />;
  const { student, guardians, emergencyContacts } = child.data;

  const columns: DataTableColumn<PeopleEmergencyContactDto>[] = [
    { id: "name", header: t("emergency.name"), rowHeader: true, cell: (c) => c.contactName },
    { id: "phone", header: t("emergency.phone"), cell: (c) => <a href={`tel:${c.phone}`} className="text-primary underline-offset-4 hover:underline">{c.phone}</a> },
    { id: "relationship", header: t("emergency.relationship"), cell: (c) => c.relationshipLabel ?? "—", className: "hidden sm:table-cell" },
    {
      id: "edit",
      header: <span className="sr-only">{t("emergency.actions")}</span>,
      align: "right",
      cell: (c) =>
        canEdit ? (
          <button type="button" className={buttonClass.ghost} onClick={() => setEditing(c)} aria-label={`${t("emergency.edit")} — ${c.contactName}`}>
            {t("emergency.edit")}
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={student.displayName} description={t("subtitle", { number: student.studentNumber })} />
      {flash.node}
      <section aria-labelledby="file-summary" className="rounded-lg border p-4">
        <h2 id="file-summary" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t("summary")} <StatusBadge label={tStatus(student.status)} tone={student.status === "ACTIVE" ? "success" : "neutral"} />
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("classroom")}</dt>
            <dd>{student.currentEnrollment?.classroomName ?? t("notEnrolled")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("birthDate")}</dt>
            <dd>{student.birthDate ? date.civil(student.birthDate) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("registration")}</dt>
            <dd>{student.currentEnrollment?.registrationNumber ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="file-guardians" className="space-y-2">
        <h2 id="file-guardians" className="text-lg font-semibold">
          {t("guardians")}
        </h2>
        <ul className="divide-y rounded-md border text-sm">
          {guardians.map((g) => (
            <li key={g.guardianId} className="flex flex-wrap items-center gap-2 p-3">
              <span className="font-medium">{g.displayName}</span>
              <span className="text-muted-foreground">{g.relationshipCode}</span>
              {g.isPrimaryContact ? <StatusBadge label={t("primary")} tone="info" /> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="file-emergency" className="space-y-2">
        <h2 id="file-emergency" className="text-lg font-semibold">
          {t("emergency.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("emergency.hint")}</p>
        <DataTable caption={t("emergency.caption")} columns={columns} rows={emergencyContacts} getRowId={(c) => c.id} emptyTitle={t("emergency.empty")} />
      </section>

      <section aria-labelledby="file-enrollments" className="space-y-2">
        <h2 id="file-enrollments" className="text-lg font-semibold">
          {t("enrollments.title")}
        </h2>
        {enrollments.isError ? <Notice kind="info">{t("enrollments.unavailable")}</Notice> : null}
        {enrollments.data && enrollments.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("enrollments.empty")}</p> : null}
        {enrollments.data && enrollments.data.length > 0 ? (
          <ul className="divide-y rounded-md border text-sm" aria-label={t("enrollments.title")}>
            {enrollments.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 p-3">
                <span className="font-medium">{e.registrationNumber ?? "—"}</span>
                <span className="text-muted-foreground">{date.civil(e.enrolledOn)}</span>
                <StatusBadge label={tEnr(e.status)} tone={enrollmentTone(e.status)} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {editing ? <EditEmergencyDialog studentId={id} contact={editing} onClose={() => setEditing(null)} onDone={() => flash.show(t("emergency.updated"))} /> : null}
    </div>
  );
}

function EditEmergencyDialog({ studentId, contact, onClose, onDone }: { studentId: string; contact: PeopleEmergencyContactDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Portal.parent.file.emergency");
  const update = useUpdateChildEmergencyContact();
  const [form, setForm] = useState({ contactName: contact.contactName, phone: contact.phone, phoneAlt: contact.phoneAlt ?? "", email: contact.email ?? "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    const patch: Record<string, string | null> = {};
    if (form.contactName.trim() !== contact.contactName) patch.contactName = form.contactName.trim();
    if (form.phone.trim() !== contact.phone) patch.phone = form.phone.trim();
    if (form.phoneAlt.trim() !== (contact.phoneAlt ?? "")) patch.phoneAlt = form.phoneAlt.trim() || null;
    if (form.email.trim() !== (contact.email ?? "")) patch.email = form.email.trim() || null;
    if (Object.keys(patch).length === 0) return onClose();
    const v = validateWith(peopleEmergencyContactPatchSchema, patch);
    if (!v.ok) return setErrors(v.errors);
    try {
      await update.mutateAsync({ studentId, contactId: contact.id, patch: v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle", { name: contact.contactName })} submitLabel={t("save")} onSubmit={() => void submit()} isPending={update.isPending} error={update.error}>
      <FormField label={t("name")} required error={errors.contactName}>
        {(c) => <TextControl {...c} value={form.contactName} onChange={set("contactName")} maxLength={160} />}
      </FormField>
      <FormField label={t("phone")} required error={errors.phone}>
        {(c) => <TextControl {...c} type="tel" value={form.phone} onChange={set("phone")} maxLength={40} />}
      </FormField>
      <FormField label={t("phoneAlt")} error={errors.phoneAlt}>
        {(c) => <TextControl {...c} type="tel" value={form.phoneAlt} onChange={set("phoneAlt")} maxLength={40} />}
      </FormField>
      <FormField label={t("email")} error={errors.email}>
        {(c) => <TextControl {...c} type="email" value={form.email} onChange={set("email")} maxLength={320} />}
      </FormField>
    </FormDialog>
  );
}
