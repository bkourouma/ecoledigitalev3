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
  BadgeCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
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
  useMarquerVerses,
  type BulletinArchive,
} from "@/lib/hooks/use-professional-remuneration";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openHistoriquePaiePdf } from "@/lib/utils/paie-report";

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

/**
 * Deux mots suffisent au gestionnaire : PAYÉ et IMPAYÉ.
 *
 * `approved` est l'état posé par l'archivage — le montant est arrêté, il n'a
 * pas encore été versé. C'est la définition même d'un impayé, et c'est ce que
 * le mot doit dire ici. `paid` n'arrive que par un constat de versement
 * explicite, avec sa date.
 *
 * Les autres valeurs restent listées pour les bulletins antérieurs.
 */
const STATUT_LABELS: Record<string, string> = {
  paid: "Payé",
  approved: "Impayé",
  // Abandonné depuis la 0114, conservé pour d'éventuelles données anciennes.
  unpaid: "Impayé",
  calculated: "Calculé",
  disputed: "Contesté",
  cancelled: "Annulé",
};

const STATUT_STYLES: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  /* Ambre et non rouge : un impayé n'est pas une anomalie, c'est une étape.
     Le rouge est réservé aux situations qui demandent une correction. */
  approved: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  unpaid: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  calculated: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  disputed: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

/** Un bulletin arrêté mais pas encore versé — au sens comptable du mot. */
const estImpaye = (statut: string): boolean => statut === "approved" || statut === "unpaid";

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

const jour = (v: string): Date => new Date(v.length <= 10 ? `${v}T00:00:00` : v);

/**
 * Année scolaire d'un bulletin.
 *
 * La source de vérité est `payment_periods.academic_year_id`, remontée par
 * l'API dans `annee_scolaire`. La déduction par date ne sert que de repli pour
 * une période qui ne serait rattachée à aucune année : l'année démarre en
 * septembre, juillet et août appartenant donc à l'année qui vient de s'achever.
 *
 * LE PIVOT EST POSÉ SUR LE MILIEU DE L'INTERVALLE, pas sur sa date de début.
 * Une période qui ne commence pas en septembre serait sinon rangée dans l'année
 * précédente : « Exercice 2026-2027 » court du 01/08/2026 au 31/12/2026, donc
 * démarre en août, et tombait en 2025-2026 — le filtre d'année n'offrait jamais
 * 2026-2027 et empilait silencieusement deux exercices. Sur une période de
 * septembre à août, le milieu tombe en mars : le résultat est inchangé.
 *
 * Même règle côté serveur pour l'écran propriétaire de la masse salariale
 * (`ANNEE_SQL`), pour qu'un même bulletin tombe dans la même année des deux
 * côtés.
 */
const anneeScolaire = (b: BulletinArchive): string | null => {
  if (b.annee_scolaire) return b.annee_scolaire;
  if (!b.periode_debut) return null;
  const debut = jour(b.periode_debut);
  if (isNaN(debut.getTime())) return null;
  const fin = b.periode_fin ? jour(b.periode_fin) : debut;
  const milieu = new Date(
    debut.getTime() + (isNaN(fin.getTime()) ? 0 : fin.getTime() - debut.getTime()) / 2
  );
  const y = milieu.getFullYear();
  return milieu.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
};

/**
 * Libellé d'une période dans le filtre, déduit de son INTERVALLE et non de son
 * nom : le nom est saisi à la main et ne dit pas toujours ce qu'il couvre.
 *
 *   « Décembre 2025 — année 2025-2026 »
 *   « Décembre 2025 → février 2026 — année 2025-2026 »  (période à cheval)
 */
