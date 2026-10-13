"use client";

/**
 * Briques communes des écrans de pilotage (`/v2/direction/*`, `/v2/owner/*`) : filtres de périmètre, bandeau de fraîcheur
 * (`asOf`, `stale`, manques), carte d'indicateur, export CSV de l'API, navigation de section, garde de fonctionnalité.
 *
 * AUCUN calcul de résultat ni de montant ici : les écrans affichent ce que l'API lit dans les read-models. Un indicateur sans
 * mesure s'affiche « Non mesuré » (jamais 0), l'état d'un indicateur est dit en toutes lettres (jamais la couleur seule).
 */

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Clock, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ANALYTICS_FEATURES, type AnalyticsExportDataset, type AnalyticsMeta, type AnalyticsReadingStatus, type AnalyticsScopeQuery } from "@ecoledigitale/contracts/v2/analytics";
import { useFeature, usePermission } from "@/platform/access";
import { useAnalyticsExport, useAnalyticsScopes } from "@/platform/v2/analytics";
import { downloadText } from "@/platform/ui/csv";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";

/**
 * Bandeau « règles de démonstration » : tant qu'une période lue repose sur un jeu de règles fictif (`placeholder`), les moyennes,
 * taux de validation et décisions affichés ne sont PAS officiels. Une provenance illisible est dite aussi, jamais présumée officielle.
 */
export function DemoRulesBanner({ rulesSource }: { rulesSource: { demonstration: boolean; unknownClassPeriods?: number } | undefined }) {
  const t = useTranslations("v2Owner.demo");
  if (!rulesSource) return null;
  return (
    <>
      {rulesSource.demonstration ? (
        <Notice kind="warning">
          <p className="font-medium">{t("title")}</p>
          <p className="mt-1">{t("body")}</p>
        </Notice>
      ) : null}
      {!rulesSource.demonstration && (rulesSource.unknownClassPeriods ?? 0) > 0 ? <Notice kind="info">{t("unknown")}</Notice> : null}
    </>
  );
}

