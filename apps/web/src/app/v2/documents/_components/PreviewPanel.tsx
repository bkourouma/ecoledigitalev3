"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { DocumentVersionDto } from "@ecoledigitale/contracts/v2/documents";
import { fetchPreviewBlob } from "@/platform/v2/documents";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";

/** `Blob.text()` n'existe pas partout (anciens navigateurs, jsdom) : repli par `FileReader`. */
function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("lecture impossible"));
    reader.readAsText(blob);
  });
}

type Loaded ={ kind: "IMAGE" | "PDF"; url: string } | { kind: "TEXT"; text: string };
type State = { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; value: Loaded };

/**
 * Prévisualisation SÛRE d'une version : les octets sont servis par l'API (type réel, `nosniff`, aucun HTML ni SVG) puis lus en
 * `blob` ; une image s'affiche dans `<img>`, un PDF dans le visionneur du navigateur, un texte dans `<pre>` (échappé par React).
 * Chaque prévisualisation est un accès journalisé : ce composant n'est monté qu'à la demande explicite de l'utilisateur
 * (bouton « Prévisualiser la version N » de la liste des versions).
 */
export function PreviewPanel({ documentId, version }: { documentId: string; version: DocumentVersionDto }) {
  const t = useTranslations("v2Documents.preview");
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const previewable = version.state !== "PURGED" && version.previewKind !== "NONE";

  useEffect(() => {
    if (!previewable) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading" });
    void (async () => {
      try {
        const blob = await fetchPreviewBlob(documentId, version.versionNo);
        if (cancelled) return;
        const type = blob.type.split(";")[0]?.trim().toLowerCase() ?? "";
        if (type === "text/plain" || type === "text/csv") {
          const text = await readBlobText(blob);
          if (!cancelled) setState({ status: "ready", value: { kind: "TEXT", text } });
        } else if (type.startsWith("image/") || type === "application/pdf") {
          objectUrl = URL.createObjectURL(blob);
          setState({ status: "ready", value: { kind: type === "application/pdf" ? "PDF" : "IMAGE", url: objectUrl } });
        } else {
          setState({ status: "error", error: new Error("type") });
        }
      } catch (error) {
        if (!cancelled) setState({ status: "error", error });
      }
    })();
    // Changer de version, de document ou quitter l'écran libère l'URL d'objet.
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, version.versionNo, previewable, attempt]);

  if (!previewable) return <Notice kind="info">{t("unavailable")}</Notice>;
  return (
    <section aria-label={t("title", { version: version.versionNo })} className="space-y-3">
      <h3 className="text-sm font-semibold">{t("title", { version: version.versionNo })}</h3>
      {state.status === "loading" ? <LoadingBlock label={t("loading")} /> : null}
      {state.status === "error" ? <ErrorBlock error={state.error} onRetry={() => setAttempt((n) => n + 1)} /> : null}
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
