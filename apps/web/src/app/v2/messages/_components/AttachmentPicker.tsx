"use client";

import { useId, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MessagingAttachmentDto } from "@ecoledigitale/contracts/v2/messaging";
import { fileToBase64, useUploadAttachment } from "@/platform/v2/messaging";
import { useDescribeError } from "@/platform/ui/errors";
import { formatBytes } from "./messaging-utils";

/**
 * Pièces jointes d'un message ou d'une annonce : chaque fichier est déposé AU CHOIX de l'utilisateur (base64) ; l'API
 * contrôle le type RÉEL (PDF, JPEG, PNG, WebP), la taille et le nombre selon les paramètres de l'établissement. Une pièce
 * déposée mais jamais envoyée est purgée par le serveur au bout de 24 h.
 */
export function AttachmentPicker({ value, onChange, disabled, max = 5 }: { value: ReadonlyArray<MessagingAttachmentDto>; onChange: (next: MessagingAttachmentDto[]) => void; disabled?: boolean; max?: number }) {
  const t = useTranslations("v2Messaging.attachments");
  const describe = useDescribeError();
  const inputId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const upload = useUploadAttachment();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    let next = [...value];
    for (const file of Array.from(files)) {
      if (next.length >= max) {
        setError(t("tooMany", { max }));
        break;
      }
      try {
        const att = await upload.mutateAsync({ fileName: file.name, contentBase64: await fileToBase64(file) });
        next = [...next, att];
        onChange(next);
      } catch (e) {
        setError(`${file.name} : ${describe(e)}`);
      }
    }
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-within:ring-2 focus-within:ring-ring sm:h-9 ${disabled || busy ? "pointer-events-none opacity-50" : ""}`}>
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          {busy ? t("uploading") : t("add")}
        </label>
        <input ref={ref} id={inputId} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" disabled={disabled || busy} onChange={(e) => void onFiles(e.target.files)} />
        <span className="text-xs text-muted-foreground">{t("hint")}</span>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("list")}>
          {value.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-2 rounded-md border bg-muted px-2 py-1 text-xs">
              <span className="max-w-[12rem] truncate">{a.fileName}</span>
              <span className="text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
              <button type="button" aria-label={t("remove", { name: a.fileName })} className="rounded p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onChange(value.filter((x) => x.id !== a.id))} disabled={disabled}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
