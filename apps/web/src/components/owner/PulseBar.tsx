"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info, Loader2, RefreshCw } from "lucide-react";
import type { OwnerPulseKpi } from "@ecoledigitale/contracts";
import { useOwnerPulse } from "@/lib/hooks/use-owner-pulse";
import { formatFcfa, formatPct, VIZ_STATUS } from "@/components/owner/charts/palette";

/**
 * Barre haute persistante de l'espace propriétaire : les 8 chiffres qu'on
 * regarde avant tout le reste.
 *
 * Trois règles de lecture, héritées de la palette data-viz :
 *  - une couleur de statut est TOUJOURS doublée d'un libellé ;
 *  - un chiffre approximé porte son hypothèse (bulle « i »), jamais en silence ;
 *  - un indicateur non mesurable affiche « non mesuré », pas un zéro trompeur.
 */

const STATUS_LABEL: Record<OwnerPulseKpi["status"], string> = {
  good: "Dans la cible",
  warning: "À surveiller",
  critical: "À traiter",
  neutral: "Sans seuil",
};

const STATUS_COLOR: Record<OwnerPulseKpi["status"], string> = {
  good: VIZ_STATUS.good,
  warning: VIZ_STATUS.warning,
  critical: VIZ_STATUS.critical,
  neutral: "var(--viz-muted)",
};

function formatValue(kpi: OwnerPulseKpi): string {
  if (!kpi.measured) return "—";
  if (kpi.unit === "fcfa") return formatFcfa(kpi.value);
  if (kpi.unit === "percent") return formatPct(kpi.value);
  return new Intl.NumberFormat("fr-FR").format(kpi.value);
}

/**
 * Écart à la valeur de comparaison. En points pour un pourcentage, en pourcentage
 * pour un montant ou un effectif — comparer deux taux en « % de % » n'a pas de sens.
 */
function deltaText(kpi: OwnerPulseKpi): { text: string; direction: "up" | "down" | "flat" } | null {
  if (!kpi.measured || kpi.previousValue === null) return null;
  const diff = kpi.value - kpi.previousValue;
  if (Math.abs(diff) < 0.05) return { text: "stable", direction: "flat" };
  const direction = diff > 0 ? "up" : "down";
  if (kpi.unit === "percent") {
    return { text: `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} pt`, direction };
  }
  if (kpi.previousValue === 0) {
    return { text: diff > 0 ? "nouveau" : "en baisse", direction };
  }
  const pct = (100 * diff) / Math.abs(kpi.previousValue);
  return { text: `${diff > 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)} %`, direction };
}

function KpiTile({ kpi }: { kpi: OwnerPulseKpi }) {
  const [showHint, setShowHint] = useState(false);
  const delta = deltaText(kpi);
  const color = STATUS_COLOR[kpi.status];

  const body = (
    <div className="flex h-full flex-col gap-1.5 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{kpi.label}</span>
        <button
          type="button"
          aria-label={`Méthode de calcul : ${kpi.label}`}
          aria-expanded={showHint}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(e) => {
            // La tuile entière est un lien : on ne veut pas naviguer en ouvrant l'aide.
            e.preventDefault();
            e.stopPropagation();
            setShowHint((v) => !v);
          }}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="text-xl font-semibold tabular-nums leading-tight">{formatValue(kpi)}</div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1" style={{ color }}>
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          {kpi.measured ? STATUS_LABEL[kpi.status] : "Non mesuré"}
        </span>
        {delta && (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            {delta.direction === "up" ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : delta.direction === "down" ? (
              <ArrowDownRight className="h-3 w-3" />
            ) : (
              <ArrowRight className="h-3 w-3" />
            )}
            {delta.text} · {kpi.previousLabel}
          </span>
        )}
      </div>

      {kpi.detail && <p className="text-[11px] leading-snug text-muted-foreground">{kpi.detail}</p>}

      {showHint && (
        <p className="rounded bg-muted/60 p-2 text-[11px] leading-snug text-muted-foreground">
          {kpi.hint}
        </p>
      )}
    </div>
  );

  if (!kpi.href) return body;
  return (
    <Link
      href={kpi.href}
      className="block h-full rounded-lg outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring hover:shadow-sm"
      aria-label={`${kpi.label} : ${formatValue(kpi)}. ${STATUS_LABEL[kpi.status]}.`}
    >
      {body}
    </Link>
  );
}

export function PulseBar() {
  const { data, isLoading, isError, error, refetch, isFetching } = useOwnerPulse();

  // Squelette : le bloc garde sa hauteur, la page ne saute pas au chargement.
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <span>
          {error instanceof Error ? error.message : "Indicateurs de tête indisponibles."}
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 rounded border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Réessayer
        </button>
      </div>
    );
  }

  const computed = new Date(data.computedAt);

  return (
    <section aria-label="Indicateurs de tête" className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {data.kpis.map((kpi) => (
          <KpiTile key={kpi.key} kpi={kpi} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          Données au {computed.toLocaleDateString("fr-FR")} à{" "}
          {computed.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          {data.academicYearLabel ? ` · année ${data.academicYearLabel}` : ""}
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-60"
        >
          {isFetching ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Actualiser
        </button>
      </div>
    </section>
  );
}
