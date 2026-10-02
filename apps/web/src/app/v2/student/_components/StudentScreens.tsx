"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PeopleStudentDetailDto } from "@ecoledigitale/contracts/v2/people";
import { usePermission } from "@/platform/access";
import { useMyEnrollments } from "@/platform/v2/academic";
import { useMyStudentRecord } from "@/platform/v2/people";
import type { FamilySubject } from "@/platform/v2/portal";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { PortalScreen } from "../../attendance/_components/PortalScreen";
import { enrollmentTone } from "../../enrollments/_components/labels";
import { FamilyDocuments } from "../../_family/FamilyDocuments";
import { FamilyFinance, FamilyReceiptDetail } from "../../_family/FamilyFinance";
import { FamilyReportCards } from "../../_family/FamilyReportCards";
import { FamilyResults } from "../../_family/FamilyResults";
import { FamilySchedule } from "../../_family/FamilySchedule";
import { AnnouncementsEntry, FamilySnapshot } from "../../_family/FamilySnapshot";
import { FamilyUpcoming } from "../../_family/FamilyUpcoming";
import { OwnContactForm } from "../../_family/OwnContactForm";

/**
 * Dossier de l'élève connecté : l'API (`/people/me/student`) ne renvoie QUE la fiche liée au compte. Sans fiche liée, le portail
 * l'indique et n'émet aucune autre lecture (aucun identifiant d'élève n'est jamais choisi par l'utilisateur).
 */
function WithStudent({ children }: { children: (student: PeopleStudentDetailDto, subject: FamilySubject) => ReactNode }) {
  const t = useTranslations("v2Portal.student");
  const tCommon = useTranslations("common");
  const me = useMyStudentRecord();
  if (me.isPending && me.fetchStatus === "idle") return <Notice kind="warning">{tCommon("tenantUnknown")}</Notice>;
  if (me.isPending) return <LoadingBlock />;
  if (me.isError) {
    return me.error.status === 404 || me.error.status === 403 ? <Notice kind="warning">{t("noRecord")}</Notice> : <ErrorBlock error={me.error} onRetry={() => void me.refetch()} />;
  }
  return <>{children(me.data, { kind: "me", studentId: me.data.id })}</>;
}

const LINKS = { results: "/v2/student/results", attendance: "/v2/student/attendance", finance: "/v2/student/finance", schedule: "/v2/student/schedule" };

export function StudentHome() {
  return <WithStudent>{(student, subject) => <StudentHomeBody student={student} subject={subject} />}</WithStudent>;
}

function StudentHomeBody({ student, subject }: { student: PeopleStudentDetailDto; subject: FamilySubject }) {
  const t = useTranslations("v2Portal.student.home");
  const tStatus = useTranslations("v2Students.status");
  const tEnr = useTranslations("v2Enrollments.status");
  const date = useDateFormat();
  const enrollments = useMyEnrollments(usePermission("enrollment.self.read").allowed);
  return (
    <div className="space-y-6">
      <PageHeader
        title={student.displayName}
        description={t("subtitle", { number: student.studentNumber })}
        actions={
          <Link href="/v2/student/profile" className={buttonClass.secondary}>
            {t("profile")}
          </Link>
        }
      />
      <section aria-labelledby="stu-file" className="rounded-lg border p-4">
        <h2 id="stu-file" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t("file")} <StatusBadge label={tStatus(student.status)} tone={student.status === "ACTIVE" ? "success" : "neutral"} />
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("classroom")}</dt>
            <dd>{student.currentEnrollment?.classroomName ?? t("notEnrolled")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("registration")}</dt>
            <dd>{student.currentEnrollment?.registrationNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("birthDate")}</dt>
            <dd>{student.birthDate ? date.civil(student.birthDate) : "—"}</dd>
          </div>
        </dl>
      </section>
      <FamilySnapshot subject={subject} links={LINKS} />
      <section aria-labelledby="stu-enrollments" className="space-y-2">
        <h2 id="stu-enrollments" className="text-lg font-semibold">
          {t("enrollments")}
        </h2>
        {enrollments.isError ? <Notice kind="info">{t("enrollmentsUnavailable")}</Notice> : null}
        {enrollments.data && enrollments.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("noEnrollments")}</p> : null}
        {enrollments.data && enrollments.data.length > 0 ? (
          <ul className="divide-y rounded-md border text-sm" aria-label={t("enrollments")}>
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
      <AnnouncementsEntry />
    </div>
  );
}

