"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { SchoolLifeEffectDto, SchoolLifeMeasureDto } from "@ecoledigitale/contracts/v2/schoollife";
import { useDecideAppeal, useEffectAction, useMeasureAction, useMeasureEffects, useMeasures } from "@/platform/v2/schoollife";
import { Can } from "@/platform/ui/AccessGate";
import { useDescribeError } from "@/platform/ui/errors";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { KindLabel, StatusLabel, useDateTime } from "./shared";

type Pending =
  | { kind: "validate" | "reject" | "cancel" | "revoke"; measure: SchoolLifeMeasureDto }
  | { kind: "uphold" | "overturn"; measure: SchoolLifeMeasureDto; appealId: string }
  | { kind: "skip"; effect: SchoolLifeEffectDto }
  | { kind: "apply"; effect: SchoolLifeEffectDto };

/**
 * File de validation de la direction. Le circuit (quatre yeux, permission d'approbation du type, validation d'une
 * exclusion, recours, effet sur le statut de l'élève) est décidé par l'API : un refus s'affiche tel quel. Une exclusion
 * validée n'applique JAMAIS d'elle-même la suspension : l'effet attend ici l'acte d'un humain habilité.
 */
export function ValidationsScreen() {
  const t = useTranslations("v2Schoollife.validations");
  const flash = useFlash();
  const describe = useDescribeError();
  const [pending, setPending] = useState<Pending | null>(null);
  const [applyStatus, setApplyStatus] = useState<"SUSPENDED" | "EXCLUDED">("SUSPENDED");
  const [actionError, setActionError] = useState<string | null>(null);
  const proposed = useMeasures({ status: "PROPOSED" });
  const validated = useMeasures({ status: "VALIDATED" });
  const notified = useMeasures({ status: "NOTIFIED" });
  const executed = useMeasures({ status: "EXECUTED" });
  const appealed = useMeasures({ status: "APPEALED" });
  const effects = useMeasureEffects();
  const validate = useMeasureAction("validate");
  const reject = useMeasureAction("reject");
  const cancel = useMeasureAction("cancel");
  const revoke = useMeasureAction("revoke");
  const notify = useMeasureAction("notify");
  const execute = useMeasureAction("execute");
  const uphold = useDecideAppeal("uphold");
  const overturn = useDecideAppeal("overturn");
  const apply = useEffectAction("apply");
  const skip = useEffectAction("skip");

  const close = () => setPending(null);
  const direct = (run: () => Promise<unknown>, doneKey: string) => {
    setActionError(null);
    run().then(() => flash.show(t(`done.${doneKey}`))).catch((e: unknown) => setActionError(describe(e)));
  };

  const inForce = [...(notified.data ?? []), ...(executed.data ?? [])];

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      {flash.node}
      {actionError ? <Notice kind="error">{actionError}</Notice> : null}

      <Section id="sl-proposed" title={t("proposed.title")} hint={t("proposed.hint")}>
        <QueryBoundary query={proposed} isEmpty={(proposed.data ?? []).length === 0} empty={<EmptyBlock title={t("proposed.empty")} />}>
          <MeasureList measures={proposed.data ?? []}>
            {(m) => (
              <>
                <Can permission={m.kind === "TEMP_EXCLUSION" ? "schoollife.exclusion.validate" : "schoollife.measure.validate"}>
                  <button type="button" className={buttonClass.primary} onClick={() => setPending({ kind: "validate", measure: m })}>
                    {t("actions.validate")}
                  </button>
                  <button type="button" className={buttonClass.secondary} onClick={() => setPending({ kind: "reject", measure: m })}>
                    {t("actions.reject")}
                  </button>
                </Can>
              </>
            )}
          </MeasureList>
        </QueryBoundary>
      </Section>

      <Section id="sl-validated" title={t("validated.title")} hint={t("validated.hint")}>
        <QueryBoundary query={validated} isEmpty={(validated.data ?? []).length === 0} empty={<EmptyBlock title={t("validated.empty")} />}>
          <MeasureList measures={validated.data ?? []}>
            {(m) => (
              <Can permission={m.kind === "TEMP_EXCLUSION" ? "schoollife.exclusion.validate" : "schoollife.measure.validate"}>
                <button type="button" className={buttonClass.primary} disabled={notify.isPending} onClick={() => direct(() => notify.mutateAsync({ id: m.id }), "notified")}>
                  {t("actions.notify")}
                </button>
                <button type="button" className={buttonClass.secondary} disabled={execute.isPending} onClick={() => direct(() => execute.mutateAsync({ id: m.id }), "executed")}>
                  {t("actions.execute")}
                </button>
                <button type="button" className={buttonClass.ghost} onClick={() => setPending({ kind: "cancel", measure: m })}>
                  {t("actions.cancel")}
                </button>
              </Can>
            )}
          </MeasureList>
        </QueryBoundary>
      </Section>

      <Section id="sl-appealed" title={t("appealed.title")} hint={t("appealed.hint")}>
        <QueryBoundary query={appealed} isEmpty={(appealed.data ?? []).length === 0} empty={<EmptyBlock title={t("appealed.empty")} />}>
          <MeasureList measures={appealed.data ?? []} showAppeals>
            {(m) => {
              const open = m.appeals.find((a) => a.status === "FILED");
              return open ? (
                <Can permission="schoollife.appeal.decide">
                  <button type="button" className={buttonClass.primary} onClick={() => setPending({ kind: "uphold", measure: m, appealId: open.id })}>
                    {t("actions.uphold")}
                  </button>
                  <button type="button" className={buttonClass.secondary} onClick={() => setPending({ kind: "overturn", measure: m, appealId: open.id })}>
                    {t("actions.overturn")}
                  </button>
                </Can>
              ) : null;
            }}
          </MeasureList>
        </QueryBoundary>
      </Section>

      <Section id="sl-inforce" title={t("inForce.title")} hint={t("inForce.hint")}>
        {inForce.length === 0 ? (
          <EmptyBlock title={t("inForce.empty")} />
        ) : (
          <MeasureList measures={inForce}>
            {(m) => (
              <Can permission="schoollife.measure.revoke">
                <button type="button" className={buttonClass.danger} onClick={() => setPending({ kind: "revoke", measure: m })}>
                  {t("actions.revoke")}
                </button>
              </Can>
            )}
          </MeasureList>
        )}
      </Section>

      <Can permission="schoollife.exclusion.apply">
        <Section id="sl-effects" title={t("effects.title")} hint={t("effects.hint")}>
          <QueryBoundary query={effects} isEmpty={(effects.data ?? []).length === 0} empty={<EmptyBlock title={t("effects.empty")} />}>
            <ul className="divide-y rounded-lg border">
              {(effects.data ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 p-3">
                  <StatusLabel status={e.status} />
                  <span className="min-w-0 flex-1 text-sm">
                    {t("effects.request")}
                    <Link href={`/v2/schoollife/eleves/${e.studentId}`} className="ml-2 underline underline-offset-4">
                      {t("effects.openFile")}
                    </Link>
                  </span>
                  <button type="button" className={buttonClass.primary} onClick={() => setPending({ kind: "apply", effect: e })}>
                    {t("actions.apply")}
                  </button>
                  <button type="button" className={buttonClass.secondary} onClick={() => setPending({ kind: "skip", effect: e })}>
                    {t("actions.skip")}
                  </button>
                </li>
              ))}
            </ul>
          </QueryBoundary>
        </Section>
      </Can>

      {pending && (pending.kind === "validate" || pending.kind === "reject" || pending.kind === "cancel" || pending.kind === "revoke") ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t(`dialogs.${pending.kind}.title`)}
          description={t(`dialogs.${pending.kind}.description`, { student: pending.measure.studentName ?? "—" })}
          reasonLabel={t(`dialogs.${pending.kind}.label`)}
          confirmLabel={t(`dialogs.${pending.kind}.confirm`)}
          destructive={pending.kind === "revoke" || pending.kind === "reject"}
          reasonRequired={pending.kind !== "validate"}
          minLength={pending.kind === "revoke" ? 10 : 5}
          maxLength={2000}
          isPending={validate.isPending || reject.isPending || cancel.isPending || revoke.isPending}
          error={pending.kind === "validate" ? validate.error : pending.kind === "reject" ? reject.error : pending.kind === "cancel" ? cancel.error : revoke.error}
          onConfirm={(reason) => {
            const id = pending.measure.id;
            const done = (key: string) => () => {
              flash.show(t(`done.${key}`));
              close();
            };
            if (pending.kind === "validate") validate.mutate(reason ? { id, note: reason } : { id }, { onSuccess: done("validated") });
            if (pending.kind === "reject") reject.mutate({ id, note: reason }, { onSuccess: done("rejected") });
            if (pending.kind === "cancel") cancel.mutate({ id, reason }, { onSuccess: done("cancelled") });
            if (pending.kind === "revoke") revoke.mutate({ id, reason }, { onSuccess: done("revoked") });
          }}
        />
      ) : null}

      {pending && (pending.kind === "uphold" || pending.kind === "overturn") ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t(`dialogs.${pending.kind}.title`)}
          description={t(`dialogs.${pending.kind}.description`, { student: pending.measure.studentName ?? "—" })}
          reasonLabel={t("dialogs.appeal.label")}
          confirmLabel={t(`dialogs.${pending.kind}.confirm`)}
          destructive={pending.kind === "overturn"}
          minLength={10}
          maxLength={2000}
          isPending={uphold.isPending || overturn.isPending}
          error={pending.kind === "uphold" ? uphold.error : overturn.error}
          onConfirm={(decisionNote) => {
            const run = pending.kind === "uphold" ? uphold : overturn;
            run.mutate({ appealId: pending.appealId, decisionNote }, { onSuccess: () => { flash.show(t("done.decided")); close(); } });
          }}
        />
      ) : null}

      {pending?.kind === "skip" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("dialogs.skip.title")}
          description={t("dialogs.skip.description")}
          reasonLabel={t("dialogs.skip.label")}
          confirmLabel={t("dialogs.skip.confirm")}
          isPending={skip.isPending}
          error={skip.error}
          onConfirm={(reason) => skip.mutate({ id: pending.effect.id, reason }, { onSuccess: () => { flash.show(t("done.skipped")); close(); } })}
        />
      ) : null}

      {pending?.kind === "apply" ? (
        <FormDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("dialogs.apply.title")}
          description={t("dialogs.apply.description")}
          submitLabel={t("dialogs.apply.confirm")}
          isPending={apply.isPending}
          error={apply.error}
          onSubmit={() => apply.mutate({ id: pending.effect.id, status: applyStatus }, { onSuccess: () => { flash.show(t("done.applied")); close(); } })}
        >
          <FormField label={t("dialogs.apply.status")} required hint={t("dialogs.apply.statusHint")}>
            {(c) => (
              <NativeSelect
                {...c}
                value={applyStatus}
                onChange={(v) => setApplyStatus(v as "SUSPENDED" | "EXCLUDED")}
                options={[
                  { value: "SUSPENDED", label: t("dialogs.apply.SUSPENDED") },
                  { value: "EXCLUDED", label: t("dialogs.apply.EXCLUDED") },
                ]}
              />
            )}
          </FormField>
        </FormDialog>
      ) : null}
    </div>
  );
}

