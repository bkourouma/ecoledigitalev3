"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EXAM_JURY_DECISION_CODES, EXAM_JURY_JUSTIFICATION_MIN, type ExamJuryDecisionCode, type ExamJuryDto } from "@ecoledigitale/contracts/v2/examinations";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { ConfirmDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { useCloseMockJury, useMockJury, useOpenMockJury, useSaveJuryDecisions } from "@/platform/v2/examinations";

interface Draft {
  finalCode: ExamJuryDecisionCode | "";
  justification: string;
}

/**
 * Jury d'un EXAMEN BLANC : relit le résultat calculé par la règle, tranche (admis, ajourné, différé) et motive tout écart. Il ne
 * modifie jamais le résultat calculé et ne sert à aucun document officiel : pour un examen officiel, l'admission est prononcée par
 * l'autorité. Le web n'applique aucune règle ; l'API valide (justification, clôture complète).
 */
export function JuryPanel({ sessionId }: { sessionId: string }) {
  const t = useTranslations("v2Examinations.mock.jury");
  const jury = useMockJury(sessionId);
  return (
    <section aria-labelledby="jury-title" className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 id="jury-title" className="text-base font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {jury.isPending ? <LoadingBlock /> : null}
      {jury.isError ? <ErrorBlock error={jury.error} onRetry={() => void jury.refetch()} /> : null}
      {jury.isSuccess ? jury.data === null ? <OpenJury sessionId={sessionId} /> : <JuryTable key={`${jury.data.id}-${jury.data.status}-${jury.data.counts.decided}`} sessionId={sessionId} jury={jury.data} /> : null}
    </section>
  );
}

function OpenJury({ sessionId }: { sessionId: string }) {
  const t = useTranslations("v2Examinations.mock.jury");
  const open = useOpenMockJury(sessionId);
  const [heldOn, setHeldOn] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={t("heldOn")}>{(c) => <TextControl {...c} type="date" value={heldOn} onChange={setHeldOn} />}</FormField>
        <FormField label={t("note")}>{(c) => <TextControl {...c} value={note} onChange={setNote} maxLength={2000} />}</FormField>
      </div>
      <button type="button" className={buttonClass.primary} disabled={open.isPending} onClick={() => open.mutate({ ...(heldOn ? { heldOn } : {}), ...(note.trim() ? { note: note.trim() } : {}) })}>
        {t("open")}
      </button>
      {open.isError ? <ErrorBlock error={open.error} /> : null}
    </div>
  );
}

