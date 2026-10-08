"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AssignmentDto } from "@ecoledigitale/contracts/v2/stateassign";
import { usePermission } from "@/platform/access";
import { useAmendAssignment, useAssignmentAct, useReconcileAssignment, useUpdateAssignment, type AssignmentActName } from "@/platform/v2/stateassign";
import { FormField, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { ConfirmDialog, FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput } from "@/platform/ui/money";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors } from "@/platform/ui/validation";
import { PERM, isIsoDate } from "./stateassign-utils";

type Dialog = null | "verify" | "reject" | "suspend" | "end" | "transfer-out" | "amend" | "edit";

/** Montant facultatif saisi : vide = « inchangé » (`undefined`) ; sinon un ENTIER ≥ 0 (une décimale est refusée, jamais devinée). */
function optionalAmount(text: string): { ok: true; value: number | undefined } | { ok: false } {
  if (text.trim() === "") return { ok: true, value: undefined };
  const p = parseAmountInput(text, { allowZero: true });
  return p.ok ? { ok: true, value: p.amount } : { ok: false };
}

function VerifyDialog({ a, open, onOpenChange, onDone }: { a: AssignmentDto; open: boolean; onOpenChange: (o: boolean) => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2Stateassign.actions.verify");
  const mutation = useAssignmentAct("verify");
  const [note, setNote] = useState("");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={mutation.isPending}
      error={mutation.error}
      onSubmit={() => mutation.mutate({ id: a.id, rowVersion: a.rowVersion, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: () => { onOpenChange(false); onDone(t("done")); } })}
    >
      <Notice kind="info">{t("fourEyes")}</Notice>
      <FormField label={t("note")}>{(c) => <TextAreaControl {...c} value={note} onChange={setNote} maxLength={2000} />}</FormField>
    </FormDialog>
  );
}

function EndDialog({ a, act, open, onOpenChange, onDone }: { a: AssignmentDto; act: "end" | "transfer-out"; open: boolean; onOpenChange: (o: boolean) => void; onDone: (message: string) => void }) {
  const tEnd = useTranslations("v2Stateassign.actions.end");
  const tTransfer = useTranslations("v2Stateassign.actions.transfer");
  const te = act === "end" ? tEnd : tTransfer;
  const mutation = useAssignmentAct(act);
  const [endedOn, setEndedOn] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  const dateProblem = !isIsoDate(endedOn) ? te("errors.date") : null;
  const reasonProblem = reason.trim().length < 5 ? te("errors.reason") : null;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={te("title")}
      description={te("description")}
      submitLabel={te("submit")}
      isPending={mutation.isPending}
      error={Object.keys(errors).length === 0 ? mutation.error : undefined}
      onSubmit={() => {
        setSubmitted(true);
        if (dateProblem || reasonProblem) return;
        mutation.mutate({ id: a.id, rowVersion: a.rowVersion, endedOn, reason: reason.trim() }, { onSuccess: () => { onOpenChange(false); onDone(te("done")); } });
      }}
    >
      <FormField label={te("endedOn")} required error={submitted ? dateProblem : (errors.endedOn ?? null)}>{(c) => <TextControl {...c} type="date" value={endedOn} onChange={setEndedOn} />}</FormField>
      <FormField label={te("reason")} required error={submitted ? reasonProblem : (errors.reason ?? null)}>{(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={2000} />}</FormField>
    </FormDialog>
  );
}

