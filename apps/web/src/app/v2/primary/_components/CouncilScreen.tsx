"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { PRIMARY_COUNCIL_ROLES, primaryPutAttendanceBodySchema, type PrimaryCouncilCaseDto, type PrimaryCouncilOverviewDto } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, LoadingBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { validateWith } from "@/platform/ui/validation";
import { useStaffList } from "@/platform/v2/people";
import {
  usePreparePrimaryCouncil,
  usePrimaryCouncil,
  usePrimaryCouncils,
  usePutPrimaryCouncilAttendance,
  useRequestPrimaryCouncilMinutes,
  useDecidePrimaryCouncilCase,
  useUpdatePrimaryCouncilCase,
  type PrimaryDecisionResult,
} from "@/platform/v2/primary";
import {
  attendancePayload,
  buildDecision,
  canConfirmRuleProposal,
  COUNCIL_JUSTIFICATION_MIN,
  DECIDABLE_CODES,
  quorumView,
  rowsFromAttendance,
  signaturesWithoutPresence,
  type AttendanceRow,
  type DecisionMode,
} from "./council-model";
import { classLabel, ClassPeriodPicker, FeatureGate, PlaceholderNotice, PrimaryError, RuleBanner, toneOfCase, useClassSelection, useCodeLabels } from "./shared";

/**
 * Conseil des maîtres. Même route pour l'instituteur (préparer, ses propositions) et la direction (présence, décisions, procès-verbal) :
 * chaque bouton n'apparaît que si la permission est détenue ; l'API reste la barrière et son message est affiché tel quel.
 */
export function CouncilScreen({ initialClassroomId }: { initialClassroomId?: string | null }) {
  return (
    <FeatureGate feature="primary.council">
      <CouncilBody initialClassroomId={initialClassroomId ?? null} />
    </FeatureGate>
  );
}

