"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { peopleEmergencyContactPatchSchema, type PeopleEmergencyContactDto } from "@ecoledigitale/contracts/v2/people";
import { useChildEnrollments } from "@/platform/v2/academic";
import { useMyChild, useMyChildren, useUpdateChildEmergencyContact } from "@/platform/v2/people";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { enrollmentTone } from "../../enrollments/_components/labels";
import { studentTone } from "./StudentsScreen";

/**
 * « Mes enfants » (parent) : l'API ne renvoie QUE les enfants dont l'utilisateur est tuteur (lien vivant avec accès au
 * portail). Rien n'est filtré côté écran : ce qui n'est pas renvoyé n'existe pas pour ce compte.
 */
export function MyChildrenScreen() {
  const t = useTranslations("v2Students.children");
  const tStatus = useTranslations("v2Students.status");
  const children = useMyChildren();

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      {children.isPending && children.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {children.isError ? <ErrorBlock error={children.error} onRetry={() => void children.refetch()} /> : null}
      {children.data && children.data.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      {children.data && children.data.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("listLabel")}>
          {children.data.map((c) => (
            <li key={c.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold">
                  <Link href={`/v2/students/children/${c.id}`} className="text-primary underline-offset-4 hover:underline">
                    {c.displayName}
                  </Link>
                </h2>
                <StatusBadge label={tStatus(c.status)} tone={studentTone(c.status)} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{c.currentEnrollment?.classroomName ?? t("notEnrolled")}</p>
              <p className="text-xs text-muted-foreground">{c.studentNumber}</p>
              <Link href={`/v2/students/children/${c.id}`} className={`${buttonClass.secondary} mt-3`}>
                {t("open")}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ChildDetail({ id }: { id: string }) {
  const t = useTranslations("v2Students.children.detail");
  const tStatus = useTranslations("v2Students.status");
  const tEnr = useTranslations("v2Enrollments.status");
  const date = useDateFormat();
  const child = useMyChild(id);
  const enrollments = useChildEnrollments(id);
  const flash = useFlash();
  const [editing, setEditing] = useState<PeopleEmergencyContactDto | null>(null);

  if (child.isPending && child.fetchStatus !== "idle") return <LoadingBlock />;
  if (child.isError) return <ErrorBlock error={child.error} onRetry={() => void child.refetch()} />;
  if (!child.data) return null;
  const { student, guardians, emergencyContacts } = child.data;

  const emergencyColumns: DataTableColumn<PeopleEmergencyContactDto>[] = [
    { id: "name", header: t("emergency.name"), rowHeader: true, cell: (c) => c.contactName },
    { id: "phone", header: t("emergency.phone"), cell: (c) => <a href={`tel:${c.phone}`} className="text-primary underline-offset-4 hover:underline">{c.phone}</a> },
    { id: "relationship", header: t("emergency.relationship"), cell: (c) => c.relationshipLabel ?? "—", className: "hidden sm:table-cell" },
    { id: "edit", header: <span className="sr-only">{t("emergency.actions")}</span>, align: "right", cell: (c) => (<button type="button" className={buttonClass.ghost} onClick={() => setEditing(c)} aria-label={`${t("emergency.edit")} — ${c.contactName}`}>{t("emergency.edit")}</button>) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={student.displayName}
        description={t("subtitle", { number: student.studentNumber })}
        actions={
          <Link href="/v2/students/children" className={buttonClass.secondary}>
            {t("back")}
          </Link>
        }
      />
      {flash.node}
      <section aria-labelledby="child-summary" className="rounded-lg border p-4">
        <h2 id="child-summary" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t("summary")} <StatusBadge label={tStatus(student.status)} tone={studentTone(student.status)} />
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

      <section aria-labelledby="child-guardians" className="space-y-2">
        <h2 id="child-guardians" className="text-lg font-semibold">
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

      <section aria-labelledby="child-emergency" className="space-y-2">
        <h2 id="child-emergency" className="text-lg font-semibold">
          {t("emergency.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("emergency.hint")}</p>
        <DataTable caption={t("emergency.caption")} columns={emergencyColumns} rows={emergencyContacts} getRowId={(c) => c.id} emptyTitle={t("emergency.empty")} />
      </section>

      <section aria-labelledby="child-enrollments" className="space-y-2">
        <h2 id="child-enrollments" className="text-lg font-semibold">
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
  const t = useTranslations("v2Students.children.detail.emergency");
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
