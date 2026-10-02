"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { RULES_STATUSES, type RulesStatus, type RulesValidateResponse, type RulesVersionDetailDto } from "@ecoledigitale/contracts/v2/rules";
import { useFeature, usePermission } from "@/platform/access";
import { useRuleVersion, useSimulation, useTransitionVersion, useValidateVersion } from "@/platform/v2/rules";
import { CheckControl, FormField, TextAreaControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { toneOfStatus } from "../../assessments/_components/shared";
import { shortHash } from "../../results/_components/shared";
import { DiagnosticList, RuleEditor } from "./RuleEditor";
import { SimulationPanel } from "./SimulationPanel";

type Tab = "rules" | "simulation" | "journal";

export function RuleVersionScreen({ id }: { id: string }) {
  const t = useTranslations("v2Rules.version");
  const query = useRuleVersion(id);
  return (
    <QueryBoundary query={query}>
      {query.data ? <VersionBody version={query.data} /> : null}
      <p className="mt-6 text-sm">
        <Link href="/v2/rules" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("back")}
        </Link>
      </p>
    </QueryBoundary>
  );
}

function VersionBody({ version }: { version: RulesVersionDetailDto }) {
  const t = useTranslations("v2Rules.version");
  const tStatus = useTranslations("v2Rules.status");
  const tCatalog = useTranslations("v2Rules.catalog");
  const date = useDateFormat();
  const flash = useFlash();
  const [tab, setTab] = useState<Tab>("rules");
  const editExpression = usePermission("rules.version.edit_expression");
  const editorFeature = useFeature("rules.expression-editor");
  const editParameters = usePermission("rules.version.edit");
  const validate = useValidateVersion();
  const [report, setReport] = useState<RulesValidateResponse | null>(null);
  const isTenant = version.origin === "tenant";
  const isDraft = version.status === "draft";
  const editableExpression = isTenant && isDraft && editExpression.allowed && editorFeature.allowed;
  const editableParameters = isTenant && isDraft && editParameters.allowed;
  const tabs: Tab[] = ["rules", "simulation", "journal"];

  async function runValidate() {
    setReport(null);
    try {
      setReport(await validate.mutateAsync({ id: version.id }));
    } catch {
      /* affichée ci-dessous */
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${version.ruleSetCode} · ${t("versionNo", { n: version.versionNo })}`}
        description={t("description", { contract: version.contractId })}
        actions={
          <>
            <StatusBadge label={tCatalog(`origins.${version.origin}`)} tone={isTenant ? "neutral" : "info"} />
            <StatusBadge label={tStatus(version.status)} tone={toneOfStatus(version.status)} />
          </>
        }
      />
      {flash.node}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Info label={t("effectiveFrom")}>{date.civil(version.effectiveFrom)}</Info>
        <Info label={t("effectiveTo")}>{version.effectiveTo ? date.civil(version.effectiveTo) : t("openEnded")}</Info>
        <Info label={t("hash")}>
          <span title={version.definitionHash ?? undefined} className="font-mono text-xs">
            {shortHash(version.definitionHash)}
          </span>
        </Info>
        <Info label={t("source")}>{[version.source.kind, version.source.reference].filter(Boolean).join(" · ") || "—"}</Info>
      </dl>
      {version.notes ? <p className="text-sm text-muted-foreground">{version.notes}</p> : null}
      {!isTenant ? <Notice kind="info">{t("nationalReadOnly")}</Notice> : null}

      <WorkflowPanel version={version} onMessage={flash.show} />

      <div role="tablist" aria-label={t("tabs")} className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((id) => (
          <button
            key={id}
            id={`rtab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`rpanel-${id}`}
            onClick={() => setTab(id)}
            className={`inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t(`tab.${id}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rpanel-${tab}`} aria-labelledby={`rtab-${tab}`} className="space-y-4">
        {tab === "rules" ? (
          <>
            {isTenant && isDraft && !editableExpression && editParameters.allowed ? <Notice kind="info">{t("expressionLocked")}</Notice> : null}
            {isTenant && !isDraft ? <Notice kind="info">{t("notDraft")}</Notice> : null}
            <div className="flex flex-wrap gap-2">
              {editParameters.allowed ? (
                <button type="button" className={buttonClass.secondary} onClick={() => void runValidate()} disabled={validate.isPending}>
                  {t("validate")}
                </button>
              ) : null}
            </div>
            {validate.error ? <ErrorBlock error={validate.error} /> : null}
            {report ? <ValidationReport report={report} version={version} /> : null}
            {version.rules.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRules")}</p> : null}
            <div className="space-y-4">
              {version.rules.map((rule) => (
                <RuleEditor key={`${version.rowVersion ?? 0}-${rule.key}-${rule.expression.length}`} version={version} rule={rule} editableExpression={editableExpression} editableParameters={editableParameters} />
              ))}
            </div>
          </>
        ) : null}
        {tab === "simulation" ? <SimulationPanel version={version} /> : null}
        {tab === "journal" ? <Journal version={version} /> : null}
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function ValidationReport({ report, version }: { report: RulesValidateResponse; version: RulesVersionDetailDto }) {
  const t = useTranslations("v2Rules.version");
  return (
    <section aria-label={t("validationTitle")} className="space-y-2 rounded-md border p-4">
      <Notice kind={report.ok ? "success" : "error"}>{t(report.ok ? "validationOk" : "validationKo")}</Notice>
      {report.violations.length > 0 ? (
        <div role="alert">
          <ul className="space-y-1 text-sm">
            {report.violations.map((v, i) => (
              <li key={i} className="text-destructive">
                {v.ruleKey ? <span className="font-mono text-xs">{v.ruleKey} : </span> : null}
                {v.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.rules
        .filter((r) => !r.ok)
        .map((r) => (
          <div key={r.key}>
            <p className="font-mono text-xs font-medium">{r.key}</p>
            <DiagnosticList diagnostics={r.diagnostics} source={version.rules.find((x) => x.key === r.key)?.expression} />
          </div>
        ))}
    </section>
  );
}

function Journal({ version }: { version: RulesVersionDetailDto }) {
  const t = useTranslations("v2Rules.journal");
  const tStatus = useTranslations("v2Rules.status");
  const date = useDateFormat();
  const events = [...version.events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <ol className="space-y-2" aria-label={t("label")}>
      {events.map((e) => (
        <li key={e.id} className="rounded-md border p-3 text-sm">
          <p className="font-medium">
            {e.fromStatus ? `${tStatus(e.fromStatus)} → ` : ""}
            {tStatus(e.toStatus)}
          </p>
          <p className="text-muted-foreground">{t("by", { name: e.actorName, kind: t(`actorKind.${e.actorKind}`), date: date.instant(e.occurredAt) })}</p>
          {e.comment ? <p>{e.comment}</p> : null}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Workflow : brouillon -> simulée -> proposée -> approuvée -> publiée
// ---------------------------------------------------------------------------

const NEXT: Partial<Record<RulesStatus, Array<{ to: RulesStatus; primary: boolean }>>> = {
  draft: [{ to: "simulated", primary: true }],
  simulated: [
    { to: "proposed", primary: true },
    { to: "draft", primary: false },
  ],
  proposed: [{ to: "draft", primary: false }],
};

function WorkflowPanel({ version, onMessage }: { version: RulesVersionDetailDto; onMessage: (m: string) => void }) {
  const t = useTranslations("v2Rules.workflow");
  const tStatus = useTranslations("v2Rules.status");
  const canPropose = usePermission("rules.version.propose");
  const [dialog, setDialog] = useState<RulesStatus | null>(null);
  const isTenant = version.origin === "tenant";
  const currentIndex = RULES_STATUSES.indexOf(version.status);
  const actions = isTenant && canPropose.allowed ? (NEXT[version.status] ?? []) : [];
  return (
    <section aria-label={t("label")} className="space-y-3 rounded-md border p-3">
      <ol aria-label={t("steps")} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {RULES_STATUSES.filter((s) => s !== "retired" || version.status === "retired").map((s, i) => (
          <li key={s} aria-current={s === version.status ? "step" : undefined} className={s === version.status ? "font-semibold text-primary" : i < currentIndex ? "text-emerald-700" : "text-muted-foreground"}>
            {i > 0 ? <span aria-hidden="true"> › </span> : null}
            {tStatus(s)}
            {s === version.status ? <span className="sr-only"> ({t("current")})</span> : null}
          </li>
        ))}
      </ol>
      {isTenant ? <p className="text-xs text-muted-foreground">{t("operatorNote")}</p> : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a.to} type="button" className={a.primary ? buttonClass.primary : buttonClass.secondary} onClick={() => setDialog(a.to)}>
              {t(`action.${version.status}.${a.to}`)}
            </button>
          ))}
        </div>
      ) : null}
      {dialog ? <TransitionDialog version={version} to={dialog} onClose={() => setDialog(null)} onDone={(percent) => onMessage(t("done", { status: tStatus(dialog), percent: percent ?? "—" }))} /> : null}
    </section>
  );
}

function TransitionDialog({ version, to, onClose, onDone }: { version: RulesVersionDetailDto; to: RulesStatus; onClose: () => void; onDone: (decisionChangedPercent: string | null) => void }) {
  const t = useTranslations("v2Rules.workflow");
  const tStatus = useTranslations("v2Rules.status");
  const transition = useTransitionVersion();
  const simulation = useSimulation(to === "proposed" ? version.lastSimulationId : null);
  const percent = simulation.data?.decisionChangedPercent ?? null;
  const [comment, setComment] = useState("");
  const [confirmImpact, setConfirmImpact] = useState(false);

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("dialogTitle", { status: tStatus(to) })}
      description={t(`dialogDescription.${to}`)}
      submitLabel={t("submit")}
      isPending={transition.isPending}
      error={transition.error}
      onSubmit={async () => {
        try {
          const r = await transition.mutateAsync({ id: version.id, to, comment: comment.trim() || undefined, confirmDecisionImpact: confirmImpact || undefined, expectedRowVersion: version.rowVersion ?? undefined });
          onDone(r.decisionChangedPercent);
          onClose();
        } catch {
          /* affichée par la boîte de dialogue */
        }
      }}
    >
      {to === "proposed" && percent !== null ? (
        <>
          <Notice kind={Number(percent) > 0 ? "warning" : "info"}>{t("impact", { percent })}</Notice>
          {Number(percent) > 0 ? <CheckControl checked={confirmImpact} onChange={setConfirmImpact} label={t("confirmImpact")} hint={t("confirmImpactHint")} /> : null}
        </>
      ) : null}
      <FormField label={t("comment")} hint={t("commentHint")}>
        {(c) => <TextAreaControl {...c} value={comment} onChange={setComment} maxLength={2000} />}
      </FormField>
    </FormDialog>
  );
}
