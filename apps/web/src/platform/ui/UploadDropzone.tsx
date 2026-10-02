"use client";

import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FileUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Taille lisible (octets -> o / Ko / Mo), en français. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1).replace(".", ",")} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${bytes} o`;
}

export interface UploadDropzoneProps {
  /** Fichier choisi (une sélection à la fois) : déposé OU choisi au clavier / à la souris dans le sélecteur du système. */
  onFile: (file: File) => void;
  /** Extensions acceptées, sans le point (`["pdf", "jpg"]`) : confort de saisie seulement ; l'API reste la barrière (octets). */
  extensions?: readonly string[];
  /** Taille maximale en octets (contrôle de confort ; l'API contrôle le contenu réel). */
  maxBytes?: number;
  /** Envoi en cours : la zone est désactivée et l'état annoncé. */
  busy?: boolean;
  disabled?: boolean;
  /** Nom du fichier déjà choisi (rappel visible et annoncé). */
  selectedName?: string | null;
  className?: string;
  id?: string;
}

/**
 * Zone de dépôt ACCESSIBLE : glisser-déposer ET sélecteur de fichier. La zone entière est un seul bouton focalisable
 * (Entrée / Espace ouvrent le sélecteur du système) ; l'`<input type="file">` est relié à ce bouton, jamais sans nom.
 * Les refus de confort (taille, extension) et le fichier retenu sont annoncés par une région `aria-live`.
 */
export function UploadDropzone({ onFile, extensions, maxBytes, busy = false, disabled = false, selectedName = null, className, id }: UploadDropzoneProps) {
  const t = useTranslations("v2DocumentsUi.dropzone");
  const generated = useId();
  const baseId = id ?? `dz-${generated}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const inactive = disabled || busy;
  const accept = extensions && extensions.length > 0 ? extensions.map((e) => `.${e}`).join(",") : undefined;

  function take(file: File | undefined | null): void {
    if (!file || inactive) return;
    if (file.size === 0) return setMessage({ kind: "error", text: t("empty", { name: file.name }) });
    if (maxBytes !== undefined && file.size > maxBytes) return setMessage({ kind: "error", text: t("tooLarge", { name: file.name, max: formatFileSize(maxBytes) }) });
    const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    if (extensions && extensions.length > 0 && !extensions.includes(ext)) return setMessage({ kind: "error", text: t("badExtension", { name: file.name, allowed: extensions.join(", ") }) });
    setMessage({ kind: "ok", text: t("selected", { name: file.name, size: formatFileSize(file.size) }) });
    onFile(file);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>): void {
    take(e.target.files?.[0]);
    e.target.value = ""; // permet de rechoisir le même fichier
  }

  function onDrop(e: DragEvent<HTMLElement>): void {
    e.preventDefault();
    setDragging(false);
    if (inactive) return;
    if (e.dataTransfer.files.length > 1) return setMessage({ kind: "error", text: t("oneAtATime") });
    take(e.dataTransfer.files[0]);
  }

  const status = busy ? t("busy") : (message?.text ?? (selectedName ? t("selectedAlready", { name: selectedName }) : ""));
  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        id={baseId}
        disabled={inactive}
        aria-describedby={`${baseId}-status`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!inactive) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex min-h-[8rem] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-background p-6 text-center text-sm transition-colors",
          "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
          dragging && "border-primary bg-primary/5",
        )}
      >
        <FileUp className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{t("prompt")}</span>
        <span className="text-xs text-muted-foreground">
          {t("hint")}
          {extensions && extensions.length > 0 ? ` ${t("allowed", { list: extensions.join(", ") })}` : ""}
          {maxBytes !== undefined ? ` ${t("max", { max: formatFileSize(maxBytes) })}` : ""}
        </span>
      </button>
      <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} accept={accept} aria-label={t("inputLabel")} disabled={inactive} onChange={onChange} data-testid="dropzone-input" />
      <p id={`${baseId}-status`} role={message?.kind === "error" ? "alert" : "status"} aria-live="polite" className={cn("min-h-[1.25rem] text-sm", message?.kind === "error" ? "font-medium text-destructive" : "text-muted-foreground")}>
        {status}
      </p>
    </div>
  );
}
