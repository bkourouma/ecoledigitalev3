"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { councilsWishInputSchema, type CouncilsFamilyOrientationDto } from "@ecoledigitale/contracts/v2/councils";
import { ApiError } from "@/platform/api/errors";
import { useAddWish, useChildOrientation, useMyOrientation, useRecordConsent } from "@/platform/v2/councils";
import { FormField, NativeSelect, TextAreaControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { isFeatureUnavailable } from "@/platform/ui/errors";
import { ActionError } from "./shared";

const STAGE_TONE: Record<string, Tone> = { OPEN: "info", WISHES_COLLECTED: "info", DECIDED: "success", APPLIED: "success", CLOSED: "neutral", CANCELLED: "neutral" };
const CONSENT_TONE: Record<string, Tone> = { PENDING: "warning", GIVEN: "success", REFUSED: "danger" };
const MAX_RANK = 20;

/**
 * Orientation vue par la FAMILLE (tuteur lié : formulaire de vœux avec rang, accord de la famille) ou par l'ÉLÈVE (lecture seule).
 *
 * L'écran n'affiche que ce que l'API renvoie : l'état est déjà masqué par l'API tant que la décision du conseil n'est pas visible de
 * la famille ; aucune note interne ni avis du personnel n'existe dans la réponse. Les destinations proposées sont les parcours autorisés
 * saisis par l'établissement (aucune règle d'orientation n'est écrite ici). Hors lien tuteur ou fonction non incluse : la rubrique
 * disparaît (le portail des décisions affiche déjà « introuvable »).
 */
export function FamilyOrientation({ mode, studentId }: { mode: "guardian" | "student"; studentId: string | null }) {
  const t = useTranslations("v2CouncilsFamily");
  const child = useChildOrientation(mode === "guardian" ? studentId : null);
  const mine = useMyOrientation(mode === "student");
  const q = mode === "guardian" ? child : mine;
  if (mode === "guardian" && !studentId) return null;
  if (q.isError && ((q.error instanceof ApiError && q.error.status === 404) || isFeatureUnavailable(q.error))) return null;
  return (
    <section aria-labelledby="family-orientation-title" className="space-y-4">
      <div className="space-y-1">
        <h2 id="family-orientation-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{mode === "guardian" ? t("descriptionGuardian") : t("descriptionStudent")}</p>
      </div>
      {q.isPending && q.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? <OrientationBody data={q.data} mode={mode} /> : null}
    </section>
  );
}

function OrientationBody({ data, mode }: { data: CouncilsFamilyOrientationDto; mode: "guardian" | "student" }) {
  const t = useTranslations("v2CouncilsFamily");
  const file = data.file;
  if (!file) return <EmptyBlock title={t("noFile")} description={t("noFileHint")} />;
  return (
    <div className="space-y-4">
      {data.studentName ? <p className="text-sm text-muted-foreground">{t("about", { name: data.studentName })}</p> : null}
      <div className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{t("stateTitle")}</h3>
          <StatusBadge label={t(`stage.${file.stage}`)} tone={STAGE_TONE[file.stage] ?? "neutral"} />
        </div>
        <p className="text-sm text-muted-foreground">{t(`stageHint.${file.stage}`)}</p>
      </div>
      <Wishes data={data} />
      {file.guardianConsent !== "NOT_REQUIRED" ? <Consent data={data} mode={mode} /> : null}
      {mode === "guardian" ? <WishForm data={data} /> : <Notice kind="info">{t("readOnly")}</Notice>}
    </div>
  );
}

function Wishes({ data }: { data: CouncilsFamilyOrientationDto }) {
  const t = useTranslations("v2CouncilsFamily");
  const wishes = data.file?.wishes ?? [];
  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-4">
      <h3 className="text-base font-semibold">{t("wishesTitle")}</h3>
      {wishes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noWishes")}</p>
      ) : (
        <ol className="space-y-2" aria-label={t("wishesTitle")}>
          {wishes.map((w) => (
            <li key={w.id} className="rounded-md bg-white/[0.04] p-3 text-sm">
              <p className="font-medium">
                {t("wishRank", { rank: w.rank })} — {w.targetLabel ?? t("unnamedTarget")}
              </p>
              <p className="text-muted-foreground">{t(`source.${w.source}`)}</p>
              {w.comment ? (
                <p>
                  <span className="font-medium">{t("comment")} : </span>
                  {w.comment}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Consent({ data, mode }: { data: CouncilsFamilyOrientationDto; mode: "guardian" | "student" }) {
  const t = useTranslations("v2CouncilsFamily");
  const date = useDateFormat();
  const consent = useRecordConsent();
  const [choice, setChoice] = useState<"GIVEN" | "REFUSED" | null>(null);
  const [done, setDone] = useState(false);
  const file = data.file!;
  const when = file.consentRecordedAt ? date.instant(file.consentRecordedAt) : "";

  async function confirm() {
    if (!choice) return;
    try {
      await consent.mutateAsync({ id: file.id, state: choice });
      setDone(true);
      setChoice(null);
    } catch {
      /* affichée dans la fenêtre */
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{t("consentTitle")}</h3>
        <StatusBadge label={t(`consent.${file.guardianConsent}`)} tone={CONSENT_TONE[file.guardianConsent] ?? "neutral"} />
      </div>
      <p className="text-sm text-muted-foreground">{t(`consentHint.${file.guardianConsent}`, { date: when })}</p>
      {done ? <Notice kind="success">{t("consentSaved")}</Notice> : null}
      {mode === "guardian" && file.consentOpen ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass.primary} onClick={() => (consent.reset(), setChoice("GIVEN"))}>
            {t("consentGive")}
          </button>
          <button type="button" className={buttonClass.secondary} onClick={() => (consent.reset(), setChoice("REFUSED"))}>
            {t("consentRefuse")}
          </button>
        </div>
      ) : null}
      <ModalDialog open={choice !== null} onOpenChange={(o) => !o && !consent.isPending && setChoice(null)} title={t("consentDialogTitle")} description={choice === "REFUSED" ? t("consentRefuseConfirm") : t("consentGiveConfirm")}>
        <div className="space-y-4">
          <ActionError error={consent.error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClass.secondary} disabled={consent.isPending} onClick={() => setChoice(null)}>
              {t("cancel")}
            </button>
            <button type="button" className={choice === "REFUSED" ? buttonClass.danger : buttonClass.primary} disabled={consent.isPending} onClick={() => void confirm()}>
              {choice === "REFUSED" ? t("consentRefuse") : t("consentGive")}
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}

function WishForm({ data }: { data: CouncilsFamilyOrientationDto }) {
  const t = useTranslations("v2CouncilsFamily");
  const file = data.file!;
  const add = useAddWish();
  const maxRank = file.wishes.reduce((m, w) => Math.max(m, w.rank), 0);
  const ranks = Array.from({ length: Math.min(MAX_RANK, maxRank + 1) }, (_, i) => i + 1);
  const [rank, setRank] = useState(String(Math.min(MAX_RANK, maxRank + 1)));
  const [optionKey, setOptionKey] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  if (!file.wishesOpen) return <Notice kind="info">{t("wishesClosed")}</Notice>;
  if (data.options.length === 0) return <Notice kind="info">{t("noOptions")}</Notice>;

  const clash = file.wishes.find((w) => String(w.rank) === rank);
  const options = data.options.map((o, i) => ({ value: o.pathId, label: o.label ?? t("optionFallback", { n: i + 1 }) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(null);
    const option = data.options.find((o) => o.pathId === optionKey);
    if (!option) return setError(t("errors.option"));
    // Le serveur impose la source (tuteur) : on envoie GUARDIAN, jamais une valeur choisie par l'utilisateur.
    const parsed = councilsWishInputSchema.safeParse({ rank: Number(rank), toProgramId: option.toProgramId, toGradeLevelId: option.toGradeLevelId, optionIds: [], source: "GUARDIAN", ...(comment.trim() ? { comment: comment.trim() } : {}) });
    if (!parsed.success) return setError(t("errors.invalid"));
    setError(null);
    try {
      await add.mutateAsync({ id: file.id, wish: parsed.data });
      setSaved(parsed.data.rank);
      setComment("");
      setOptionKey("");
    } catch {
      /* affichée sous le formulaire */
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4" aria-labelledby="wish-form-title">
      <h3 id="wish-form-title" className="text-base font-semibold">
        {t("formTitle")}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("rank")} required hint={clash ? t("rankReplaces") : t("rankHint")}>
          {(c) => <NativeSelect {...c} value={rank} onChange={setRank} options={ranks.map((r) => ({ value: String(r), label: String(r) }))} />}
        </FormField>
        <FormField label={t("destination")} required error={error === t("errors.option") ? error : null}>
          {(c) => <NativeSelect {...c} value={optionKey} placeholder={t("choose")} onChange={setOptionKey} options={options} />}
        </FormField>
      </div>
      <FormField label={t("commentOptional")}>{(c) => <TextAreaControl {...c} value={comment} onChange={setComment} rows={3} maxLength={1000} />}</FormField>
      {error && error !== t("errors.option") ? <Notice kind="error">{error}</Notice> : null}
      <ActionError error={add.error} />
      {saved !== null ? <Notice kind="success">{t("saved", { rank: saved })}</Notice> : null}
      <button type="submit" className={buttonClass.primary} disabled={add.isPending}>
        {t("submit")}
      </button>
    </form>
  );
}
