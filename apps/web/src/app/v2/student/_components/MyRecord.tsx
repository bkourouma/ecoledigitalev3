"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { peopleOwnContactPatchSchema, type PeopleStudentDetailDto } from "@ecoledigitale/contracts/v2/people";
import { useMyEnrollments } from "@/platform/v2/academic";
import { useMyStudentRecord } from "@/platform/v2/people";
import { useUpdateMyStudentContact } from "@/platform/v2/self";
import { Can, RequirePermission } from "@/platform/ui/AccessGate";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, nullifyEmpty, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { enrollmentTone } from "../../enrollments/_components/labels";
import { studentTone } from "../../students/_components/StudentsScreen";

/** Ligne d'un bloc d'informations : masquée quand l'API n'envoie pas la valeur (jamais de « null » affiché). */
function Info({ label, value, always = false, placeholder }: { label: string; value: ReactNode; always?: boolean; placeholder?: string }) {
  if (!always && (value === null || value === undefined || value === "")) return null;
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value === null || value === undefined || value === "" ? <span className="text-muted-foreground">{placeholder}</span> : value}</dd>
    </div>
  );
}

/**
 * « Mon dossier » (élève) : lecture seule de l'identité, du matricule, de la classe, des coordonnées et des inscriptions, avec la
 * seule modification que l'API autorise (mes coordonnées). Aucun champ interne n'est affiché (identifiants techniques, notes,
 * attributs, état du compte, dates d'audit). Ce que l'API n'envoie pas n'apparaît pas.
 */
export function MyRecordScreen() {
  return (
    <RequirePermission permission="student.self.read">
      <MyRecordContent />
    </RequirePermission>
  );
}

function MyRecordContent() {
  const t = useTranslations("v2StudentSelf");
  const tStatus = useTranslations("v2Students.status");
  const tSex = useTranslations("v2StudentSelf.sex");
  const date = useDateFormat();
  const record = useMyStudentRecord();
  const flash = useFlash();
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      {record.isPending && record.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {record.isError ? <ErrorBlock error={record.error} onRetry={() => void record.refetch()} /> : null}
      {record.data ? (
        <>
          <section aria-labelledby="me-identity" className="rounded-lg border p-4">
            <h2 id="me-identity" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
              {record.data.displayName} <StatusBadge label={tStatus(record.data.status)} tone={studentTone(record.data.status)} />
            </h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Info label={t("studentNumber")} value={record.data.studentNumber} always />
              <Info label={t("otherNames")} value={record.data.otherNames} />
              <Info label={t("sexLabel")} value={record.data.sex ? tSex(record.data.sex) : null} />
              <Info label={t("birthDate")} value={record.data.birthDate ? date.civil(record.data.birthDate) : null} />
              <Info label={t("birthPlace")} value={record.data.birthPlace} />
              <Info label={t("nationality")} value={record.data.nationality} />
              <Info label={t("firstEnrolledOn")} value={record.data.firstEnrolledOn ? date.civil(record.data.firstEnrolledOn) : null} />
            </dl>
          </section>

          <section aria-labelledby="me-class" className="rounded-lg border p-4">
            <h2 id="me-class" className="mb-3 text-lg font-semibold">
              {t("classTitle")}
            </h2>
            {record.data.currentEnrollment ? (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <Info label={t("classroom")} value={record.data.currentEnrollment.classroomName} always placeholder="—" />
                <Info label={t("registration")} value={record.data.currentEnrollment.registrationNumber} />
                <Info label={t("enrollmentStatus")} value={<EnrollmentStatus status={record.data.currentEnrollment.status} />} />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t("notEnrolled")}</p>
            )}
          </section>

          <ContactSection student={record.data} onEdit={() => setEditing(true)} />

          {record.data.primaryGuardian ? (
            <section aria-labelledby="me-guardian" className="rounded-lg border p-4">
              <h2 id="me-guardian" className="mb-3 text-lg font-semibold">
                {t("guardianTitle")}
              </h2>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Info label={t("guardianName")} value={record.data.primaryGuardian.displayName} always />
                <Info label={t("guardianPhone")} value={record.data.primaryGuardian.phone} />
              </dl>
            </section>
          ) : null}
        </>
      ) : null}

      <EnrollmentsSection />
      {editing && record.data ? <EditContactDialog student={record.data} onClose={() => setEditing(false)} onDone={() => flash.show(t("contact.updated"))} /> : null}
    </div>
  );
}

