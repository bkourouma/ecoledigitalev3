"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, ArrowRight, BarChart3, CheckCircle2, Clock, FileBadge, Gavel, Lock, MinusCircle, Settings, XCircle, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ResponsiveTable, type Column } from "@ecoledigitale/ui";
import type { PrimaryProgressDto } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, QueryBoundary } from "@/platform/ui/states";
import { useMyPrimaryClassrooms, usePrimaryProgress } from "@/platform/v2/primary";
import { lightOf, type Light } from "./direction-model";
import { FeatureGate, RuleBanner, useYearOptions } from "./shared";

const LIGHT_STYLE: Record<Light, string> = {
  green: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  orange: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  red: "border-red-400/40 bg-red-400/10 text-red-300",
  none: "border-white/10 bg-white/5 text-muted-foreground",
};

function LightIcon({ light }: { light: Light }) {
  const cls = "h-4 w-4 shrink-0";
  if (light === "green") return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (light === "red") return <XCircle className={cls} aria-hidden="true" />;
  if (light === "orange") return <Clock className={cls} aria-hidden="true" />;
  return <MinusCircle className={cls} aria-hidden="true" />;
}

/** Avancement des classes (direction) : feux vert / orange / rouge portés par un TEXTE et une icône, jamais par la couleur seule. */
export function DirectionScreen() {
  return (
    <FeatureGate feature="primary.reports">
      <DirectionBody />
    </FeatureGate>
  );
}

function DirectionBody() {
  const t = useTranslations("v2PrimaryDirection");
  const classes = useMyPrimaryClassrooms();
  const years = useYearOptions(classes.data ?? []);
  const [yearId, setYearId] = useState("");
  const progress = usePrimaryProgress(yearId || null);
  const council = usePermission("primary.council.manage").allowed;
  const bilans = usePermission("primary.bilan.read").allowed;
  const archives = usePermission("primary.archive.prepare").allowed;
  const reports = usePermission("primary.report.read").allowed;
  const settings = usePermission("primary.settings.manage").allowed;

  const periodLabel = (item: PrimaryProgressDto) => classes.data?.find((c) => c.classroomId === item.classroomId)?.periods.find((p) => p.id === item.periodId)?.label ?? item.periodId.slice(0, 8);

  const columns: Column<PrimaryProgressDto>[] = [
    { key: "class", header: t("columns.class"), label: t("columns.class"), cell: (r) => <span className="font-medium">{r.name ?? r.classroomId.slice(0, 8)}</span> },
    { key: "period", header: t("columns.period"), label: t("columns.period"), cell: (r) => periodLabel(r) },
    {
      key: "light",
      header: t("columns.status"),
      label: t("columns.status"),
      cell: (r) => {
        const v = lightOf(r);
        return (
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${LIGHT_STYLE[v.light]}`} data-light={v.light}>
            <LightIcon light={v.light} />
            {t(`light.${v.reason}`)}
          </span>
        );
      },
    },
    { key: "students", header: t("columns.students"), label: t("columns.students"), cell: (r) => r.studentCount, hideOnMobile: true },
    { key: "entered", header: t("columns.entered"), label: t("columns.entered"), cell: (r) => t("fraction", { a: r.competencies.recorded, b: r.competencies.expected }) },
    { key: "validated", header: t("columns.validated"), label: t("columns.validated"), cell: (r) => t("fraction", { a: r.competencies.validated, b: r.competencies.expected }) },
    { key: "reviews", header: t("columns.reviews"), label: t("columns.reviews"), cell: (r) => t("fraction", { a: r.reviews.sealed, b: r.reviews.total }) },
    {
      key: "locked",
      header: t("columns.locked"),
      label: t("columns.locked"),
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          {r.locked ? <Lock className="h-4 w-4" aria-hidden="true" /> : null}
          {r.locked ? t("locked") : t("open")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <RuleBanner />
      <nav aria-label={t("links.label")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {council ? <Shortcut href="/v2/primary/conseil" icon={Gavel} label={t("links.council")} /> : null}
        {bilans ? <Shortcut href="/v2/primary/bilans" icon={FileBadge} label={t("links.reviews")} /> : null}
        {archives ? <Shortcut href="/v2/primary/archives" icon={Archive} label={t("links.archives")} /> : null}
        {reports ? <Shortcut href="/v2/primary/etats" icon={BarChart3} label={t("links.reports")} /> : null}
        {settings ? <Shortcut href="/v2/primary/parametres" icon={Settings} label={t("links.settings")} /> : null}
      </nav>
      <div className="max-w-sm">
        <FormField label={t("year")}>{(c) => <NativeSelect {...c} value={yearId} onChange={setYearId} placeholder={t("yearDefault")} options={years} />}</FormField>
      </div>
      <p className="text-xs text-muted-foreground">{t("rule")}</p>
      <QueryBoundary query={progress} isEmpty={(progress.data ?? []).length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        <ResponsiveTable columns={columns} rows={progress.data ?? []} rowKey={(r) => `${r.classroomId}-${r.periodId}`} caption={t("caption")} />
      </QueryBoundary>
    </div>
  );
}

/** Raccourci vers un autre écran du pack : carte avec icône et flèche. */
function Shortcut({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 bg-card/40 px-4 py-3 text-sm font-medium transition-colors hover:border-violet-400/40 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
    </Link>
  );
}
