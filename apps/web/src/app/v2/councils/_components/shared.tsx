"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/platform/api/errors";
import { cn } from "@/lib/utils";
import { Can } from "@/platform/ui/AccessGate";
import { useDescribeError } from "@/platform/ui/errors";
import type { Tone } from "@/platform/ui/PageHeader";
import { buttonClass, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, QueryBoundary } from "@/platform/ui/states";

// Utilitaires partagés avec la vie scolaire (dates locales, choix de classe, choix d'élève par inscription).
export { localToIso, nowLocalInput, StudentPicker, todayInput, useClassChoices, useDateTime, type PickedStudent } from "../../schoollife/_components/shared";

// ---------------------------------------------------------------------------
// Libellés d'énumérations (`v2Councils.enums.<groupe>.<VALEUR>`) et tons
// ---------------------------------------------------------------------------

export type EnumGroup =
  | "status"
  | "scope"
  | "presence"
  | "function"
  | "agendaStatus"
  | "proposalKind"
  | "proposalStatus"
  | "origin"
  | "decisionFamily"
  | "decisionMode"
  | "decisionStatus"
  | "effectKind"
  | "effectStatus"
  | "minutesStatus"
  | "renderStatus"
  | "signatureMethod"
  | "unlockStatus"
  | "resultsStatus"
  | "guardianVisibility"
  | "effectsTrigger"
  | "appliesTo"
  | "pathKind"
  | "orientationStatus"
  | "consent"
  | "wishSource"
  | "transferStatus"
  | "effectiveKind"
  | "decidedVia"
  | "ruleSource"
  | "authorRole"
  | "proposedSource"
  | "studentStatus";

const TONES: Record<string, Tone> = {
  // vert : abouti
  SIGNED: "success",
  RECORDED: "success",
  APPLIED: "success",
  RENDERED: "success",
  DECIDED: "success",
  ACCEPTED: "success",
  PRESENT: "success",
  GIVEN: "success",
  APPROVED: "success",
  REVIEWED: "success",
  // bleu : en cours / à faire
  PLANNED: "info",
  OPEN: "info",
  PENDING: "info",
  PROPOSED: "info",
  GENERATED: "info",
  REQUESTED: "info",
  INVITED: "info",
  AWAITING_HUMAN: "warning",
  WISHES_COLLECTED: "info",
  MODIFIED: "info",
  // rouge : refus, échec, annulation
  CANCELLED: "danger",
  FAILED: "danger",
  REJECTED: "danger",
  WITHDRAWN: "danger",
  REVOKED: "danger",
  REFUSED: "danger",
  ABSENT: "danger",
  REVERTED: "danger",
  SKIPPED: "neutral",
  EXPIRED: "neutral",
  CONSUMED: "neutral",
  SUPERSEDED: "neutral",
  EXCUSED: "neutral",
  CLOSED: "neutral",
  placeholder: "warning",
};

export function EnumLabel({ group, value, className }: { group: EnumGroup; value: string; className?: string }) {
  const t = useTranslations("v2Councils.enums");
  const key = `${group}.${value}`;
  return <StatusBadge label={t.has(key) ? t(key) : value} tone={TONES[value] ?? "neutral"} className={className} />;
}

/** Texte traduit d'une énumération (sans pastille), repli sur le code brut. */
export function useEnumText() {
  const t = useTranslations("v2Councils.enums");
  return (group: EnumGroup, value: string | null | undefined): string => {
    if (!value) return "—";
    const key = `${group}.${value}`;
    return t.has(key) ? t(key) : value;
  };
}

// ---------------------------------------------------------------------------
// Bandeau « règles de démonstration » : la valeur vient de l'API, jamais déduite côté web
// ---------------------------------------------------------------------------

export function PlaceholderBanner({ ruleSourceKind, className }: { ruleSourceKind: string | null | undefined; className?: string }) {
  const t = useTranslations("v2Councils.banner");
  if (ruleSourceKind !== "placeholder") return null;
  return (
    <div role="note" aria-label={t("title")} className={cn("flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200", className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">{t("title")}</p>
        <p className="text-xs">{t("hint")}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Erreurs : le message de l'API d'abord, repli traduit par code stable `councils.*`
// ---------------------------------------------------------------------------

export function useCouncilsError(): (error: unknown) => string {
  const describe = useDescribeError();
  const t = useTranslations("v2Councils.errors");
  return (error) => {
    if (error instanceof ApiError && error.code.startsWith("councils.")) {
      if (error.message.trim() !== "") return error.message;
      const key = `codes.${error.code.slice("councils.".length)}`;
      if (t.has(key)) return t(key);
    }
    return describe(error);
  };
}

export function ActionError({ error }: { error: unknown }) {
  const describe = useCouncilsError();
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      {describe(error)}
    </p>
  );
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Enveloppe de requête : un 404 (hors périmètre, lien erroné) devient un état « introuvable ». */
export function CouncilsBoundary({ query, ...rest }: ComponentProps<typeof QueryBoundary>) {
  const t = useTranslations("v2Councils.common");
  if (query.isError && isNotFound(query.error)) {
    return (
      <EmptyBlock
        title={t("notFound")}
        description={t("notFoundHint")}
        action={
          <Link href="/v2/councils" className={buttonClass.secondary}>
            {t("backToCalendar")}
          </Link>
        }
      />
    );
  }
  return <QueryBoundary query={query} {...rest} />;
}

/** Empreinte abrégée (affichage seul ; la valeur complète est en infobulle). */
export function Hash({ value }: { value: string | null | undefined }) {
  if (!value) return <span>—</span>;
  return (
    <code title={value} className="rounded bg-muted px-1 py-0.5 text-xs">
      {value.slice(0, 12)}
    </code>
  );
}

// ---------------------------------------------------------------------------
// Navigation d'une séance
// ---------------------------------------------------------------------------

export type CouncilTab = "file" | "deliberation" | "minutes" | "history";

export function CouncilSubNav({ councilId, current }: { councilId: string; current: CouncilTab }) {
  const t = useTranslations("v2Councils.subnav");
  const items: Array<{ key: CouncilTab; href: string; label: string; permission: string }> = [
    { key: "file", href: `/v2/councils/${councilId}`, label: t("file"), permission: "council.read" },
    { key: "deliberation", href: `/v2/councils/${councilId}/deliberation`, label: t("deliberation"), permission: "council.read" },
    { key: "minutes", href: `/v2/councils/${councilId}/pv`, label: t("minutes"), permission: "council.minutes.read" },
    { key: "history", href: `/v2/councils/${councilId}/historique`, label: t("history"), permission: "council.read" },
  ];
  return (
    <nav aria-label={t("label")} className="mb-4 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b">
        {items.map((i) => (
          <li key={i.key}>
            <Can permission={i.permission}>
              <Link
                href={i.href}
                aria-current={current === i.key ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10",
                  current === i.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {i.label}
              </Link>
            </Can>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Titre lisible d'une séance : l'intitulé, sinon type et classe (valeurs de l'API). */
export function councilTitle(c: { title: string | null; councilTypeLabel: string; classroomName: string | null; periodLabel: string | null }): string {
  if (c.title) return c.title;
  return [c.councilTypeLabel, c.classroomName, c.periodLabel].filter(Boolean).join(" · ");
}

export function Section({ id, title, children, actions }: { id: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-2xl border border-white/10 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Tableau à défilement horizontal (mobile) avec légende accessible. */
export function ScrollTable({ caption, children }: { caption: string; children: ReactNode }) {
  const t = useTranslations("v2Councils.common");
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("tableLabel", { caption })}>
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const TH = "px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";
export const TD = "px-2 py-2 align-top";
