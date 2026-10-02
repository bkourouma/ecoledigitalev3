"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { COUNCIL_EFFECT_KINDS, COUNCIL_EFFECT_STATUSES, type CouncilsEffectDto } from "@ecoledigitale/contracts/v2/councils";
import { useEffectAction, useEffects } from "@/platform/v2/councils";
import { Can } from "@/platform/ui/AccessGate";
import { CheckControl, FormField, NativeSelect, TextAreaControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, useFlash } from "@/platform/ui/states";
import { ActionError, CouncilsBoundary, EnumLabel, ScrollTable, TD, TH, useDateTime, useEnumText } from "./shared";

const PAGE_SIZE = 25;
type Pending = { kind: "apply" | "skip" | "revert"; effect: CouncilsEffectDto } | null;

/**
 * File des effets d'une décision : application automatique en échec (relance), application HUMAINE d'une exclusion
 * (confirmation explicite : aucun statut d'élève ne change sans l'acte d'un humain habilité), abandon et annulation motivés.
 */
export function EffectsScreen({ councilId }: { councilId?: string }) {
  const t = useTranslations("v2Councils.effects");
  const text = useEnumText();
  const dt = useDateTime();
  const flash = useFlash();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<Pending>(null);
  const q = useEffects({ status: status || undefined, kind: kind || undefined, councilId, page, pageSize: PAGE_SIZE });
  const retry = useEffectAction("retry");
  const apply = useEffectAction("apply");
  const skip = useEffectAction("skip");
  const revert = useEffectAction("revert");
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dialogMutation = pending?.kind === "apply" ? apply : pending?.kind === "skip" ? skip : revert;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {councilId ? (
        <Notice kind="info">
          {t("filteredByCouncil")}{" "}
          <Link href="/v2/councils/effets" className="font-medium underline">
            {t("showAll")}
          </Link>
        </Notice>
      ) : null}
      <form className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2" aria-label={t("filters.label")} onSubmit={(e) => e.preventDefault()}>
        <FormField label={t("filters.status")}>
          {(c) => <NativeSelect {...c} value={status} placeholder={t("filters.all")} onChange={(v) => { setStatus(v); setPage(1); }} options={COUNCIL_EFFECT_STATUSES.map((s) => ({ value: s, label: text("effectStatus", s) }))} />}
        </FormField>
        <FormField label={t("filters.kind")}>
          {(c) => <NativeSelect {...c} value={kind} placeholder={t("filters.all")} onChange={(v) => { setKind(v); setPage(1); }} options={COUNCIL_EFFECT_KINDS.map((k) => ({ value: k, label: text("effectKind", k) }))} />}
        </FormField>
      </form>
      {flash.node}
      <ActionError error={retry.error} />
      <CouncilsBoundary query={q} isEmpty={items.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ScrollTable caption={t("table.caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{t("table.student")}</th>
              <th scope="col" className={TH}>{t("table.effect")}</th>
              <th scope="col" className={TH}>{t("table.status")}</th>
              <th scope="col" className={TH}>{t("table.attempts")}</th>
              <th scope="col" className={TH}>{t("table.detail")}</th>
              <th scope="col" className={TH}><span className="sr-only">{t("table.actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((e) => (
              <tr key={e.id}>
                <td className={TD}>
                  {e.studentName ?? "—"}
                  <div className="text-xs text-muted-foreground">
                    <Link href={`/v2/councils/${e.councilId}`} className="underline">
                      {t("table.council")}
                    </Link>
                  </div>
                </td>
                <td className={TD}>
                  {text("effectKind", e.kind)}
                  {e.decisionTypeCode ? <div className="text-xs text-muted-foreground">{e.decisionTypeCode}</div> : null}
                  {e.irreversible ? <StatusBadge label={t("table.irreversible")} tone="danger" className="mt-1" /> : null}
                </td>
                <td className={TD}><EnumLabel group="effectStatus" value={e.status} /></td>
                <td className={TD}>{e.attempts}</td>
                <td className={TD}>
                  {e.lastError ? <span className="text-xs text-destructive">{e.lastError}</span> : null}
                  {e.appliedAt ? <div className="text-xs">{t("table.appliedAt", { date: dt.dateTime(e.appliedAt) })}</div> : null}
                  {e.revertReason ? <div className="text-xs">{t("table.revertReason", { reason: e.revertReason })}</div> : null}
                </td>
                <td className={TD}>
                  <div className="flex flex-wrap gap-2">
                    {e.status === "FAILED" ? (
                      <Can permission="council.effect.manage">
                        <button type="button" className={buttonClass.secondary} disabled={retry.isPending} onClick={() => retry.mutate({ id: e.id }, { onSuccess: () => flash.show(t("done.retried")) })}>
                          {t("actions.retry")}
                        </button>
                      </Can>
                    ) : null}
                    {e.status === "AWAITING_HUMAN" ? (
                      <Can permission={e.kind === "STUDENT_STATUS_REQUEST" ? "council.exclusion.apply" : "council.effect.manage"}>
                        <button type="button" className={buttonClass.primary} onClick={() => setPending({ kind: "apply", effect: e })}>
                          {t("actions.apply")}
                        </button>
                      </Can>
                    ) : null}
                    {e.status === "AWAITING_HUMAN" || e.status === "FAILED" ? (
                      <Can permission="council.effect.manage">
                        <button type="button" className={buttonClass.ghost} onClick={() => setPending({ kind: "skip", effect: e })}>
                          {t("actions.skip")}
                        </button>
                      </Can>
                    ) : null}
                    {e.status === "APPLIED" && !e.irreversible ? (
                      <Can permission="council.effect.manage">
                        <button type="button" className={buttonClass.secondary} onClick={() => setPending({ kind: "revert", effect: e })}>
                          {t("actions.revert")}
                        </button>
                      </Can>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
        {total > PAGE_SIZE ? (
          <nav aria-label={t("pagination.label")} className="mt-3 flex items-center justify-between gap-2">
            <button type="button" className={buttonClass.secondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t("pagination.previous")}
            </button>
            <span className="text-sm text-muted-foreground">{t("pagination.page", { page, pages: lastPage })}</span>
            <button type="button" className={buttonClass.secondary} disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
              {t("pagination.next")}
            </button>
          </nav>
        ) : null}
      </CouncilsBoundary>

      {pending?.kind === "apply" ? (
        <ApplyDialog
          effect={pending.effect}
          isPending={apply.isPending}
          error={apply.error}
          onClose={() => setPending(null)}
          onConfirm={(reason) => apply.mutate({ id: pending.effect.id, ...(reason ? { reason } : {}) }, { onSuccess: () => { flash.show(t("done.applied")); setPending(null); } })}
        />
      ) : null}
      {pending && pending.kind !== "apply" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={t(`dialogs.${pending.kind}.title`)}
          description={t(`dialogs.${pending.kind}.description`)}
          reasonLabel={t(`dialogs.${pending.kind}.label`)}
          confirmLabel={t(`dialogs.${pending.kind}.confirm`)}
          destructive={pending.kind === "revert"}
          maxLength={1000}
          isPending={dialogMutation.isPending}
          error={dialogMutation.error}
          onConfirm={(reason) => dialogMutation.mutate({ id: pending.effect.id, reason }, { onSuccess: () => { flash.show(t(pending.kind === "skip" ? "done.skipped" : "done.reverted")); setPending(null); } })}
        />
      ) : null}
    </div>
  );
}

/** Application humaine : une case à cocher EXPLICITE est exigée avant tout envoi ; le motif est facultatif. */
function ApplyDialog({ effect, isPending, error, onClose, onConfirm }: { effect: CouncilsEffectDto; isPending: boolean; error: unknown; onClose: () => void; onConfirm: (reason: string) => void }) {
  const t = useTranslations("v2Councils.effects.dialogs.apply");
  const text = useEnumText();
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const reasonTooShort = reason.trim() !== "" && reason.trim().length < 5;
  function submit() {
    setTouched(true);
    if (!confirmed || reasonTooShort) return;
    onConfirm(reason.trim());
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("confirm")} onSubmit={submit} isPending={isPending} error={error}>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("student")}</dt>
          <dd className="font-medium">{effect.studentName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("effect")}</dt>
          <dd className="font-medium">{text("effectKind", effect.kind)}</dd>
        </div>
      </dl>
      {effect.irreversible ? <Notice kind="warning">{t("irreversible")}</Notice> : null}
      <CheckControl checked={confirmed} onChange={setConfirmed} label={t("confirmLabel")} hint={t("confirmHint")} />
      {touched && !confirmed ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {t("confirmRequired")}
        </p>
      ) : null}
      <FormField label={t("reason")} hint={t("reasonHint")} error={touched && reasonTooShort ? t("reasonTooShort") : null}>
        {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} rows={2} maxLength={1000} />}
      </FormField>
    </FormDialog>
  );
}