/** Avenant : REMPLACE le dossier courant (motif, date d'effet) et crée la version n+1, à vérifier à son tour. Champ vide = inchangé. */
function AmendDialog({ a, open, onOpenChange, onDone }: { a: AssignmentDto; open: boolean; onOpenChange: (o: boolean) => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2Stateassign.actions.amend");
  const mutation = useAmendAssignment();
  const [reason, setReason] = useState("");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [reference, setReference] = useState("");
  const [authority, setAuthority] = useState("");
  const [stateAmount, setStateAmount] = useState("");
  const [parentAmount, setParentAmount] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  const state = optionalAmount(stateAmount);
  const parent = optionalAmount(parentAmount);
  const problems = {
    reason: reason.trim().length < 5 ? t("errors.reason") : null,
    date: !isIsoDate(effectiveOn) ? t("errors.date") : null,
    state: state.ok ? null : t("errors.amount"),
    parent: parent.ok ? null : t("errors.amount"),
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title", { version: a.version + 1 })}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={mutation.isPending}
      error={Object.keys(errors).length === 0 ? mutation.error : undefined}
      wide
      onSubmit={() => {
        setSubmitted(true);
        if (Object.values(problems).some(Boolean) || !state.ok || !parent.ok) return;
        mutation.mutate(
          {
            id: a.id,
            body: {
              reason: reason.trim(),
              effectiveOn,
              rowVersion: a.rowVersion,
              ...(reference.trim() ? { reference: reference.trim() } : {}),
              ...(authority.trim() ? { issuingAuthority: authority.trim() } : {}),
              ...(state.value !== undefined ? { declaredStateAmount: state.value } : {}),
              ...(parent.value !== undefined ? { declaredParentAmount: parent.value } : {}),
            },
          },
          { onSuccess: () => { onOpenChange(false); onDone(t("done")); } },
        );
      }}
    >
      <Notice kind="info">{t("explain")}</Notice>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("reason")} required error={submitted ? problems.reason : (errors.reason ?? null)} className="sm:col-span-2">{(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={2000} />}</FormField>
        <FormField label={t("effectiveOn")} required error={submitted ? problems.date : (errors.effectiveOn ?? null)}>{(c) => <TextControl {...c} type="date" value={effectiveOn} onChange={setEffectiveOn} />}</FormField>
        <FormField label={t("reference")} hint={t("unchanged", { value: a.reference })} error={errors.reference ?? null}>{(c) => <TextControl {...c} value={reference} onChange={setReference} maxLength={120} />}</FormField>
        <FormField label={t("authority")} hint={t("unchangedAuthority")} className="sm:col-span-2">{(c) => <TextControl {...c} value={authority} onChange={setAuthority} maxLength={200} />}</FormField>
        <FormField label={t("stateAmount")} hint={t("amountHint")} error={submitted ? problems.state : (errors.declaredStateAmount ?? null)}>{(c) => <TextControl {...c} inputMode="numeric" value={stateAmount} onChange={setStateAmount} />}</FormField>
        <FormField label={t("parentAmount")} hint={t("amountHint")} error={submitted ? problems.parent : (errors.declaredParentAmount ?? null)}>{(c) => <TextControl {...c} inputMode="numeric" value={parentAmount} onChange={setParentAmount} />}</FormField>
      </div>
    </FormDialog>
  );
}

/** Correction d'un dossier RECEIVED (avant vérification) ; après la vérification, le fond est figé : avenant. */
function EditDialog({ a, open, onOpenChange, onDone }: { a: AssignmentDto; open: boolean; onOpenChange: (o: boolean) => void; onDone: (message: string) => void }) {
  const t = useTranslations("v2Stateassign.actions.edit");
  const mutation = useUpdateAssignment(a.id);
  const [reference, setReference] = useState(a.reference);
  const [issuedOn, setIssuedOn] = useState(a.issuedOn ?? "");
  const [authority, setAuthority] = useState(a.issuingAuthority ?? "");
  const [stateAmount, setStateAmount] = useState(a.declaredState ? String(a.declaredState.amount) : "");
  const [parentAmount, setParentAmount] = useState(a.declaredParent ? String(a.declaredParent.amount) : "");
  const [notes, setNotes] = useState(a.notes ?? "");
  const [submitted, setSubmitted] = useState(false);
  const errors = apiErrorToFieldErrors(mutation.error);
  const amount = (s: string) => (s.trim() === "" ? { ok: true as const, value: null } : (() => { const p = parseAmountInput(s, { allowZero: true }); return p.ok ? { ok: true as const, value: p.amount } : { ok: false as const }; })());
  const state = amount(stateAmount);
  const parent = amount(parentAmount);
  const problems = { reference: reference.trim() ? null : t("errors.reference"), date: issuedOn && !isIsoDate(issuedOn) ? t("errors.date") : null, state: state.ok ? null : t("errors.amount"), parent: parent.ok ? null : t("errors.amount") };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      submitLabel={t("submit")}
      isPending={mutation.isPending}
      error={Object.keys(errors).length === 0 ? mutation.error : undefined}
      wide
      onSubmit={() => {
        setSubmitted(true);
        if (Object.values(problems).some(Boolean) || !state.ok || !parent.ok) return;
        mutation.mutate(
          { reference: reference.trim(), issuedOn: issuedOn || null, issuingAuthority: authority.trim() || null, declaredStateAmount: state.value, declaredParentAmount: parent.value, notes: notes.trim() || null, rowVersion: a.rowVersion },
          { onSuccess: () => { onOpenChange(false); onDone(t("done")); } },
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("reference")} required error={submitted ? problems.reference : (errors.reference ?? null)}>{(c) => <TextControl {...c} value={reference} onChange={setReference} maxLength={120} />}</FormField>
        <FormField label={t("issuedOn")} error={submitted ? problems.date : (errors.issuedOn ?? null)}>{(c) => <TextControl {...c} type="date" value={issuedOn} onChange={setIssuedOn} />}</FormField>
        <FormField label={t("authority")} className="sm:col-span-2">{(c) => <TextControl {...c} value={authority} onChange={setAuthority} maxLength={200} />}</FormField>
        <FormField label={t("stateAmount")} hint={t("amountHint")} error={submitted ? problems.state : (errors.declaredStateAmount ?? null)}>{(c) => <TextControl {...c} inputMode="numeric" value={stateAmount} onChange={setStateAmount} />}</FormField>
        <FormField label={t("parentAmount")} hint={t("amountHint")} error={submitted ? problems.parent : (errors.declaredParentAmount ?? null)}>{(c) => <TextControl {...c} inputMode="numeric" value={parentAmount} onChange={setParentAmount} />}</FormField>
        <FormField label={t("notes")} className="sm:col-span-2">{(c) => <TextAreaControl {...c} value={notes} onChange={setNotes} maxLength={2000} />}</FormField>
      </div>
    </FormDialog>
  );
}

function SimpleAct({ a, act, label, onDone, className }: { a: AssignmentDto; act: Extract<AssignmentActName, "activate" | "resume">; label: string; onDone: (message: string) => void; className: string }) {
  const t = useTranslations("v2Stateassign.actions");
  const tConfirm = useTranslations("v2Ui.confirm");
  const mutation = useAssignmentAct(act);
  const [confirming, setConfirming] = useState(false);
  const run = () => mutation.mutate({ id: a.id, rowVersion: a.rowVersion }, { onSuccess: () => onDone(t(`${act}.done`)) });
  return (
    <>
      <button type="button" disabled={mutation.isPending} onClick={() => (act === "activate" ? setConfirming(true) : run())} className={className}>
        {label}
      </button>
      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirming(false)}
          title={tConfirm("activateAssignment.title")}
          description={tConfirm("activateAssignment.description")}
          confirmLabel={tConfirm("activateAssignment.action")}
          isPending={mutation.isPending}
          onConfirm={() => {
            setConfirming(false);
            run();
          }}
        />
      ) : null}
      {mutation.isError ? <ErrorBlock error={mutation.error} /> : null}
    </>
  );
}

