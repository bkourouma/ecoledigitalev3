"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  History,
  Loader2,
  CalendarRange,
  UserRound,
  Wallet,
} from "lucide-react";
import {
  useEnseignantsPaie,
  useHistoriqueBulletins,
  type BulletinArchive,
} from "@/lib/hooks/use-professional-remuneration";
import { SearchableSelect } from "@/components/SearchableSelect";

/**
 * Historique des bulletins de paie archivés — feature 031.
 *
 * Un bulletin n'arrive ici qu'une fois ARCHIVÉ. Tant qu'il reste au plan de
 * travail (écran « Bulletins de paie »), il est encore en cours de traitement :
 * le mélanger à l'historique empêcherait de distinguer ce qui reste à faire de
 * ce qui est classé.
 *
 * L'archivage ne libère aucune heure : les heures consommées restent
 * rattachées au bulletin, donc décomptées. Classer n'est pas annuler.
 */

const PAGE_SIZES = [10, 20, 50];

const STATUT_LABELS: Record<string, string> = {
  calculated: "Calculé",
  approved: "Approuvé",
  paid: "Payé",
  disputed: "Contesté",
  cancelled: "Annulé",
};

const STATUT_STYLES: Record<string, string> = {
  calculated: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paid: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  disputed: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
};

const TYPE_LABELS: Record<string, string> = {
  salary: "Salaire fixe",
  hourly: "Taux horaire",
  mixed: "Mixte",
};

const fmtMontant = (v: number, devise: string): string =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v || 0))} ${devise}`;

const fmtDate = (d: string | null): string => {
  if (!d) return "—";
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("fr-FR");
};

const fmtHorodatage = (d: string | null): string | undefined => {
  if (!d) return undefined;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleString("fr-FR");
};

/**
 * Année scolaire d'un bulletin.
 *
 * La source de vérité est `payment_periods.academic_year_id`, remontée par
 * l'API dans `annee_scolaire`. La déduction par date ne sert que de repli pour
 * une période qui ne serait rattachée à aucune année : l'année démarre en
 * septembre (2025-2026 = 2025-09-01 → 2026-06-30), juillet et août appartenant
 * donc à l'année qui vient de s'achever.
 */
const anneeScolaire = (b: BulletinArchive): string | null => {
  if (b.annee_scolaire) return b.annee_scolaire;
  const debut = b.periode_debut;
  if (!debut) return null;
  const d = new Date(debut.length <= 10 ? `${debut}T00:00:00` : debut);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
};

const fmtHeures = (v: number | null): string => {
  const n = Number(v ?? 0);
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h} h`;
};

export default function HistoriqueBulletinsPage() {
  return (
    // `useSearchParams` impose une frontière de suspense au build Next.
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      }
    >
      <Contenu />
    </Suspense>
  );
}

