"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useClassroom, useClassroomAction, type ClassroomAction } from "@/platform/v2/academic";
import { useClassroomAssignments, useStudents } from "@/platform/v2/people";
import { usePrograms, useReference, useAcademicYears } from "@/platform/v2/academic";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import type { PeopleAssignmentDto, PeopleStudentSummaryDto } from "@ecoledigitale/contracts/v2/people";
import { toneOf } from "./shared";

/** Actions proposées selon l'état de la classe (affordance d'écran) ; l'API décide de la transition. */
const CLASSROOM_ACTIONS: Record<string, ClassroomAction[]> = { DRAFT: ["activate", "cancel"], ACTIVE: ["complete", "cancel"], COMPLETED: [], CANCELLED: [], ARCHIVED: [] };

export function ClassroomDetail({ id }: { id: string }) {
  const t = useTranslations("v2Academic.classroomDetail");
  const tStatus = useTranslations("v2Academic.status.classroom");
  const classroom = useClassroom(id);
  const programs = usePrograms();
  const years = useAcademicYears();
  const grades = useReference("grade-levels");
  const date = useDateFormat();
  const flash = useFlash();
  const action = useClassroomAction();
  const [pending, setPending] = useState<ClassroomAction | null>(null);
  const students = useStudents({ classroomId: id, limit: 200 });
  const assignments = useClassroomAssignments(id);

  if (classroom.isPending && classroom.fetchStatus !== "idle") return <LoadingBlock />;
  if (classroom.isError) return <ErrorBlock error={classroom.error} onRetry={() => void classroom.refetch()} />;
  const c = classroom.data;
  if (!c) return null;
  const program = (programs.data ?? []).find((p) => p.id === c.programId);
  const grade = (grades.data ?? []).find((g) => g.id === c.gradeLevelId);
  const year = (years.data ?? []).find((y) => y.id === c.academicYearId);

  const studentColumns: DataTableColumn<PeopleStudentSummaryDto>[] = [
    { id: "name", header: t("students.name"), rowHeader: true, cell: (s) => (<Link href={`/v2/students/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{s.displayName}</Link>) },
    { id: "number", header: t("students.number"), cell: (s) => s.studentNumber, className: "hidden sm:table-cell" },
    { id: "reg", header: t("students.registration"), cell: (s) => s.currentEnrollment?.registrationNumber ?? "—", className: "hidden md:table-cell" },
    { id: "status", header: t("students.status"), cell: (s) => s.currentEnrollment?.status ?? "—" },
  ];
  const assignmentColumns: DataTableColumn<PeopleAssignmentDto>[] = [
    { id: "staff", header: t("assignments.staff"), rowHeader: true, cell: (a) => (<Link href={`/v2/staff/${a.staffId}`} className="font-medium text-primary underline-offset-4 hover:underline">{a.staffDisplayName ?? a.staffId}</Link>) },
    { id: "role", header: t("assignments.role"), cell: (a) => t(`assignments.roles.${a.roleCode}`) },
    { id: "scope", header: t("assignments.scope"), cell: (a) => (a.coversAllSubjects ? t("assignments.allSubjects") : a.curriculumNodeId ? t("assignments.oneSubject") : "—") },
    { id: "dates", header: t("assignments.dates"), cell: (a) => `${date.civil(a.startsOn)} → ${a.endsOn ? date.civil(a.endsOn) : "…"}`, className: "hidden sm:table-cell" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        description={t("subtitle", { code: c.code, program: program?.label ?? "—", grade: grade?.label ?? "—" })}
        actions={
          <>
            <Link href="/v2/academic/classrooms" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            <Can permission="academic.classroom.manage">
              {(CLASSROOM_ACTIONS[c.status] ?? []).map((a) => (
                <button key={a} type="button" className={a === "cancel" ? buttonClass.danger : buttonClass.primary} onClick={() => setPending(a)}>
                  {t(`actions.${a}`)}
                </button>
              ))}
            </Can>
          </>
        }
      />
      {flash.node}
      <dl className="grid gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{t("status")}</dt>
          <dd>
            <StatusBadge label={tStatus(c.status)} tone={toneOf(c.status)} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("year")}</dt>
          <dd>{year?.label ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("headcount")}</dt>
          <dd>{c.capacity ? t("headcountOf", { count: c.enrolledCount, capacity: c.capacity }) : c.enrolledCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("capacityKind")}</dt>
          <dd>{c.capacity ? (c.capacityIsHard ? t("capacityHard") : t("capacitySoft")) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("dates")}</dt>
          <dd>{c.startsOn ? `${date.civil(c.startsOn)} → ${date.civil(c.endsOn)}` : "—"}</dd>
        </div>
      </dl>

      <section aria-labelledby="class-students" className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 id="class-students" className="text-lg font-semibold">
            {t("students.title")}
          </h2>
          <Can permission="enrollment.create">
            <Link href={`/v2/enrollments/new?classroomId=${c.id}`} className={buttonClass.secondary}>
              {t("students.enroll")}
            </Link>
          </Can>
        </div>
        <DataTable caption={t("students.caption")} columns={studentColumns} rows={students.data?.items ?? []} getRowId={(s) => s.id} isLoading={students.isFetching} error={students.error} onRetry={() => void students.refetch()} emptyTitle={t("students.empty")} />
      </section>

      <section aria-labelledby="class-assign" className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 id="class-assign" className="text-lg font-semibold">
            {t("assignments.title")}
          </h2>
          <Link href={`/v2/staff/assignments?classroomId=${c.id}`} className={buttonClass.secondary}>
            {t("assignments.manage")}
          </Link>
        </div>
        <DataTable caption={t("assignments.caption")} columns={assignmentColumns} rows={assignments.data ?? []} getRowId={(a) => a.id} isLoading={assignments.isFetching} error={assignments.error} onRetry={() => void assignments.refetch()} emptyTitle={t("assignments.empty")} />
      </section>

      {pending ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={t(`actionTitle.${pending}`, { name: c.name })}
          description={t(`actionDescription.${pending}`)}
          reasonLabel={t("reason")}
          reasonRequired={pending === "cancel"}
          confirmLabel={t(`actions.${pending}`)}
          destructive={pending === "cancel"}
          isPending={action.isPending}
          error={action.error}
          onConfirm={async (reason) => {
            try {
              await action.mutateAsync({ id: c.id, action: pending, reason: reason || undefined });
              flash.show(t(`done.${pending}`, { name: c.name }));
              setPending(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </div>
  );
}