function EnrollmentStatus({ status }: { status: string }) {
  const tEnr = useTranslations("v2Enrollments.status");
  return <StatusBadge label={tEnr(status as "ACTIVE")} tone={enrollmentTone(status)} />;
}

function ContactSection({ student, onEdit }: { student: PeopleStudentDetailDto; onEdit: () => void }) {
  const t = useTranslations("v2StudentSelf.contact");
  return (
    <section aria-labelledby="me-contact" className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="me-contact" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Can permission="student.self.update">
          <button type="button" className={buttonClass.secondary} onClick={onEdit}>
            {t("edit")}
          </button>
        </Can>
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Info label={t("email")} value={student.email} always placeholder={t("empty")} />
        <Info label={t("phone")} value={student.phone} always placeholder={t("empty")} />
        <Info label={t("phoneAlt")} value={student.phoneAlt} always placeholder={t("empty")} />
        <Info label={t("addressLine")} value={student.addressLine} always placeholder={t("empty")} />
        <Info label={t("city")} value={student.city} always placeholder={t("empty")} />
        <Info label={t("residence")} value={student.residence} always placeholder={t("empty")} />
      </dl>
    </section>
  );
}

function EnrollmentsSection() {
  const t = useTranslations("v2StudentSelf.enrollments");
  const tMode = useTranslations("v2Enrollments.mode");
  const date = useDateFormat();
  const list = useMyEnrollments();
  return (
    <section aria-labelledby="me-enrollments" className="space-y-2">
      <h2 id="me-enrollments" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {list.isError ? <Notice kind="info">{t("unavailable")}</Notice> : null}
      {list.data && list.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      {list.data && list.data.length > 0 ? (
        <ul className="divide-y rounded-md border text-sm" aria-label={t("title")}>
          {list.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="font-medium">{e.registrationNumber ?? "—"}</span>
              <span className="text-muted-foreground">{date.civil(e.enrolledOn)}</span>
              <span className="text-muted-foreground">{tMode(e.mode)}</span>
              <EnrollmentStatus status={e.status} />
              {e.isRepeating ? <StatusBadge label={t("repeating")} tone="warning" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function EditContactDialog({ student, onClose, onDone }: { student: PeopleStudentDetailDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2StudentSelf.contact");
  const update = useUpdateMyStudentContact();
  const initial = { email: student.email ?? "", phone: student.phone ?? "", phoneAlt: student.phoneAlt ?? "", addressLine: student.addressLine ?? "", city: student.city ?? "", residence: student.residence ?? "" };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    // Seuls les champs modifiés partent ; un champ vidé devient `null` (effacé).
    const changed: Record<string, string> = {};
    for (const k of Object.keys(form) as Array<keyof typeof form>) if (form[k].trim() !== initial[k]) changed[k] = form[k].trim();
    if (Object.keys(changed).length === 0) return onClose();
    const v = validateWith(peopleOwnContactPatchSchema, nullifyEmpty(changed));
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await update.mutateAsync(v.data);
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle")} description={t("editHint")} submitLabel={t("save")} onSubmit={() => void submit()} isPending={update.isPending} error={update.error}>
      <FormField label={t("email")} error={errors.email}>
        {(c) => <TextControl {...c} type="email" autoComplete="email" value={form.email} onChange={set("email")} maxLength={320} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("phone")} error={errors.phone}>
          {(c) => <TextControl {...c} type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} maxLength={40} />}
        </FormField>
        <FormField label={t("phoneAlt")} error={errors.phoneAlt}>
          {(c) => <TextControl {...c} type="tel" value={form.phoneAlt} onChange={set("phoneAlt")} maxLength={40} />}
        </FormField>
      </div>
      <FormField label={t("addressLine")} error={errors.addressLine}>
        {(c) => <TextControl {...c} autoComplete="street-address" value={form.addressLine} onChange={set("addressLine")} maxLength={300} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("city")} error={errors.city}>
          {(c) => <TextControl {...c} value={form.city} onChange={set("city")} maxLength={120} />}
        </FormField>
        <FormField label={t("residence")} error={errors.residence}>
          {(c) => <TextControl {...c} value={form.residence} onChange={set("residence")} maxLength={200} />}
        </FormField>
      </div>
    </FormDialog>
  );
}
