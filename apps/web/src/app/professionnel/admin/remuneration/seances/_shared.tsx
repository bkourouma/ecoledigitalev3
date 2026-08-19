"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@ecoledigitale/ui";
import { ChevronDown, HelpCircle } from "lucide-react";
import type { SeancePaie, SeanceStatut, SeanceFilters } from "@/lib/hooks/use-professional-remuneration";
import { useProfessionalUeSessionsList } from "@/lib/hooks/use-professional-catalog-admin";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Pièces de l'écran de validation des séances — feature 031, US1.
 *
 * `/seances` est un PLAN DE TRAVAIL (`validated=false`) : il ne montre que ce
 * qui reste à décider. Les séances déjà validées y noyaient les quelques lignes
 * à traiter sous des mois d'historique.
 *
 * Le découpage est porté par la REQUÊTE, pas par un tri côté client : la liste
 * est paginée, et filtrer après coup donnerait des compteurs faux.
 *
 * Ce fichier ne porte AUCUNE règle de paie. Le prédicat de payabilité vit à un
 * seul endroit, côté API (`SEANCE_PAYABLE_PREDICATE`) ; l'écran se contente de
 * lire `payable` et `blockers` tels que le serveur les renvoie.
 */

/* ========================= Libellés et formats ======================== */

export const STATUT_LABELS: Record<SeanceStatut, string> = {
  planifiee: "Planifiée",
  realisee: "Réalisée",
  annulee: "Annulée",
};

/**
 * Teintes translucides plutôt que des fonds clairs codés en dur : l'application
 * est en thème sombre par défaut, et un `bg-slate-100` y devient une pastille
 * blanche avec du texte quasi invisible.
 */
export const STATUT_STYLES: Record<SeanceStatut, string> = {
  planifiee: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  realisee: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  annulee: "bg-red-500/15 text-red-400 border-red-500/30",
};

