"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { useAttestationRoster, useIssueAttestation } from "@/platform/v2/higher";
import { FormField } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { ClassroomPicker } from "../../assessments/_components/shared";
import { CurriculumNodePicker } from "./shared";

/** Attestations de réussite : liste des étudiants d'un programme avec leur éligibilité (décidée par les règles) et émission unitaire. */
export function AttestationsScreen() {
  const t = useTranslations("v2Higher.attestations");
  const date = useDateFormat();
  const [programNodeId, setProgramNodeId] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const roster = useAttestationRoster(programNodeId ? { programNodeId, classroomId: classroomId || undefined } : null);
  const issue = useIssueAttestation();
  const canIssue = usePermission("higher.document.issue");
  const [actionError, setActionError] = useState<unknown>(null);
  const flash = useFlash();
  const rows = roster.data ?? [];

  async function emit(studentId: string, name: string) {
    setActionError(null);
    try {
      const r = await issue.mutateAsync({ studentId, programNodeId });
      flash.show(t(r.created ? "issued" : "existing", { name, reference: r.document.reference }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-4 space-y-3">
        <CurriculumNodePicker value={programNodeId} onChange={(id) => setProgramNodeId(id)} label={t("program")} hint={t("programHint")} />
        <FormField label={t("classroom")} hint={t("classroomHint")} className="max-w-md">
          {(c) => <ClassroomPicker {...c} value={classroomId} onChange={setClassroomId} />}
        </FormField>
      </div>
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {!programNodeId ? <Notice kind="info">{t("choose")}</Notice> : null}
      {programNodeId && roster.isPending && roster.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {roster.isError ? <ErrorBlock error={roster.error} onRetry={() => void roster.refetch()} /> : null}
      {programNodeId && !roster.isPending && !roster.isError && rows.length === 0 ? <EmptyBlock title={t("empty")} /> : null}
      {rows.length > 0 ? (
        <div role="region" aria-label={t("tableCaption")} tabIndex={0} className="overflow-x-auto rounded-2xl border border-white/10 bg-card/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="bg-white/[0.04] text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("columns.student")}</th>
                <th scope="col" className="px-3 py-2 text-right">{t("columns.ue")}</th>
                <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">{t("columns.credits")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.state")}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">{t("columns.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const name = r.fullName ?? t("studentFallback", { id: r.studentId.slice(0, 4) });
                return (
                  <tr key={r.studentId} className="border-t border-white/5 align-top transition-colors hover:bg-white/[0.04]">
                    <th scope="row" className="min-w-[8rem] px-3 py-2 text-left font-medium">
                      {name}
                      {r.matricule ? <span className="block text-xs font-normal text-muted-foreground">{r.matricule}</span> : null}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{t("ue", { acquired: r.ueAcquired, required: r.ueRequired })}</td>
                    <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{String(r.creditsAcquired).replace(".", ",")}</td>
                    <td className="px-3 py-2">
                      <StatusBadge label={r.eligible ? t("eligible") : t("notEligible")} tone={r.eligible ? "success" : "warning"} />
                      {r.reference ? <span className="mt-1 block font-mono text-xs">{r.reference}</span> : null}
                      {r.acquiredDate ? <span className="block text-xs text-muted-foreground">{t("acquiredOn", { date: date.civil(r.acquiredDate) })}</span> : null}
                      {!r.eligible && r.missingUeNodeIds.length > 0 ? <span className="block text-xs text-muted-foreground">{t("missing", { count: r.missingUeNodeIds.length })}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.eligible && !r.documentId && canIssue.allowed ? (
                        <button type="button" className={buttonClass.secondary} onClick={() => void emit(r.studentId, name)} disabled={issue.isPending} aria-label={t("issueOf", { name })}>
                          {t("issue")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
