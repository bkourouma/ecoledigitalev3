"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ADMISSION_ACCEPTED_MIME, type AdmissionsPublicTrackDto } from "@ecoledigitale/contracts/v2/admissions";
import { publicTrack, publicUploadDocument } from "@/platform/v2/admissions";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";
import { publicErrorKey } from "./PublicFormScreen";

/** Les codes sont affichés par blocs et saisis avec ou sans espaces : on ne garde que les caractères du code, en majuscules. */
export function normalizeTrackingCode(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

/**
 * Suivi PUBLIC d'un dossier par code de suivi. Le code n'est JAMAIS placé dans l'URL (corps de requête, mémoire de la page) ;
 * une réponse unique est donnée pour un code inconnu, expiré ou mal formé ; seuls la phase, les pièces à fournir et l'échéance d'une
 * offre sont montrés (aucune donnée personnelle, aucun effectif, aucun rang).
 */
export function PublicTrackScreen({ school }: { school: string }) {
  const t = useTranslations("v2AdmissionsPublic.track");
  const [input, setInput] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; key: ReturnType<typeof publicErrorKey> } | { status: "ok"; data: AdmissionsPublicTrackDto }>({ status: "idle" });

  async function lookup(value: string, silent = false) {
    if (!silent) setState({ status: "loading" });
    try {
      setState({ status: "ok", data: await publicTrack(school, value) });
    } catch (error) {
      setState({ status: "error", key: publicErrorKey(error) });
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeTrackingCode(input);
    if (normalized.length < 8) {
      setState({ status: "error", key: "invalid" });
      return;
    }
    setCode(normalized);
    void lookup(normalized);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <form noValidate onSubmit={submit} aria-label={t("title")} className="max-w-xl space-y-3">
        <FormField label={t("codeLabel")} hint={t("codeHint")} required>
          {(c) => <TextControl {...c} value={input} onChange={setInput} maxLength={40} autoComplete="off" />}
        </FormField>
        <button type="submit" className={buttonClass.primary} disabled={state.status === "loading"}>
          {t("search")}
        </button>
      </form>
      {state.status === "loading" ? <LoadingBlock /> : null}
      {state.status === "error" ? <Notice kind="error">{t(`error.${state.key === "tooMany" || state.key === "unavailable" ? state.key : "notFound"}`)}</Notice> : null}
      {state.status === "ok" && code ? <Result school={school} code={code} data={state.data} onChanged={() => void lookup(code, true)} /> : null}
      <Link href={`/v2/apply/${encodeURIComponent(school)}`} className="inline-block text-sm text-primary hover:underline">
        {t("backToForm")}
      </Link>
    </div>
  );
}

function Result({ school, code, data, onChanged }: { school: string; code: string; data: AdmissionsPublicTrackDto; onChanged: () => void }) {
  const t = useTranslations("v2AdmissionsPublic.track");
  const fmt = useDateFormat();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [failure, setFailure] = useState<ReturnType<typeof publicErrorKey> | null>(null);

  async function upload(requirementId: string, file: File) {
    setBusy(requirementId);
    setFailure(null);
    setSent(null);
    try {
      await publicUploadDocument({ school, trackingCode: code, requirementId, file });
      setSent(requirementId);
      onChanged();
    } catch (error) {
      setFailure(publicErrorKey(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="track-result" className="max-w-xl space-y-4 rounded-lg border p-4" aria-live="polite">
      <h2 id="track-result" className="text-base font-semibold">
        {t("phaseTitle")}
      </h2>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge label={data.phaseLabel} tone={data.phase === "ENROLLED" ? "success" : data.phase === "CLOSED" ? "neutral" : data.phase === "DOCUMENTS_NEEDED" ? "warning" : "info"} />
        <span className="text-xs text-muted-foreground">{t("updatedAt", { date: fmt.instant(data.updatedAt) })}</span>
      </p>
      {sent !== null ? <Notice kind="success">{t("sent")}</Notice> : null}
      {data.closureLabel ? <Notice kind="info">{data.closureLabel}</Notice> : null}
      {data.offer ? <Notice kind="success">{t("offerPending", { date: fmt.instant(data.offer.expiresAt) })}</Notice> : null}
      {data.missingDocuments.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">{t("missing")}</h3>
          <ul className="mt-2 divide-y">
            {data.missingDocuments.map((d) => (
              <li key={d.requirementId} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <p className="font-medium">{d.label}</p>
                  {d.rejected && d.reason ? <p className="text-xs text-destructive">{t("rejected", { reason: d.reason })}</p> : null}
                </div>
                <div>
                  <input
                    ref={(el) => {
                      inputs.current[d.requirementId] = el;
                    }}
                    type="file"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={t("uploadAria", { label: d.label })}
                    accept={ADMISSION_ACCEPTED_MIME.join(",")}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(d.requirementId, file);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" className={buttonClass.secondary} disabled={busy !== null} onClick={() => inputs.current[d.requirementId]?.click()} aria-label={t("uploadAria", { label: d.label })}>
                    {busy === d.requirementId ? t("uploading") : t("upload")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t("uploadHint")}</p>
        </div>
      ) : null}
      {failure ? <Notice kind="error">{t(`uploadError.${failure === "tooMany" || failure === "unavailable" ? failure : "invalid"}`)}</Notice> : null}
    </section>
  );
}
