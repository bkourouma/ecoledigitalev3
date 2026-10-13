"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ExamSessionDetailDto } from "@ecoledigitale/contracts/v2/examinations";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useDateFormat } from "@/platform/ui/format";
import { useAssessments } from "@/platform/v2/assess";
import { useClassroomOptions } from "@/platform/v2/lookups";
import { useComputeMock, useImportFromAssess, useLinkAssessment, useMockLinks, useUnlinkAssessment } from "@/platform/v2/examinations";
import { JuryPanel } from "./JuryPanel";
import { BatchReport, SessionScope } from "./shared";

function Panel({ session }: { session: ExamSessionDetailDto }) {
  const t = useTranslations("v2Examinations.mock");
  const date = useDateFormat();
  const links = useMockLinks(session.id);
  const link = useLinkAssessment(session.id);
  const unlink = useUnlinkAssessment(session.id);
  const importScores = useImportFromAssess(session.id);
  const compute = useComputeMock(session.id);
  const [paperId, setPaperId] = useState("");
  const [classroom, setClassroom] = useState<SelectOption | null>(null);
  const [assessmentId, setAssessmentId] = useState("");
  const assessments = useAssessments({ classroomId: classroom?.value }, { enabled: classroom !== null });
  const assessmentOptions = (assessments.data?.pages.flatMap((p) => p.items) ?? []).map((a) => ({ value: a.id, label: `${a.title} — ${date.civil(a.assessedOn)} (/${a.scaleMax})` }));
  const papers = new Map(session.papers.map((p) => [p.id, p]));

  async function addLink() {
    if (!paperId || !classroom || !assessmentId) return;
    try {
      await link.mutateAsync({ paperId, classroomId: classroom.value, assessmentId });
      setAssessmentId("");
    } catch {
      /* erreur affichée */
    }
  }

  return (
    <div className="space-y-4">
      <Notice kind="info">{t("notice")}</Notice>
      <section aria-labelledby="links-title" className="space-y-3">
        <h2 id="links-title" className="text-lg font-semibold">{t("linksTitle")}</h2>
        {links.isPending ? <LoadingBlock /> : links.isError ? <ErrorBlock error={links.error} onRetry={() => void links.refetch()} /> : links.data.length === 0 ? <EmptyBlock title={t("noLinks")} description={t("noLinksHint")} /> : (
          <ul className="space-y-2">
            {links.data.map((l) => (
              <li key={l.id} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{t("linkLine", { paper: papers.get(l.paperId)?.label ?? l.paperCode, assessment: l.assessmentId.slice(0, 8) })}</span>
                <button type="button" className={buttonClass.ghost} disabled={unlink.isPending} onClick={() => unlink.mutate(l.id)}>{t("unlink")}</button>
              </li>
            ))}
          </ul>
        )}
        {unlink.isError ? <ErrorBlock error={unlink.error} /> : null}
      </section>

      <section aria-labelledby="add-title" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h2 id="add-title" className="text-base font-semibold">{t("add.title")}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label={t("add.paper")} required>{(c) => <NativeSelect {...c} value={paperId} placeholder={t("add.choose")} options={session.papers.map((p) => ({ value: p.id, label: `${p.code} — ${p.label}` }))} onChange={setPaperId} />}</FormField>
          <FormField label={t("add.classroom")} required>{(c) => <SelectAsync {...c} value={classroom} onChange={(o) => { setClassroom(o); setAssessmentId(""); }} useOptions={useClassroomOptions} placeholder={t("add.choose")} />}</FormField>
          <FormField label={t("add.assessment")} required hint={t("add.assessmentHint")}>{(c) => <NativeSelect {...c} value={assessmentId} disabled={classroom === null} placeholder={t("add.choose")} options={assessmentOptions} onChange={setAssessmentId} />}</FormField>
        </div>
        <button type="button" className={buttonClass.primary} disabled={!paperId || !classroom || !assessmentId || link.isPending} onClick={() => void addLink()}>{t("add.submit")}</button>
        {link.isError ? <ErrorBlock error={link.error} /> : null}
      </section>

      <section aria-labelledby="run-title" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h2 id="run-title" className="text-base font-semibold">{t("run.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("run.hint")}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.secondary} disabled={importScores.isPending} onClick={() => importScores.mutate()}>{t("run.import")}</button>
          <button type="button" className={buttonClass.primary} disabled={compute.isPending} onClick={() => compute.mutate()}>{t("run.compute")}</button>
        </div>
        {importScores.isError ? <ErrorBlock error={importScores.error} /> : null}
        {importScores.data ? <BatchReport summary={t("run.importReport", { saved: importScores.data.saved, unchanged: importScores.data.unchanged, noCandidate: importScores.data.noCandidate })} failures={importScores.data.failed.map((f) => ({ id: `${f.candidateId}-${f.paperId}`, message: f.message, code: f.code }))} /> : null}
        {compute.isError ? <ErrorBlock error={compute.error} /> : null}
        {compute.data ? (
          <div className="space-y-2">
            <BatchReport summary={t("run.computeReport", { computed: compute.data.computed, skipped: compute.data.skippedPublished })} failures={compute.data.failed.map((f) => ({ id: f.candidateId, message: f.message, code: f.code }))} />
            <p className="text-xs text-muted-foreground" data-testid="mock-trace">{t("run.trace", { ruleSet: compute.data.ruleSetCode, version: compute.data.ruleVersionId })}</p>
            {compute.data.demoRules ? <Notice kind="warning">{t("run.demoRules")}</Notice> : null}
          </div>
        ) : null}
      </section>

      <JuryPanel sessionId={session.id} />
    </div>
  );
}

/** Examens blancs : notes issues d'`assess`, moyenne et issue calculées par la RÈGLE (jamais d'un résultat officiel). */
export function MockScreen() {
  const t = useTranslations("v2Examinations.mock");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <SessionScope kind="MOCK">{(session) => <Panel session={session} />}</SessionScope>
    </div>
  );
}
