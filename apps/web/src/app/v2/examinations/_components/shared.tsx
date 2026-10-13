"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ExamSessionDetailDto, ExamSessionStatus } from "@ecoledigitale/contracts/v2/examinations";
import { cn } from "@/lib/utils";
import { useExamSession, useExamSessions } from "@/platform/v2/examinations";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";

/** Les écrans d'examens n'affichent que ce que l'API décide : étiquettes et teintes ne portent AUCUNE règle. */
export const SESSION_PHASES: readonly ExamSessionStatus[] = ["PLANNED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "IN_PROGRESS", "RESULTS_ENTERED", "PUBLISHED", "ARCHIVED"];

export function useExamLabels() {
  const t = useTranslations("v2Examinations.enums");
  return {
    sessionStatus: (v: string) => t(`sessionStatus.${v}` as never),
    sessionKind: (v: string) => t(`sessionKind.${v}` as never),
    registration: (v: string) => t(`registration.${v}` as never),
    eligibility: (v: string) => t(`eligibility.${v}` as never),
    outcome: (v: string) => t(`outcome.${v}` as never),
    resultCode: (v: string) => t(`resultCode.${v}` as never),
    scoreStatus: (v: string) => t(`scoreStatus.${v}` as never),
    docKind: (v: string) => t(`docKind.${v}` as never),
    batchStatus: (v: string) => t(`batchStatus.${v}` as never),
    batchKind: (v: string) => t(`batchKind.${v}` as never),
    piece: (v: string) => t(`piece.${v}` as never),
    source: (v: string) => t(`source.${v}` as never),
    countGroup: (v: string) => t(`countGroup.${v}` as never),
    revisionStatus: (v: string) => t(`revisionStatus.${v}` as never),
    docStatus: (v: string) => t(`docStatus.${v}` as never),
    /** Motif codé renvoyé par une règle ; un motif inconnu est affiché tel quel (jamais masqué). */
    reason: (v: string) => (t.has(`reason.${v}` as never) ? t(`reason.${v}` as never) : v),
    importError: (v: string) => (t.has(`importError.${v}` as never) ? t(`importError.${v}` as never) : v),
  };
}

export const sessionTone = (s: string): Tone => (s === "PUBLISHED" ? "success" : s === "ARCHIVED" ? "neutral" : s === "PLANNED" ? "info" : "warning");
export const eligibilityTone = (s: string): Tone => (s === "ELIGIBLE" ? "success" : s === "INELIGIBLE" ? "danger" : s === "NEEDS_REVIEW" ? "warning" : "neutral");
export const outcomeTone = (s: string): Tone => (s === "ADMITTED" ? "success" : s === "FAILED" || s === "EXCLUDED" ? "danger" : s === "PENDING" ? "neutral" : "warning");
export const registrationTone = (s: string): Tone => (s === "REGISTERED" ? "success" : s === "WITHDRAWN" ? "danger" : s === "PRE_REGISTERED" ? "info" : "neutral");

/** Bandeau « Règles de démonstration » tant que des données ou une règle FICTIVES servent. */
export function DemoBanner({ visible }: { visible: boolean }) {
  const t = useTranslations("v2Examinations.demo");
  if (!visible) return null;
  return (
    <Notice kind="warning" className="mb-4">
      <p className="font-semibold">{t("title")}</p>
      <p>{t("body")}</p>
    </Notice>
  );
}

/** Parcours d'une session : étapes, étape courante annoncée (`aria-current`). */
export function Phases({ status }: { status: ExamSessionStatus }) {
  const t = useTranslations("v2Examinations.enums.sessionStatus");
  const tp = useTranslations("v2Examinations.sessionDetail");
  const index = SESSION_PHASES.indexOf(status);
  return (
    <ol aria-label={tp("phases")} className="flex flex-wrap gap-2">
      {SESSION_PHASES.map((p, i) => (
        <li key={p} aria-current={i === index ? "step" : undefined} className={cn("rounded-full border px-3 py-1 text-xs font-medium", i < index && "border-emerald-400/40 bg-emerald-400/10 text-emerald-200", i === index && "border-primary bg-primary text-primary-foreground", i > index && "text-muted-foreground")}>
          {t(p as never)}
        </li>
      ))}
    </ol>
  );
}

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <StatusBadge label={label} tone={tone} />;
}

