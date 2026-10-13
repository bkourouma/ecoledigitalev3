"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { publicRespondOffer, publicViewOffer } from "@/platform/v2/admissions";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { ApiError } from "@/platform/api/errors";
import { publicErrorKey } from "./PublicFormScreen";

type OfferErrorKey = "notFound" | "tooMany" | "unavailable" | "expired" | "processing";

/**
 * Message affiché à la famille. Le détail d'un refus interne (pièce non acceptée, sexe absent, classe non désignée) n'est jamais
 * montré : un 409 devient « l'établissement vous contactera » (et non plus « lien invalide »), un 410 « proposition échue ».
 */
function offerErrorKey(error: unknown): OfferErrorKey {
  if (error instanceof ApiError) {
    if (error.status === 410) return "expired";
    if (error.status === 409) return "processing";
  }
  const k = publicErrorKey(error);
  return k === "tooMany" || k === "unavailable" ? k : "notFound";
}

/** Lit le secret dans le FRAGMENT de l'adresse (`#t=...`) : jamais envoyé au serveur, ni consigné dans ses journaux, ni transmis en `Referer`. */
export function readOfferToken(hash: string): string | null {
  const m = /(?:^#|&)t=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

type View = Awaited<ReturnType<typeof publicViewOffer>>;

/**
 * Réponse PUBLIQUE de la famille à une proposition de place (lien à usage unique reçu de l'établissement). L'acceptation lance
 * côté API la création du dossier élève, de l'inscription en attente et des frais d'inscription ; aucune donnée personnelle ni
 * aucun montant n'est montré ici.
 */
export function PublicOfferScreen({ school }: { school: string }) {
  const t = useTranslations("v2AdmissionsPublic.offer");
  const fmt = useDateFormat();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<OfferErrorKey | null>(null);
  const [answer, setAnswer] = useState<{ status: "ACCEPTED" | "DECLINED"; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState<"accept" | "decline" | null>(null);

  useEffect(() => {
    setToken(readOfferToken(window.location.hash));
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    publicViewOffer(school, token).then(
      (v) => !cancelled && setView(v),
      (e) => !cancelled && setError(offerErrorKey(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [school, token]);

  async function respond(accept: boolean) {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      setAnswer(await publicRespondOffer(school, token, accept));
    } catch (e) {
      setError(offerErrorKey(e));
      setConfirming(null);
    } finally {
      setPending(false);
    }
  }

  if (token === undefined) return <LoadingBlock />;
  if (token === null) return <Notice kind="info">{t("noLink")}</Notice>;
  if (answer) {
    return (
      <div className="space-y-3" role="status">
        <h1 className="text-2xl font-bold tracking-tight">{answer.status === "ACCEPTED" ? t("acceptedTitle") : t("declinedTitle")}</h1>
        <p className="text-sm">{answer.message}</p>
      </div>
    );
  }
  if (error && !view) return <Notice kind={error === "unavailable" || error === "tooMany" ? "warning" : "info"}>{t(`error.${error}`)}</Notice>;
  if (!view) return <LoadingBlock />;

  const open = view.status === "PENDING";
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("title", { school: view.institutionName })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <dl className="grid max-w-xl gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("grade")}</dt>
          <dd className="font-medium">{view.gradeLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("classroom")}</dt>
          <dd className="font-medium">{view.classroomLabel ?? t("classroomLater")}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("expires")}</dt>
          <dd className="font-medium">{fmt.instant(view.expiresAt)}</dd>
        </div>
        {view.conditions ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("conditions")}</dt>
            <dd className="whitespace-pre-wrap">{view.conditions}</dd>
          </div>
        ) : null}
      </dl>
      {!open ? <Notice kind="info">{t(`closed.${view.status}`)}</Notice> : null}
      {error ? <Notice kind={error === "unavailable" || error === "tooMany" ? "warning" : "error"}>{t(`error.${error}`)}</Notice> : null}
      {open ? (
        confirming ? (
          <div className="max-w-xl space-y-3 rounded-lg border p-4" role="group" aria-label={t("confirmTitle")}>
            <p className="text-sm font-medium">{confirming === "accept" ? t("confirmAccept") : t("confirmDecline")}</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button type="button" className={buttonClass.secondary} disabled={pending} onClick={() => setConfirming(null)}>
                {t("back")}
              </button>
              <button type="button" className={confirming === "accept" ? buttonClass.primary : buttonClass.danger} disabled={pending} onClick={() => void respond(confirming === "accept")}>
                {confirming === "accept" ? t("accept") : t("decline")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={buttonClass.primary} onClick={() => setConfirming("accept")}>
              {t("accept")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setConfirming("decline")}>
              {t("decline")}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