/** 2.5 → « 2h30 » ; 2 → « 2h ». */
export function fmtHeures(h: number | null | undefined): string {
  if (h == null) return "—";
  const heures = Math.floor(h);
  const minutes = Math.round((h - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
}

/**
 * Format numérique compact. « 03 juil. 2026 » coûtait ~60 px de plus par ligne,
 * assez pour repousser la dernière colonne hors de l'écran.
 */
export function fmtDate(d: string): string {
  const parsed = new Date(`${d}T00:00:00`);
  return isNaN(parsed.getTime())
    ? d
    : parsed.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Une séance déjà payée ne peut plus être dévalidée : sa case est verrouillée. */
export function isLocked(s: SeancePaie): boolean {
  return Boolean(s.paiement_statut && ["approved", "paid"].includes(s.paiement_statut));
}

/* ============================ Indicateurs ============================= */

/** Une carte de compteur. Le jeu de cartes diffère d'une page à l'autre. */
export type Indicateur = {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
};

export function StatCard({ label, value, hint, icon }: Indicateur) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-indigo-500">{icon}</span>
        </div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/* ============================== Filtres =============================== */

/**
 * Filtres de l'écran. Réduits à l'enseignant : c'est un plan de travail, on
 * l'ouvre pour traiter une personne. Les filtres temporels, de session et de
 * payabilité ont été retirés au fil des passes — l'API les accepte toujours,
 * mais plus rien ne les renseigne.
 */
export type FiltresSeances = {
  enseignantId: string;
};

export const FILTRES_VIDES: FiltresSeances = {
  enseignantId: "",
};

/**
 * Traduit l'état des filtres en requête API.
 *
 * `validated` n'est pas un filtre de l'utilisateur, c'est l'identité de la page.
 */
export function versSeanceFilters(v: FiltresSeances, validated: boolean): SeanceFilters {
  return {
    enseignantId: v.enseignantId || undefined,
    validated,
    limit: 200,
  };
}

/** Liste des enseignants — sert au filtre, pas seulement au formulaire d'ajout. */
export function useEnseignants() {
  const [teachers, setTeachers] = useState<Array<{ id: string; nom: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/teachers", { headers: createApiHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        setTeachers(
          (j?.data ?? []).map((t: any) => ({
            id: t.id,
            nom: `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || t.email || "Enseignant",
          }))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return teachers;
}

export function useCohortes() {
  const query = useProfessionalUeSessionsList({ pageSize: 500 });
  const cohortes: any[] = (query.data?.items ?? query.data ?? []) as any[];
  return { cohortes, isLoading: query.isLoading };
}

/* ============================ Aide statuts ============================ */

/**
 * Ce que veut dire chaque statut, et ce qu'il fait à la paie.
 *
 * La confusion que cet écran doit éviter : le `statut` constate un FAIT
 * pédagogique (le cours a-t-il eu lieu ?), la validation est un ACTE DE GESTION
 * (« cette séance est payable »). « Réalisée » ne paie rien à elle seule — c'est
 * la question que pose systématiquement le gestionnaire devant la colonne.
 *
 * Repliée par défaut : l'information est décisive la première fois, du bruit
 * les suivantes.
 */
export function AideStatuts() {
  const [ouvert, setOuvert] = useState(false);

  const lignes: Array<{ statut: SeanceStatut; quoi: string; paie: string }> = [
    {
      statut: "planifiee",
      quoi: "Le cours est au programme, on ne sait pas encore s'il a eu lieu. C'est la valeur par défaut à la création.",
      paie: "Jamais payée en l'état, mais bien listée ici : c'est souvent le statut d'une séance dont l'appel vient d'être fait. Passez-la en « Réalisée » pour pouvoir la valider.",
    },
    {
      statut: "realisee",
      quoi: "Le cours a bien eu lieu. C'est un constat pédagogique, pas un engagement de dépense.",
      paie: "Nécessaire pour être payée, mais pas suffisant : il faut encore la valider.",
    },
    {
      statut: "annulee",
      quoi: "Le cours n'a pas eu lieu.",
      paie: "Jamais payée. Le passage à « Annulée » est refusé si la séance est déjà dans un paiement approuvé ou payé.",
    },
  ];

  return (
    <div className="rounded-lg border border-input bg-muted/30">
      <button
        onClick={() => setOuvert((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-foreground"
      >
        <HelpCircle className="h-4 w-4 text-indigo-400 shrink-0" />
        Que signifient les statuts « Planifiée », « Réalisée » et « Annulée » ?
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground ml-auto shrink-0 transition-transform ${
            ouvert ? "rotate-180" : ""
          }`}
        />
      </button>

      {ouvert && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {lignes.map((l) => (
            <div key={l.statut} className="flex flex-col sm:flex-row sm:items-start gap-2">
              <span
                className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium sm:w-24 ${STATUT_STYLES[l.statut]}`}
              >
                {STATUT_LABELS[l.statut]}
              </span>
              <div className="text-sm min-w-0">
                <p className="text-foreground">{l.quoi}</p>
                <p className="text-muted-foreground">{l.paie}</p>
              </div>
            </div>
          ))}

          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <p className="font-medium">Statut et validation sont deux choses distinctes.</p>
            <p className="mt-1">
              Une séance n'est payée que si elle est <strong>Réalisée</strong> ET{" "}
              <strong>validée</strong>, avec un enseignant et une durée connue. Faire sortir une
              séance de « Réalisée » <strong>efface sa validation</strong> : la remettre à
              « Réalisée » ne la revalide pas, il faut la valider de nouveau.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export const TAILLES_PAGE = [10, 20, 50] as const;

/**
 * Pagination serveur : elle pilote `limit`/`offset`, elle ne redécoupe pas une
 * liste déjà chargée. Sur un plan de travail qui peut compter des centaines de
 * séances, tout charger pour n'en montrer dix serait payer la requête complète
 * à chaque page.
 */
export function PaginationTableau({
  page,
  taillePage,
  total,
  affichees,
  onPage,
  onTaillePage,
}: {
  page: number;
  taillePage: number;
  total: number;
  affichees: number;
  onPage: (p: number) => void;
  onTaillePage: (t: number) => void;
}) {
  const nbPages = Math.max(1, Math.ceil(total / taillePage));
  const premier = total === 0 ? 0 : page * taillePage + 1;
  const dernier = page * taillePage + affichees;

  const bouton =
    "rounded-md border border-input px-2.5 py-1 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted/60";

  return (
    <div className="border-t border-border px-3 py-2 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Afficher</span>
        <select
          value={taillePage}
          onChange={(e) => onTaillePage(Number(e.target.value))}
          className="rounded-md border border-input bg-background text-foreground px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {TAILLES_PAGE.map((t) => (
            <option key={t} value={t} className="bg-background text-foreground">
              {t}
            </option>
          ))}
        </select>
        <span>par page</span>
      </div>

      <div className="text-sm text-muted-foreground">
        {total === 0 ? "Aucune séance" : `${premier}–${dernier} sur ${total}`}
      </div>

      <div className="flex items-center gap-1">
        <button onClick={() => onPage(0)} disabled={page === 0} className={bouton}>
          «
        </button>
        <button onClick={() => onPage(page - 1)} disabled={page === 0} className={bouton}>
          Précédent
        </button>
        <span className="px-2 text-sm text-muted-foreground">
          Page {page + 1} / {nbPages}
        </span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page + 1 >= nbPages}
          className={bouton}
        >
          Suivant
        </button>
        <button
          onClick={() => onPage(nbPages - 1)}
          disabled={page + 1 >= nbPages}
          className={bouton}
        >
          »
        </button>
      </div>
    </div>
  );
}
