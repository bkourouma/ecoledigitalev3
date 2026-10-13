"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EXAM_DOCUMENT_KINDS, type ExamCandidateDetailDto, type ExamDocumentKind, type ExamPieceDto } from "@ecoledigitale/contracts/v2/examinations";
import { Can } from "@/platform/ui/AccessGate";
import { DocumentPicker, type DocumentRef } from "@/platform/ui/DocumentPicker";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { PdfButton } from "@/platform/ui/PdfButton";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { showDecimal, useDateFormat } from "@/platform/ui/format";
import {
  issuedDocumentFilePath,
  useCandidatePieceAction,
  useEligibility,
  useExamCandidate,
  useExamSession,
  useIssueDocument,
  useRegisterCandidate,
  useSetIdentifier,
  useWithdrawCandidate,
} from "@/platform/v2/examinations";
import { useAnonymizeCandidate, useExternalProfile } from "@/platform/v2/examinations-external";
import { CandidateFeeSection } from "./CandidateFeeSection";
import { DemoBanner, eligibilityTone, outcomeTone, registrationTone, StatusPill, useExamLabels } from "./shared";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ManualEligibilityDialog({ candidateId, open, onOpenChange }: { candidateId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Examinations.candidateDetail.eligibility.manual");
  const labels = useExamLabels();
  const elig = useEligibility();
  const [result, setResult] = useState("ELIGIBLE");
  const [reasons, setReasons] = useState("");
  async function submit() {
    try {
      await elig.mutateAsync({ id: candidateId, body: { mode: "MANUAL", result: result as "ELIGIBLE", reasons: reasons.split(",").map((r) => r.trim()).filter(Boolean) } });
      onOpenChange(false);
    } catch {
      /* erreur affichée dans la fenêtre */
    }
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={elig.isPending} error={elig.error}>
      <div className="space-y-3">
        <FormField label={t("result")} required>{(c) => <NativeSelect {...c} value={result} options={(["ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"] as const).map((r) => ({ value: r, label: labels.eligibility(r) }))} onChange={setResult} />}</FormField>
        <FormField label={t("reasons")} hint={t("reasonsHint")}>{(c) => <TextControl {...c} value={reasons} onChange={setReasons} maxLength={400} />}</FormField>
      </div>
    </FormDialog>
  );
}

function SubmitPieceDialog({ candidateId, piece, onClose }: { candidateId: string; piece: ExamPieceDto | null; onClose: () => void }) {
  const t = useTranslations("v2Examinations.candidateDetail.pieces.submit");
  const action = useCandidatePieceAction();
  const [doc, setDoc] = useState<DocumentRef | null>(null);
  async function submit() {
    if (!piece || !doc) return;
    try {
      await action.mutateAsync({ candidateId, requirementId: piece.requirementId, body: { action: "SUBMIT", documentRef: doc.id } });
      setDoc(null);
      onClose();
    } catch {
      /* erreur affichée dans la fenêtre */
    }
  }
  return (
    <ModalDialog open={piece !== null} onOpenChange={(o) => !o && onClose()} title={t("title", { piece: piece?.label ?? "" })}>
      <div className="space-y-3">
        <DocumentPicker value={doc} onChange={setDoc} label={t("document")} hint={t("hint")} required />
        {action.isError ? <ErrorBlock error={action.error} /> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClass.secondary} onClick={onClose}>{t("cancel")}</button>
          <button type="button" className={buttonClass.primary} disabled={!doc || action.isPending} onClick={() => void submit()}>{t("confirm")}</button>
        </div>
      </div>
    </ModalDialog>
  );
}

/** Données personnelles RESTREINTES d'un candidat libre : lecture auditée côté API, numéro de pièce masqué tant qu'on ne le demande pas. */
function ExternalProfileSection({ candidateId, anonymized }: { candidateId: string; anonymized: boolean }) {
  const t = useTranslations("v2ExaminationsExternal.profile");
  const [reveal, setReveal] = useState(false);
  const query = useExternalProfile(candidateId, reveal, true);
  return (
    <Section id="external-profile" title={t("title")}>
      <p className="text-sm text-muted-foreground">{anonymized ? t("anonymized") : t("restricted")}</p>
      {query.isPending ? <LoadingBlock /> : query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["contactPhone", query.data.contactPhone],
              ["contactEmail", query.data.contactEmail],
              ["addressLine", query.data.addressLine],
              ["idPieceKind", query.data.idPieceKind],
              ["idPieceNumber", query.data.idPieceNumber],
              ["guardianName", query.data.guardianName],
              ["guardianRelation", query.data.guardianRelation],
              ["guardianPhone", query.data.guardianPhone],
              ["guardianEmail", query.data.guardianEmail],
              ["declaredInExamGrade", query.data.declaredInExamGrade ? t("yes") : t("no")],
              ["declaredPriorAttempts", String(query.data.declaredPriorAttempts)],
              ["dataSource", t(`source.${query.data.dataSource}` as never)],
            ] as const
          ).map(([key, value]) => (
            <div key={key}><dt className="text-xs text-muted-foreground">{t(`fields.${key}` as never)}</dt><dd className="font-medium">{value ?? "—"}</dd></div>
          ))}
        </dl>
      )}
      {!anonymized && !reveal && query.data?.idPieceNumber ? <button type="button" className={buttonClass.secondary} onClick={() => setReveal(true)}>{t("reveal")}</button> : null}
      {reveal ? <p className="text-xs text-muted-foreground">{t("revealAudited")}</p> : null}
    </Section>
  );
}