export function StudentResults() {
  const t = useTranslations("v2Portal.student.titles");
  return <WithStudent>{(_s, subject) => <FamilyResults subject={subject} title={t("results")} />}</WithStudent>;
}

export function StudentReportCards() {
  const t = useTranslations("v2Portal.student.titles");
  return <WithStudent>{(_s, subject) => <FamilyReportCards subject={subject} title={t("reportcards")} />}</WithStudent>;
}

export function StudentSchedule() {
  const t = useTranslations("v2Portal.student.titles");
  return <WithStudent>{(_s, subject) => <FamilySchedule subject={subject} title={t("schedule")} />}</WithStudent>;
}

export function StudentUpcoming() {
  const t = useTranslations("v2Portal.student.titles");
  return <WithStudent>{(_s, subject) => <FamilyUpcoming subject={subject} title={t("upcoming")} />}</WithStudent>;
}

export function StudentAttendance() {
  return <WithStudent>{() => <PortalScreen via="self" />}</WithStudent>;
}

export function StudentFinance() {
  const t = useTranslations("v2Portal.student.titles");
  return <WithStudent>{(s) => <FamilyFinance learnerId={s.id} title={t("finance")} receiptHref={(id) => `/v2/student/finance/receipts/${id}`} />}</WithStudent>;
}

export function StudentReceipt({ id }: { id: string }) {
  return <WithStudent>{(s) => <FamilyReceiptDetail learnerId={s.id} id={id} backHref="/v2/student/finance" />}</WithStudent>;
}

export function StudentDocuments() {
  const t = useTranslations("v2Portal.student.titles");
  return <WithStudent>{(_s, subject) => <FamilyDocuments subject={subject} title={t("documents")} receiptHref={(id) => `/v2/student/finance/receipts/${id}`} />}</WithStudent>;
}

/** Profil : fiche en lecture seule + coordonnées modifiables (e-mail, téléphones, adresse) si `student.self.update`. */
export function StudentProfile() {
  return <WithStudent>{(s) => <StudentProfileBody student={s} />}</WithStudent>;
}

function StudentProfileBody({ student }: { student: PeopleStudentDetailDto }) {
  const t = useTranslations("v2Portal.student.profile");
  const date = useDateFormat();
  const canEdit = usePermission("student.self.update").allowed;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <section aria-labelledby="prof-identity" className="rounded-lg border p-4">
        <h2 id="prof-identity" className="mb-3 text-lg font-semibold">
          {t("identity")}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("lastName")}</dt>
            <dd>{student.lastName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("firstName")}</dt>
            <dd>{student.firstName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("number")}</dt>
            <dd>{student.studentNumber}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("birthDate")}</dt>
            <dd>{student.birthDate ? date.civil(student.birthDate) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("classroom")}</dt>
            <dd>{student.currentEnrollment?.classroomName ?? "—"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">{t("identityHint")}</p>
      </section>
      {canEdit ? (
        <section aria-labelledby="prof-contact" className="space-y-3 rounded-lg border p-4">
          <h2 id="prof-contact" className="text-lg font-semibold">
            {t("contact")}
          </h2>
          <OwnContactForm kind="student" initial={{ email: student.email, phone: student.phone, phoneAlt: student.phoneAlt, addressLine: student.addressLine, city: student.city, residence: student.residence }} />
        </section>
      ) : null}
    </div>
  );
}
