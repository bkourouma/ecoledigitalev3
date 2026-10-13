"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { higherAwardBodySchema, higherUpdateDiplomaBodySchema, type HigherAwardDto } from "@ecoledigitale/contracts/v2/higher";
import type { z } from "zod";
import type { higherCandidateDtoSchema } from "@ecoledigitale/contracts/v2/higher";
import { usePermission } from "@/platform/access";
import {
  useAwardDiploma,
  useAwards,
  useCandidates,
  useDeleteDiploma,
  useDiploma,
  useIssueAwardDocument,
  useRecomputeDiploma,
  useRevokeAward,
  useStudentProgress,
  useSyncDiploma,
  useUpdateDiploma,
} from "@/platform/v2/higher";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat, showDecimal } from "@/platform/ui/format";
import { FormDialog, ModalDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { toneOfStatus } from "../../assessments/_components/shared";
import { AwardDocuments } from "./AwardDocuments";

type Candidate = z.infer<typeof higherCandidateDtoSchema>;
type Tab = "requirements" | "candidates" | "awards";

export function DiplomaDetail({ id }: { id: string }) {
  const t = useTranslations("v2Higher.diploma");
  const tStatus = useTranslations("v2Higher.diplomaStatus");
  const query = useDiploma(id);
  const [tab, setTab] = useState<Tab>("requirements");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sync = useSyncDiploma();
  const remove = useDeleteDiploma();
  const canManage = usePermission("higher.diploma.manage");
  const flash = useFlash();
  const [actionError, setActionError] = useState<unknown>(null);
  const [deleted, setDeleted] = useState(false);
  const tabs: Tab[] = ["requirements", "candidates", "awards"];
  const d = query.data;

  async function runSync() {
    setActionError(null);
    try {
      const r = await sync.mutateAsync({ id });
      flash.show(t("synced", { added: r.added.length, removed: r.removed.length, updated: r.updated }));
    } catch (e) {
      setActionError(e);
    }
  }

  if (deleted) return <Notice kind="success">{t("deleted")}</Notice>;

  return (
    <QueryBoundary query={query}>
      {d ? (
        <div className="space-y-6">
          <PageHeader
            title={d.diploma.label}
            description={`${d.diploma.code} · ${d.diploma.gradeCode} · ${t("uvLine", { required: String(d.diploma.uvRequired).replace(".", ","), listed: String(d.requirementsCredits).replace(".", ",") })}`}
            actions={
              <>
                <StatusBadge label={tStatus(d.diploma.status)} tone={d.diploma.status === "ACTIVE" ? "success" : "neutral"} />
                {canManage.allowed ? (
                  <>
                    <button type="button" className={buttonClass.secondary} onClick={() => setEditing(true)}>
                      {t("edit")}
                    </button>
                    <button type="button" className={buttonClass.secondary} onClick={() => void runSync()} disabled={sync.isPending}>
                      {t("sync")}
                    </button>
                    <button type="button" className={buttonClass.danger} onClick={() => setDeleting(true)}>
                      {t("delete")}
                    </button>
                  </>
                ) : null}
              </>
            }
          />
          {flash.node}
          {actionError ? <ErrorBlock error={actionError} /> : null}
          {d.diploma.description ? <p className="text-sm text-muted-foreground">{d.diploma.description}</p> : null}
          <p className="text-sm text-muted-foreground">{t("counts", { total: d.awardCounts.total, obtained: d.awardCounts.obtained })}</p>

          <div role="tablist" aria-label={t("tabs")} className="flex gap-1 overflow-x-auto border-b">
            {tabs.map((x) => (
              <button
                key={x}
                id={`dtab-${x}`}
                type="button"
                role="tab"
                aria-selected={tab === x}
                aria-controls={`dpanel-${x}`}
                onClick={() => setTab(x)}
                className={`inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 ${tab === x ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {t(`tab.${x}`)}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`dpanel-${tab}`} aria-labelledby={`dtab-${tab}`}>
            {tab === "requirements" ? (
              <ul className="space-y-2" aria-label={t("requirements")}>
                {d.requirements.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
                    <span>
                      <span className="font-medium">{r.ueLabel ?? t("unknownUe")}</span> <span className="font-mono text-xs text-muted-foreground">{r.ueCode}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">{t("credits", { credits: String(r.credits).replace(".", ",") })}</span>
                      <StatusBadge label={t(r.mandatory ? "mandatory" : "optional")} tone={r.mandatory ? "info" : "neutral"} />
                      {r.removedFromCurriculum ? <StatusBadge label={t("removed")} tone="warning" /> : null}
                    </span>
                  </li>
                ))}
                {d.requirements.length === 0 ? <EmptyBlock title={t("noRequirements")} /> : null}
              </ul>
            ) : null}
            {tab === "candidates" ? <CandidatesTab diplomaId={id} /> : null}
            {tab === "awards" ? <AwardsTab diplomaId={id} /> : null}
          </div>

          {editing ? <EditDialog diploma={d.diploma} onClose={() => setEditing(false)} onDone={() => flash.show(t("updated"))} /> : null}
          {deleting ? (
            <ReasonDialog
              open
              onOpenChange={(o) => !o && setDeleting(false)}
              title={t("deleteTitle")}
              description={t("deleteDescription")}
              reasonLabel={t("deleteConfirm")}
              reasonRequired={false}
              confirmLabel={t("delete")}
              destructive
              isPending={remove.isPending}
              error={remove.error}
              onConfirm={async () => {
                try {
                  await remove.mutateAsync({ id });
                  setDeleted(true);
                } catch {
                  /* affichée par la boîte de dialogue */
                }
              }}
            />
          ) : null}
          <p className="text-sm">
            <Link href="/v2/higher/diplomas" className="font-medium text-primary underline-offset-4 hover:underline">
              {t("back")}
            </Link>
          </p>
        </div>
      ) : null}
    </QueryBoundary>
  );
}

function EditDialog({ diploma, onClose, onDone }: { diploma: { id: string; label: string; uvRequired: number; autoAward: boolean; status: string; description: string | null }; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Higher.diploma");
  const tStatus = useTranslations("v2Higher.diplomaStatus");
  const update = useUpdateDiploma();
  const [form, setForm] = useState({ label: diploma.label, uvRequired: String(diploma.uvRequired), autoAward: diploma.autoAward, status: diploma.status });
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit() {
    const patch: Record<string, unknown> = {};
    if (form.label.trim() !== diploma.label) patch.label = form.label.trim();
    const uv = Number(form.uvRequired.replace(",", "."));
    if (uv !== diploma.uvRequired) patch.uvRequired = uv;
    if (form.autoAward !== diploma.autoAward) patch.autoAward = form.autoAward;
    if (form.status !== diploma.status) patch.status = form.status;
    const v = validateWith(higherUpdateDiplomaBodySchema, patch);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      await update.mutateAsync({ id: diploma.id, patch: v.data });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle")} submitLabel={t("save")} onSubmit={() => void submit()} isPending={update.isPending} error={Object.keys(errors).length === 0 ? update.error : null}>
      <FormField label={t("label")} error={errors.label}>
        {(c) => <TextControl {...c} value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} maxLength={200} />}
      </FormField>
      <FormField label={t("uvRequired")} error={errors.uvRequired} hint={t("uvHint")}>
        {(c) => <TextControl {...c} value={form.uvRequired} onChange={(v) => setForm((f) => ({ ...f, uvRequired: v }))} inputMode="decimal" />}
      </FormField>
      <FormField label={t("statusLabel")} error={errors.status}>
        {(c) => (
          <NativeSelect
            {...c}
            value={form.status}
            onChange={(v) => setForm((f) => ({ ...f, status: v }))}
            options={[
              { value: "ACTIVE", label: tStatus("ACTIVE") },
              { value: "INACTIVE", label: tStatus("INACTIVE") },
            ]}
          />
        )}
      </FormField>
      <CheckControl checked={form.autoAward} onChange={(v) => setForm((f) => ({ ...f, autoAward: v }))} label={t("autoAward")} hint={t("autoAwardHint")} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Candidats : éligibilité décidée par la règle, octroi, octroi forcé, ré-octroi
// ---------------------------------------------------------------------------

function CandidatesTab({ diplomaId }: { diplomaId: string }) {
  const t = useTranslations("v2Higher.candidates");
  const tAward = useTranslations("v2Higher.awardStatus");
  const query = useCandidates(diplomaId);
  const recompute = useRecomputeDiploma();
  const canCreate = usePermission("higher.award.create");
  const canForce = usePermission("higher.award.force");
  const [awarding, setAwarding] = useState<Candidate | null>(null);
  const [progressOf, setProgressOf] = useState<Candidate | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const flash = useFlash();
  const items = useMemo(() => [...(query.data ?? [])].sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? "", "fr", { sensitivity: "base" })), [query.data]);

  async function runRecompute() {
    setActionError(null);
    try {
      const r = await recompute.mutateAsync({ id: diplomaId });
      flash.show(t("recomputed", { evaluated: r.evaluated, awarded: r.awarded, failed: r.failed }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <div className="space-y-3">
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      {canCreate.allowed ? (
        <div>
          <button type="button" className={buttonClass.secondary} onClick={() => void runRecompute()} disabled={recompute.isPending}>
            {t("recompute")}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">{t("recomputeHint")}</p>
        </div>
      ) : null}
      <QueryBoundary query={query} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <div role="region" aria-label={t("tableCaption")} tabIndex={0} className="overflow-x-auto rounded-2xl border border-white/10 bg-card/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="bg-white/[0.04] text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t("columns.student")}</th>
                <th scope="col" className="px-3 py-2 text-right">{t("columns.progress")}</th>
                <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">{t("columns.missing")}</th>
                <th scope="col" className="px-3 py-2">{t("columns.eligibility")}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">{t("columns.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const name = c.fullName ?? t("studentFallback", { id: c.studentId.slice(0, 4) });
                const canAward = c.awardStatus !== "OBTAINED" && (c.eligible === true ? canCreate.allowed : canForce.allowed && canCreate.allowed);
                return (
                  <tr key={c.studentId} className="border-t border-white/5 align-top transition-colors hover:bg-white/[0.04]">
                    <th scope="row" className="min-w-[8rem] px-3 py-2 text-left font-medium">
                      {name}
                      {c.matricule ? <span className="block text-xs font-normal text-muted-foreground">{c.matricule}</span> : null}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t("uv", { uv: String(c.uvValidated).replace(".", ","), percent: c.percent })}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{c.missingMandatory}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        <StatusBadge label={c.eligible === null ? t("unknown") : c.eligible ? t("eligible") : t("notEligible")} tone={c.eligible === true ? "success" : c.eligible === false ? "warning" : "neutral"} />
                        {c.awardStatus ? <StatusBadge label={tAward(c.awardStatus)} tone={toneOfStatus(c.awardStatus)} /> : null}
                      </span>
                      {c.awardReference ? <span className="mt-1 block font-mono text-xs">{c.awardReference}</span> : null}
                      {c.revokeReason ? <span className="mt-1 block text-xs text-muted-foreground">{t("revokedBecause", { reason: c.revokeReason })}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <span className="flex flex-wrap justify-end gap-1">
                        <button type="button" className={buttonClass.ghost} onClick={() => setProgressOf(c)} aria-label={t("progressOf", { name })}>
                          {t("progress")}
                        </button>
                        {canAward ? (
                          <button type="button" className={c.eligible === true ? buttonClass.secondary : buttonClass.danger} onClick={() => setAwarding(c)} aria-label={t(c.awardStatus === "REVOKED" ? "reawardOf" : c.eligible === true ? "awardOf" : "forceOf", { name })}>
                            {t(c.awardStatus === "REVOKED" ? "reaward" : c.eligible === true ? "award" : "force")}
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
      {awarding ? <AwardDialog diplomaId={diplomaId} candidate={awarding} canForce={canForce.allowed} onClose={() => setAwarding(null)} onDone={(msg) => flash.show(msg)} /> : null}
      {progressOf ? <ProgressDialog diplomaId={diplomaId} candidate={progressOf} onClose={() => setProgressOf(null)} /> : null}
    </div>
  );
}

function AwardDialog({ diplomaId, candidate, canForce, onClose, onDone }: { diplomaId: string; candidate: Candidate; canForce: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2Higher.award");
  const award = useAwardDiploma();
  const reaward = candidate.awardStatus === "REVOKED";
  const notEligible = candidate.eligible !== true;
  const [force, setForce] = useState(notEligible);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const name = candidate.fullName ?? candidate.studentId.slice(0, 8);

  async function submit() {
    if (notEligible && force && reason.trim().length < 20) return setErrors({ reason: t("reasonTooShort") });
    if (reaward && decision.trim().length < 20) return setErrors({ reawardDecision: t("decisionTooShort") });
    const body = {
      studentId: candidate.studentId,
      ...(notEligible && force ? { force: true, reason: reason.trim() } : {}),
      ...(reaward ? { reawardDecision: decision.trim() } : {}),
    };
    const v = validateWith(higherAwardBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const r = await award.mutateAsync({ diplomaId, studentId: candidate.studentId, force: v.data.force, reason: v.data.reason, reawardDecision: v.data.reawardDecision });
      onDone(t("done", { name, reference: r.award.reference }));
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t(reaward ? "reawardTitle" : notEligible ? "forceTitle" : "title", { name })} description={t("description")} submitLabel={t(reaward ? "reawardSubmit" : notEligible ? "forceSubmit" : "submit")} onSubmit={() => void submit()} isPending={award.isPending} error={Object.keys(errors).length === 0 ? award.error : null}>
      {notEligible ? (
        <>
          <Notice kind="warning">{t("notEligible")}</Notice>
          {canForce ? (
            <>
              <CheckControl checked={force} onChange={setForce} label={t("force")} hint={t("forceHint")} />
              {force ? (
                <FormField label={t("reason")} required error={errors.reason} hint={t("reasonHint")}>
                  {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={1000} />}
                </FormField>
              ) : null}
            </>
          ) : (
            <Notice kind="error">{t("noForceRight")}</Notice>
          )}
        </>
      ) : (
        <Notice kind="info">{t("eligible")}</Notice>
      )}
      {reaward ? (
        <FormField label={t("decision")} required error={errors.reawardDecision} hint={t("decisionHint")}>
          {(c) => <TextAreaControl {...c} value={decision} onChange={setDecision} maxLength={1000} />}
        </FormField>
      ) : null}
    </FormDialog>
  );
}

function ProgressDialog({ diplomaId, candidate, onClose }: { diplomaId: string; candidate: Candidate; onClose: () => void }) {
  const t = useTranslations("v2Higher.progress");
  const query = useStudentProgress(diplomaId, candidate.studentId);
  const name = candidate.fullName ?? candidate.studentId.slice(0, 8);
  return (
    <ModalDialog open onOpenChange={(o) => !o && onClose()} title={t("title", { name })} className="sm:max-w-2xl">
      <QueryBoundary query={query}>
        {query.data ? (
          <div className="space-y-4 text-sm">
            <p>{t("summary", { validated: String(query.data.progress.uvValidated).replace(".", ","), required: String(query.data.progress.uvRequired).replace(".", ","), percent: query.data.progress.percent })}</p>
            {query.data.eligibility ? (
              <p>
                {t(query.data.eligibility.eligible ? "eligible" : "notEligible")}{" "}
                <span className="text-muted-foreground">{t("rule", { ruleSet: query.data.eligibility.rule.ruleSetCode, version: query.data.eligibility.rule.versionNo })}</span>
              </p>
            ) : null}
            <Section title={t("missingMandatory")} items={query.data.progress.missingMandatory} />
            <Section title={t("remaining")} items={query.data.progress.remaining} />
            <Section title={t("validated")} items={query.data.progress.validated} />
          </div>
        ) : null}
      </QueryBoundary>
    </ModalDialog>
  );
}

function Section({ title, items }: { title: string; items: Array<{ ueNodeId: string; code: string | null; label: string | null; credits: number; mandatory: boolean; removedFromCurriculum: boolean }> }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="font-semibold">
        {title} ({items.length})
      </h3>
      <ul className="mt-1 space-y-1">
        {items.map((r) => (
          <li key={r.ueNodeId}>
            {r.label ?? r.code ?? r.ueNodeId.slice(0, 8)} — {String(r.credits).replace(".", ",")}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Octrois : révocation, émission des documents
// ---------------------------------------------------------------------------

function AwardsTab({ diplomaId }: { diplomaId: string }) {
  const t = useTranslations("v2Higher.awards");
  const tAward = useTranslations("v2Higher.awardStatus");
  const tVia = useTranslations("v2Higher.awardedVia");
  const date = useDateFormat();
  const query = useAwards(diplomaId);
  const candidates = useCandidates(diplomaId);
  const issue = useIssueAwardDocument();
  const revoke = useRevokeAward();
  const canRevoke = usePermission("higher.award.revoke");
  const canIssue = usePermission("higher.document.issue");
  const [revoking, setRevoking] = useState<HigherAwardDto | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const flash = useFlash();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const names = useMemo(() => new Map((candidates.data ?? []).map((c) => [c.studentId, c.fullName ?? c.studentId.slice(0, 8)] as const)), [candidates.data]);

  async function emit(award: HigherAwardDto, kind: "DIPLOMA" | "ATTESTATION_AUTHENTICITY", duplicate = false) {
    setActionError(null);
    try {
      const r = await issue.mutateAsync({ awardId: award.id, kind, duplicate });
      flash.show(t(r.created ? "documentCreated" : "documentExisting", { reference: r.document.reference }));
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <div className="space-y-3">
      {flash.node}
      {actionError ? <ErrorBlock error={actionError} /> : null}
      <QueryBoundary query={query} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} />}>
        <ul className="space-y-3" aria-label={t("listLabel")}>
          {items.map((a) => {
            const name = names.get(a.studentId) ?? t("studentFallback", { id: a.studentId.slice(0, 4) });
            return (
              <li key={a.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {name} <span className="font-mono text-xs font-normal text-muted-foreground">{a.reference}</span>
                  </p>
                  <span className="flex flex-wrap gap-1">
                    <StatusBadge label={tAward(a.status)} tone={toneOfStatus(a.status)} />
                    <StatusBadge label={tVia(a.awardedVia)} tone={a.awardedVia === "FORCED" ? "warning" : "neutral"} />
                  </span>
                </div>
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  <Fact label={t("credits")}>{String(a.creditsTotal).replace(".", ",")}</Fact>
                  <Fact label={t("cycleAverage")}>{showDecimal(a.cycleAverage)}</Fact>
                  <Fact label={t("mention")}>{a.mentionCode ?? "—"}</Fact>
                  <Fact label={t("acquiredDate")}>{date.civil(a.acquiredDate)}</Fact>
                  <Fact label={t("rule")}>{`${a.rule.ruleSetCode} · v${a.rule.versionNo}`}</Fact>
                  <Fact label={t("awardedBy")}>{`${a.awardedByName} (${date.instant(a.awardedAt)})`}</Fact>
                </dl>
                {a.forcedReason ? <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">{t("forcedReason", { reason: a.forcedReason })}</p> : null}
                {a.reawardDecision ? <p className="text-xs text-muted-foreground">{t("reawardDecision", { decision: a.reawardDecision })}</p> : null}
                {a.status === "REVOKED" ? <p className="text-xs text-destructive">{t("revoked", { name: a.revokedByName ?? "—", date: date.instant(a.revokedAt), reason: a.revokeReason ?? "—" })}</p> : null}
                <AwardDocuments award={a} />
                {a.status === "OBTAINED" ? (
                  <div className="flex flex-wrap gap-2">
                    {canIssue.allowed ? (
                      <>
                        <button type="button" className={buttonClass.secondary} onClick={() => void emit(a, "DIPLOMA")} disabled={issue.isPending} aria-label={t("issueDiplomaOf", { name })}>
                          {t("issueDiploma")}
                        </button>
                        <button type="button" className={buttonClass.ghost} onClick={() => void emit(a, "DIPLOMA", true)} disabled={issue.isPending} aria-label={t("duplicateOf", { name })}>
                          {t("duplicate")}
                        </button>
                        <button type="button" className={buttonClass.ghost} onClick={() => void emit(a, "ATTESTATION_AUTHENTICITY")} disabled={issue.isPending} aria-label={t("issueAuthenticityOf", { name })}>
                          {t("issueAuthenticity")}
                        </button>
                      </>
                    ) : null}
                    {canRevoke.allowed ? (
                      <button type="button" className={buttonClass.danger} onClick={() => setRevoking(a)} aria-label={t("revokeOf", { name })}>
                        {t("revoke")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </QueryBoundary>
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <button type="button" className={buttonClass.secondary} onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {t("more")}
          </button>
        </div>
      ) : null}
      {revoking ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setRevoking(null)}
          title={t("revokeTitle", { name: names.get(revoking.studentId) ?? revoking.reference })}
          description={t("revokeDescription")}
          reasonLabel={t("revokeReason")}
          minLength={10}
          maxLength={1000}
          confirmLabel={t("revoke")}
          destructive
          isPending={revoke.isPending}
          error={revoke.error}
          onConfirm={async (reason) => {
            try {
              await revoke.mutateAsync({ id: revoking.id, reason });
              flash.show(t("revokedDone"));
              setRevoking(null);
            } catch {
              /* affichée par la boîte de dialogue */
            }
          }}
        />
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

