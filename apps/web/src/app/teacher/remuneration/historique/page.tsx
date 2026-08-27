"use client";

import { useMemo, useState } from "react";
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
  CalendarClock,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  Loader2,
  Wallet,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useMonHistoriquePaie,
  type BulletinArchive,
} from "@/lib/hooks/use-professional-remuneration";

/**
 * Mon historique de paiements — espace enseignant.
 *
 * Ne montre QUE les bulletins réellement versés : le filtre est posé côté
 * serveur (`/my/historique`), un bulletin archivé mais impayé n'est qu'un
 * montant arrêté en interne et l'annoncer ici promettrait un versement qui n'a
 * pas eu lieu. Tout ce qui est affiché est donc, par construction, « Payé » —
 * d'où l'absence de colonne de statut : elle ne dirait jamais qu'un seul mot.
 *
 * Aucun téléchargement de bulletin : le document reste délivré par
 * l'administration. Il n'y a pas de bouton grisé non plus — il ferait croire à
 * un droit temporairement indisponible, alors que l'écran n'en donne aucun.
 */

const PAGE_SIZES = [10, 20, 50];

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

const fmtHeures = (v: number | null): string => {
  const n = Number(v ?? 0);
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h} h`;
};

/**
 * Année scolaire d'un bulletin. La source de vérité est l'année rattachée à la
 * période ; la déduction par date ne sert que de repli, avec un pivot en
 * septembre — juillet et août appartiennent à l'année qui s'achève.
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

/** Libellé d'une période déduit de son INTERVALLE : le nom saisi ne dit pas toujours ce qu'il couvre. */
const libellePeriode = (b: BulletinArchive): string => {
  const [anD, moisD] = b.periode_debut.split("-").map(Number);
  const [anF, moisF] = b.periode_fin.split("-").map(Number);
  const premier = majuscule(`${MOIS[moisD - 1]} ${anD}`);
  const annee = anneeScolaire(b);
  const suffixe = annee ? ` — année ${annee}` : "";
  if (anD === anF && moisD === moisF) return premier + suffixe;
  return `${premier} → ${MOIS[moisF - 1]} ${anF}${suffixe}`;
};

export default function MonHistoriquePaiementsPage() {
  const [annee, setAnnee] = useState("");
  const [periodeId, setPeriodeId] = useState("");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const query = useMonHistoriquePaie();
  const items = useMemo(() => query.data?.items ?? [], [query.data]);

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

  const anneeActive = anneeOptions.some((o) => o.value === annee) ? annee : "";

  /**
   * Périodes représentées, groupées par identifiant et non par nom : deux
   * périodes peuvent porter le même intitulé, les fondre en masquerait une.
   * Les options suivent l'année choisie.
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
      .sort((a, z) => z[1].debut.localeCompare(a[1].debut))
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
    }),
    [filtres]
  );

  // Pagination client : l'historique est déjà chargé en entier.
  const totalPages = Math.max(1, Math.ceil(filtres.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * pageSize;
  const pageItems = useMemo(
    () => filtres.slice(firstIndex, firstIndex + pageSize),
    [filtres, firstIndex, pageSize]
  );

  function changeAnnee(value: string) {
    setAnnee(value);
    // La période choisie appartenait peut-être à l'année qu'on quitte.
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

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
          <History className="h-7 w-7 text-indigo-500 shrink-0" />
          Mon historique de paiements
        </h1>
        <p className="text-muted-foreground mt-2">
          Les rémunérations qui vous ont été effectivement versées, la plus récente en premier. Un
          montant en cours de traitement n&apos;apparaît qu&apos;une fois le versement enregistré.
        </p>
      </div>

      {/* Filtres */}
      <Card className="shadow-sm">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
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
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Période de paiement</span>
            <SearchableSelect
              value={periodeActive}
              onChange={changePeriode}
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
              placeholder="Toutes les périodes"
              searchPlaceholder="Rechercher une période…"
              options={[{ value: "", label: "Toutes les périodes" }, ...periodeOptions]}
            />
          </label>
        </CardContent>
      </Card>

      {/* Indicateurs du périmètre affiché */}
      <div className="grid grid-cols-2 gap-4">
        <Carte
          label="Paiements reçus"
          valeur={String(stats.total)}
          icone={<FileText className="h-5 w-5" />}
        />
        <Carte
          label="Montant cumulé"
          valeur={fmtMontant(stats.montant, stats.devise)}
          hint="sur le périmètre affiché"
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
            <p>{(query.error as Error)?.message ?? "Impossible de charger votre historique."}</p>
          </CardContent>
        </Card>
      ) : filtres.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {items.length > 0
              ? "Aucun paiement ne correspond à ces filtres."
              : "Aucun paiement versé pour l'instant."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pageItems.map((b) => (
            <LigneBulletin key={b.id} bulletin={b} />
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

function LigneBulletin({ bulletin: b }: { bulletin: BulletinArchive }) {
  const heures = Number(b.heures_normales ?? 0) + Number(b.heures_sup ?? 0);

  return (
    <Card>
      <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="lg:w-56 shrink-0">
          <div className="text-sm font-semibold break-words">{b.periode_nom}</div>
          <div className="text-xs text-muted-foreground">
            {fmtDate(b.periode_debut)} → {fmtDate(b.periode_fin)}
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 min-w-0">
          <Donnee label="Montant versé" valeur={fmtMontant(b.montant, b.devise)} fort />
          <Donnee label="Rémunération" valeur={TYPE_LABELS[b.type_paiement] ?? b.type_paiement} />
          {/* Un salaire fixe n'a pas d'heures valorisées : la colonne est
              retirée plutôt que remplie d'un tiret, qui se lirait comme une
              donnée manquante. */}
          {b.type_paiement !== "salary" && <Donnee label="Heures" valeur={fmtHeures(heures)} />}
          <Donnee
            label="Versé le"
            valeur={fmtDate(b.verse_le)}
            title={fmtHorodatage(b.verse_le)}
          />
        </div>

        {/* Pas de statut affiché : l'écran ne montre que des paiements versés,
            un libellé qui ne varie jamais n'apprend rien. */}
        <div className="shrink-0">
          <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
            Payé
          </span>
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
          <span className="text-indigo-500 shrink-0">{icone}</span>
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
  fort,
  title,
}: {
  label: string;
  valeur: string;
  fort?: boolean;
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 break-words ${fort ? "font-semibold" : ""}`}>{valeur}</div>
    </div>
  );
}
