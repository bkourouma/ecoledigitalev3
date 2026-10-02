"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { HigherDocumentDto } from "@ecoledigitale/contracts/v2/higher";
import { usePermission } from "@/platform/access";
import { PDF_POLL_MAX, PDF_POLL_MS, requestDocumentPdf, useRefreshHigherDocuments, useRenderDocument } from "@/platform/v2/higher-documents";
import { useDescribeError } from "@/platform/ui/errors";
import { buttonClass, StatusBadge, type Tone } from "@/platform/ui/PageHeader";

type PdfState = "ready" | "preparing" | "failed" | "revoked";

/** État du PDF d'un document, lu dans le DTO (aucun calcul) : révoqué, prêt, en préparation (en attente ou rendu en cours) ou en échec. */
export function pdfStateOf(doc: Pick<HigherDocumentDto, "status" | "renderStatus">): PdfState {
  if (doc.status === "REVOKED") return "revoked";
  if (doc.renderStatus === "RENDERED") return "ready";
  if (doc.renderStatus === "FAILED") return "failed";
  return "preparing";
}

const TONE: Record<PdfState, Tone> = { ready: "success", preparing: "info", failed: "danger", revoked: "neutral" };

/** Pastille « PDF » : Prêt / En préparation / Échec / Révoqué. */
export function PdfStateBadge({ doc }: { doc: Pick<HigherDocumentDto, "status" | "renderStatus"> }) {
  const t = useTranslations("v2HigherPdf.state");
  const state = pdfStateOf(doc);
  return <StatusBadge label={t(state)} tone={TONE[state]} />;
}

/** Mention « scellé » : le document est signé numériquement (empreinte et signature vérifiables publiquement). */
export function SealBadge({ sealed }: { sealed: boolean }) {
  const t = useTranslations("v2HigherPdf");
  return <StatusBadge label={sealed ? t("sealed") : t("notSealed")} tone={sealed ? "success" : "warning"} />;
}

/** Lien vers la page publique de vérification (partage de l'authenticité). */
export function VerifyLink({ code }: { code: string }) {
  const t = useTranslations("v2HigherPdf");
  return (
    <Link href={`/v2/verify/${code}`} className="block text-xs text-primary underline-offset-4 hover:underline">
      {t("verify")}
    </Link>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "preparing"; attempts: number }
  | { kind: "ready" }
  | { kind: "failed" }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

/**
 * Télécharger le PDF d'un document officiel. Au clic, l'API répond soit par une URL signée (ouverte aussitôt, jamais conservée ni
 * affichée), soit par l'état du rendu : « en préparation » (relu toutes les 3 s, une minute au plus), « échec » (bouton « Relancer »
 * avec `higher.document.issue`). Un document révoqué n'est plus servi (le serveur répond 409, son message est affiché).
 */
export function DocumentPdfActions({ doc, label }: { doc: HigherDocumentDto; label?: string }) {
  const t = useTranslations("v2HigherPdf");
  const describe = useDescribeError();
  const canIssue = usePermission("higher.document.issue");
  const render = useRenderDocument();
  const refresh = useRefreshHigherDocuments();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Relecture de l'état tant que le PDF est en préparation (un minuteur par étape : l'effet se réarme à chaque tentative).
  useEffect(() => {
    if (phase.kind !== "preparing") return;
    const attempts = phase.attempts;
    const handle = setTimeout(async () => {
      try {
        const r = await requestDocumentPdf(doc.id);
        if (!alive.current) return;
        if (r.status === "READY") {
          // Pas d'ouverture automatique (un onglet ouvert hors d'un clic est bloqué) : le bouton redevient actif.
          setPhase({ kind: "ready" });
          void refresh();
        } else if (r.status === "FAILED") {
          setPhase({ kind: "failed" });
          void refresh();
        } else if (attempts + 1 >= PDF_POLL_MAX) {
          setPhase({ kind: "timeout" });
        } else {
          setPhase({ kind: "preparing", attempts: attempts + 1 });
        }
      } catch (e) {
        if (alive.current) setPhase({ kind: "error", message: describe(e) });
      }
    }, PDF_POLL_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `describe` et `refresh` sont recréés à chaque rendu
  }, [phase, doc.id]);

  async function download() {
    setPhase({ kind: "working" });
    try {
      const r = await requestDocumentPdf(doc.id);
      if (r.status === "READY") {
        window.open(r.url, "_blank", "noopener,noreferrer");
        setPhase({ kind: "idle" });
      } else if (r.status === "FAILED") {
        setPhase({ kind: "failed" });
      } else {
        setPhase({ kind: "preparing", attempts: 0 });
      }
    } catch (e) {
      setPhase({ kind: "error", message: describe(e) });
    }
  }

  async function retry() {
    try {
      await render.mutateAsync({ id: doc.id });
      setPhase({ kind: "preparing", attempts: 0 });
    } catch (e) {
      setPhase({ kind: "error", message: describe(e) });
    }
  }

  if (doc.status === "REVOKED") return <p className="text-xs text-muted-foreground">{t("revokedNote")}</p>;
  const name = label ?? doc.reference;
  const busy = phase.kind === "working" || phase.kind === "preparing";
  const failed = phase.kind === "failed" || (phase.kind === "idle" && doc.renderStatus === "FAILED");
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => void download()} aria-label={`${t("download")} — ${name}`}>
          {t("download")}
        </button>
        {failed && canIssue.allowed ? (
          <button type="button" className={buttonClass.ghost} disabled={render.isPending} onClick={() => void retry()} aria-label={`${t("retry")} — ${name}`}>
            {t("retry")}
          </button>
        ) : null}
      </div>
      <div aria-live="polite" className="text-xs">
        {phase.kind === "preparing" ? <p className="text-muted-foreground">{t("preparing")}</p> : null}
        {phase.kind === "ready" ? <p className="text-emerald-800">{t("nowReady")}</p> : null}
        {phase.kind === "timeout" ? <p className="text-muted-foreground">{t("timeout")}</p> : null}
        {failed ? <p className="text-destructive">{canIssue.allowed ? t("failed") : t("failedNoRetry")}</p> : null}
        {phase.kind === "error" ? (
          <p role="alert" className="text-destructive">
            {phase.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
