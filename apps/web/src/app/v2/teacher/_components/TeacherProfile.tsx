"use client";

import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useMyStaff } from "@/platform/v2/people";
import { useTeachingContext } from "@/platform/v2/teaching";
import { useDateFormat } from "@/platform/ui/format";
import { PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { OwnContactForm } from "../../_family/OwnContactForm";
import { staffTone } from "../../staff/_components/StaffScreen";

/** Profil de l'enseignant : sa fiche (lecture seule), ses affectations et ses coordonnées (modifiables : `staff.own.update`). */
export function TeacherProfile() {
  const t = useTranslations("v2Portal.teacher.profile");
  const tStatus = useTranslations("v2Staff.status");
  const date = useDateFormat();
  const me = useMyStaff();
  const ctx = useTeachingContext();
  const canEdit = usePermission("staff.own.update").allowed;

  if (me.isPending) return <LoadingBlock />;
  if (me.isError) return <ErrorBlock error={me.error} onRetry={() => void me.refetch()} />;
  const s = me.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <section aria-labelledby="tp-card" className="rounded-lg border p-4">
        <h2 id="tp-card" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {s.displayName} <StatusBadge label={tStatus(s.status)} tone={staffTone(s.status)} />
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("number")}</dt>
            <dd>{s.staffNumber}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("jobTitle")}</dt>
            <dd>{s.jobTitle ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("hiredOn")}</dt>
            <dd>{s.hiredOn ? date.civil(s.hiredOn) : "—"}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="tp-classes" className="space-y-2">
        <h2 id="tp-classes" className="text-lg font-semibold">
          {t("classes")}
        </h2>
        {ctx.classes.length === 0 ? <p className="text-sm text-muted-foreground">{t("noClasses")}</p> : null}
        <ul className="divide-y rounded-md border text-sm">
          {ctx.classes.map((c) => (
            <li key={c.classroomId} className="p-3">
              <span className="font-medium">{c.classroomName ?? t("unnamed")}</span>
              <span className="block text-muted-foreground">
                {c.assignments.some((a) => a.coversAllSubjects) ? t("allSubjects") : [...new Set(c.assignments.map((a) => a.nodeLabel).filter(Boolean))].join(", ")}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {canEdit ? (
        <section aria-labelledby="tp-contact" className="space-y-3 rounded-lg border p-4">
          <h2 id="tp-contact" className="text-lg font-semibold">
            {t("contact")}
          </h2>
          <OwnContactForm kind="staff" initial={{ email: s.email, phone: s.phone, phoneAlt: s.phoneAlt, addressLine: s.addressLine, city: s.city }} fields={["email", "phone", "phoneAlt", "addressLine", "city"]} />
        </section>
      ) : null}
    </div>
  );
}
