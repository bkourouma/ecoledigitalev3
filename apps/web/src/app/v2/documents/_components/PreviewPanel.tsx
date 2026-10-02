"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DocumentVersionDto } from "@ecoledigitale/contracts/v2/documents";
import { fetchPreviewBlob } from "@/platform/v2/documents";
import { buttonClass } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";

type Loaded = { kind: "IMAGE" | "PDF"; url: string } | { kind: "TEXT"; text: string };

/**
 * Prévisualisation SÛRE d'une version : les octets sont servis par l'API (type réel, `nosniff`, aucun HTML ni SVG) puis lus en
 * `blob` ; une image s'affiche dans `<img>`, un PDF dans le visionneur du navigateur, un texte dans `<pre>` (échappé par React).
 * Chaque prévisualisation est un accès journalisé : elle ne part que sur demande explicite de l'utilisateur.
 */
export function PreviewPanel({ documentId, version }: { documentId: string; version: DocumentVersionDto }) {
  const t = useTranslations("v2Documents.preview");
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; value: Loaded }>({ status: "idle" });

  // Changer de version ou de document remet l'aperçu à zéro et libère l'URL d'objet.
  useEffect(() => {
    setState({ status: "idle" });
  }, [documentId, version.versionNo]);
  useEffect(
    () => () => {
      if (state.status === "ready" && state.value.kind !== "TEXT") URL.revokeObjectURL(state.value.url);
    },
    [state],
  );

  async function load(): Promise<void> {
    setState({ status: "loading" });
    try {
      const blob = await fetchPreviewBlob(documentId, version.versionNo);
      const type = blob.type.split(";")[0]?.trim().toLowerCase() ?? "";
      if (type === "text/plain" || type === "text/csv") return setState({ status: "ready", value: { kind: "TEXT", text: await blob.text() } });
      if (type.startsWith("image/")) return setState({ status: "ready", value: { kind: "IMAGE", url: URL.createObjectURL(blob) } });
      if (type === "application/pdf") return setState({ status: "ready", value: { kind: "PDF", url: URL.createObjectURL(blob) } });
      setState({ status: "error", error: new Error("type") });
    } catch (error) {
      setState({ status: "error", error });
    }
  }

  if (version.state === "PURGED" || version.previewKind === "NONE") return <Notice kind="info">{t("unavailable")}</Notice>;
  return (
    <section aria-label={t("title")} className="space-y-3">
      {state.status === "idle" ? (
        <button type="button" onClick={() => void load()} className={buttonClass.secondary}>
          <Eye className="h-4 w-4" aria-hidden="true" />
          {t("show", { version: version.versionNo })}
        </button>
      ) : null}
      {state.status === "loading" ? <LoadingBlock label={t("loading")} /> : null}
      {state.status === "error" ? <ErrorBlock error={state.error} onRetry={() => void load()} /> : null}
      {state.status === "ready" && state.value.kind === "IMAGE" ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob local : next/image ne s'applique pas
        <img src={state.value.url} alt={t("imageAlt", { name: version.fileName })} className="max-h-[70vh] max-w-full rounded-md border object-contain" />
      ) : null}
      {state.status === "ready" && state.value.kind === "PDF" ? (
        <iframe src={state.value.url} title={t("pdfTitle", { name: version.fileName })} referrerPolicy="no-referrer" className="h-[70vh] w-full rounded-md border" />
      ) : null}
      {state.status === "ready" && state.value.kind === "TEXT" ? (
        <pre tabIndex={0} aria-label={t("textLabel", { name: version.fileName })} className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
          {state.value.text}
        </pre>
      ) : null}
    </section>
  );
}