const libellePeriode = (b: BulletinArchive): string => {
  const [anD, moisD] = b.periode_debut.split("-").map(Number);
  const [anF, moisF] = b.periode_fin.split("-").map(Number);
  const premier = majuscule(`${MOIS[moisD - 1]} ${anD}`);
  const annee = anneeScolaire(b);
  const suffixe = annee ? ` — année ${annee}` : "";
  if (anD === anF && moisD === moisF) return premier + suffixe;
  return `${premier} → ${MOIS[moisF - 1]} ${anF}${suffixe}`;
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
  const [periodeId, setPeriodeId] = useState("");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const [retour, setRetour] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  const enseignantsQuery = useEnseignantsPaie();
  const query = useHistoriqueBulletins(enseignantId || undefined);
  const verser = useMarquerVerses();

  /**
   * Constate le versement. Le rafraîchissement passe par l'invalidation du hook :
   * le statut, la date et l'accès au PDF changent tous les trois, les recalculer
   * à la main ici les ferait diverger de ce que le serveur a réellement écrit.
   */
  const lancerVersement = async (ids: string[]) => {
    setRetour(null);
    try {
      const r = await verser.mutateAsync(ids);
      await query.refetch();
      setRetour({
        kind: r.verses > 0 ? "ok" : "warn",
        text:
          r.verses > 0
            ? `${r.verses} versement(s) enregistré(s).`
            : "Aucun bulletin à verser : ils sont déjà réglés ou pas encore arrêtés.",
      });
    } catch (error) {
      setRetour({ kind: "warn", text: (error as Error).message });
    }
  };

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

  /**
   * Périodes réellement représentées, libellées par leur intervalle. Groupées
   * par identifiant et non par nom : deux périodes peuvent porter le même
   * intitulé, les fondre en masquerait une.
   *
   * Les options suivent l'année sélectionnée — proposer une période de
   * 2024-2025 alors qu'on filtre 2025-2026 ne donnerait qu'une liste vide.
   */
  const periodeOptions = useMemo(() => {
    const source = anneeActive ? items.filter((b) => anneeScolaire(b) === anneeActive) : items;
    const par = new Map<string, { libelle: string; debut: string }>();
    for (const b of source) {
      if (!par.has(b.periode_id)) {
        par.set(b.periode_id, { libelle: libellePeriode(b), debut: b.periode_debut });
      }
    }
    return [...par.entries()]
      .sort((a, z) => z[1].debut.localeCompare(a[1].debut)) // la plus récente en tête
      .map(([id, p]) => ({ value: id, label: p.libelle }));
  }, [items, anneeActive]);

  const periodeActive = periodeOptions.some((o) => o.value === periodeId) ? periodeId : "";

  const filtres = useMemo(() => {
    let liste = anneeActive ? items.filter((b) => anneeScolaire(b) === anneeActive) : items;
    if (periodeActive) liste = liste.filter((b) => b.periode_id === periodeActive);
    return liste;
  }, [items, anneeActive, periodeActive]);

  const stats = useMemo(
    () => ({
      total: filtres.length,
      montant: filtres.reduce((s, b) => s + (b.montant ?? 0), 0),
      devise: filtres[0]?.devise ?? "XOF",
      /* Ce qui reste dû sur le périmètre affiché. C'est le chiffre que le
         gestionnaire cherche : « combien me reste-t-il à verser ? » */
      impayes: filtres.filter((b) => estImpaye(b.statut)),
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
    // La période choisie appartenait peut-être à l'année qu'on quitte : la
    // laisser posée filtrerait sur une valeur que la liste ne propose plus.
    setPeriodeId("");
    setPage(1);
  }

  function changePeriode(value: string) {
    setPeriodeId(value);
    setPage(1);
  }

  function changePageSize(value: string) {
    setPageSize(Number(value));
    setPage(1);
  }

  /** Périmètre de l'export : les filtres tels qu'ils sont posés à l'écran. */
  const exportContexte = useMemo(() => {
    const enseignant = enseignantId
      ? (enseignants.find((e) => e.id === enseignantId)?.nom ?? undefined)
      : undefined;
    const periode = periodeActive
      ? (periodeOptions.find((o) => o.value === periodeActive)?.label ?? undefined)
      : undefined;
    const annee = anneeActive || undefined;
    return {
      enseignant,
      annee,
      periode,
      filtreLibelle:
        [enseignant, annee, periode].filter(Boolean).join("  ·  ") || "Tous les bulletins archivés",
    };
  }, [enseignantId, enseignants, anneeActive, periodeActive, periodeOptions]);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-6">
      {/* Plus de lien « Retour » : cet écran est une entrée de menu à part
          entière, pas une sous-page des bulletins. */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <History className="h-7 w-7 text-indigo-500" />
            Historique des paiements
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Toutes les générations archivées, la plus récente en premier. Un bulletin n'apparaît ici
            qu'une fois archivé depuis l'écran des bulletins.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {/* Exporte le périmètre FILTRÉ, pas la page affichée : la pagination
              est un confort de lecture, pas un critère de sélection. */}
          <ExportButtons
            formats={["pdf"]}
            disabled={query.isLoading || filtres.length === 0}
            onError={(text) => setRetour({ kind: "warn", text })}
            onExportPdf={(win) => openHistoriquePaiePdf(filtres, exportContexte, win)}
          />
        </div>
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

          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="text-muted-foreground">Période de paiement</span>
            <SearchableSelect
              value={periodeActive}
              onChange={changePeriode}
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
              placeholder="Toutes les périodes"
              searchPlaceholder="Rechercher une période…"
              options={[{ value: "", label: "Toutes les périodes" }, ...periodeOptions]}
            />
            <span className="text-xs text-muted-foreground">
              Le mois et l&apos;année scolaire sont déduits de l&apos;intervalle de dates de la
              période.
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

      {/* Reste à verser sur le périmètre affiché, avec le règlement groupé.
          Le bouton porte sur ce qui est FILTRÉ, pas sur tout l'historique : on
          règle une période, pas l'ensemble des exercices d'un coup. */}
      {stats.impayes.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <BadgeCheck className="h-5 w-5 shrink-0 text-amber-500" />
            <p className="text-sm">
              <span className="font-semibold text-amber-400">
                {stats.impayes.length} bulletin(s) impayé(s)
              </span>{" "}
              <span className="text-muted-foreground">
                —{" "}
                {fmtMontant(
                  stats.impayes.reduce((s, b) => s + (b.montant ?? 0), 0),
                  stats.devise
                )}{" "}
                restant à verser
              </span>
            </p>
            <button
              type="button"
              onClick={() => lancerVersement(stats.impayes.map((b) => b.id))}
              disabled={verser.isPending}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed whitespace-nowrap"
            >
              {verser.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BadgeCheck className="h-4 w-4" />
              )}
              Marquer versés ({stats.impayes.length})
            </button>
          </CardContent>
        </Card>
      )}

      {retour && (
        <p className={`text-sm ${retour.kind === "ok" ? "text-emerald-400" : "text-amber-500"}`}>
          {retour.text}
        </p>
      )}

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
            <LigneBulletin
              key={b.id}
              bulletin={b}
              avecNom={!enseignantId}
              onVerser={lancerVersement}
              versementEnCours={verser.isPending}
            />
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

function LigneBulletin({
  bulletin: b,
  avecNom,
  onVerser,
  versementEnCours,
}: {
  bulletin: BulletinArchive;
  avecNom: boolean;
  onVerser: (ids: string[]) => void;
  versementEnCours: boolean;
}) {
  const heures = Number(b.heures_normales ?? 0) + Number(b.heures_sup ?? 0);

  /* Le statut fait foi, pas le montant : c'est l'archivage qui a arrêté le
     montant, et le versement qui le solde. Rejuger ici sur `montant <= 0`
     ferait diverger l'écran des décisions enregistrées. */
  const impaye = estImpaye(b.statut);

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
          {/* Un salaire fixe n'a pas d'heures valorisées : la colonne est
              retirée, pas remplie d'un tiret. Un « — » se lit comme une donnée
              manquante, alors que la question ne se pose simplement pas. */}
          {b.type_paiement !== "salary" && (
            <Donnee label="Heures" valeur={fmtHeures(heures)} />
          )}
          {/* Deux dates, deux actes. « Archivé le » dit quand le montant a été
              arrêté ; « Versé le » quand l'argent est parti. Les confondre est
              précisément ce qui avait produit 35 bulletins déclarés payés sans
              qu'aucun décaissement n'ait été enregistré. */}
          <Donnee
            label="Archivé le"
            valeur={fmtDate(b.archive_le)}
            hint={b.archive_par || undefined}
            title={fmtHorodatage(b.archive_le)}
          />
          {b.verse_le && (
            <Donnee
              label="Versé le"
              valeur={fmtDate(b.verse_le)}
              title={fmtHorodatage(b.verse_le)}
            />
          )}
        </div>

        <div className="shrink-0 flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
              STATUT_STYLES[b.statut] ?? "bg-muted text-muted-foreground border-border"
            }`}
          >
            {STATUT_LABELS[b.statut] ?? b.statut}
          </span>
          {/* Solder le bulletin : c'est ce geste, et lui seul, qui le fait
              passer à « Payé » et enregistre la date du versement. */}
          {impaye && (
            <button
              type="button"
              onClick={() => onVerser([b.id])}
              disabled={versementEnCours}
              title="Enregistrer le versement de ce bulletin"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed whitespace-nowrap"
            >
              <BadgeCheck className="h-4 w-4" />
              Marquer versé
            </button>
          )}

          {/* Même libellé et même traitement que sur l'écran des bulletins :
              c'est le même document, il doit porter le même nom partout.

              UN BULLETIN IMPAYÉ NE S'IMPRIME PAS. Le document atteste une
              rémunération versée ; le remettre avant le versement en ferait la
              preuve d'un paiement qui n'a pas eu lieu. Le bouton reste visible
              mais inerte — le retirer laisserait croire à un défaut
              d'affichage — et s'active dès que le versement est constaté. */}
          {impaye ? (
            <button
              type="button"
              disabled
              title="Bulletin impayé : enregistrez le versement pour pouvoir éditer le document."
              className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-muted-foreground cursor-not-allowed whitespace-nowrap"
            >
              <FileText className="h-4 w-4" />
              Bulletin
            </button>
          ) : (
            <a
              href={`/api/teacher-payments/${b.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 whitespace-nowrap"
            >
              <FileText className="h-4 w-4" />
              Bulletin
            </a>
          )}
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
      {/* `break-words` et non `truncate` : le seul indice restant est le nom de
          la personne qui a archivé. Tronqué, « Administrateur Te… » ne désigne
          plus personne — c'est justement ce qu'on veut lire. */}
      {hint && <div className="text-[11px] text-muted-foreground break-words">{hint}</div>}
    </div>
  );
}
