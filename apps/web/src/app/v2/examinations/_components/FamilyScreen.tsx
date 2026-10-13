"use client";

import { useTranslations } from "next-intl";
import type { ExamFamilyExamDto } from "@ecoledigitale/contracts/v2/examinations";
import { usePermission } from "@/platform/access";
import { PdfButton } from "@/platform/ui/PdfButton";
import { PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { useDateFormat } from "@/platform/ui/format";
import { familyDocumentFilePath, useChildrenExams, useMyExams } from "@/platform/v2/examinations";
import { DemoBanner, outcomeTone, registrationTone, StatusPill, useExamLabels } from "./shared";

function ExamCard({ exam }: { exam: ExamFamilyExamDto }) {
  const t = useTranslations("v2Examinations.family");
  const labels = useExamLabels();
  const date = useDateFormat();
  return (
    <li className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid="family-exam">
      <DemoBanner visible={exam.demoRules} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{exam.displayName ?? t("child")} — {exam.examTypeLabel} {exam.sessionYear}</h2>
        <StatusPill label={labels.registration(exam.registrationStatus)} tone={registrationTone(exam.registrationStatus)} />
      </div>
      <p className="text-sm text-muted-foreground">{exam.sessionLabel} ({labels.sessionKind(exam.sessionKind)})</p>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">{t("number")}</dt><dd className="font-medium">{exam.candidateNumber ?? t("noNumber")}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("startsOn")}</dt><dd className="font-medium">{date.civil(exam.startsOn)}</dd></div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("seat")}</dt>
          <dd className="font-medium">{exam.assignment ? t("seatValue", { center: exam.assignment.centerName, room: exam.assignment.roomCode, seat: exam.assignment.seatNumber }) : t("noSeat")}</dd>
        </div>
      </dl>
      {exam.outcome !== null ? (
        <p>
          <span className="text-sm text-muted-foreground">{t("outcome")} </span>
          <StatusPill label={labels.outcome(exam.outcome)} tone={outcomeTone(exam.outcome)} />
        </p>
      ) : <p className="text-sm text-muted-foreground">{t("outcomePending")}</p>}
      {exam.documents.length > 0 ? (
        <ul className="space-y-2" aria-label={t("documents")}>
          {exam.documents.filter((d) => d.status === "ISSUED").map((d) => (
            <li key={d.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{labels.docKind(d.kind)}</span>
              <PdfButton path={familyDocumentFilePath(d.id)} fileName={`${d.kind}-${exam.candidateNumber ?? d.id}.pdf`} label={t("download")} ariaLabel={t("downloadAria", { kind: labels.docKind(d.kind), name: exam.displayName ?? "" })} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** « Examen de mon enfant » (parent) / « Mon examen » (élève) : inscription, place, issue publiée et documents — jamais de notes. */
export function FamilyScreen() {
  const t = useTranslations("v2Examinations.family");
  const parent = usePermission("exam.document.child.read");
  const student = usePermission("exam.document.self.read");
  const isParent = parent.allowed;
  const isStudent = student.allowed;
  const children = useChildrenExams(isParent);
  const mine = useMyExams(isStudent && !isParent);
  const query = isParent ? children : mine;
  const items = query.data ?? [];
  const waiting = parent.isLoading || student.isLoading || (query.isPending && (isParent || isStudent));
  return (
    <div>
      <PageHeader title={isParent ? t("titleParent") : t("titleStudent")} description={t("description")} />
      {waiting ? <LoadingBlock /> : query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : <ul className="space-y-3">{items.map((e) => <ExamCard key={`${e.sessionId}-${e.candidateId}`} exam={e} />)}</ul>}
    </div>
  );
}
