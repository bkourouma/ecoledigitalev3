"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  /**
   * Appelé avant de quitter l'étape vers l'avant. `false` (ou une promesse résolue à `false`) bloque la progression :
   * l'étape affiche alors ses propres erreurs de champ. Aucune règle métier ici : seulement la validation de forme.
   */
  validate?: () => boolean | Promise<boolean>;
}

export interface WizardProps {
  /** Nom accessible de l'assistant. */
  label: string;
  steps: ReadonlyArray<WizardStep>;
  /** Dernière étape : appelé par le bouton final. */
  onFinish: () => void | Promise<void>;
  finishLabel: string;
  isSubmitting?: boolean;
  /** Message d'erreur global (par ex. réponse de l'API) affiché au-dessus des boutons. */
  footerNotice?: ReactNode;
  onCancel?: () => void;
  className?: string;
}

/**
 * Assistant en étapes : liste d'étapes (`aria-current="step"`), titre de l'étape focalisé à chaque changement, boutons
 * Précédent / Suivant / Terminer, validation par étape. Sur mobile, l'indicateur se réduit à « Étape x sur n ».
 */
export function Wizard({ label, steps, onFinish, finishLabel, isSubmitting = false, footerNotice, onCancel, className }: WizardProps) {
  const t = useTranslations("v2Ui.wizard");
  const [index, setIndex] = useState(0);
  const [checking, setChecking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [index]);

  if (!step) return null;

  async function next() {
    setChecking(true);
    try {
      const ok = step!.validate ? await step!.validate() : true;
      if (!ok) return;
      if (last) await onFinish();
      else setIndex((i) => i + 1);
    } finally {
      setChecking(false);
    }
  }

  const busy = checking || isSubmitting;
  const btn = "inline-flex h-11 min-w-[6rem] items-center justify-center gap-2 rounded-md px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

  return (
    <section aria-label={label} className={cn("space-y-5", className)}>
      <p className="text-sm text-muted-foreground sm:hidden" aria-hidden="true">
        {t("progress", { current: index + 1, total: steps.length })} — {step.title}
      </p>
      <ol className="hidden items-center gap-2 sm:flex" aria-label={t("steps")}>
        {steps.map((s, i) => {
          const done = i < index;
          const current = i === index;
          return (
            <li key={s.id} aria-current={current ? "step" : undefined} className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold",
                  done && "border-primary bg-primary text-primary-foreground",
                  current && "border-primary text-primary",
                  !done && !current && "border-input text-muted-foreground",
                )}
              >
                {done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn("text-sm", current ? "font-semibold" : "text-muted-foreground")}>
                {s.title}
                {done ? <span className="sr-only"> ({t("done")})</span> : null}
              </span>
              {i < steps.length - 1 ? <span className="mx-1 h-px w-6 bg-border" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
      <div className="h-1 overflow-hidden rounded bg-muted sm:hidden" aria-hidden="true">
        <div className="h-full bg-primary transition-all" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
      </div>

      <div className="space-y-4">
        <div>
          <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            {step.title}
          </h2>
          {step.description ? <p className="text-sm text-muted-foreground">{step.description}</p> : null}
        </div>
        <div>{step.content}</div>
      </div>

      {footerNotice ? <div>{footerNotice}</div> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {onCancel ? (
            <button type="button" onClick={onCancel} disabled={busy} className={cn(btn, "text-muted-foreground hover:bg-accent")}>
              {t("cancel")}
            </button>
          ) : null}
          {index > 0 ? (
            <button type="button" onClick={() => setIndex((i) => i - 1)} disabled={busy} className={cn(btn, "border border-input bg-background hover:bg-accent")}>
              {t("previous")}
            </button>
          ) : null}
        </div>
        <button type="button" onClick={() => void next()} disabled={busy} className={cn(btn, "bg-primary text-primary-foreground hover:bg-primary/90")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {last ? finishLabel : t("next")}
        </button>
      </div>
    </section>
  );
}
