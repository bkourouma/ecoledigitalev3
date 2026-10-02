"use client";

/**
 * Briques communes des écrans de pilotage (`/v2/direction/*`, `/v2/owner/*`) : filtres de périmètre, bandeau de fraîcheur
 * (`asOf`, `stale`, manques), carte d'indicateur, export CSV de l'API, navigation de section, garde de fonctionnalité.
 *
 * AUCUN calcul de résultat ni de montant ici : les écrans affichent ce que l'API lit dans les read-models. Un indicateur sans
 * mesure s'affiche « Non mesuré » (jamais 0), l'état d'un indicateur est dit en toutes lettres (jamais la couleur seule).
 */

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ANALYTICS_FEATURES, type AnalyticsExportDataset, type AnalyticsMeta, type AnalyticsReadingStatus, type AnalyticsScopeQuery } from "@ecoledigitale/contracts/v2/analytics";
import { useFeature, usePermission } from "@/platform/access";
import { useAnalyticsExport, useAnalyticsScopes } from "@/platform/v2/analytics";
import { downloadText } from "@/platform/ui/csv";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { SectionNav, type SectionNavItem } from "@/platform/ui/SectionNav";
import { LoadingBlock, Notice } from "@/platform/ui/states";

// ---------------------------------------------------------------------------------------------------------------------
// Navigation de section
// ---------------------------------------------------------------------------------------------------------------------

export function AnalyticsNav() {
  const t = useTranslations("v2Owner.nav");
  const items: SectionNavItem[] = [
    { href: "/v2/direction", label: t("dashboard"), permission: "analytics.read", exact: true },
    { href: "/v2/direction/effectifs", label: t("enrollment"), permission: "analytics.read" },
    { href: "/v2/owner/pedagogie", label: t("pedagogy"), permission: "analytics.pedagogy.read" },
    { href: "/v2/owner/scolarite", label: t("tuition"), permission: "analytics.finance.read" },
    { href: "/v2/owner/tresorerie", label: t("treasury"), permission: "analytics.treasury.read" },
    { href: "/v2/owner/paie", label: t("payroll"), permission: "analytics.payroll.read" },
    { href: "/v2/owner/charges", label: t("charges"), permission: "analytics.charges.read" },
    { href: "/v2/owner", label: t("freshness"), permission: "analytics.read", exact: true },
  ];
  return <SectionNav label={t("label")} items={items} />;
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
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" noValidate onSubmit={(e) => e.preventDefault()} aria-label={t("label")}>
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
      <p className="text-sm text-muted-foreground">{meta.asOf ? t("asOf", { date: date.instant(meta.asOf) }) : t("never")}</p>
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

/** Carte d'indicateur : valeur, détail, état en texte ; « Non mesuré » quand la source n'a rien mesuré. */
export function KpiCard({ label, value, detail, status, measured = true }: { label: string; value: ReactNode; detail?: ReactNode; status?: AnalyticsReadingStatus; measured?: boolean }) {
  const t = useTranslations("v2Owner.common");
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{measured ? value : <span className="text-base font-medium text-muted-foreground">{t("notMeasured")}</span>}</dd>
      {measured && detail ? <dd className="mt-1 text-xs text-muted-foreground">{detail}</dd> : null}
      {measured && status ? (
        <dd className="mt-2">
          <StatusLabel status={status} />
        </dd>
      ) : null}
    </div>
  );
}

export function KpiGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label}>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>
    </section>
  );
}

export function Section({ id, title, actions, children }: { id: string; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
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
