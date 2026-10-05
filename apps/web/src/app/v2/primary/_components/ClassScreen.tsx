"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Lock, Unlock } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { FormField, TextAreaControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, QueryBoundary, useFlash } from "@/platform/ui/states";
import { validateWith, type FieldErrors } from "@/platform/ui/validation";
import { primaryWithdrawReadyBodySchema } from "@ecoledigitale/contracts/v2/primary_school";
import { useMarkPrimaryPeriodReady, useMyPrimaryClassrooms, useWithdrawPrimaryReady } from "@/platform/v2/primary";
import { DailyCall } from "./DailyCall";
import { ConfirmActionDialog, classLabel, RuleBanner } from "./shared";

/**
 * Q-P18 : marquer la classe × période « prêtes » (les familles voient alors les compétences et le rang provisoire ; la saisie est
 * gelée) ou retirer ce marquage (motif obligatoire, refusé par l'API si un bulletin de la période est publié). Le web n'évalue rien :
 * il envoie l'ordre et affiche la réponse ou le refus de l'API tel quel.
 */
function ReadyControl({ classroomId, periodId, periodLabel, ready, onNotice }: { classroomId: string; periodId: string; periodLabel: string; ready: boolean; onNotice: (message: string) => void }) {
  const t = useTranslations("v2PrimaryClass.ready");
  const mark = useMarkPrimaryPeriodReady();
  const withdraw = useWithdrawPrimaryReady();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  async function confirm() {
    if (ready) {
      const v = validateWith(primaryWithdrawReadyBodySchema, { reason });
      if (!v.ok) {
        setErrors(v.errors);
        return;
      }
      setErrors({});
      try {
        await withdraw.mutateAsync({ classroomId, periodId, reason: v.data.reason });
        onNotice(t("withdrawn", { period: periodLabel }));
        setOpen(false);
        setReason("");
      } catch {
        /* le refus de l'API reste affiché dans la fenêtre */
      }
      return;
    }
    try {
      await mark.mutateAsync({ classroomId, periodId });
      onNotice(t("marked", { period: periodLabel }));
      setOpen(false);
    } catch {
      /* idem */
    }
  }

  const action = ready ? withdraw : mark;
  return (
    <>
      <button
        type="button"
        className="min-h-[2.75rem] rounded-md border px-2 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
      >
        {ready ? t("withdraw", { period: periodLabel }) : t("mark", { period: periodLabel })}
      </button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            mark.reset();
            withdraw.reset();
            setErrors({});
          }
        }}
        title={ready ? t("withdrawDialog.title", { period: periodLabel }) : t("markDialog.title", { period: periodLabel })}
        description={ready ? t("withdrawDialog.description") : t("markDialog.description")}
        confirmLabel={ready ? t("withdrawDialog.confirm") : t("markDialog.confirm")}
        isPending={action.isPending}
        error={action.error}
        onConfirm={() => void confirm()}
      >
        {ready ? (
          <FormField label={t("withdrawDialog.reason")} required hint={t("withdrawDialog.reasonHint")} error={errors.reason}>
            {(c) => <TextAreaControl {...c} value={reason} onChange={setReason} maxLength={500} />}
          </FormField>
        ) : null}
      </ConfirmActionDialog>
    </>
  );
}

/**
 * « Ma classe » (instituteur, mobile d'abord) : pour chaque classe, effectif, titulaire oui/non, périodes (verrouillée ou ouverte),
 * et accès en un geste à l'appel du jour, aux compétences et au conseil. Les liens non permis sont MASQUÉS ; l'API reste la barrière.
 */
export function ClassScreen() {
  const t = useTranslations("v2PrimaryClass");
  const classes = useMyPrimaryClassrooms();
  const canCall = usePermission("attendance.take").allowed;
  const competencyRead = usePermission("primary.competency.read").allowed;
  const competencyRecord = usePermission("primary.competency.record").allowed;
  const councilRead = usePermission("primary.council.read").allowed;
  const councilPrepare = usePermission("primary.council.prepare").allowed;
  const canValidate = usePermission("primary.competency.validate").allowed;
  const canCompetencies = competencyRead || competencyRecord;
  const canCouncil = councilRead || councilPrepare;
  const [callFor, setCallFor] = useState<string | null>(null);
  const flash = useFlash();

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <RuleBanner />
      {flash.node}
      <QueryBoundary query={classes} isEmpty={(classes.data ?? []).length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ul className="space-y-4" aria-label={t("list")}>
          {(classes.data ?? []).map((c) => {
            const name = classLabel(c);
            const headingId = `class-${c.classroomId}`;
            return (
              <li key={c.classroomId}>
                <section aria-labelledby={headingId} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 id={headingId} className="text-lg font-semibold">
                        {name}
                      </h2>
                      <p className="text-sm text-muted-foreground">{c.gradeLevelCode ?? ""}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={t("students", { count: c.studentCount })} tone="neutral" />
                      <StatusBadge label={c.isHomeroom ? t("homeroomYes") : t("homeroomNo")} tone={c.isHomeroom ? "success" : "warning"} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">{t("periods")}</h3>
                    {c.periods.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("noPeriod")}</p>
                    ) : (
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {c.periods.map((p) => (
                          <li key={p.id} className="inline-flex flex-wrap items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm">
                            {p.locked ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Unlock className="h-4 w-4" aria-hidden="true" />}
                            <span>{p.label}</span>
                            <span className="text-xs font-medium">{p.locked ? t("periodLocked") : t("periodOpen")}</span>
                            {p.ready ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-800">
                                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                {t("ready.badge")}
                              </span>
                            ) : null}
                            {canValidate ? <ReadyControl classroomId={c.classroomId} periodId={p.id} periodLabel={p.label} ready={p.ready} onNotice={flash.show} /> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {canCall ? (
                      <button type="button" className={buttonClass.primary} aria-expanded={callFor === c.classroomId} onClick={() => setCallFor(callFor === c.classroomId ? null : c.classroomId)}>
                        {t("dailyCall")}
                      </button>
                    ) : null}
                    {canCompetencies ? (
                      <Link href={`/v2/primary/competences?classe=${c.classroomId}`} className={buttonClass.secondary}>
                        {t("competencies")}
                      </Link>
                    ) : null}
                    {canCouncil ? (
                      <Link href={`/v2/primary/conseil?classe=${c.classroomId}`} className={buttonClass.secondary}>
                        {t("council")}
                      </Link>
                    ) : null}
                  </div>
                  {callFor === c.classroomId ? <DailyCall classroomId={c.classroomId} onClose={() => setCallFor(null)} /> : null}
                </section>
              </li>
            );
          })}
        </ul>
      </QueryBoundary>
    </div>
  );
}
