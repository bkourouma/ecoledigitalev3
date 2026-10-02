"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { PEOPLE_STUDENT_STATUSES, peopleChangeStatusBodySchema, peopleUpdateStudentBodySchema, type PeopleStudentDetailDto } from "@ecoledigitale/contracts/v2/people";
import { useChangeStudentStatus, useStudent, useStudentSensitive, useStudentStatusHistory, useUpdateStudent } from "@/platform/v2/people";
import { usePermission } from "@/platform/access";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IdentityFields, identityOf, identityPatch, type IdentityValue } from "./identity";
import { DocumentsTab } from "./StudentDocuments";
import { studentTone } from "./StudentsScreen";
import { EmergencyTab, GuardiansTab, SchoolingTab } from "./StudentTabs";

export function StudentDetail({ id }: { id: string }) {
  const t = useTranslations("v2Students.detail");
  const tStatus = useTranslations("v2Students.status");
  const student = useStudent(id);
  const flash = useFlash();
  const [changingStatus, setChangingStatus] = useState(false);
  const [editing, setEditing] = useState(false);
  const canGuardians = usePermission("guardian.read");
  const canRead = usePermission("student.read");

  if (student.isPending && student.fetchStatus !== "idle") return <LoadingBlock />;
  if (student.isError) return <ErrorBlock error={student.error} onRetry={() => void student.refetch()} />;
  if (!student.data) return null;
  const s = student.data;
  // Fiche réduite (enseignant limité à sa classe) : l'API ne renvoie ni coordonnées ni historique complet.
  const reduced = s.access !== "FULL";

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.displayName}
        description={t("subtitle", { number: s.studentNumber })}
        actions={
          <>
            <Link href="/v2/students" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            <Can permission="enrollment.create">
              <Link href={`/v2/enrollments/new?studentId=${s.id}`} className={buttonClass.secondary}>
                {t("enroll")}
              </Link>
            </Can>
            <Can permission="student.update">
              <button type="button" className={buttonClass.secondary} onClick={() => setEditing(true)}>
                {t("edit")}
              </button>
            </Can>
            <Can permission="student.status.update">
              <button type="button" className={buttonClass.secondary} onClick={() => setChangingStatus(true)}>
                {t("changeStatus")}
              </button>
            </Can>
          </>
        }
      />
      {flash.node}
      {reduced ? <Notice kind="info">{t("reducedAccess")}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge label={tStatus(s.status)} tone={studentTone(s.status)} />
        {s.currentEnrollment ? (
          <span>
            {t("currentClass")} :{" "}
            <Link href={`/v2/academic/classrooms/${s.currentEnrollment.classroomId}`} className="text-primary underline-offset-4 hover:underline">
              {s.currentEnrollment.classroomName ?? "—"}
            </Link>
          </span>
        ) : (
          <span className="text-muted-foreground">{t("notEnrolled")}</span>
        )}
      </div>

      <Tabs defaultValue="identity">
        <div className="overflow-x-auto">
          <TabsList className="w-max justify-start">
            <TabsTrigger value="identity">{t("tabs.identity")}</TabsTrigger>
            {canGuardians.allowed ? <TabsTrigger value="guardians">{t("tabs.guardians")}</TabsTrigger> : null}
            <TabsTrigger value="emergency">{t("tabs.emergency")}</TabsTrigger>
            {canRead.allowed && !reduced ? <TabsTrigger value="schooling">{t("tabs.schooling")}</TabsTrigger> : null}
            {!reduced ? <TabsTrigger value="status">{t("tabs.status")}</TabsTrigger> : null}
            {!reduced ? <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger> : null}
          </TabsList>
        </div>
        <TabsContent value="identity">
          <IdentityTab student={s} />
        </TabsContent>
        <TabsContent value="guardians">
          <GuardiansTab studentId={s.id} />
        </TabsContent>
        <TabsContent value="emergency">
          <EmergencyTab studentId={s.id} />
        </TabsContent>
        <TabsContent value="schooling">
          <SchoolingTab studentId={s.id} />
        </TabsContent>
        <TabsContent value="status">
          <StatusTab studentId={s.id} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab studentId={s.id} />
        </TabsContent>
      </Tabs>

      {editing ? <EditDialog student={s} onClose={() => setEditing(false)} onDone={() => flash.show(t("updated"))} /> : null}
      {changingStatus ? <StatusDialog student={s} onClose={() => setChangingStatus(false)} onDone={() => flash.show(t("statusChanged"))} /> : null}
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

function IdentityTab({ student: s }: { student: PeopleStudentDetailDto }) {
  const t = useTranslations("v2Students.detail.identity");
  const tId = useTranslations("v2Students.identity");
  const date = useDateFormat();
  const [reveal, setReveal] = useState(false);
  const sensitive = useStudentSensitive(s.id, reveal);
  const canSensitive = usePermission("student.sensitive.read");

  return (
    <div className="space-y-5">
      <section aria-labelledby="id-civil" className="rounded-lg border p-4">
        <h2 id="id-civil" className="mb-3 text-lg font-semibold">
          {t("civil")}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Item label={tId("lastName")}>{s.lastName}</Item>
          <Item label={tId("firstName")}>{s.firstName}</Item>
          <Item label={tId("otherNames")}>{s.otherNames}</Item>
          <Item label={tId("sex")}>{s.sex ? tId(s.sex === "F" ? "sexF" : "sexM") : t("unknown")}</Item>
          <Item label={tId("birthDate")}>{s.birthDate ? date.civil(s.birthDate) : ""}</Item>
          <Item label={tId("birthPlace")}>{s.birthPlace}</Item>
          <Item label={tId("nationality")}>{s.nationality}</Item>
          <Item label={t("firstEnrolledOn")}>{s.firstEnrolledOn ? date.civil(s.firstEnrolledOn) : ""}</Item>
          <Item label={t("portalAccount")}>{s.portalAccount === "NONE" ? t("noPortal") : s.portalAccount}</Item>
        </dl>
      </section>
      <section aria-labelledby="id-contact" className="rounded-lg border p-4">
        <h2 id="id-contact" className="mb-3 text-lg font-semibold">
          {t("contact")}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Item label={tId("email")}>{s.email}</Item>
          <Item label={tId("phone")}>{s.phone}</Item>
          <Item label={tId("phoneAlt")}>{s.phoneAlt}</Item>
          <Item label={tId("addressLine")}>{s.addressLine}</Item>
          <Item label={tId("city")}>{s.city}</Item>
          <Item label={tId("residence")}>{s.residence}</Item>
        </dl>
      </section>
      {s.primaryGuardian ? (
        <section aria-labelledby="id-primary" className="rounded-lg border p-4">
          <h2 id="id-primary" className="mb-2 text-lg font-semibold">
            {t("primaryGuardian")}
          </h2>
          <p className="text-sm">
            <Link href={`/v2/guardians/${s.primaryGuardian.guardianId}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {s.primaryGuardian.displayName}
            </Link>{" "}
            · {s.primaryGuardian.relationshipCode} {s.primaryGuardian.phone ? `· ${s.primaryGuardian.phone}` : ""}
          </p>
        </section>
      ) : null}
      {canSensitive.allowed ? (
        <section aria-labelledby="id-sensitive" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/40 p-4">
          <h2 id="id-sensitive" className="text-lg font-semibold">
            {t("sensitive")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("sensitiveHint")}</p>
          {!reveal ? (
            <button type="button" className={buttonClass.secondary} onClick={() => setReveal(true)}>
              {t("reveal")}
            </button>
          ) : (
            <>
              {sensitive.isPending && sensitive.fetchStatus !== "idle" ? <LoadingBlock /> : null}
              {sensitive.isError ? <ErrorBlock error={sensitive.error} /> : null}
              {sensitive.data ? (
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <Item label={t("nationalId")}>{sensitive.data.nationalStudentId}</Item>
                  <Item label={t("birthCertificateNumber")}>{sensitive.data.birthCertificateNumber}</Item>
                  <Item label={t("birthCertificateDate")}>{sensitive.data.birthCertificateDate ? date.civil(sensitive.data.birthCertificateDate) : ""}</Item>
                  <Item label={t("civilRegistryOffice")}>{sensitive.data.civilRegistryOffice}</Item>
                </dl>
              ) : null}
              <button type="button" className={buttonClass.ghost} onClick={() => setReveal(false)}>
                {t("hide")}
              </button>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

function EditDialog({ student, onClose, onDone }: { student: PeopleStudentDetailDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Students.detail");
  const initial = identityOf(student as unknown as Partial<Record<keyof IdentityValue, string | null>>);
  const [value, setValue] = useState<IdentityValue>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = useUpdateStudent();

  async function submit() {
    const patch = identityPatch(value, initial);
    if (Object.keys(patch).length === 0) return onClose();
    const v = validateWith(peopleUpdateStudentBodySchema, { person: patch });
    if (!v.ok) return setErrors(Object.fromEntries(Object.entries(v.errors).map(([k, m]) => [k.replace(/^person\./, "person."), m])));
    setErrors({});
    try {
      await update.mutateAsync({ id: student.id, patch: v.data as Record<string, unknown> });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle", { name: student.displayName })} submitLabel={t("save")} onSubmit={() => void submit()} isPending={update.isPending} error={update.error} wide>
      <IdentityFields value={value} onChange={setValue} errors={errors} />
    </FormDialog>
  );
}

function StatusDialog({ student, onClose, onDone }: { student: PeopleStudentDetailDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Students.detail.statusDialog");
  const tStatus = useTranslations("v2Students.status");
  const change = useChangeStudentStatus();
  const [form, setForm] = useState({ status: "", reasonText: "", effectiveOn: "" });
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const body: Record<string, string> = { status: form.status };
    if (form.reasonText.trim()) body.reasonText = form.reasonText.trim();
    if (form.effectiveOn) body.effectiveOn = form.effectiveOn;
    const v = validateWith(peopleChangeStatusBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    try {
      await change.mutateAsync({ id: student.id, body: v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title", { name: student.displayName })} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={change.isPending} error={change.error}>
      <FormField label={t("status")} required error={errors.status}>
        {(c) => <NativeSelect {...c} value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))} placeholder={t("choose")} options={PEOPLE_STUDENT_STATUSES.filter((x) => x !== student.status).map((x) => ({ value: x, label: tStatus(x) }))} />}
      </FormField>
      <FormField label={t("reason")} hint={t("reasonHint")} error={errors.reasonText}>
        {(c) => <TextAreaControl {...c} value={form.reasonText} onChange={(v) => setForm((f) => ({ ...f, reasonText: v }))} maxLength={1000} />}
      </FormField>
      <FormField label={t("effectiveOn")} hint={t("effectiveOnHint")} error={errors.effectiveOn}>
        {(c) => <TextControl {...c} type="date" value={form.effectiveOn} onChange={(v) => setForm((f) => ({ ...f, effectiveOn: v }))} />}
      </FormField>
    </FormDialog>
  );
}

function StatusTab({ studentId }: { studentId: string }) {
  const t = useTranslations("v2Students.detail.statusTab");
  const tStatus = useTranslations("v2Students.status");
  const date = useDateFormat();
  const history = useStudentStatusHistory(studentId);
  const label = (v: string) => ((PEOPLE_STUDENT_STATUSES as readonly string[]).includes(v) ? tStatus(v) : v);
  const columns: DataTableColumn<NonNullable<typeof history.data>[number]>[] = [
    { id: "when", header: t("when"), rowHeader: true, cell: (h) => date.civil(h.effectiveOn) },
    { id: "change", header: t("change"), cell: (h) => `${h.fromStatus ? label(h.fromStatus) : "—"} → ${label(h.toStatus)}` },
    { id: "reason", header: t("reason"), cell: (h) => h.reasonText ?? h.reasonCode ?? "—", className: "hidden sm:table-cell" },
  ];
  return <DataTable caption={t("caption")} columns={columns} rows={history.data ?? []} getRowId={(h) => h.id} isLoading={history.isFetching} error={history.error} onRetry={() => void history.refetch()} emptyTitle={t("empty")} />;
}