function Contenu() {
  const params = useSearchParams();
  // Pré-sélection depuis la carte d'un enseignant : arriver ici déjà filtré
  // évite de rechercher la personne qu'on vient de quitter.
  const [enseignantId, setEnseignantId] = useState(params.get("enseignantId") ?? "");
  const [annee, setAnnee] = useState("");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const enseignantsQuery = useEnseignantsPaie();
  const query = useHistoriqueBulletins(enseignantId || undefined);

  const items = query.data?.items ?? [];
  const enseignants = enseignantsQuery.data?.items ?? [];

  // Années réellement représentées dans les bulletins chargés.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of items) {
      const a = anneeScolaire(b);
      if (a) set.add(a);
    }
    return Array.from(set)
      .sort()
      .reverse()
      .map((a) => ({ value: a, label: a }));
  }, [items]);

  // Changer d'enseignant peut faire disparaître l'année choisie : on retombe
  // alors sur « toutes », plutôt que de filtrer sur une valeur devenue absente.
  const anneeActive = anneeOptions.some((o) => o.value === annee) ? annee : "";

  const filtres = useMemo(
    () =>
      anneeActive ? items.filter((b) => anneeScolaire(b) === anneeActive) : items,
    [items, anneeActive]
  );

  const stats = useMemo(
    () => ({
      total: filtres.length,
      montant: filtres.reduce((s, b) => s + (b.montant ?? 0), 0),
      devise: filtres[0]?.devise ?? "XOF",
    }),
    [filtres]
  );

  // Pagination client : l'historique est déjà chargé en entier.
  const totalPages = Math.max(1, Math.ceil(filtres.length / pageSize));
  // Borne la page courante : changer de filtre peut la rendre caduque.
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * pageSize;
  const pageItems = useMemo(
    () => filtres.slice(firstIndex, firstIndex + pageSize),
    [filtres, firstIndex, pageSize]
  );

  // Changer d'enseignant ou de taille de page ramène en tête de liste.
  function changeEnseignant(value: string) {
    setEnseignantId(value);
    setPage(1);
  }

  function changeAnnee(value: string) {
    setAnnee(value);
    setPage(1);
  }

  function changePageSize(value: string) {
    setPageSize(Number(value));
    setPage(1);
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-6">
      {/* Plus de lien « Retour » : cet écran est une entrée de menu à part
          entière, pas une sous-page des bulletins. */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
          <History className="h-7 w-7 text-indigo-500" />
          Historique des paiements
        </h1>
        <p className="text-muted-foreground mt-2">
          Toutes les générations archivées, la plus récente en premier. Un bulletin n'apparaît ici
          qu'une fois archivé depuis l'écran des bulletins.
        </p>
      </div>

      {/* Filtre */}
      <Card className="shadow-sm">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Enseignant</span>
            <SearchableSelect
              value={enseignantId}
              onChange={changeEnseignant}
              icon={<UserRound className="h-4 w-4 text-muted-foreground" />}
              placeholder="Tous les enseignants"
              searchPlaceholder="Rechercher un enseignant…"
              options={[
                { value: "", label: "Tous les enseignants" },
                ...enseignants
                  .filter((e) => e.nb_bulletins_archives > 0)
                  .map((e) => ({
                    value: e.id,
                    label: `${e.nom} (${e.nb_bulletins_archives})`,
                  })),
              ]}
            />
            <span className="text-xs text-muted-foreground">
              Seuls les enseignants ayant au moins un bulletin archivé sont proposés.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Année scolaire</span>
            <SearchableSelect
              value={anneeActive}
              onChange={changeAnnee}
              icon={<CalendarRange className="h-4 w-4 text-muted-foreground" />}
              placeholder="Toutes les années"
              searchPlaceholder="Rechercher une année…"
              options={[{ value: "", label: "Toutes les années" }, ...anneeOptions]}
            />
            <span className="text-xs text-muted-foreground">
              Année rattachée à la période de paie du bulletin.
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Indicateurs du périmètre affiché */}
      <div className="grid grid-cols-2 gap-4">
        <Carte
          label="Bulletins archivés"
          valeur={String(stats.total)}
          icone={<FileText className="h-5 w-5" />}
        />
        <Carte
          label="Montant cumulé"
          valeur={fmtMontant(stats.montant, stats.devise)}
          hint={enseignantId ? "pour cet enseignant" : "tous enseignants"}
          icone={<Wallet className="h-5 w-5" />}
        />
      </div>

      {/* Liste */}
      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : query.isError ? (
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 py-8 text-red-400">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(query.error as Error)?.message ?? "Impossible de charger l'historique."}</p>
          </CardContent>
        </Card>
      ) : filtres.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {items.length > 0
              ? "Aucun bulletin archivé ne correspond à ces filtres."
              : enseignantId
              ? "Aucun bulletin archivé pour cet enseignant."
              : "Aucun bulletin archivé pour l'instant. Générez puis archivez depuis l'écran des bulletins."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pageItems.map((b) => (
            <LigneBulletin key={b.id} bulletin={b} avecNom={!enseignantId} />
          ))}

          <Card>
            <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Lignes par page</span>
                <Select value={String(pageSize)} onValueChange={changePageSize}>
                  <SelectTrigger className="h-8 w-[4.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>
                  {firstIndex + 1}–{firstIndex + pageItems.length} sur {filtres.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Précédent
                </Button>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  Page {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Suivant
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function LigneBulletin({ bulletin: b, avecNom }: { bulletin: BulletinArchive; avecNom: boolean }) {
  const heures = Number(b.heures_normales ?? 0) + Number(b.heures_sup ?? 0);

  return (
    <Card>
      <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="lg:w-56 shrink-0">
          {avecNom && (
            <div className="font-semibold break-words">{b.enseignant_nom ?? "Enseignant"}</div>
          )}
          <div className="text-sm text-muted-foreground">{b.periode_nom}</div>
          <div className="text-xs text-muted-foreground">
            {fmtDate(b.periode_debut)} → {fmtDate(b.periode_fin)}
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 min-w-0">
          <Donnee label="Montant" valeur={fmtMontant(b.montant, b.devise)} fort />
          <Donnee
            label="Rémunération"
            valeur={TYPE_LABELS[b.type_paiement] ?? b.type_paiement}
          />
          <Donnee
            label="Heures"
            // Un salaire fixe n'a pas d'heures valorisées : afficher « 0 h »
            // serait juste, mais « — » dit mieux que la question ne se pose pas.
            valeur={b.type_paiement === "salary" ? "—" : fmtHeures(heures)}
            hint={b.nb_lignes > 0 ? `${b.nb_lignes} ligne(s)` : undefined}
          />
          <Donnee
            label="Archivé le"
            valeur={fmtDate(b.archive_le)}
            hint={b.archive_par || undefined}
            title={fmtHorodatage(b.archive_le)}
          />
        </div>

        <div className="shrink-0 flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
              STATUT_STYLES[b.statut] ?? "bg-muted text-muted-foreground border-border"
            }`}
          >
            {STATUT_LABELS[b.statut] ?? b.statut}
          </span>
          {/* Même libellé et même traitement que sur l'écran des bulletins :
              c'est le même document, il doit porter le même nom partout. */}
          <a
            href={`/api/teacher-payments/${b.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 whitespace-nowrap"
          >
            <FileText className="h-4 w-4" />
            Bulletin
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function Carte({
  label,
  valeur,
  hint,
  icone,
}: {
  label: string;
  valeur: string;
  hint?: string;
  icone: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-indigo-500">{icone}</span>
        </div>
        <div className="text-2xl font-bold mt-1">{valeur}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Donnee({
  label,
  valeur,
  hint,
  fort,
  title,
}: {
  label: string;
  valeur: string;
  hint?: string;
  fort?: boolean;
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 break-words ${fort ? "font-semibold" : ""}`}>{valeur}</div>
      {hint && <div className="text-[11px] text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}
