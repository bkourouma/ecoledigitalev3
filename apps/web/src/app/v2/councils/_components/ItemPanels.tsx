"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  councilsDecisionInputSchema,
  councilsProposalInputSchema,
  type CouncilsAgendaItemDetailDto,
  type CouncilsCouncilDetailDto,
  type CouncilsDecisionDto,
  type CouncilsDecisionTypeDto,
  type CouncilsFacts,
  type CouncilsProposalDto,
} from "@ecoledigitale/contracts/v2/councils";
import { useReference, usePrograms } from "@/platform/v2/academic";
import { useCouncilsReference, useCreateProposal, useRecordDecision, useResolveProposal, useWithdrawDecision } from "@/platform/v2/councils";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { ActionError, EnumLabel, Hash, Section, useDateTime, useEnumText } from "./shared";

// ---------------------------------------------------------------------------
// Faits figés `council-facts/1` : valeurs de l'API, aucun calcul
// ---------------------------------------------------------------------------

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export function FactsPanel({ facts, factsVersion, factsHash, compact: dense = false }: { facts: CouncilsFacts | null; factsVersion: number; factsHash: string | null; compact?: boolean }) {
  const t = useTranslations("v2Councils.facts");
  if (!facts) return <Notice kind="info">{t("none")}</Notice>;
  const r = facts.results;
  const a = facts.attendance;
  const d = facts.discipline;
  const dash = "—";
  const num = (n: number | null | undefined) => (n === null || n === undefined ? dash : String(n));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("frozen", { version: factsVersion })} <Hash value={factsHash} />
      </p>
      {r === null || r.missingResults ? <Notice kind="warning">{t("missingResults")}</Notice> : null}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("resultStatus")}>{r?.status ?? dash}</Fact>
        <Fact label={t("average")}>{r ? (r.averageDisplay ?? r.average ?? dash) : dash}</Fact>
        <Fact label={t("rank")}>{r && r.rank !== null ? (r.cohortSize !== null ? t("rankOf", { rank: r.rank, size: r.cohortSize }) : String(r.rank)) : dash}</Fact>
        <Fact label={t("mention")}>{r?.mentionCode ?? dash}</Fact>
        {dense ? null : <Fact label={t("ruleVersion")}>{r?.ruleVersionRef ?? dash}</Fact>}
        <Fact label={t("repeating")}>{facts.repeating ? t("yes") : t("no")}</Fact>
        <Fact label={t("funding")}>{facts.funding.type ?? dash}</Fact>
        <Fact label={t("stateAssigned")}>{facts.funding.stateAssigned ? t("yes") : t("no")}</Fact>
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">{t("attendance")}</h3>
          {a && a.available ? (
            <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Fact label={t("absentMinutes")}>{num(a.absentMinutes)}</Fact>
              <Fact label={t("excusedMinutes")}>{num(a.excusedMinutes)}</Fact>
              <Fact label={t("absentCount")}>{num(a.absentCount)}</Fact>
              <Fact label={t("excusedCount")}>{num(a.excusedCount)}</Fact>
              <Fact label={t("lateCount")}>{num(a.lateCount)}</Fact>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t("attendanceUnavailable")}</p>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("discipline")}</h3>
          {d && d.available ? (
            <div className="mt-1 space-y-1">
              <dl className="grid grid-cols-2 gap-2">
                <Fact label={t("exclusionDays")}>{num(d.exclusionDays)}</Fact>
                <Fact label={t("conductPoints")}>{num(d.conductPoints)}</Fact>
              </dl>
              {Object.keys(d.measuresByKind).length > 0 ? (
                <ul className="flex flex-wrap gap-1" aria-label={t("measuresByKind")}>
                  {Object.entries(d.measuresByKind).map(([k, n]) => (
                    <li key={k}>
                      <StatusBadge label={`${k} : ${n}`} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("disciplineUnavailable")}</p>
          )}
        </div>
      </div>
      {r && r.appreciations.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">{t("appreciations")}</h3>
          <ul className="mt-1 space-y-1">
            {r.appreciations.map((x, i) => (
              <li key={i} className="text-sm">
                <AuthorRole role={x.authorRole} /> {x.body}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AuthorRole({ role }: { role: string }) {
  return <EnumLabel group="authorRole" value={role} />;
}

// ---------------------------------------------------------------------------
// Suggestions des règles : toujours ÉTIQUETÉES « Suggestion », jamais présentées comme une décision
// ---------------------------------------------------------------------------

export function SuggestionsPanel({ facts }: { facts: CouncilsFacts | null }) {
  const t = useTranslations("v2Councils.suggestions");
  const text = useEnumText();
  const list = facts?.results?.suggestions ?? [];
  return (
    <section aria-labelledby="item-suggestions" className="space-y-2 rounded-lg border border-dashed border-amber-400 bg-amber-50/40 p-3">
      <h2 id="item-suggestions" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("notDecision")}</p>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="space-y-1">
          {list.map((s, i) => (
            <li key={`${s.kind}-${s.code}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge label={t("label")} tone="warning" />
              <span>{text("proposalKind", s.kind)}</span>
              <strong>{s.code}</strong>
              {s.ref ? <span className="text-xs text-muted-foreground">{s.ref}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Propositions (suggestions de règle consignées + propositions humaines)
// ---------------------------------------------------------------------------

type ProposalPending = { kind: "reject" | "withdraw"; proposal: CouncilsProposalDto };

export function ProposalsPanel({ itemId, proposals }: { itemId: string; proposals: readonly CouncilsProposalDto[] }) {
  const t = useTranslations("v2Councils.proposals");
  const text = useEnumText();
  const flash = useFlash();
  const accept = useResolveProposal("accept");
  const reject = useResolveProposal("reject");
  const withdraw = useResolveProposal("withdraw");
  const [pending, setPending] = useState<ProposalPending | null>(null);
  const [adding, setAdding] = useState(false);
  const action = pending?.kind === "reject" ? reject : withdraw;
  return (
    <Section
      id="item-proposals"
      title={t("title")}
      actions={
        <Can permission="council.proposal.write">
          <button type="button" className={buttonClass.secondary} onClick={() => setAdding(true)}>
            {t("add")}
          </button>
        </Can>
      }
    >
      {flash.node}
      <ActionError error={accept.error} />
      {proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {proposals.map((p) => (
            <li key={p.id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {p.origin === "RULE_SUGGESTION" ? <StatusBadge label={t("originSuggestion")} tone="warning" /> : <StatusBadge label={t("originHuman")} tone="info" />}
                <span className="text-sm font-medium">{text("proposalKind", p.kind)}</span>
                {p.code ? <strong className="text-sm">{p.code}</strong> : null}
                <EnumLabel group="proposalStatus" value={p.status} />
              </div>
              {p.body ? <p className="text-sm">{p.body}</p> : null}
              <p className="text-xs text-muted-foreground">
                {p.proposedByName ? t("by", { name: p.proposedByName }) : null}
                {p.resolutionNote ? ` · ${p.resolutionNote}` : ""}
              </p>
              {p.status === "PROPOSED" ? (
                <Can permission="council.decision.record">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass.primary} disabled={accept.isPending} onClick={() => accept.mutate({ id: p.id }, { onSuccess: () => flash.show(t("done.accepted")) })}>
                      {t("accept")}
                    </button>
                    <button type="button" className={buttonClass.secondary} onClick={() => setPending({ kind: "reject", proposal: p })}>
                      {t("reject")}
                    </button>
                    {p.origin === "HUMAN" ? (
                      <button type="button" className={buttonClass.ghost} onClick={() => setPending({ kind: "withdraw", proposal: p })}>
                        {t("withdraw")}
                      </button>
                    ) : null}
                  </div>
                </Can>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {pending ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={t(`dialog.${pending.kind}.title`)}
          description={t(`dialog.${pending.kind}.description`)}
          reasonLabel={t("dialog.note")}
          confirmLabel={t(`dialog.${pending.kind}.confirm`)}
          reasonRequired={false}
          minLength={1}
          maxLength={1000}
          isPending={action.isPending}
          error={action.error}
          onConfirm={(note) =>
            action.mutate(compact({ id: pending.proposal.id, note }) as { id: string; note?: string }, {
              onSuccess: () => {
                flash.show(t(pending.kind === "reject" ? "done.rejected" : "done.withdrawn"));
                setPending(null);
              },
            })
          }
        />
      ) : null}
      {adding ? <ProposalFormDialog itemId={itemId} onClose={() => setAdding(false)} onDone={() => flash.show(t("done.added"))} /> : null}
    </Section>
  );
}

const HUMAN_KINDS = ["APPRECIATION", "REMARK", "DISTINCTION"] as const;

function ProposalFormDialog({ itemId, onClose, onDone }: { itemId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.proposals.form");
  const text = useEnumText();
  const create = useCreateProposal();
  const [kind, setKind] = useState<(typeof HUMAN_KINDS)[number]>("APPRECIATION");
  const [body, setBody] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const usesCode = kind === "DISTINCTION";
  function submit() {
    const payload = compact({ kind, body: usesCode ? "" : body, code: usesCode ? code : "" });
    const v = validateWith(councilsProposalInputSchema, payload);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    create.mutate(
      { itemId, input: v.data },
      {
        onSuccess: () => {
          onDone();
          onClose();
        },
        onError: (e) => setErrors(apiErrorToFieldErrors(e)),
      },
    );
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrorToFieldErrors(create.error)).length === 0 ? create.error : undefined}>
      <FormField label={t("kind")} required>
        {(c) => <NativeSelect {...c} value={kind} onChange={(v) => setKind(v as (typeof HUMAN_KINDS)[number])} options={HUMAN_KINDS.map((k) => ({ value: k, label: text("proposalKind", k) }))} />}
      </FormField>
      {usesCode ? (
        <FormField label={t("code")} hint={t("codeHint")} required error={errors.code ?? null}>
          {(c) => <TextControl {...c} value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={40} />}
        </FormField>
      ) : (
        <FormField label={t("body")} required error={errors.body ?? null}>
          {(c) => <TextAreaControl {...c} value={body} onChange={setBody} rows={3} maxLength={1000} />}
        </FormField>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Décisions enregistrées (suggestion et décision côte à côte, jamais écrasées)
// ---------------------------------------------------------------------------

export function DecisionsPanel({ decisions }: { decisions: readonly CouncilsDecisionDto[] }) {
  const t = useTranslations("v2Councils.decisions");
  const text = useEnumText();
  const dt = useDateTime();
  const flash = useFlash();
  const withdraw = useWithdrawDecision();
  const [withdrawing, setWithdrawing] = useState<CouncilsDecisionDto | null>(null);
  return (
    <Section id="item-decisions" title={t("title")}>
      {flash.node}
      {decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="space-y-3">
          {decisions.map((d) => (
            <li key={d.id} className="space-y-1 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">{d.decisionTypeLabel ?? d.decisionTypeCode}</strong>
                <EnumLabel group="decisionStatus" value={d.status} />
                <EnumLabel group="decisionFamily" value={d.family} />
                {d.differsFromSuggestion ? <StatusBadge label={t("differs")} tone="warning" /> : null}
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <Fact label={t("suggested")}>{d.suggestedCode ? `${t("suggestionTag")} : ${d.suggestedCode}` : t("noSuggestion")}</Fact>
                <Fact label={t("decided")}>{d.decisionTypeCode}</Fact>
                <Fact label={t("mode")}>{text("decisionMode", d.mode)}</Fact>
                {d.mode === "VOTE" ? <Fact label={t("votes")}>{t("votesValue", { for: d.votesFor ?? 0, against: d.votesAgainst ?? 0, abstain: d.votesAbstain ?? 0 })}</Fact> : null}
                <Fact label={t("decider")}>{d.deciderName ?? "—"}</Fact>
                <Fact label={t("decidedAt")}>{dt.dateTime(d.decidedAt)}</Fact>
                {d.targetLabel ? <Fact label={t("target")}>{d.targetLabel}</Fact> : null}
                <Fact label={t("facts")}>
                  {t("factsVersion", { version: d.factsVersion })} <Hash value={d.factsHash} />
                </Fact>
              </dl>
              {d.justification ? (
                <p className="text-sm">
                  <span className="font-medium">{t("justification")} : </span>
                  {d.justification}
                </p>
              ) : null}
              {d.withdrawnReason ? (
                <p className="text-sm text-muted-foreground">
                  {t("withdrawnReason")} : {d.withdrawnReason}
                </p>
              ) : null}
              {d.status === "RECORDED" ? (
                <Can permission="council.decision.record">
                  <button type="button" className={buttonClass.secondary} onClick={() => setWithdrawing(d)}>
                    {t("withdraw")}
                  </button>
                </Can>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {withdrawing ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setWithdrawing(null)}
          title={t("withdrawDialog.title")}
          description={t("withdrawDialog.description")}
          reasonLabel={t("withdrawDialog.label")}
          confirmLabel={t("withdrawDialog.confirm")}
          destructive
          maxLength={1000}
          isPending={withdraw.isPending}
          error={withdraw.error}
          onConfirm={(reason) =>
            withdraw.mutate(
              { id: withdrawing.id, reason },
              {
                onSuccess: () => {
                  flash.show(t("withdrawn"));
                  setWithdrawing(null);
                },
              },
            )
          }
        />
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Enregistrement d'une décision
// ---------------------------------------------------------------------------

function TargetFields({ programId, gradeLevelId, label, onProgram, onGrade, onLabel, errors }: { programId: string; gradeLevelId: string; label: string; onProgram: (v: string) => void; onGrade: (v: string) => void; onLabel: (v: string) => void; errors: FieldErrors }) {
  const t = useTranslations("v2Councils.decisionForm");
  const programs = usePrograms();
  const grades = useReference("grade-levels");
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{t("target")}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("targetProgram")} error={errors.targetProgramId ?? null}>
          {(c) => <NativeSelect {...c} value={programId} placeholder={t("none")} onChange={onProgram} options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.label }))} />}
        </FormField>
        <FormField label={t("targetGrade")} error={errors.targetGradeLevelId ?? null}>
          {(c) => <NativeSelect {...c} value={gradeLevelId} placeholder={t("none")} onChange={onGrade} options={(grades.data ?? []).filter((g) => g.active).map((g) => ({ value: g.id, label: g.label }))} />}
        </FormField>
      </div>
      <FormField label={t("targetLabel")} error={errors.targetLabel ?? errors.target ?? null}>
        {(c) => <TextControl {...c} value={label} onChange={onLabel} maxLength={200} />}
      </FormField>
    </fieldset>
  );
}

const MODES = ["CONSENSUS", "VOTE", "PRESIDENT_CASTING_VOTE"] as const;

export function DecisionForm({ itemId, detail, council }: { itemId: string; detail: CouncilsAgendaItemDetailDto; council: CouncilsCouncilDetailDto }) {
  const t = useTranslations("v2Councils.decisionForm");
  const text = useEnumText();
  const ref = useCouncilsReference();
  const record = useRecordDecision();
  const flash = useFlash();
  const [typeId, setTypeId] = useState("");
  const [deciderId, setDeciderId] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("CONSENSUS");
  const [votesFor, setVotesFor] = useState("");
  const [votesAgainst, setVotesAgainst] = useState("");
  const [votesAbstain, setVotesAbstain] = useState("");
  const [justification, setJustification] = useState("");
  const [programId, setProgramId] = useState("");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [supersedeReason, setSupersedeReason] = useState("");
  const [serverWantsJustification, setServerWantsJustification] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const types = (ref.data?.decisionTypes ?? []).filter((x) => x.active);
  const type: CouncilsDecisionTypeDto | undefined = types.find((x) => x.id === typeId);
  const deciders = council.participants.filter((p) => p.presence === "PRESENT" && p.canDecide);
  const existing = type?.exclusiveGroup ? detail.decisions.find((d) => d.status === "RECORDED" && d.exclusiveGroup === type.exclusiveGroup) : undefined;
  const facts = detail.facts;
  const missingResults = facts?.results?.missingResults === true || (facts !== null && facts.results === null);
  const familyNeedsResults = type !== undefined && (type.family === "PASSAGE" || type.family === "REPEAT");
  // Indications issues des DONNÉES de l'API (type de décision, faits figés, suggestions) ; l'API reste seule juge de l'écart.
  const suggestedDecisions = (facts?.results?.suggestions ?? []).filter((s) => s.kind === "DECISION");
  const gapHint = type !== undefined && suggestedDecisions.length > 0 && !suggestedDecisions.some((s) => s.code === (type.resultsFinalCode ?? type.code));
  const justificationRequired = (type?.requiresJustification ?? false) || (familyNeedsResults && missingResults) || serverWantsJustification;
  const toNumber = (s: string) => (s.trim() === "" ? undefined : Number(s));

  function selectType(id: string) {
    setTypeId(id);
    const next = types.find((x) => x.id === id);
    if (next?.requiresVote) setMode("VOTE");
    setErrors({});
    setServerWantsJustification(false);
  }

  function submit() {
    const local: FieldErrors = {};
    if (justificationRequired && justification.trim() === "") local.justification = t("justificationRequired");
    if (type?.requiresTarget && programId === "" && gradeLevelId === "" && targetLabel.trim() === "") local.target = t("targetRequired");
    if (existing && supersedeReason.trim() === "") local.supersedeReason = t("supersedeRequired", { decision: existing.decisionTypeLabel ?? existing.decisionTypeCode });
    const payload = compact({
      decisionTypeId: typeId,
      deciderParticipantId: deciderId,
      mode,
      justification: justification.trim(),
      votesFor: mode === "VOTE" ? toNumber(votesFor) : undefined,
      votesAgainst: mode === "VOTE" ? toNumber(votesAgainst) : undefined,
      votesAbstain: mode === "VOTE" ? toNumber(votesAbstain) : undefined,
      targetProgramId: type?.requiresTarget ? programId : "",
      targetGradeLevelId: type?.requiresTarget ? gradeLevelId : "",
      targetLabel: type?.requiresTarget ? targetLabel.trim() : "",
      supersedesDecisionId: existing ? existing.id : undefined,
      supersedeReason: existing ? supersedeReason.trim() : "",
    });
    const v = validateWith(councilsDecisionInputSchema, payload);
    const all = { ...(v.ok ? {} : v.errors), ...local };
    if (Object.keys(all).length > 0) return setErrors(all);
    if (!v.ok) return;
    setErrors({});
    record.mutate(
      { itemId, input: v.data },
      {
        onSuccess: () => {
          flash.show(t("saved"));
          setTypeId("");
          setJustification("");
          setVotesFor("");
          setVotesAgainst("");
          setVotesAbstain("");
          setSupersedeReason("");
          setProgramId("");
          setGradeLevelId("");
          setTargetLabel("");
          setMode("CONSENSUS");
          setServerWantsJustification(false);
        },
        onError: (e) => {
          const fields = apiErrorToFieldErrors(e);
          if (fields.justification || (typeof (e as { code?: unknown }).code === "string" && /justification/i.test((e as { code: string }).code))) setServerWantsJustification(true);
          setErrors(fields);
        },
      },
    );
  }

  const apiGeneral = record.error && Object.keys(apiErrorToFieldErrors(record.error)).length === 0 ? record.error : null;

  return (
    <Section id="item-decision-form" title={t("title")}>
      {flash.node}
      {detail.councilStatus !== "OPEN" ? <Notice kind="info">{t("notOpen")}</Notice> : null}
      {deciders.length === 0 ? <Notice kind="warning">{t("noDecider")}</Notice> : null}
      <form
        noValidate
        className="space-y-3"
        aria-label={t("title")}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("type")} required error={errors.decisionTypeId ?? null}>
            {(c) => <NativeSelect {...c} value={typeId} placeholder={t("chooseType")} onChange={selectType} options={types.map((x) => ({ value: x.id, label: x.label }))} />}
          </FormField>
          <FormField label={t("decider")} hint={t("deciderHint")} required error={errors.deciderParticipantId ?? null}>
            {(c) => <NativeSelect {...c} value={deciderId} placeholder={t("chooseDecider")} onChange={setDeciderId} options={deciders.map((p) => ({ value: p.id, label: p.displayName }))} />}
          </FormField>
        </div>
        {type ? (
          <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label={t("typeRules")}>
            {type.requiresJustification ? <li>{t("rules.justification")}</li> : null}
            {type.requiresVote ? <li>{t("rules.vote")}</li> : null}
            {type.requiresTarget ? <li>{t("rules.target")}</li> : null}
            {type.needsHumanApplication ? <li>{t("rules.humanApplication")}</li> : null}
            {type.exclusiveGroup ? <li>{t("rules.exclusive", { group: type.exclusiveGroup })}</li> : null}
          </ul>
        ) : null}
        {gapHint ? <Notice kind="warning">{t("gapHint")}</Notice> : null}
        <FormField label={t("mode")} required error={errors.mode ?? null}>
          {(c) => <NativeSelect {...c} value={mode} onChange={(v) => setMode(v as (typeof MODES)[number])} options={MODES.map((m) => ({ value: m, label: text("decisionMode", m) }))} />}
        </FormField>
        {mode === "VOTE" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label={t("votesFor")} required error={errors.votesFor ?? null}>
              {(c) => <TextControl {...c} type="number" inputMode="numeric" min={0} value={votesFor} onChange={setVotesFor} />}
            </FormField>
            <FormField label={t("votesAgainst")} required error={errors.votesAgainst ?? null}>
              {(c) => <TextControl {...c} type="number" inputMode="numeric" min={0} value={votesAgainst} onChange={setVotesAgainst} />}
            </FormField>
            <FormField label={t("votesAbstain")} required error={errors.votesAbstain ?? null}>
              {(c) => <TextControl {...c} type="number" inputMode="numeric" min={0} value={votesAbstain} onChange={setVotesAbstain} />}
            </FormField>
          </div>
        ) : null}
        <FormField label={t("justification")} hint={justificationRequired ? t("justificationHintRequired") : t("justificationHint")} required={justificationRequired} error={errors.justification ?? null}>
          {(c) => <TextAreaControl {...c} value={justification} onChange={setJustification} rows={3} maxLength={2000} />}
        </FormField>
        {type?.requiresTarget ? <TargetFields programId={programId} gradeLevelId={gradeLevelId} label={targetLabel} onProgram={setProgramId} onGrade={setGradeLevelId} onLabel={setTargetLabel} errors={errors} /> : null}
        {existing ? (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm">{t("existing", { decision: existing.decisionTypeLabel ?? existing.decisionTypeCode })}</p>
            <FormField label={t("supersedeReason")} required error={errors.supersedeReason ?? null}>
              {(c) => <TextAreaControl {...c} value={supersedeReason} onChange={setSupersedeReason} rows={2} maxLength={1000} />}
            </FormField>
          </div>
        ) : null}
        {apiGeneral ? <ActionError error={apiGeneral} /> : null}
        <Can permission="council.decision.record">
          <button type="submit" className={buttonClass.primary} disabled={record.isPending}>
            {t("submit")}
          </button>
        </Can>
      </form>
    </Section>
  );
}