function CouncilBody({ initialClassroomId }: { initialClassroomId: string | null }) {
  const t = useTranslations("v2PrimaryCouncil");
  const sel = useClassSelection(initialClassroomId);
  const councils = usePrimaryCouncils({});
  const prepare = usePreparePrimaryCouncil();
  const canPrepareP = usePermission("primary.council.prepare").allowed;
  const canManage = usePermission("primary.council.manage").allowed;
  const canPrepare = canPrepareP || canManage;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [heldOn, setHeldOn] = useState("");
  const flash = useFlash();

  const periodLabel = (classroomId: string, periodId: string) => {
    const c = sel.list.find((x) => x.classroomId === classroomId);
    return c?.periods.find((p) => p.id === periodId)?.label ?? periodId.slice(0, 8);
  };
  const classroomName = (classroomId: string) => {
    const c = sel.list.find((x) => x.classroomId === classroomId);
    return c ? classLabel(c) : classroomId.slice(0, 8);
  };

  async function doPrepare() {
    flash.show(null);
    try {
      const o = await prepare.mutateAsync({ classroomId: sel.classroomId, periodId: sel.periodId, ...(heldOn ? { heldOn } : {}) });
      flash.show(t("prepared"));
      setSelectedId(o.deliberationId);
    } catch {
      /* affichée sous le formulaire */
    }
  }

  if (selectedId) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} description={t("description")} />
        <button type="button" className={buttonClass.secondary} onClick={() => setSelectedId(null)}>
          {t("back")}
        </button>
        <CouncilSession deliberationId={selectedId} canManage={canManage} canPrepare={canPrepare} classroomName={classroomName} periodLabel={periodLabel} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <RuleBanner classroomId={sel.classroomId || null} />
      {flash.node}

      {canPrepare ? (
        <section aria-label={t("prepare.label")} className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-3">
          <h2 className="text-base font-semibold">{t("prepare.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("prepare.hint")}</p>
          {sel.classes.isPending ? <LoadingBlock /> : null}
          {sel.list.length > 0 ? <ClassPeriodPicker classes={sel.list} classroomId={sel.classroomId} periodId={sel.periodId} onClassroom={sel.setClassroomId} onPeriod={sel.setPeriodId} /> : null}
          <FormField label={t("prepare.heldOn")} hint={t("prepare.heldOnHint")}>
            {(c) => <TextControl {...c} type="date" value={heldOn} onChange={setHeldOn} />}
          </FormField>
          <button type="button" className={buttonClass.primary} disabled={!sel.classroomId || !sel.periodId || prepare.isPending} onClick={() => void doPrepare()}>
            {prepare.isPending ? t("prepare.working") : t("prepare.button")}
          </button>
          <PrimaryError error={prepare.error} />
        </section>
      ) : null}

      <section aria-label={t("list.label")} className="space-y-3">
        <h2 className="text-base font-semibold">{t("list.title")}</h2>
        <QueryBoundary query={councils} isEmpty={(councils.data ?? []).length === 0} empty={<EmptyBlock title={t("list.empty")} description={t("list.emptyHint")} />}>
          <ul className="space-y-2">
            {(councils.data ?? []).map((c) => (
              <li key={c.deliberationId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-card/40 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{`${classroomName(c.classroomId)} · ${periodLabel(c.classroomId, c.periodId)}`}</p>
                  <p className="text-sm text-muted-foreground">{t("list.counts", { total: c.total, open: c.open, decided: c.decided })}</p>
                </div>
                <button type="button" className={buttonClass.secondary} onClick={() => setSelectedId(c.deliberationId)} aria-label={t("list.openFor", { name: `${classroomName(c.classroomId)} · ${periodLabel(c.classroomId, c.periodId)}` })}>
                  {t("list.open")}
                </button>
              </li>
            ))}
          </ul>
        </QueryBoundary>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Séance
// ---------------------------------------------------------------------------

function CouncilSession({ deliberationId, canManage, canPrepare, classroomName, periodLabel }: { deliberationId: string; canManage: boolean; canPrepare: boolean; classroomName: (id: string) => string; periodLabel: (c: string, p: string) => string }) {
  const t = useTranslations("v2PrimaryCouncil");
  const council = usePrimaryCouncil(deliberationId);
  return (
    <QueryBoundary query={council}>
      {council.data ? (
        <div className="space-y-6">
          <header className="space-y-2">
            <h2 className="text-xl font-semibold">{`${classroomName(council.data.classroomId)} · ${periodLabel(council.data.classroomId, council.data.periodId)}`}</h2>
            <p className="text-sm text-muted-foreground">{t("session.counts", { total: council.data.counts.total, open: council.data.counts.open, decided: council.data.counts.decided, deferred: council.data.counts.deferred })}</p>
          </header>
          {council.data.ruleSourceKind === "placeholder" ? <PlaceholderNotice /> : <RuleBanner classroomId={council.data.classroomId} />}
          <AttendanceSheet key={JSON.stringify(council.data.attendance)} overview={council.data} canManage={canManage} />
          <CasesPanel overview={council.data} canManage={canManage} canPrepare={canPrepare} />
          {canManage ? <MinutesPanel overview={council.data} /> : null}
        </div>
      ) : null}
    </QueryBoundary>
  );
}

// ---------------------------------------------------------------------------
// Feuille de présence
// ---------------------------------------------------------------------------

function QuorumLine({ overview }: { overview: PrimaryCouncilOverviewDto }) {
  const t = useTranslations("v2PrimaryCouncil.attendance");
  const view = quorumView(overview.quorum);
  const values = { convened: overview.quorum.convened, present: overview.quorum.present };
  return (
    <p role="status" aria-live="polite" className="text-sm font-medium" data-testid="quorum">
      {view === "none" ? t("quorumNone", values) : view === "met" ? t("quorumMet", values) : t("quorumUnmet", values)}
    </p>
  );
}

function AttendanceSheet({ overview, canManage }: { overview: PrimaryCouncilOverviewDto; canManage: boolean }) {
  const t = useTranslations("v2PrimaryCouncil.attendance");
  const label = useCodeLabels();
  const dateFmt = useDateFormat();
  const canReadStaff = usePermission("staff.read").allowed;
  const staff = useStaffList({ limit: 200 }, { enabled: canManage && canReadStaff });
  const put = usePutPrimaryCouncilAttendance();
  const [rows, setRows] = useState<AttendanceRow[]>(() => rowsFromAttendance(overview.attendance));
  const [problem, setProblem] = useState<string | null>(null);
  const [addStaff, setAddStaff] = useState("");
  const [addRole, setAddRole] = useState<string>("TEACHER");
  const flash = useFlash();
  const patch = (staffId: string, p: Partial<AttendanceRow>) => setRows((rs) => rs.map((r) => (r.staffId === staffId ? { ...r, ...p } : r)));
  const editableRows = rows.filter((r) => r.signedAt === null);
  const known = new Set(rows.map((r) => r.staffId));
  const candidates = (staff.data?.items ?? []).filter((s) => !known.has(s.id));

  async function save() {
    flash.show(null);
    const missing = signaturesWithoutPresence(rows);
    if (missing.length > 0) return setProblem(t("signNeedsPresence"));
    const body = attendancePayload(rows);
    const v = validateWith(primaryPutAttendanceBodySchema, body);
    if (!v.ok) return setProblem(Object.values(v.errors)[0] ?? t("invalid"));
    setProblem(null);
    try {
      await put.mutateAsync({ deliberationId: overview.deliberationId, attendance: v.data });
      flash.show(t("saved"));
    } catch {
      /* affichée sous le tableau */
    }
  }

  return (
    <section aria-label={t("label")} className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-3">
      <h3 className="text-base font-semibold">{t("title")}</h3>
      <QuorumLine overview={overview} />
      {flash.node}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="space-y-3">
        {rows.map((r) => {
          const signed = r.signedAt !== null;
          const name = r.staffName ?? t("staffFallback", { id: r.staffId.slice(-4) });
          const editable = canManage && !signed;
          return (
            <li key={r.staffId} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{name}</p>
                {signed ? <StatusBadge label={t("signedAt", { date: dateFmt.instant(r.signedAt) })} tone="success" /> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label={t("roleFor", { name })}>
                  {(c) => (
                    <NativeSelect
                      {...c}
                      value={r.roleCode}
                      disabled={!editable}
                      onChange={(v) => patch(r.staffId, { roleCode: v as AttendanceRow["roleCode"] })}
                      options={PRIMARY_COUNCIL_ROLES.map((x) => ({ value: x, label: label("councilRole", x) }))}
                    />
                  )}
                </FormField>
                <FormField label={t("presenceFor", { name })}>
                  {(c) => (
                    <NativeSelect
                      {...c}
                      value={r.present === null ? "" : r.present ? "yes" : "no"}
                      disabled={!editable}
                      onChange={(v) => patch(r.staffId, { present: v === "" ? null : v === "yes", ...(v !== "yes" ? { sign: false } : {}) })}
                      options={[
                        { value: "", label: t("presenceUnknown") },
                        { value: "yes", label: t("present") },
                        { value: "no", label: t("absent") },
                      ]}
                    />
                  )}
                </FormField>
                <div className="flex flex-col justify-end">
                  <CheckControl checked={r.convened} disabled={!editable} onChange={(v) => patch(r.staffId, { convened: v })} label={t("convenedFor", { name })} />
                  <CheckControl checked={signed || r.sign} disabled={!editable || r.present !== true} onChange={(v) => patch(r.staffId, { sign: v })} label={t("signFor", { name })} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {canManage && canReadStaff ? (
        <div className="grid gap-3 rounded-xl border border-dashed border-white/15 p-3 sm:grid-cols-3">
          <FormField label={t("addStaff")}>
            {(c) => <NativeSelect {...c} value={addStaff} onChange={setAddStaff} placeholder={t("addStaffChoose")} options={candidates.map((s) => ({ value: s.id, label: s.displayName }))} />}
          </FormField>
          <FormField label={t("role")}>
            {(c) => <NativeSelect {...c} value={addRole} onChange={setAddRole} options={PRIMARY_COUNCIL_ROLES.map((x) => ({ value: x, label: label("councilRole", x) }))} />}
          </FormField>
          <div className="flex items-end">
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={!addStaff}
              onClick={() => {
                const s = candidates.find((x) => x.id === addStaff);
                if (!s) return;
                setRows((rs) => [...rs, { staffId: s.id, staffName: s.displayName, roleCode: addRole as AttendanceRow["roleCode"], convened: true, present: null, note: null, signedAt: null, sign: false }]);
                setAddStaff("");
              }}
            >
              {t("add")}
            </button>
          </div>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {problem}
        </p>
      ) : null}
      <PrimaryError error={put.error} />
      {canManage && editableRows.length > 0 ? (
        <button type="button" className={buttonClass.primary} disabled={put.isPending} onClick={() => void save()}>
          {put.isPending ? t("saving") : t("save")}
        </button>
      ) : null}
      {canManage ? <p className="text-xs text-muted-foreground">{t("signedFrozen")}</p> : <Notice kind="info">{t("readOnly")}</Notice>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dossiers, un par un
// ---------------------------------------------------------------------------

function CasesPanel({ overview, canManage, canPrepare }: { overview: PrimaryCouncilOverviewDto; canManage: boolean; canPrepare: boolean }) {
  const t = useTranslations("v2PrimaryCouncil.cases");
  const label = useCodeLabels();
  const [index, setIndex] = useState(0);
  const cases = overview.cases;
  const current = cases[Math.min(index, Math.max(0, cases.length - 1))];
  if (cases.length === 0) return <Notice kind="info">{t("empty")}</Notice>;
  return (
    <section aria-label={t("label")} className="space-y-3">
      <h3 className="text-base font-semibold">{t("title")}</h3>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass.secondary} disabled={index <= 0} onClick={() => setIndex(index - 1)} aria-label={t("previous")}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <FormField label={t("pick")}>
            {(c) => (
              <NativeSelect
                {...c}
                value={current?.id ?? ""}
                onChange={(v) => setIndex(Math.max(0, cases.findIndex((x) => x.id === v)))}
                options={cases.map((x) => ({ value: x.id, label: `${x.studentName ?? t("studentFallback", { id: x.studentId.slice(-4) })} — ${label("caseStatus", x.status)}` }))}
              />
            )}
          </FormField>
        </div>
        <button type="button" className={buttonClass.secondary} disabled={index >= cases.length - 1} onClick={() => setIndex(index + 1)} aria-label={t("next")}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t("position", { position: Math.min(index, cases.length - 1) + 1, total: cases.length })}
      </p>
      {current ? <CaseCard key={current.id} overview={overview} c={current} canManage={canManage} canPrepare={canPrepare} /> : null}
    </section>
  );
}

function CaseCard({ overview, c, canManage, canPrepare }: { overview: PrimaryCouncilOverviewDto; c: PrimaryCouncilCaseDto; canManage: boolean; canPrepare: boolean }) {
  const t = useTranslations("v2PrimaryCouncil.cases");
  const label = useCodeLabels();
  const update = useUpdatePrimaryCouncilCase();
  const decide = useDecidePrimaryCouncilCase();
  const name = c.studentName ?? t("studentFallback", { id: c.studentId.slice(-4) });
  const decided = c.status === "DECIDED";
  const [proposalCode, setProposalCode] = useState(c.proposalCode ?? "");
  const [proposalNote, setProposalNote] = useState(c.proposalNote ?? "");
  const [mode, setMode] = useState<DecisionMode>(canConfirmRuleProposal(c.ruleProposalCode) ? "confirm" : "other");
  const [finalCode, setFinalCode] = useState("");
  const [justification, setJustification] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<PrimaryDecisionResult | null>(null);
  const [saved, setSaved] = useState(false);
  const confirmable = canConfirmRuleProposal(c.ruleProposalCode);
  const differs = mode === "other" && finalCode !== "" && finalCode !== c.ruleProposalCode;

  async function saveProposal() {
    setSaved(false);
    try {
      await update.mutateAsync({ deliberationId: overview.deliberationId, caseId: c.id, patch: { proposalCode: proposalCode || null, proposalNote: proposalNote.trim() || null } });
      setSaved(true);
    } catch {
      /* affichée sous le formulaire */
    }
  }

  async function setStatus(status: "OPEN" | "DEFERRED") {
    try {
      await update.mutateAsync({ deliberationId: overview.deliberationId, caseId: c.id, patch: { status } });
    } catch {
      /* affichée sous le formulaire */
    }
  }

  async function submitDecision() {
    const built = buildDecision({ mode, ruleProposalCode: c.ruleProposalCode, finalCode, justification });
    if (!built.ok) {
      setProblem(built.problem === "justification_short" ? t("decision.justificationShort", { min: COUNCIL_JUSTIFICATION_MIN }) : built.problem === "code_required" ? t("decision.codeRequired") : t("decision.cannotConfirm"));
      return;
    }
    setProblem(null);
    try {
      setResult(await decide.mutateAsync({ deliberationId: overview.deliberationId, caseId: c.id, ...built.body }));
    } catch {
      /* affichée sous le formulaire */
    }
  }

  return (
    <article aria-label={t("articleLabel", { name })} className="space-y-4 rounded-2xl border border-white/10 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-lg font-semibold">{name}</h4>
        <StatusBadge label={label("caseStatus", c.status)} tone={toneOfCase(c.status)} />
      </div>
      <div>
        <p className="text-sm font-medium">{t("reasons")}</p>
        {c.reasonCodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noReason")}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {c.reasonCodes.map((code) => (
              <li key={code}>
                <StatusBadge label={label("reasonCode", code)} tone="info" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={t("compare")}>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">{t("ruleProposal")}</p>
          <p className="mt-1 text-base font-semibold" data-testid="rule-proposal">
            {c.ruleProposalCode ? label("ruleProposal", c.ruleProposalCode) : t("noRuleProposal")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("ruleProposalHint")}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">{t("councilDecision")}</p>
          <p className="mt-1 text-base font-semibold" data-testid="council-decision">
            {c.finalCode ? label("ruleProposal", c.finalCode) : t("noDecision")}
          </p>
          {c.justification ? <p className="mt-1 text-sm">{t("justificationShown", { text: c.justification })}</p> : null}
        </div>
      </div>

      {canPrepare && !decided ? (
        <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <legend className="px-1 text-sm font-medium">{t("myProposal.legend")}</legend>
          <FormField label={t("myProposal.code")}>
            {(f) => <NativeSelect {...f} value={proposalCode} onChange={setProposalCode} placeholder={t("myProposal.none")} options={DECIDABLE_CODES.map((x) => ({ value: x, label: label("ruleProposal", x) }))} />}
          </FormField>
          <FormField label={t("myProposal.note")}>{(f) => <TextAreaControl {...f} value={proposalNote} onChange={setProposalNote} maxLength={1000} />}</FormField>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.primary} disabled={update.isPending} onClick={() => void saveProposal()}>
              {t("myProposal.save")}
            </button>
            <button type="button" className={buttonClass.secondary} disabled={update.isPending} onClick={() => void setStatus(c.status === "DEFERRED" ? "OPEN" : "DEFERRED")}>
              {c.status === "DEFERRED" ? t("myProposal.reopen") : t("myProposal.defer")}
            </button>
          </div>
          {saved ? <Notice kind="success">{t("myProposal.saved")}</Notice> : null}
          <PrimaryError error={update.error} />
        </fieldset>
      ) : c.proposalCode || c.proposalNote ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm">
          <p className="font-medium">{t("myProposal.shown", { code: c.proposalCode ? label("ruleProposal", c.proposalCode) : "—" })}</p>
          {c.proposalNote ? <p className="mt-1 text-muted-foreground">{c.proposalNote}</p> : null}
        </div>
      ) : null}

      {canManage && !decided ? (
        <fieldset className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <legend className="px-1 text-sm font-medium">{t("decision.legend")}</legend>
          <div role="radiogroup" aria-label={t("decision.mode")} className="space-y-1">
            <label className="flex min-h-[2.75rem] items-start gap-3 text-sm">
              <input type="radio" name={`mode-${c.id}`} className="mt-1 h-4 w-4 accent-primary" checked={mode === "confirm"} disabled={!confirmable} onChange={() => setMode("confirm")} />
              <span>
                {t("decision.confirm")}
                {!confirmable ? <span className="block text-xs text-muted-foreground">{t("decision.confirmUnavailable")}</span> : null}
              </span>
            </label>
            <label className="flex min-h-[2.75rem] items-start gap-3 text-sm">
              <input type="radio" name={`mode-${c.id}`} className="mt-1 h-4 w-4 accent-primary" checked={mode === "other"} onChange={() => setMode("other")} />
              <span>{t("decision.other")}</span>
            </label>
          </div>
          {mode === "other" ? (
            <>
              <FormField label={t("decision.code")} required>
                {(f) => <NativeSelect {...f} value={finalCode} onChange={setFinalCode} placeholder={t("decision.chooseCode")} options={DECIDABLE_CODES.map((x) => ({ value: x, label: label("ruleProposal", x) }))} />}
              </FormField>
              <FormField label={t("decision.justification")} required={differs} hint={t("decision.justificationHint", { min: COUNCIL_JUSTIFICATION_MIN })}>
                {(f) => <TextAreaControl {...f} value={justification} onChange={setJustification} maxLength={2000} />}
              </FormField>
            </>
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {problem}
            </p>
          ) : null}
          <PrimaryError error={decide.error} />
          <button type="button" className={buttonClass.primary} disabled={decide.isPending} onClick={() => void submitDecision()}>
            {decide.isPending ? t("decision.saving") : t("decision.submit")}
          </button>
        </fieldset>
      ) : null}
      {result ? (
        <Notice kind="success">
          {t("decision.done", { code: label("ruleProposal", result.finalCode) })}
          {result.changedFromProposal ? ` ${t("decision.changed")}` : ""}
          {result.outcomeRecorded ? ` ${t("decision.outcome", { code: label("outcomeCode", result.outcomeRecorded) })}` : ""}
        </Notice>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Procès-verbal
// ---------------------------------------------------------------------------

function MinutesPanel({ overview }: { overview: PrimaryCouncilOverviewDto }) {
  const t = useTranslations("v2PrimaryCouncil.minutes");
  const request = useRequestPrimaryCouncilMinutes();
  const [heldOn, setHeldOn] = useState(overview.heldOn ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const requested = useMemo(() => request.data ?? null, [request.data]);

  async function submit() {
    if (!heldOn) return setProblem(t("heldOnRequired"));
    setProblem(null);
    try {
      await request.mutateAsync({ deliberationId: overview.deliberationId, heldOn });
    } catch {
      /* affichée ci-dessous (document non disponible : message explicatif) */
    }
  }

  return (
    <section aria-label={t("label")} className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-3">
      <h3 className="text-base font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {overview.minutesDocumentId ? <Notice kind="info">{t("alreadyRequested")}</Notice> : null}
      <FormField label={t("heldOn")} required hint={t("heldOnHint")} error={problem}>
        {(c) => <TextControl {...c} type="date" value={heldOn} onChange={setHeldOn} />}
      </FormField>
      <button type="button" className={buttonClass.primary} disabled={request.isPending} onClick={() => void submit()}>
        {request.isPending ? t("working") : t("request")}
      </button>
      <PrimaryError error={request.error} />
      {requested ? <Notice kind="success">{requested.documentId ? t("requested") : t("requestedPending")}</Notice> : null}
    </section>
  );
}
