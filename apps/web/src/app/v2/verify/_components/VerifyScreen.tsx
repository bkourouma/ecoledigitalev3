"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/platform/api/errors";
import { useDescribeError } from "@/platform/ui/errors";
import { useVerifyCode, verifyFile } from "@/platform/v2/reportcards";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";

/** Les codes sont affichés par blocs et saisis avec ou sans espaces : on ne garde que les caractères du code, en majuscules. */
export function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

const TONE = { AUTHENTIC: "success", SUPERSEDED: "warning", REVOKED: "danger", INVALID: "danger", UNKNOWN: "neutral" } as const;

/**
 * Page PUBLIQUE de vérification d'un document (bulletin, relevé, diplôme, attestation) : aucune authentification, aucune
 * donnée personnelle (ni note, ni nom, ni matricule, ni date de naissance). Un code inexistant, mal formé ou trop long
 * reçoit la même réponse.
 */
export function VerifyScreen({ initialCode = "" }: { initialCode?: string }) {
  const t = useTranslations("v2ReportcardsVerify");
  const [input, setInput] = useState(initialCode);
  const [code, setCode] = useState<string | null>(initialCode ? normalizeCode(initialCode) : null);
  const result = useVerifyCode(code);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <form
        noValidate
        className="max-w-xl space-y-3"
        aria-label={t("codeForm")}
        onSubmit={(e) => {
          e.preventDefault();
          const next = normalizeCode(input);
          setCode(next === "" ? null : next);
        }}
      >
        <FormField label={t("codeLabel")} hint={t("codeHint")} required>
          {(c) => <TextControl {...c} value={input} onChange={setInput} maxLength={64} autoComplete="off" />}
        </FormField>
        <button type="submit" className={buttonClass.primary}>
          {t("verify")}
        </button>
      </form>

      {code ? <Outcome query={result} /> : null}

      <FileCheck />

      <Notice kind="info">{t("privacy")}</Notice>
    </div>
  );
}

function Outcome({ query }: { query: ReturnType<typeof useVerifyCode> }) {
  const t = useTranslations("v2ReportcardsVerify");
  const tStatus = useTranslations("v2ReportcardsVerify.status");
  const tKind = useTranslations("v2ReportcardsVerify.kind");
  const date = useDateFormat();
  if (query.isPending && query.fetchStatus !== "idle") return <LoadingBlock label={t("checking")} />;
  if (query.isError) {
    const error = query.error;
    // 404 : même réponse pour un code inexistant, mal formé ou trop long (le serveur ne les distingue pas).
    if (error instanceof ApiError && error.status === 404) {
      return (
        <section aria-label={t("result")} role="status" className="space-y-2 rounded-md border p-4">
          <StatusBadge label={tStatus("UNKNOWN")} tone="neutral" />
          <p className="text-sm">{t("unknown")}</p>
        </section>
      );
    }
    return <ErrorBlock error={error} onRetry={() => void query.refetch()} />;
  }
  const r = query.data;
  if (!r) return null;
  return (
    <section aria-label={t("result")} role="status" className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={tStatus(r.status)} tone={TONE[r.status]} />
        <h2 className="text-lg font-semibold">{tStatus(`headline.${r.status}`)}</h2>
      </div>
      <p className="text-sm">{r.message}</p>
      {r.status === "SUPERSEDED" && r.supersededByIssuedAt ? <p className="text-sm">{t("supersededBy", { date: date.instant(r.supersededByIssuedAt) })}</p> : null}
      {r.status === "REVOKED" && r.revokedAt ? <p className="text-sm">{t("revokedOn", { date: date.instant(r.revokedAt) })}</p> : null}
      {r.status !== "UNKNOWN" ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {r.institutionName ? <Info label={t("institution")}>{r.institutionName}</Info> : null}
          {r.documentKind ? <Info label={t("documentKind")}>{tKind(r.documentKind)}</Info> : null}
          {r.title ? <Info label={t("documentTitle")}>{r.title}</Info> : null}
          {r.issuedAt ? <Info label={t("issuedAt")}>{date.instant(r.issuedAt)}</Info> : null}
          {r.mention ? <Info label={t("mention")}>{r.mention}</Info> : null}
        </dl>
      ) : null}
      {r.keyId ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{t("technical")}</summary>
          <dl className="mt-2 space-y-1 text-xs">
            <div>
              <dt className="inline text-muted-foreground">{t("keyId")} : </dt>
              <dd className="inline font-mono">{r.keyId}</dd>
            </div>
            {r.keyFingerprint ? (
              <div>
                <dt className="inline text-muted-foreground">{t("fingerprint")} : </dt>
                <dd className="inline break-all font-mono">{r.keyFingerprint}</dd>
              </div>
            ) : null}
            {r.snapshotHash ? (
              <div>
                <dt className="inline text-muted-foreground">{t("documentHash")} : </dt>
                <dd className="inline break-all font-mono">{r.snapshotHash}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </section>
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

const MAX_BYTES = 10 * 1024 * 1024;

function FileCheck() {
  const t = useTranslations("v2ReportcardsVerify.file");
  const tStatus = useTranslations("v2ReportcardsVerify.status");
  const describe = useDescribeError();
  const date = useDateFormat();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "pending" } | { kind: "error"; message: string } | { kind: "done"; data: Awaited<ReturnType<typeof verifyFile>> }>({ kind: "idle" });

  async function check(file: File | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setState({ kind: "error", message: t("notPdf") });
    if (file.size > MAX_BYTES) return setState({ kind: "error", message: t("tooLarge") });
    setState({ kind: "pending" });
    try {
      setState({ kind: "done", data: await verifyFile(file) });
    } catch (e) {
      setState({ kind: "error", message: describe(e) });
    }
  }

  return (
    <section aria-labelledby="file-h" className="max-w-xl space-y-3 rounded-md border p-4">
      <h2 id="file-h" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <FormField label={t("input")} hint={t("hint")}>
        {(c) => <input {...c} type="file" accept="application/pdf,.pdf" onChange={(e) => void check(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-sm file:font-medium" />}
      </FormField>
      <div aria-live="polite">
        {state.kind === "pending" ? <LoadingBlock label={t("checking")} /> : null}
        {state.kind === "error" ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.message}
          </p>
        ) : null}
        {state.kind === "done" ? (
          <div role="status" className="space-y-1 text-sm">
            <StatusBadge label={state.data.match ? t("match") : t("noMatch")} tone={state.data.match ? "success" : "danger"} />
            <p>{state.data.message}</p>
            {state.data.match && state.data.status ? <p>{t("documentStatus", { status: tStatus(state.data.status) })}</p> : null}
            {state.data.match && state.data.institutionName ? <p>{state.data.institutionName}</p> : null}
            {state.data.match && state.data.title ? <p>{state.data.title}</p> : null}
            {state.data.match && state.data.issuedAt ? <p>{t("issuedOn", { date: date.instant(state.data.issuedAt) })}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