/** Lecture / écriture du paramètre `?session=` : la session choisie survit au rechargement et se partage. */
export function useSessionParam(): [string | null, (id: string | null) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const value = params?.get("session") ?? null;
  return [value, (id) => router.replace(id ? `${pathname}?session=${id}` : pathname)];
}

export function SessionPicker({ value, onChange, kind, label }: { value: string | null; onChange: (id: string | null) => void; kind?: "OFFICIAL" | "MOCK"; label?: string }) {
  const t = useTranslations("v2Examinations.sessionPicker");
  const labels = useExamLabels();
  const sessions = useExamSessions({ ...(kind ? { sessionKind: kind } : {}), pageSize: 200 });
  const items = sessions.data?.items ?? [];
  // Une seule session disponible et aucune choisie : elle est retenue d'office (un clic de moins sur mobile).
  useEffect(() => {
    if (value === null && items.length === 1) onChange(items[0]!.id);
  }, [value, items, onChange]);
  if (sessions.isPending) return <LoadingBlock />;
  if (sessions.isError) return <ErrorBlock error={sessions.error} onRetry={() => void sessions.refetch()} />;
  if (items.length === 0) return <EmptyBlock title={t("empty")} description={t("emptyHint")} />;
  return (
    <FormField label={label ?? t("label")} className="max-w-xl">
      {(c) => (
        <NativeSelect
          {...c}
          value={value ?? ""}
          placeholder={t("choose")}
          options={items.map((s) => ({ value: s.id, label: `${s.label} — ${s.examTypeCode} ${s.sessionYear} (${labels.sessionKind(s.sessionKind)}, ${labels.sessionStatus(s.status)})` }))}
          onChange={(v) => onChange(v || null)}
        />
      )}
    </FormField>
  );
}

/** Écran rattaché à une session : sélecteur, bandeau de démonstration, puis le contenu (qui reçoit le détail de la session). */
export function SessionScope({ kind, children }: { kind?: "OFFICIAL" | "MOCK"; children: (session: ExamSessionDetailDto) => ReactNode }) {
  const [sessionId, setSessionId] = useSessionParam();
  const session = useExamSession(sessionId);
  return (
    <div className="space-y-4">
      <SessionPicker value={sessionId} onChange={setSessionId} {...(kind ? { kind } : {})} />
      {sessionId === null ? null : session.isPending ? <LoadingBlock /> : session.isError ? <ErrorBlock error={session.error} onRetry={() => void session.refetch()} /> : (
        <>
          <DemoBanner visible={session.data.demoRules} />
          {children(session.data)}
        </>
      )}
    </div>
  );
}

/** Rapport d'une opération en lot : effectifs, puis chaque ligne refusée avec le message de l'API. */
export function BatchReport({ summary, failures }: { summary: string; failures: ReadonlyArray<{ id: string; message: string; code?: string }> }) {
  const t = useTranslations("v2Examinations.common");
  return (
    <Notice kind={failures.length > 0 ? "warning" : "success"}>
      <p>{summary}</p>
      {failures.length > 0 ? (
        <ul aria-label={t("failures")} className="mt-2 list-disc space-y-1 pl-5">
          {failures.slice(0, 20).map((f) => (
            <li key={f.id}>
              {f.message}
              {f.code ? <span className="ml-1 text-xs text-muted-foreground">({f.code})</span> : null}
            </li>
          ))}
          {failures.length > 20 ? <li>{t("moreFailures", { count: failures.length - 20 })}</li> : null}
        </ul>
      ) : null}
    </Notice>
  );
}

export const showAverage = (v: string | null): string => (v === null ? "—" : v.replace(".", ","));