function JuryTable({ sessionId, jury }: { sessionId: string; jury: ExamJuryDto }) {
  const t = useTranslations("v2Examinations.mock.jury");
  const tCode = useTranslations("v2Examinations.mock.jury.code");
  const save = useSaveJuryDecisions(sessionId);
  const close = useCloseMockJury(sessionId);
  const closed = jury.status === "CLOSED";
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [confirming, setConfirming] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});

  const current = (candidateId: string): Draft => {
    const row = jury.rows.find((r) => r.candidateId === candidateId);
    return drafts[candidateId] ?? { finalCode: row?.decision?.finalCode ?? "", justification: row?.decision?.justification ?? "" };
  };
  const set = (candidateId: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [candidateId]: { ...current(candidateId), ...patch } }));
  // Même proposition que la règle ? Les seuls codes décidables sont ADMITTED, FAILED, DEFERRED.
  const differs = (proposed: string, d: Draft) => d.finalCode !== "" && d.finalCode !== proposed;

  async function saveAll() {
    const items: Array<{ candidateId: string; finalCode: ExamJuryDecisionCode; justification?: string }> = [];
    const local: Record<string, string> = {};
    for (const row of jury.rows) {
      const d = drafts[row.candidateId];
      if (!d || d.finalCode === "") continue;
      if (differs(row.proposedCode, d) && d.justification.trim().length < EXAM_JURY_JUSTIFICATION_MIN) {
        local[row.candidateId] = t("justificationShort", { min: EXAM_JURY_JUSTIFICATION_MIN });
        continue;
      }
      items.push({ candidateId: row.candidateId, finalCode: d.finalCode, ...(d.justification.trim() ? { justification: d.justification.trim() } : {}) });
    }
    setProblems(local);
    if (items.length === 0 || Object.keys(local).length > 0) return;
    try {
      const report = await save.mutateAsync({ items });
      setProblems(Object.fromEntries(report.failed.map((f) => [f.candidateId, f.message])));
      if (report.failed.length === 0) setDrafts({});
    } catch {
      /* erreur affichée sous le tableau */
    }
  }

  const pending = Object.values(drafts).some((d) => d.finalCode !== "");
  const allDecided = jury.counts.decided === jury.counts.total && !pending;

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge label={t(closed ? "closed" : "openState")} tone={closed ? "neutral" : "info"} />
        <span data-testid="jury-counts">{t("counts", { decided: jury.counts.decided, total: jury.counts.total, changed: jury.counts.changed })}</span>
      </p>
      {closed ? <Notice kind="success">{t("closedNotice")}</Notice> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3">{t("columns.candidate")}</th>
              <th scope="col" className="py-2 pr-3">{t("columns.proposal")}</th>
              <th scope="col" className="py-2 pr-3">{t("columns.average")}</th>
              <th scope="col" className="py-2">{t("columns.decision")}</th>
            </tr>
          </thead>
          <tbody>
            {jury.rows.map((row) => {
              const d = current(row.candidateId);
              const name = [row.lastName, row.firstName].filter(Boolean).join(" ") || row.candidateNumber || row.candidateId.slice(0, 8);
              const needsWhy = differs(row.proposedCode, d);
              return (
                <tr key={row.candidateId} className="border-t border-white/10 align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">{name}</th>
                  <td className="py-2 pr-3">{tCode(row.proposedCode)}</td>
                  <td className="py-2 pr-3">{row.average ?? "—"}</td>
                  <td className="space-y-1 py-2">
                    {closed ? (
                      <span>
                        {row.decision ? tCode(row.decision.finalCode) : "—"}
                        {row.decision?.changedFromProposal ? <span className="block text-xs text-muted-foreground">{row.decision.justification}</span> : null}
                      </span>
                    ) : (
                      <>
                        <NativeSelect
                          aria-label={t("decisionFor", { name })}
                          value={d.finalCode}
                          onChange={(v) => set(row.candidateId, { finalCode: v as ExamJuryDecisionCode | "" })}
                          placeholder={t("toDecide")}
                          options={EXAM_JURY_DECISION_CODES.map((c) => ({ value: c, label: tCode(c) }))}
                        />
                        {needsWhy ? (
                          <TextControl aria-label={t("justificationFor", { name })} value={d.justification} onChange={(v) => set(row.candidateId, { justification: v })} placeholder={t("justificationPlaceholder", { min: EXAM_JURY_JUSTIFICATION_MIN })} maxLength={2000} />
                        ) : null}
                        {problems[row.candidateId] ? <p role="alert" className="text-xs font-medium text-destructive">{problems[row.candidateId]}</p> : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!closed ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.primary} disabled={save.isPending || !pending} onClick={() => void saveAll()}>
            {t("save")}
          </button>
          <button type="button" className={buttonClass.secondary} disabled={!allDecided || close.isPending} onClick={() => setConfirming(true)}>
            {t("close")}
          </button>
        </div>
      ) : null}
      {!closed && !allDecided && !pending ? <p className="text-xs text-muted-foreground">{t("closeHint")}</p> : null}
      {save.isError ? <ErrorBlock error={save.error} /> : null}
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t("closeTitle")} description={t("closeDescription")} confirmLabel={t("closeConfirm")} isPending={close.isPending} error={close.error} onConfirm={() => close.mutate(undefined, { onSuccess: () => setConfirming(false) })} />
    </div>
  );
}
