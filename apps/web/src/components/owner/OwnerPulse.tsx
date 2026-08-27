"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info, Loader2, RefreshCw } from "lucide-react";
import type { OwnerPulseKpi } from "@ecoledigitale/contracts";
import { useOwnerPulse } from "@/lib/hooks/use-owner-pulse";
import { formatFcfa, formatPct, VIZ_STATUS } from "@/components/owner/charts/palette";

/**
 * Le pouls de l'établissement : les chiffres qu'on regarde avant tout le reste,
 * groupés en deux lectures — l'argent, puis l'école.
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

/**
 * Regroupement des indicateurs en deux lectures.
 *
 * En une seule rangée, les tuiles se lisaient comme une liste : rien ne disait
 * que les premières répondent à « est-ce que l'argent rentre ? » et les
 * suivantes à « est-ce que l'école tourne ? ». Deux rangées titrées font ce
 * travail sans ajouter un pixel de chrome.
 *
 * Deux indicateurs ont été RETIRÉS sur décision métier :
 *  - « Taux de recouvrement » — le module professionnel ne fonctionne pas par
 *    échéancier, un taux y suppose un attendu échelonné qui n'existe pas ;
 *  - « Réussite du dernier semestre » — elle se lit sur l'écran Résultats, avec
 *    les décisions de jury et le poids du rattrapage qui l'expliquent.
 */
const GROUPES: Array<{ titre: string; keys: string[] }> = [
  {
    titre: "L'argent",
    keys: ["cash_collected_month", "outstanding", "operating_balance"],
  },
  {
    titre: "L'école",
    keys: ["headcount_active", "fill_rate", "presence_rate"],
  },
];

/**
 * Répartit les indicateurs reçus dans les groupes ci-dessus.
 *
 * Tout indicateur dont la clé n'est listée nulle part atterrit dans un groupe
 * « Autres indicateurs » plutôt que de disparaître : le jour où le serveur en
 * ajoute un neuvième, il s'affiche — mal rangé, mais visible. Un tableau de
 * bord qui perd un chiffre en silence est pire qu'un tableau de bord mal rangé.
 */
function grouper(kpis: OwnerPulseKpi[]): Array<{ titre: string; kpis: OwnerPulseKpi[] }> {
  const connues = new Set(GROUPES.flatMap((g) => g.keys));
  const groupes = GROUPES.map((g) => ({
    titre: g.titre,
    kpis: g.keys
      .map((k) => kpis.find((kpi) => kpi.key === k))
      .filter((k): k is OwnerPulseKpi => !!k),
  })).filter((g) => g.kpis.length > 0);

  const orphelins = kpis.filter((k) => !connues.has(k.key));
  if (orphelins.length > 0) {
    groupes.push({ titre: "Autres indicateurs", kpis: orphelins });
  }
  return groupes;
}

/**
 * Les chiffres de tête, en deux rangées titrées.
 *
 * Se monte uniquement sur le tableau de bord. Ils étaient auparavant répétés en
 * bandeau au-dessus des dix-sept écrans de l'espace : sur la page Assiduité,
 * des indicateurs financiers volaient un tiers de la hauteur utile à la seule
 * chose qu'on était venu regarder. Le tableau de bord est l'endroit où on les
 * cherche ; partout ailleurs, ils étaient du décor.
 *
 * Le composant refait son propre appel plutôt que de recevoir les données en
 * props : React Query partage la requête avec le `useOwnerPulse()` de la page,
 * qui en a besoin pour composer le PDF. Une seule requête réseau, aucun câblage.
 */
export function OwnerPulse({ anneeScolaire }: { anneeScolaire?: string }) {
  const { data, isLoading, isError, error, refetch, isFetching } =
    useOwnerPulse(anneeScolaire);

  // Squelette : le bloc garde sa hauteur, la page ne saute pas au chargement.
  if (isLoading) {
    return (
      <div className="space-y-5">
        {GROUPES.map((g) => (
          <div key={g.titre} className="space-y-2">
            <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {g.keys.map((k) => (
                <div key={k} className="h-[104px] animate-pulse rounded-lg border bg-muted/40" />
              ))}
            </div>
          </div>
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
    <section aria-label="Indicateurs de tête" className="space-y-5">
      {grouper(data.kpis).map((groupe) => (
        <div key={groupe.titre} className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {groupe.titre}
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {groupe.kpis.map((kpi) => (
              <KpiTile key={kpi.key} kpi={kpi} />
            ))}
          </div>
        </div>
      ))}

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

/** Valeur d'un indicateur, formatée comme à l'écran — réutilisée par le PDF. */
export { formatValue as formatPulseValue };