function Detail({ data }: { data: ExamCandidateDetailDto }) {
  const t = useTranslations("v2Examinations.candidateDetail");
  const labels = useExamLabels();
  const date = useDateFormat();
  const flash = useFlash();
  const c = data.candidate;
  const session = useExamSession(c.sessionId);
  const elig = useEligibility();
  const register = useRegisterCandidate();
  const withdraw = useWithdrawCandidate();
  const piece = useCandidatePieceAction();
  const identifier = useSetIdentifier();
  const anonymize = useAnonymizeCandidate();
  const tExt = useTranslations("v2ExaminationsExternal.detail");
  const external = c.candidateKind === "EXTERNAL";
  const [anonymizing, setAnonymizing] = useState(false);
  const issue = useIssueDocument();
  const [manual, setManual] = useState(false);
  const [override, setOverride] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [rejecting, setRejecting] = useState<ExamPieceDto | null>(null);
  const [submitting, setSubmitting] = useState<ExamPieceDto | null>(null);
  const [idKind, setIdKind] = useState("CEPE_CODE");
  const [idValue, setIdValue] = useState("");
  const papers = new Map((session.data?.papers ?? []).map((p) => [p.id, p]));
  const name = c.displayName ?? c.id;
  const latest = data.eligibilityChecks[0] ?? null;

  async function evaluate() {
    flash.show(null);
    try {
      await elig.mutateAsync({ id: c.id, body: { mode: "EVALUATE" } });
      flash.show(t("eligibility.evaluated"));
    } catch {
      /* erreur affichée */
    }
  }
  async function doRegister() {
    flash.show(null);
    try {
      const out = await register.mutateAsync(c.id);
      flash.show(t("registered", { number: out.candidateNumber ?? "—" }));
    } catch {
      /* erreur affichée */
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={name}
        description={t("subtitle", { number: c.candidateNumber ?? t("noNumber") })}
        actions={<Link href={`/v2/examinations/candidates?session=${c.sessionId}`} className={buttonClass.secondary}>{t("back")}</Link>}
      />
      <DemoBanner visible={session.data?.demoRules ?? false} />
      {flash.node}
      <div className="flex flex-wrap gap-2">
        <StatusPill label={labels.registration(c.registrationStatus)} tone={registrationTone(c.registrationStatus)} />
        <StatusPill label={labels.eligibility(c.eligibilityStatus)} tone={eligibilityTone(c.eligibilityStatus)} />
        <StatusPill label={labels.outcome(c.outcome)} tone={outcomeTone(c.outcome)} />
        {external ? <StatusPill label={tExt("badge")} tone="info" /> : null}
        {c.anonymized ? <StatusPill label={tExt("anonymized")} tone="neutral" /> : null}
      </div>

      <Can permission="exam.candidate.manage">
        <div className="flex flex-wrap gap-2">
          {c.registrationStatus !== "REGISTERED" && c.registrationStatus !== "WITHDRAWN" ? (
            <button type="button" className={buttonClass.primary} disabled={register.isPending} onClick={() => void doRegister()}>{t("register")}</button>
          ) : null}
          {c.registrationStatus !== "WITHDRAWN" ? <button type="button" className={buttonClass.danger} onClick={() => setWithdrawing(true)}>{t("withdraw")}</button> : null}
        </div>
      </Can>
      {register.isError ? <ErrorBlock error={register.error} /> : null}

      <Section id="identity" title={t("identity.title")}>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["lastName", c.lastName],
              ["firstName", c.firstName],
              ["birthDate", c.birthDate ? date.civil(c.birthDate) : null],
              ["birthPlace", c.birthPlace],
              ["sex", c.sex],
              ["track", c.trackCode],
              ["gradeLevel", c.gradeLevelCode],
              ["officialNumber", c.officialNumber],
            ] as const
          ).map(([key, value]) => (
            <div key={key}><dt className="text-xs text-muted-foreground">{t(`identity.${key}` as never)}</dt><dd className="font-medium">{value ?? "—"}</dd></div>
          ))}
        </dl>
      </Section>

      {external ? <Can permission="exam.external.read"><ExternalProfileSection candidateId={c.id} anonymized={c.anonymized} /></Can> : null}
      {external && !c.anonymized ? (
        <Can permission="exam.external.anonymize">
          <div><button type="button" className={buttonClass.danger} onClick={() => setAnonymizing(true)}>{tExt("anonymize")}</button></div>
        </Can>
      ) : null}

      {session.data?.sessionKind === "OFFICIAL" && (c.registrationStatus === "REGISTERED" || c.registrationStatus === "WITHDRAWN") ? <Can permission="exam.fee.read"><CandidateFeeSection candidateId={c.id} /></Can> : null}

      <Section id="eligibility" title={t("eligibility.title")}>
        <Can permission="exam.eligibility.evaluate">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.primary} disabled={elig.isPending} onClick={() => void evaluate()}>{t("eligibility.evaluate")}</button>
            <button type="button" className={buttonClass.secondary} onClick={() => setManual(true)}>{t("eligibility.manual.open")}</button>
            <Can permission="exam.eligibility.override"><button type="button" className={buttonClass.secondary} onClick={() => setOverride(true)}>{t("eligibility.override.open")}</button></Can>
          </div>
        </Can>
        {elig.isError ? <ErrorBlock error={elig.error} /> : null}
        {latest === null ? <p className="text-sm text-muted-foreground">{t("eligibility.none")}</p> : (
          <ul className="space-y-2" aria-label={t("eligibility.history")}>
            {data.eligibilityChecks.map((chk) => (
              <li key={chk.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={labels.eligibility(chk.result)} tone={eligibilityTone(chk.result)} />
                  {chk.overridden ? <StatusPill label={t("eligibility.overridden")} tone="warning" /> : null}
                  <span className="text-muted-foreground">{date.instant(chk.evaluatedAt)}</span>
                  <span className="text-xs text-muted-foreground">{chk.ruleVersionRef ? t("eligibility.byRule") : t("eligibility.byHand")}</span>
                </div>
                {chk.reasons.length > 0 ? <ul className="mt-1 list-disc pl-5">{chk.reasons.map((r) => <li key={r}>{labels.reason(r)}</li>)}</ul> : null}
                {chk.overrideReason ? <p className="mt-1">{t("eligibility.overrideReason", { reason: chk.overrideReason })}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="pieces" title={t("pieces.title")}>
        {data.pieces.length === 0 ? <p className="text-sm text-muted-foreground">{t("pieces.none")}</p> : (
          <ul className="space-y-2">
            {data.pieces.map((p) => (
              <li key={p.requirementId} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{p.label}{p.required ? <span className="ml-2 text-xs text-muted-foreground">({t("pieces.required")})</span> : null}</p>
                  <p className="text-sm text-muted-foreground">{labels.piece(p.status)}{p.presentationKind === "SIGHTED" ? ` (${tExt("sighted")})` : ""}{p.rejectionReason ? ` — ${p.rejectionReason}` : ""}</p>
                </div>
                <Can permission="exam.candidate.manage">
                  <div className="flex flex-wrap gap-2">
                    {external ? (
                      <button type="button" className={buttonClass.secondary} disabled={piece.isPending || c.anonymized} onClick={() => piece.mutate({ candidateId: c.id, requirementId: p.requirementId, body: { action: "SIGHT" } })}>{tExt("sight")}</button>
                    ) : (
                      <button type="button" className={buttonClass.secondary} onClick={() => setSubmitting(p)}>{t("pieces.submitAction")}</button>
                    )}
                    {p.status === "SUBMITTED" ? (
                      <>
                        <button type="button" className={buttonClass.secondary} disabled={piece.isPending} onClick={() => piece.mutate({ candidateId: c.id, requirementId: p.requirementId, body: { action: "ACCEPT" } })}>{t("pieces.accept")}</button>
                        <button type="button" className={buttonClass.secondary} onClick={() => setRejecting(p)}>{t("pieces.reject")}</button>
                      </>
                    ) : null}
                  </div>
                </Can>
              </li>
            ))}
          </ul>
        )}
        {piece.isError ? <ErrorBlock error={piece.error} /> : null}
      </Section>

      <Section id="identifiers" title={t("identifiers.title")}>
        {data.identifiers.length === 0 ? <p className="text-sm text-muted-foreground">{t("identifiers.none")}</p> : (
          <ul className="space-y-1 text-sm">{data.identifiers.map((i) => <li key={i.id}><span className="font-medium">{i.kind}</span> : {i.value} <span className="text-xs text-muted-foreground">({i.source})</span></li>)}</ul>
        )}
        <Can permission="exam.candidate.manage">
          <form className="grid gap-3 sm:grid-cols-3 sm:items-end" noValidate onSubmit={(e) => { e.preventDefault(); if (idValue.trim()) identifier.mutate({ candidateId: c.id, kind: idKind.trim().toUpperCase(), value: idValue.trim() }, { onSuccess: () => setIdValue("") }); }}>
            <FormField label={t("identifiers.kind")}>{(f) => <TextControl {...f} value={idKind} onChange={setIdKind} maxLength={40} />}</FormField>
            <FormField label={t("identifiers.value")}>{(f) => <TextControl {...f} value={idValue} onChange={setIdValue} maxLength={60} />}</FormField>
            <button type="submit" className={buttonClass.secondary} disabled={identifier.isPending || !idValue.trim()}>{t("identifiers.save")}</button>
          </form>
        </Can>
        {identifier.isError ? <ErrorBlock error={identifier.error} /> : null}
      </Section>

      <Section id="assignment" title={t("assignment.title")}>
        {data.assignment === null ? <p className="text-sm text-muted-foreground">{t("assignment.none")}</p> : (
          <p>{t("assignment.value", { center: data.assignment.centerName, room: data.assignment.roomCode, seat: data.assignment.seatNumber })}</p>
        )}
      </Section>

      <Section id="scores" title={t("scores.title")}>
        {data.scores.length === 0 ? <p className="text-sm text-muted-foreground">{t("scores.none")}</p> : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.scores.map((s) => (
              <li key={s.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
                <p className="font-medium">{papers.get(s.paperId)?.label ?? s.paperId}</p>
                <p>{s.status === "ENTERED" ? t("scores.value", { score: showDecimal(s.score), max: showDecimal(papers.get(s.paperId)?.scaleMax) }) : labels.scoreStatus(s.status)}</p>
                <p className="text-xs text-muted-foreground">{labels.source(`score_${s.source}`)}</p>
              </li>
            ))}
          </ul>
        )}
        {data.result ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm" data-testid="candidate-result">
            <p className="font-medium">{t("result.title")}</p>
            <p><StatusPill label={labels.resultCode(data.result.resultCode)} tone={outcomeTone(data.result.resultCode)} /> {data.result.average !== null ? t("result.average", { average: showDecimal(data.result.average) }) : null}</p>
            <p className="text-xs text-muted-foreground">{labels.source(`result_${data.result.source}`)} — {data.result.status === "PUBLISHED" ? t("result.published") : t("result.draft")}</p>
          </div>
        ) : null}
      </Section>

      <Can permission="exam.document.issue">
        <Section id="documents" title={t("documents.title")}>
          <div className="flex flex-wrap gap-2">
            {EXAM_DOCUMENT_KINDS.map((kind) => (
              <button key={kind} type="button" className={buttonClass.secondary} disabled={issue.isPending} onClick={() => issue.mutate({ candidateId: c.id, kind: kind as ExamDocumentKind })}>{t("documents.issue", { kind: labels.docKind(kind) })}</button>
            ))}
          </div>
          {issue.isError ? <ErrorBlock error={issue.error} /> : null}
          {data.documents.length === 0 ? <p className="text-sm text-muted-foreground">{t("documents.none")}</p> : (
            <ul className="space-y-2">
              {data.documents.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{labels.docKind(d.kind)} v{d.version} — {labels.docStatus(d.status)}</span>
                  {d.status === "ISSUED" ? <PdfButton path={issuedDocumentFilePath(d.id)} fileName={`${d.kind}-${c.candidateNumber ?? c.id}.pdf`} label={t("documents.download")} ariaLabel={t("documents.downloadAria", { kind: labels.docKind(d.kind), version: d.version })} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Can>

      <Section id="history" title={t("history.title")}>
        {data.history.length === 0 ? <p className="text-sm text-muted-foreground">{t("history.none")}</p> : (
          <ol className="space-y-1 text-sm">
            {data.history.map((h) => (
              <li key={h.id}>{date.instant(h.occurredAt)} — {h.kind}{h.fromValue || h.toValue ? ` (${h.fromValue ?? "—"} → ${h.toValue ?? "—"})` : ""}{h.reason ? ` — ${h.reason}` : ""}</li>
            ))}
          </ol>
        )}
      </Section>

      <ManualEligibilityDialog candidateId={c.id} open={manual} onOpenChange={setManual} />
      <ReasonDialog
        open={override}
        onOpenChange={setOverride}
        title={t("eligibility.override.title")}
        description={t("eligibility.override.description")}
        reasonLabel={t("eligibility.override.reason")}
        confirmLabel={t("eligibility.override.confirm")}
        minLength={10}
        isPending={elig.isPending}
        error={elig.error}
        onConfirm={async (reason) => {
          try {
            await elig.mutateAsync({ id: c.id, body: { mode: "OVERRIDE", reason } });
            setOverride(false);
          } catch {
            /* erreur affichée dans la fenêtre */
          }
        }}
      />
      <ReasonDialog
        open={withdrawing}
        onOpenChange={setWithdrawing}
        title={t("withdrawDialog.title")}
        description={t("withdrawDialog.description")}
        reasonLabel={t("withdrawDialog.reason")}
        confirmLabel={t("withdrawDialog.confirm")}
        destructive
        isPending={withdraw.isPending}
        error={withdraw.error}
        onConfirm={async (reason) => {
          try {
            await withdraw.mutateAsync({ id: c.id, reason });
            setWithdrawing(false);
          } catch {
            /* erreur affichée dans la fenêtre */
          }
        }}
      />
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={t("pieces.rejectDialog.title", { piece: rejecting?.label ?? "" })}
        reasonLabel={t("pieces.rejectDialog.reason")}
        confirmLabel={t("pieces.rejectDialog.confirm")}
        minLength={3}
        isPending={piece.isPending}
        error={piece.error}
        onConfirm={async (reason) => {
          if (!rejecting) return;
          try {
            await piece.mutateAsync({ candidateId: c.id, requirementId: rejecting.requirementId, body: { action: "REJECT", rejectionReason: reason } });
            setRejecting(null);
          } catch {
            /* erreur affichée dans la fenêtre */
          }
        }}
      />
      <SubmitPieceDialog candidateId={c.id} piece={submitting} onClose={() => setSubmitting(null)} />
      <ReasonDialog
        open={anonymizing}
        onOpenChange={setAnonymizing}
        title={tExt("anonymizeDialog.title")}
        description={tExt("anonymizeDialog.description")}
        reasonLabel={tExt("anonymizeDialog.reason")}
        confirmLabel={tExt("anonymizeDialog.confirm")}
        minLength={10}
        destructive
        isPending={anonymize.isPending}
        error={anonymize.error}
        onConfirm={async (reason) => {
          try {
            await anonymize.mutateAsync({ id: c.id, reason });
            setAnonymizing(false);
          } catch {
            /* erreur affichée dans la fenêtre */
          }
        }}
      />
    </div>
  );
}

/** Dossier d'un candidat : éligibilité (évaluée par la règle, dérogation motivée), pièces, identifiants, place, notes, documents. */
export function CandidateDetailScreen({ id }: { id: string }) {
  const query = useExamCandidate(id);
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  return <Detail data={query.data} />;
}