/** La fonctionnalité vendable `analytics.direction` : message explicite quand l'offre ne l'inclut pas. */
export function FeatureGuard({ children, feature = ANALYTICS_FEATURES.direction }: { children: ReactNode; feature?: string }) {
  const t = useTranslations("v2Owner.common");
  const { allowed, isLoading, isUnavailable } = useFeature(feature);
  if (isLoading) return <LoadingBlock />;
  if (!allowed) return <Notice kind="info">{isUnavailable ? t("featureUnknown") : t("featureMissing")}</Notice>;
  return <>{children}</>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Filtres de périmètre
// ---------------------------------------------------------------------------------------------------------------------

export interface ScopeValue {
  institutionId: string;
  campusId: string;
  yearId: string;
  periodId: string;
  classroomId: string;
}

export const EMPTY_SCOPE: ScopeValue = { institutionId: "", campusId: "", yearId: "", periodId: "", classroomId: "" };

export type ScopeField = "institution" | "campus" | "year" | "period" | "classroom";

/** Filtres de l'API : les valeurs vides ne sont pas envoyées (année et période par défaut décidées par l'API). */
export function scopeFilters(v: ScopeValue, fields: readonly ScopeField[]): Partial<AnalyticsScopeQuery> {
  return {
    ...(fields.includes("institution") && v.institutionId ? { institutionId: v.institutionId } : {}),
    ...(fields.includes("campus") && v.campusId ? { campusId: v.campusId } : {}),
    ...(fields.includes("year") && v.yearId ? { yearId: v.yearId } : {}),
    ...(fields.includes("period") && v.periodId ? { periodId: v.periodId } : {}),
    ...(fields.includes("classroom") && v.classroomId ? { classroomId: v.classroomId } : {}),
  };
}

export function useScopeState(initial: ScopeValue = EMPTY_SCOPE) {
  return useState<ScopeValue>(initial);
}

export function ScopeFilters({ value, onChange, fields }: { value: ScopeValue; onChange: (value: ScopeValue) => void; fields: readonly ScopeField[] }) {
  const t = useTranslations("v2Owner.filters");
  const scopes = useAnalyticsScopes();
  const data = scopes.data?.data;
  const yearId = value.yearId || data?.defaultYearId || "";
  const institutions = data?.institutions ?? [];
  const campuses = useMemo(() => (data?.campuses ?? []).filter((c) => !value.institutionId || c.institutionId === value.institutionId), [data, value.institutionId]);
  const periods = useMemo(() => (data?.periods ?? []).filter((p) => p.yearId === yearId), [data, yearId]);
  const classrooms = useMemo(
    () => (data?.classrooms ?? []).filter((c) => c.yearId === yearId && (!value.institutionId || c.institutionId === value.institutionId) && (!value.campusId || c.campusId === value.campusId)),
    [data, yearId, value.institutionId, value.campusId],
  );
  const set = (patch: Partial<ScopeValue>) => onChange({ ...value, ...patch });
  return (
    <form className="grid gap-3 rounded-2xl border border-white/10 bg-card/40 p-4 [grid-template-columns:repeat(auto-fit,minmax(12rem,18rem))]" noValidate onSubmit={(e) => e.preventDefault()} aria-label={t("label")}>
      {fields.includes("institution") && institutions.length > 1 ? (
        <FormField label={t("institution")}>
          {(c) => <NativeSelect {...c} value={value.institutionId} onChange={(v) => set({ institutionId: v, campusId: "", classroomId: "" })} placeholder={t("allInstitutions")} options={institutions.map((i) => ({ value: i.id, label: i.label }))} />}
        </FormField>
      ) : null}
      {fields.includes("campus") && campuses.length > 1 ? (
        <FormField label={t("campus")}>
          {(c) => <NativeSelect {...c} value={value.campusId} onChange={(v) => set({ campusId: v, classroomId: "" })} placeholder={t("allCampuses")} options={campuses.map((i) => ({ value: i.id, label: i.label }))} />}
        </FormField>
      ) : null}
      {fields.includes("year") ? (
        <FormField label={t("year")}>
          {(c) => <NativeSelect {...c} value={value.yearId} onChange={(v) => set({ yearId: v, periodId: "", classroomId: "" })} placeholder={t("currentYear")} options={(data?.years ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
        </FormField>
      ) : null}
      {fields.includes("period") ? (
        <FormField label={t("period")} hint={t("periodHint")}>
          {(c) => <NativeSelect {...c} value={value.periodId} onChange={(v) => set({ periodId: v })} placeholder={t("latestPeriod")} options={periods.map((p) => ({ value: p.id, label: p.label }))} />}
        </FormField>
      ) : null}
      {fields.includes("classroom") ? (
        <FormField label={t("classroom")}>
          {(c) => <NativeSelect {...c} value={value.classroomId} onChange={(v) => set({ classroomId: v })} placeholder={t("allClassrooms")} options={classrooms.map((i) => ({ value: i.id, label: i.name }))} />}
        </FormField>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Fraîcheur et manques
// ---------------------------------------------------------------------------------------------------------------------

/** « Données au … », alerte de péremption et manques déclarés de la réponse (jamais un zéro à la place d'une source absente). */
export function FreshnessBar({ meta }: { meta: AnalyticsMeta | undefined }) {
  const t = useTranslations("v2Owner.freshness");
  const date = useDateFormat();
  if (!meta) return null;
  return (
    <div className="space-y-2" data-testid="freshness">
      <p className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {meta.asOf ? t("asOf", { date: date.instant(meta.asOf) }) : t("never")}
      </p>
      {meta.stale && meta.asOf ? <Notice kind="warning">{t("stale")}</Notice> : null}
      {meta.gaps.length > 0 ? (
        <Notice kind="warning">
          <p className="font-medium">{t("gapsTitle")}</p>
          <ul className="mt-1 list-disc pl-5">
            {meta.gaps.map((g) => (
              <li key={`${g.source}-${g.reason}`}>{g.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------------------------------------------------

const TONE: Record<AnalyticsReadingStatus, Tone> = { good: "success", warning: "warning", critical: "danger", neutral: "neutral" };

export function StatusLabel({ status }: { status: AnalyticsReadingStatus }) {
  const t = useTranslations("v2Owner.status");
  return <StatusBadge label={t(status)} tone={TONE[status]} />;
}

const ACCENT: Record<AnalyticsReadingStatus, string> = { good: "bg-emerald-400", warning: "bg-amber-400", critical: "bg-red-400", neutral: "bg-transparent" };

/** Carte d'indicateur : valeur, détail, état en texte ; « Non mesuré » quand la source n'a rien mesuré. */
export function KpiCard({ label, value, detail, status, measured = true, icon: Icon }: { label: string; value: ReactNode; detail?: ReactNode; status?: AnalyticsReadingStatus; measured?: boolean; icon?: LucideIcon }) {
  const t = useTranslations("v2Owner.common");
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-card/60 p-4 shadow-sm transition-colors hover:border-violet-400/30">
      {measured && status ? <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-0.5 ${ACCENT[status]}`} /> : null}
      {Icon ? (
        <span aria-hidden="true" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      ) : null}
      <dt className={`text-sm font-medium leading-snug text-muted-foreground ${Icon ? "pr-12" : ""}`}>{label}</dt>
      <dd className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{measured ? value : <span className="text-base font-medium text-muted-foreground">{t("notMeasured")}</span>}</dd>
      {measured && detail ? <dd className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{detail}</dd> : null}
      {measured && status ? (
        <dd className="mt-3">
          <StatusLabel status={status} />
        </dd>
      ) : null}
    </div>
  );
}

export function KpiGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label}>
      <dl className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">{children}</dl>
    </section>
  );
}

export function Section({ id, title, actions, icon: Icon, children }: { id: string; title: string; actions?: ReactNode; icon?: LucideIcon; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
        <h2 id={`${id}-title`} className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          {Icon ? (
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
              <Icon className="h-4 w-4" />
            </span>
          ) : (
            <span aria-hidden="true" className="h-5 w-1 rounded-full bg-[var(--brand-primary,#8b5cf6)]" />
          )}
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Lien « voir le détail » d'un bloc : discret, avec flèche (remplace un bouton plein). */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-violet-300 transition-colors hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Export CSV produit par l'API
// ---------------------------------------------------------------------------------------------------------------------

/** `fetch().text()` retire le BOM UTF-8 envoyé par l'API : on le remet pour qu'Excel (fr) lise les accents. */
const withBom = (csv: string): string => (csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`);

/** Bouton d'export : le fichier est celui de l'API (audité, BOM, `;`) ; masqué sans `analytics.export`. */
export function ExportButton({ dataset, query, label }: { dataset: AnalyticsExportDataset; query?: Record<string, string | number | boolean | undefined>; label?: string }) {
  const t = useTranslations("v2Owner.common");
  const allowed = usePermission("analytics.export");
  const exporter = useAnalyticsExport();
  if (!allowed.allowed) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={buttonClass.secondary}
        disabled={exporter.isPending}
        onClick={() => exporter.mutate({ dataset, query: query ?? {} }, { onSuccess: (csv) => downloadText(`analytics-${dataset}.csv`, withBom(csv)) })}
      >
        {exporter.isPending ? t("exporting") : (label ?? t("export"))}
      </button>
      {exporter.isError ? (
        <span role="alert" className="text-xs text-destructive">
          {t("exportFailed")}
        </span>
      ) : null}
    </div>
  );
}