function Section({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div>
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function MeasureList({ measures, showAppeals = false, children }: { measures: readonly SchoolLifeMeasureDto[]; showAppeals?: boolean; children: (m: SchoolLifeMeasureDto) => ReactNode }) {
  const t = useTranslations("v2Schoollife.validations");
  const dt = useDateTime();
  return (
    <ul className="divide-y rounded-lg border">
      {measures.map((m) => (
        <li key={m.id} className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <KindLabel kind={m.kind} />
            <StatusLabel status={m.status} />
            <Link href={`/v2/schoollife/eleves/${m.studentId}`} className="font-medium underline-offset-4 hover:underline">
              {m.studentName ?? "—"}
            </Link>
            <span className="text-sm text-muted-foreground">{m.masked ? t("masked") : (m.typeLabel ?? "")}</span>
          </div>
          {m.masked ? null : <p className="text-sm">{m.reason}</p>}
          <p className="text-xs text-muted-foreground">
            {t("proposedBy", { name: m.proposedByName, date: dt.dateTime(m.proposedAt) })}
            {m.startsOn && m.endsOn ? ` · ${t("period", { from: dt.date(m.startsOn), to: dt.date(m.endsOn) })}` : ""}
            {m.requiresFourEyes ? ` · ${t("fourEyes")}` : ""}
          </p>
          {showAppeals
            ? m.appeals.map((a) => (
                <p key={a.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-sm">
                  <span className="font-medium">{t("appealBy", { name: a.filedByName })}</span> — {a.reason}
                </p>
              ))
            : null}
          <div className="flex flex-wrap gap-2">{children(m)}</div>
        </li>
      ))}
    </ul>
  );
}