/**
 * Actes du dossier. Chaque bouton n'apparaît que si le statut le permet ET si la permission est accordée (affichage seulement) :
 * l'API et la base décident (acte humain, séparation des tâches, transition valide).
 */
export function AssignmentActions({ a }: { a: AssignmentDto }) {
  const t = useTranslations("v2Stateassign.actions");
  const flash = useFlash();
  const [dialog, setDialog] = useState<Dialog>(null);
  const reject = useAssignmentAct("reject");
  const suspend = useAssignmentAct("suspend");
  const reconcile = useReconcileAssignment();
  const canVerify = usePermission(PERM.verify).allowed;
  const canManage = usePermission(PERM.manage).allowed;
  const canAmend = usePermission(PERM.amend).allowed;
  const canReconcile = usePermission(PERM.reconcile).allowed;
  const canRecord = usePermission(PERM.record).allowed;
  const done = (message: string) => flash.show(message);
  const close = (o: boolean) => { if (!o) setDialog(null); };

  const s = a.status;
  const verifiable = (s === "RECEIVED") && canVerify;
  const rejectable = (s === "RECEIVED" || s === "VERIFIED") && canVerify;
  const operational = s === "VERIFIED" || s === "ACTIVE" || s === "SUSPENDED";
  const reconcilable = (operational || s === "ENDED" || s === "TRANSFERRED") && canReconcile;
  const buttons = [
    verifiable ? <button key="verify" type="button" onClick={() => setDialog("verify")} className={buttonClass.primary}>{t("verify.button")}</button> : null,
    s === "VERIFIED" && canManage ? <SimpleAct key="activate" a={a} act="activate" label={t("activate.button")} onDone={done} className={buttonClass.primary} /> : null,
    s === "SUSPENDED" && canManage ? <SimpleAct key="resume" a={a} act="resume" label={t("resume.button")} onDone={done} className={buttonClass.primary} /> : null,
    s === "ACTIVE" && canManage ? <button key="suspend" type="button" onClick={() => setDialog("suspend")} className={buttonClass.secondary}>{t("suspend.button")}</button> : null,
    (s === "ACTIVE" || s === "SUSPENDED") && canManage ? <button key="end" type="button" onClick={() => setDialog("end")} className={buttonClass.secondary}>{t("end.button")}</button> : null,
    s === "ACTIVE" && canManage ? <button key="transfer" type="button" onClick={() => setDialog("transfer-out")} className={buttonClass.secondary}>{t("transfer.button")}</button> : null,
    operational && canAmend ? <button key="amend" type="button" onClick={() => setDialog("amend")} className={buttonClass.secondary}>{t("amend.button")}</button> : null,
    s === "RECEIVED" && canRecord ? <button key="edit" type="button" onClick={() => setDialog("edit")} className={buttonClass.secondary}>{t("edit.button")}</button> : null,
    reconcilable ? (
      <button key="reconcile" type="button" disabled={reconcile.isPending} onClick={() => reconcile.mutate(a.id, { onSuccess: (r) => flash.show(r.assignment.reconciliation.status === "BALANCED" ? t("reconcile.balanced") : t("reconcile.discrepancy")) })} className={buttonClass.secondary}>
        {t("reconcile.button")}
      </button>
    ) : null,
    rejectable ? <button key="reject" type="button" onClick={() => setDialog("reject")} className={buttonClass.danger}>{t("reject.button")}</button> : null,
  ].filter(Boolean);

  return (
    <div className="space-y-3" aria-label={t("label")} role="group">
      {flash.node}
      {reconcile.isError ? <ErrorBlock error={reconcile.error} /> : null}
      {buttons.length > 0 ? <div className="flex flex-wrap gap-2">{buttons}</div> : <p className="text-sm text-muted-foreground">{t("none")}</p>}
      {dialog === "verify" ? <VerifyDialog a={a} open onOpenChange={close} onDone={done} /> : null}
      {dialog === "end" ? <EndDialog a={a} act="end" open onOpenChange={close} onDone={done} /> : null}
      {dialog === "transfer-out" ? <EndDialog a={a} act="transfer-out" open onOpenChange={close} onDone={done} /> : null}
      {dialog === "amend" ? <AmendDialog a={a} open onOpenChange={close} onDone={done} /> : null}
      {dialog === "edit" ? <EditDialog a={a} open onOpenChange={close} onDone={done} /> : null}
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={close}
        title={t("reject.title")}
        description={t("reject.description")}
        reasonLabel={t("reject.reason")}
        confirmLabel={t("reject.submit")}
        destructive
        isPending={reject.isPending}
        error={reject.error}
        onConfirm={(reason) => reject.mutate({ id: a.id, rowVersion: a.rowVersion, reason }, { onSuccess: () => { setDialog(null); done(t("reject.done")); } })}
      />
      <ReasonDialog
        open={dialog === "suspend"}
        onOpenChange={close}
        title={t("suspend.title")}
        description={t("suspend.description")}
        reasonLabel={t("suspend.reason")}
        confirmLabel={t("suspend.submit")}
        isPending={suspend.isPending}
        error={suspend.error}
        onConfirm={(reason) => suspend.mutate({ id: a.id, rowVersion: a.rowVersion, reason }, { onSuccess: () => { setDialog(null); done(t("suspend.done")); } })}
      />
    </div>
  );
}
