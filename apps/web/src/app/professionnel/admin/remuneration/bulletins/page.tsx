"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@ecoledigitale/ui";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CalendarClock,
  CalendarPlus,
  Calculator,
  Check,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Lock,
  Mail,
  Plus,
  Pencil,
  ScrollText,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import {
  useArchiverBulletins,
  useCalculerPeriode,
  useCreerPeriodePaie,
  useModifierPeriodePaie,
  useSupprimerPeriodePaie,
  useEnseignantsPaie,
  usePeriodeEnAttente,
  type EnseignantPaie,
  type EtatConfiguration,
} from "@/lib/hooks/use-professional-remuneration";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ExportButtons } from "@/components/ExportButtons";
import { openPaieBulletinsPdf } from "@/lib/utils/paie-bulletins-report";

/** Période qui pilote les cartes — voir `periode_courante` côté API. */
type PeriodeCourante = NonNullable<
  ReturnType<typeof useEnseignantsPaie>["data"]
>["periode_courante"];

/**
 * Bulletins de paie — vue d'ensemble des enseignants (feature 031).
 *
 * POINT D'ENTRÉE du parcours de paie. Il répond à la question qui précède
 * toutes les autres : « qui peut être payé ? ».
 *
 * L'écran liste TOUS les enseignants de l'établissement, pas seulement ceux
 * qui ont une configuration. C'est délibéré et c'est tout l'intérêt : la liste
 * des configurations, par construction, ne peut pas montrer un enseignant qui
 * n'en a pas — or c'est exactement celui qu'il faut repérer.
 *
 * Un enseignant sans configuration valide est IGNORÉ EN SILENCE par le
 * calculateur : pas d'erreur, pas d'avertissement, juste un bulletin qui
 * n'existe pas. Ce défaut ne se voit qu'ici.
 */

/* ============================ Libellés ================================ */

const TYPE_LABELS: Record<string, string> = {
  salary: "Salaire fixe",
  hourly: "Taux horaire",
  mixed: "Mixte (salaire + horaire)",
};

/**
 * Chaque état dit ce qu'il implique POUR LE CALCUL, pas seulement ce qu'il est.
 * « Expirée » et « À venir » se lisent comme « configuré » dans une liste de
 * configurations, alors qu'ils produisent le même effet qu'une absence.
 */
const ETATS: Record<
  EtatConfiguration,
  { label: string; pastille: string; carte: string; aide: string; icone: React.ReactNode }
> = {
  active: {
    label: "Configuré",
    pastille: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    carte: "border-border",
    aide: "Prêt à être payé.",
    icone: <CheckCircle2 className="h-4 w-4" />,
  },
  absente: {
    label: "Non configuré",
    pastille: "bg-red-500/15 text-red-400 border-red-500/30",
    carte: "border-red-500/40 bg-red-500/5",
    aide: "Aucune configuration : cet enseignant sera ignoré par le calcul, sans message d'erreur.",
    icone: <AlertCircle className="h-4 w-4" />,
  },
  expiree: {
    label: "Configuration expirée",
    pastille: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    carte: "border-amber-500/40 bg-amber-500/5",
    aide: "La période de validité est passée : le calcul l'ignorera comme s'il n'y avait rien.",
    icone: <AlertTriangle className="h-4 w-4" />,
  },
  future: {
    label: "Configuration à venir",
    pastille: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    carte: "border-blue-500/40 bg-blue-500/5",
    aide: "Elle ne prend effet qu'à une date future : rien ne sera payé avant.",
    icone: <CalendarClock className="h-4 w-4" />,
  },
};

/* ============================ Formats ================================= */

const fmtMontant = (v: number | null | undefined): string =>
  v == null ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} XOF`;

const fmtDate = (d: string | null): string => {
  if (!d) return "—";
  const parsed = new Date(`${d}T00:00:00`);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("fr-FR");
};

/** 596 → « 596 h » ; 2,5 → « 2h30 ». */
const fmtHeures = (v: number | null | undefined): string => {
  const n = Number(v ?? 0);
  const heures = Math.floor(n);
  const minutes = Math.round((n - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures} h`;
};

/**
 * Un enseignant au salaire fixe est payé indépendamment de ses heures : elles
 * sont constatées, jamais valorisées. L'écran doit le dire, sinon un cumul de
 * 594 h en face d'un bulletin qui ne les mentionne pas passe pour un bug.
 */
const surSalaire = (e: EnseignantPaie) => e.config?.config_type === "salary";

/* ============================== Page ================================== */

export default function BulletinsPaiePage() {
  const query = useEnseignantsPaie();
  const enAttenteQuery = usePeriodeEnAttente();
  const calculer = useCalculerPeriode();
  const archiver = useArchiverBulletins();

  /** `""` = tous les enseignants. */
  const [enseignantChoisi, setEnseignantChoisi] = useState("");
  const [seulementAProbleme, setSeulementAProbleme] = useState(false);
  const [action, setAction] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  /* L'archivage est le geste de clôture : il fige le statut financier et sort
     les bulletins du plan de travail. Il ne part plus sur un simple clic. */
  const [confirmation, setConfirmation] = useState(false);

  const tous = query.data?.items ?? [];
  const periodeEnAttente = enAttenteQuery.data?.periode ?? null;
  /**
   * Période qui pilote les cartes : en attente de calcul, ou déjà calculée mais
   * pas encore archivée. `null` signifie que le cycle est terminé — compteurs à
   * zéro, boutons grisés, en attente d'une nouvelle période.
   */
  const periodeCourante = query.data?.periode_courante ?? null;

  /**
   * Bulletins encore au plan de travail, et le sort que l'archivage leur
   * réserve. Un bulletin à zéro sera classé IMPAYÉ : rien à verser, faute
   * d'heure valorisable.
   *
   * COMPTÉ PAR LE SERVEUR, pas déduit des cartes. Chaque carte n'expose qu'UN
   * bulletin par enseignant — le plus récent non archivé. Dès qu'un enseignant
   * en avait plusieurs, ce qui arrive quand deux périodes coexistent, le
   * décompte tiré des cartes était trop bas : « Tout archiver (3) » en classait
   * trois et en laissait d'autres derrière, sans rien dire.
   */
  const aArchiver = query.data?.en_attente ?? { total: 0 };

  /**
   * Calcule OU RECALCULE la période ouverte.
   *
   * Le repli sur `periodeCourante` n'est pas un détail : dès le premier calcul,
   * la période cesse d'être « en attente » et `periodeEnAttente` retombe à
   * `null`. L'écran n'offrait alors plus aucune commande — or c'est
   * précisément le moment où l'on en a besoin, quand on s'aperçoit qu'on a
   * généré avant d'avoir validé toutes les séances. Le serveur, lui, sait
   * recalculer : `recalculate: true` réécrit les bulletins existants.
   */
  const lancerCalcul = async () => {
    const periodId = periodeEnAttente?.id ?? periodeCourante?.id;
    if (!periodId) return;
    setAction(null);
    try {
      const r = await calculer.mutateAsync({ periodId });
      setAction({
        kind: r.calculated > 0 ? "ok" : "warn",
        text:
          r.calculated > 0
            ? `${r.calculated} bulletin(s) généré(s). Consultez les PDF, puis archivez.`
            : `Aucun bulletin généré (${r.skipped} ignoré(s)). Vérifiez les configurations et les heures à payer.`,
      });
    } catch (error) {
      setAction({ kind: "warn", text: (error as Error).message });
    }
  };

  const lancerArchivage = async () => {
    if (aArchiver.total === 0) return;
    setAction(null);
    setConfirmation(false);
    try {
      const r = await archiver.mutateAsync();
      setAction({
        kind: "ok",
        text:
          `${r.archives} bulletin(s) archivé(s), montant arrêté. Ils sont dans ` +
          `l'historique au statut « Impayé » — enregistrez-y les versements.`,
      });
    } catch (error) {
      setAction({ kind: "warn", text: (error as Error).message });
    }
  };

  const enseignants = useMemo(
    () =>
      tous.filter((e) => {
        if (seulementAProbleme && e.etat_configuration === "active") return false;
        return !enseignantChoisi || e.id === enseignantChoisi;
      }),
    [tous, enseignantChoisi, seulementAProbleme]
  );

  const stats = useMemo(() => {
    const par = (etat: EtatConfiguration) =>
      tous.filter((e) => e.etat_configuration === etat).length;
    return {
      total: tous.length,
      configures: par("active"),
      aTraiter: tous.length - par("active"),
      absentes: par("absente"),
    };
  }, [tous]);

  /** Périmètre exporté : exactement les cartes affichées, filtres compris. */
  const exportOptions = useMemo(
    () => ({
      enseignant: enseignantChoisi
        ? (tous.find((e) => e.id === enseignantChoisi)?.nom ?? enseignantChoisi)
        : "Tous les enseignants",
      filtre: seulementAProbleme
        ? "Seulement les enseignants à configurer"
        : "Tous les états de configuration",
      periode: periodeCourante?.nom ?? periodeEnAttente?.nom ?? null,
      stats: {
        total: stats.total,
        configures: stats.configures,
        aTraiter: stats.aTraiter,
        heuresValidees: query.data?.heures_validees ?? 0,
        seancesValidees: query.data?.seances_validees ?? 0,
      },
    }),
    [
      enseignantChoisi,
      tous,
      seulementAProbleme,
      periodeCourante,
      periodeEnAttente,
      stats,
      query.data,
    ]
  );

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <ScrollText className="h-7 w-7 text-indigo-500" />
            Bulletins de paie
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Tous les enseignants de l'établissement et leur configuration de rémunération. Un
            enseignant sans configuration valide ne produit aucun bulletin — et le calcul ne le
            signale pas.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButtons
            formats={["pdf"]}
            disabled={query.isLoading || enseignants.length === 0}
            onExportPdf={(win) => openPaieBulletinsPdf(enseignants, exportOptions, win)}
            onError={(text) => setAction({ kind: "warn", text })}
          />
        </div>
      </div>

      {/* Indicateurs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Indicateur
          label="Enseignants"
          valeur={String(stats.total)}
          hint={`${stats.configures} configuré(s)`}
          icone={<Users className="h-5 w-5" />}
        />
        <Indicateur
          label="Heures validées"
          valeur={fmtHeures(query.data?.heures_validees ?? 0)}
          hint={`${query.data?.seances_validees ?? 0} séance(s), tous enseignants`}
          icone={<Clock className="h-5 w-5" />}
        />
        <Indicateur
          label="À configurer"
          valeur={String(stats.aTraiter)}
          hint={stats.aTraiter > 0 ? "ignorés par le calcul en l'état" : "rien à faire"}
          icone={<AlertCircle className="h-5 w-5" />}
          alerte={stats.aTraiter > 0}
        />
      </div>

      {/* Alerte globale — un compte isolé dans une carte se remarque moins
          qu'une bande de couleur en travers de l'écran. */}
      {stats.aTraiter > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-200">
              <p className="font-semibold">
                {stats.aTraiter} enseignant(s) ne peuvent pas être payés en l'état
              </p>
              <p className="mt-1">
                {stats.absentes > 0 && (
                  <>
                    {stats.absentes} sans aucune configuration
                    {stats.aTraiter > stats.absentes && ", "}
                  </>
                )}
                {stats.aTraiter > stats.absentes && (
                  <>{stats.aTraiter - stats.absentes} avec une configuration expirée ou à venir</>
                )}
                . Le calcul les écarte sans message d'erreur : leurs heures validées ne
                produiront aucun montant.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <CreationPeriode
        onCalculer={lancerCalcul}
        calculEnCours={calculer.isPending}
        periodeCourante={periodeCourante}
        bulletinsGeneres={aArchiver.total}
      />

      {/* Génération et classement */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          {/* Le calcul ne figure plus ici : sa commande vit dans le bandeau de
              la période en attente, à l'endroit où cette période est annoncée.
              Deux boutons pour le même geste, à deux endroits de l'écran,
              laissaient croire à deux étapes distinctes. Ne reste ici que ce
              qui suit la génération : l'archivage. */}
          <button
            onClick={() => setConfirmation(true)}
            disabled={aArchiver.total === 0 || archiver.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-input px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Archive className="h-4 w-4" />
            Tout archiver ({aArchiver.total})
          </button>

          {/* L'historique a sa propre entrée de menu : « Historique des
              paiements ». Le dupliquer ici donnerait deux chemins vers le même
              écran, dont un seul se met à jour quand la route change. */}

          {action && (
            <span
              className={`text-sm ${action.kind === "ok" ? "text-emerald-400" : "text-amber-500"}`}
            >
              {action.text}
            </span>
          )}

          {!periodeEnAttente && aArchiver.total === 0 && (
            <span className="text-sm text-muted-foreground">
              Créez une période de paiement pour générer des bulletins.
            </span>
          )}
        </CardContent>
      </Card>

      {/* Recherche */}
      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Une liste déroulante avec recherche intégrée plutôt qu'un champ
              libre : on choisit ici parmi une trentaine de personnes connues,
              pas dans un ensemble ouvert. Le select montre qui existe, là où
              une saisie libre laisse deviner l'orthographe. */}
          <div className="flex-1 min-w-0">
            <SearchableSelect
              value={enseignantChoisi}
              onChange={setEnseignantChoisi}
              icon={<UserRound className="h-4 w-4 text-muted-foreground" />}
              placeholder="Tous les enseignants"
              searchPlaceholder="Rechercher un enseignant…"
              options={[
                { value: "", label: "Tous les enseignants" },
                ...tous.map((e) => ({
                  value: e.id,
                  // Le matricule lève l'ambiguïté entre deux homonymes.
                  label: e.matricule ? `${e.nom} — ${e.matricule}` : e.nom,
                })),
              ]}
            />
          </div>
          <label className="flex items-center gap-2 text-sm shrink-0">
            <input
              type="checkbox"
              checked={seulementAProbleme}
              onChange={(e) => setSeulementAProbleme(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-muted-foreground">À configurer uniquement</span>
          </label>
        </CardContent>
      </Card>

      {/* Liste — une carte par ligne */}
      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : query.isError ? (
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 py-8 text-red-400">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(query.error as Error)?.message ?? "Impossible de charger les enseignants."}</p>
          </CardContent>
        </Card>
      ) : enseignants.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {tous.length === 0
              ? "Aucun enseignant enregistré dans l'établissement."
              : seulementAProbleme
                ? "Tous les enseignants sélectionnés sont configurés."
                : "Aucun enseignant ne correspond à cette sélection."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {enseignants.map((e) => (
            <CarteEnseignant key={e.id} enseignant={e} periode={periodeCourante} />
          ))}
        </div>
      )}

      {enseignants.length > 0 && (
        <p className="text-sm text-muted-foreground text-center">
          {enseignants.length} enseignant(s) affiché(s)
          {enseignants.length !== tous.length && ` sur ${tous.length}`}.
        </p>
      )}

      {/* L'archivage clôt la période : il ARRÊTE le montant de chaque bulletin
          et les sort du plan de travail. Il ne verse rien — la boîte doit le
          dire, sinon « archiver » se comprend comme « payer », ce qui avait
          produit 35 bulletins déclarés payés sans aucun décaissement. */}
      <ConfirmationDialog
        open={confirmation}
        onOpenChange={setConfirmation}
        title="Arrêter et archiver les bulletins de la période ?"
        description={
          `${aArchiver.total} bulletin(s) vont être classés, leur montant arrêté. ` +
          `Ils passeront dans l'historique au statut « Impayé » : la somme est due, ` +
          `elle n'est pas encore versée. Le versement s'enregistre ensuite depuis ` +
          `l'historique. La période sera close.`
        }
        confirmText="Archiver"
        cancelText="Annuler"
        onConfirm={lancerArchivage}
        loading={archiver.isPending}
      />
    </div>
  );
}

/* ======================= Création d'une période ======================= */

/**
 * Création d'une période de paie, collective ou individuelle.
 *
 * UNE SEULE PÉRIODE EN ATTENTE À LA FOIS. Tant que la dernière créée n'a pas
 * servi au calcul, le formulaire est fermé : deux exercices ouverts en même
 * temps laissent le gestionnaire sans savoir lequel alimente quel bulletin.
 *
 * L'état est demandé au serveur, pas déduit de la liste affichée : c'est la
 * même règle qui refusera l'écriture, elle doit donc venir de la même source.
 * Le formulaire se désactive AVANT la saisie plutôt que de laisser remplir
 * pour opposer un refus à la fin.
 */
function CreationPeriode({
  onCalculer,
  calculEnCours,
  periodeCourante,
  bulletinsGeneres,
}: {
  /** Lance le calcul de la période ouverte, sans quitter l'écran. */
  onCalculer: () => void;
  calculEnCours: boolean;
  /** Période qui pilote l'écran : en attente de calcul, ou déjà calculée. */
  periodeCourante: PeriodeCourante | null;
  /** Bulletins encore au plan de travail sur cette période. */
  bulletinsGeneres: number;
}) {
  const enAttenteQuery = usePeriodeEnAttente();
  const creer = useCreerPeriodePaie();

  /* Plus de choix de périmètre : une période couvre TOUS les enseignants.
     Le sélecteur « Enseignants choisis » a été retiré — un périmètre partiel
     produisait des bulletins pour les uns et rien pour les autres, sans que
     l'écran dise lesquels manquaient ni pourquoi. Le calcul écarte de lui-même
     ceux qui n'ont ni heures ni configuration, avec un motif. L'API accepte
     toujours `teacherIds` : la sélection reste possible par appel direct. */
  const [nom, setNom] = useState("");
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [retour, setRetour] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  const enAttente = enAttenteQuery.data?.periode ?? null;
  const bloque = Boolean(enAttente);

  /* Édition et suppression de la période EN ATTENTE, depuis son bandeau.
     Une période calculée n'est pas modifiable ici : ses bornes ont déjà servi
     à collecter des heures, les changer laisserait des bulletins fondés sur un
     intervalle qui n'existe plus. Le bandeau ne s'affichant que sur une période
     en attente, la garde est structurelle. */
  const modifier = useModifierPeriodePaie();
  const supprimer = useSupprimerPeriodePaie();
  const [edition, setEdition] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [editNom, setEditNom] = useState("");
  const [editDebut, setEditDebut] = useState("");
  const [editFin, setEditFin] = useState("");

  const ouvrirEdition = () => {
    if (!enAttente) return;
    setRetour(null);
    setEditNom(enAttente.nom);
    setEditDebut(enAttente.periode_debut.slice(0, 10));
    setEditFin(enAttente.periode_fin.slice(0, 10));
    setEdition(true);
  };

  const enregistrerEdition = async () => {
    if (!enAttente) return;
    setRetour(null);
    if (!editNom.trim()) {
      setRetour({ kind: "warn", text: "Le nom de la période est requis." });
      return;
    }
    if (!editDebut || !editFin) {
      setRetour({ kind: "warn", text: "Les dates de début et de fin sont requises." });
      return;
    }
    if (editDebut > editFin) {
      setRetour({ kind: "warn", text: "La date de début doit précéder la date de fin." });
      return;
    }
    try {
      await modifier.mutateAsync({
        id: enAttente.id,
        name: editNom.trim(),
        periodStart: editDebut,
        periodEnd: editFin,
      });
      setEdition(false);
      setRetour({ kind: "ok", text: "Période modifiée." });
    } catch (error) {
      setRetour({ kind: "warn", text: (error as Error).message });
    }
  };

  const lancerSuppression = async () => {
    if (!enAttente) return;
    setSuppression(false);
    setRetour(null);
    try {
      await supprimer.mutateAsync(enAttente.id);
      setEdition(false);
      setRetour({ kind: "ok", text: "Période supprimée. Vous pouvez en ouvrir une autre." });
    } catch (error) {
      setRetour({ kind: "warn", text: (error as Error).message });
    }
  };

  const champ =
    "rounded-md border border-input bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed";

  const soumettre = async () => {
    setRetour(null);
    if (!nom.trim()) {
      setRetour({ kind: "warn", text: "Le nom de la période est requis." });
      return;
    }
    if (!debut || !fin) {
      setRetour({ kind: "warn", text: "Les dates de début et de fin sont requises." });
      return;
    }
    // Comparaison de chaînes : un `<input type="date"` rend toujours du
    // YYYY-MM-DD, dont l'ordre lexicographique est l'ordre chronologique. Le
    // serveur revérifie ; ce contrôle évite juste l'aller-retour.
    if (debut > fin) {
      setRetour({ kind: "warn", text: "La date de début doit précéder la date de fin." });
      return;
    }
    try {
      /* `teacherIds` absent = période COLLECTIVE côté API. C'est désormais le
         seul mode offert par cet écran. */
      await creer.mutateAsync({
        name: nom.trim(),
        periodStart: debut,
        periodEnd: fin,
      });
      setNom("");
      setDebut("");
      setFin("");
      setRetour({
        kind: "ok",
        text: "Période créée. Lancez son calcul pour pouvoir en ouvrir une autre.",
      });
    } catch (error) {
      setRetour({ kind: "warn", text: (error as Error).message });
    }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-2">
          <CalendarPlus className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold text-lg">Période de paiement</h2>
            <p className="text-muted-foreground mt-0.5 whitespace-nowrap text-sm md:text-base">
              Ouvrez une période pour tous les enseignants, ou pour un seul — un rattrapage, un
              vacataire oublié, un solde de tout compte.
            </p>
          </div>
        </div>

        {/* Verrou */}
        {bloque && enAttente && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-amber-200 flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              Une période attend son calcul
            </p>
            <p className="text-sm text-amber-200 mt-1">
              <span className="font-medium">{enAttente.nom}</span>{" "}
              {enAttente.enseignants.length > 0 ? (
                <>
                  — {enAttente.enseignants.length} enseignant(s) :{" "}
                  {enAttente.enseignants
                    .slice(0, 3)
                    .map((e) => e.nom)
                    .join(", ")}
                  {enAttente.enseignants.length > 3 &&
                    ` et ${enAttente.enseignants.length - 3} autre(s)`}
                </>
              ) : (
                <>— collective</>
              )}
              , du {fmtDate(enAttente.periode_debut)} au {fmtDate(enAttente.periode_fin)}. Aucune
              autre période ne peut être ouverte tant que celle-ci n'a pas servi au calcul.
            </p>
            {/* Corriger avant de calculer. Une faute de nom ou de bornes ne se
                rattrape plus une fois les bulletins générés : les heures
                auront été collectées sur le mauvais intervalle. C'est donc ici,
                tant que rien n'est calculé, que la période reste malléable. */}
            {edition ? (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                <label className="flex flex-col gap-1 text-xs md:col-span-3">
                  <span className="text-amber-200">Nom de la période *</span>
                  <input
                    type="text"
                    value={editNom}
                    onChange={(e) => setEditNom(e.target.value)}
                    className={champ}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-amber-200">Du *</span>
                  <input
                    type="date"
                    value={editDebut}
                    onChange={(e) => setEditDebut(e.target.value)}
                    className={champ}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-amber-200">Au *</span>
                  <input
                    type="date"
                    value={editFin}
                    onChange={(e) => setEditFin(e.target.value)}
                    className={champ}
                  />
                </label>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={enregistrerEdition}
                    disabled={modifier.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {modifier.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={() => setEdition(false)}
                    className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm font-medium"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={ouvrirEdition}
                  className="inline-flex items-center gap-1.5 font-medium text-amber-100 underline underline-offset-2"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Modifier
                </button>
                <button
                  type="button"
                  onClick={() => setSuppression(true)}
                  disabled={supprimer.isPending}
                  className="inline-flex items-center gap-1.5 font-medium text-red-300 underline underline-offset-2 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer
                </button>
              </div>
            )}

            {/* SEULE COMMANDE DE CALCUL DE L'ÉCRAN.
                C'était un lien vers /payments/calculate, qui faisait quitter la
                page pour refaire ailleurs ce qu'un bouton d'ici faisait déjà.
                Deux chemins pour un même geste, dont un seul restait sous les
                yeux du gestionnaire. Le calcul se lance donc ici, sans
                navigation, à l'endroit exact où la période est annoncée. */}
            <button
              type="button"
              onClick={onCalculer}
              disabled={calculEnCours}
              className="inline-flex items-center gap-2 mt-3 rounded-lg bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {calculEnCours ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="h-4 w-4" />
              )}
              {calculEnCours ? "Calcul en cours…" : "Générer les bulletins de cette période"}
            </button>
          </div>
        )}

        {/* PÉRIODE DÉJÀ CALCULÉE, PAS ENCORE ARCHIVÉE.
            Ce bandeau manquait, et son absence coûtait cher : dès le premier
            calcul la période sort de l'état « en attente », le bandeau ambre
            disparaît, et l'écran n'offre plus aucune commande de calcul. Or
            c'est exactement là qu'on en a besoin — quand on s'aperçoit d'avoir
            généré avant d'avoir validé toutes les séances, ce qui produit des
            bulletins incomplets et des enseignants sans bulletin du tout.
            Le recalcul réécrit les bulletins existants de la période. */}
        {!enAttente && periodeCourante && bulletinsGeneres > 0 && (
          <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-indigo-200 flex items-center gap-2">
              <Calculator className="h-4 w-4 shrink-0" />
              {bulletinsGeneres} bulletin(s) générés sur « {periodeCourante.nom} »
            </p>
            <p className="text-sm text-indigo-200 mt-1">
              Une séance validée après le calcul n&apos;y figure pas : relancez le calcul pour
              l&apos;intégrer, puis archivez.
            </p>
            <button
              type="button"
              onClick={onCalculer}
              disabled={calculEnCours}
              className="inline-flex items-center gap-2 mt-3 rounded-lg border border-indigo-400/50 px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {calculEnCours ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="h-4 w-4" />
              )}
              {calculEnCours ? "Recalcul en cours…" : "Recalculer les bulletins"}
            </button>
          </div>
        )}

        {/* Aucun affichage du périmètre : toute période couvre l'ensemble des
            enseignants, il n'y a plus rien à choisir ni à signaler. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="text-muted-foreground">Nom de la période *</span>
            <input
              type="text"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              disabled={bloque}
              placeholder="ex. Août 2026"
              className={champ}
            />
          </label>

          {/* Bornes désormais OBLIGATOIRES. Le repli sur « le mois en cours »
              était acceptable tant que deux périodes ne pouvaient pas se
              recouvrir : les dates étaient devinables. Depuis que le
              chevauchement est permis, une borne implicite décide seule quelles
              heures tombent dans quel bulletin — cela se saisit, cela ne se
              devine pas. */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Du *</span>
            <input
              type="date"
              value={debut}
              onChange={(e) => setDebut(e.target.value)}
              disabled={bloque}
              required
              className={champ}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Au *</span>
            <input
              type="date"
              value={fin}
              onChange={(e) => setFin(e.target.value)}
              disabled={bloque}
              required
              className={champ}
            />
          </label>
        </div>

        <p className="text-xs text-muted-foreground">
          Les heures validées entre ces deux dates alimenteront le bulletin — celles déjà payées
          sur une autre période exclues.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={soumettre}
            disabled={bloque || creer.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creer.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Créer la période
          </button>
          {retour && (
            <span
              className={`text-sm ${retour.kind === "ok" ? "text-emerald-400" : "text-amber-500"}`}
            >
              {retour.text}
            </span>
          )}
        </div>

        {/* L'historique des périodes déjà calculées n'a pas sa place ici :
            cet écran sert à OUVRIR une période, pas à consulter les
            précédentes. Seule celle qui bloque la création reste affichée,
            ci-dessus, parce qu'elle conditionne l'action en cours.
            La liste complète vit ailleurs — le hook `usePeriodesPaie` reste
            disponible pour l'écran qui la portera. */}
      </CardContent>

      {/* Supprimer une période reste rare et définitif : la confirmation dit ce
          qu'on efface, pas seulement « êtes-vous sûr ». Aucun bulletin n'est
          en jeu — le serveur refuse la suppression dès qu'il en existe un. */}
      <ConfirmationDialog
        open={suppression}
        onOpenChange={setSuppression}
        title="Supprimer cette période de paiement ?"
        description={
          enAttente
            ? `« ${enAttente.nom} » (du ${fmtDate(enAttente.periode_debut)} au ` +
              `${fmtDate(enAttente.periode_fin)}) sera supprimée. Aucun bulletin n'a été ` +
              `généré, aucune heure ne sera perdue : elles resteront disponibles pour ` +
              `une prochaine période.`
            : ""
        }
        confirmText="Supprimer"
        cancelText="Annuler"
        onConfirm={lancerSuppression}
        loading={supprimer.isPending}
      />
    </Card>
  );
}

/* ============================ Composants ============================== */

function Indicateur({
  label,
  valeur,
  hint,
  icone,
  alerte,
}: {
  label: string;
  valeur: string;
  hint?: string;
  icone: React.ReactNode;
  alerte?: boolean;
}) {
  return (
    <Card className={alerte ? "border-amber-500/40" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className={alerte ? "text-amber-400" : "text-indigo-500"}>{icone}</span>
        </div>
        <div className={`text-2xl font-bold mt-1 ${alerte ? "text-amber-400" : ""}`}>{valeur}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/** Une carte pleine largeur par enseignant. */
function CarteEnseignant({
  enseignant: e,
  periode,
}: {
  enseignant: EnseignantPaie;
  /** Période qui pilote la carte. `null` = cycle terminé, compteurs à zéro. */
  periode: PeriodeCourante | null;
}) {
  const etat = ETATS[e.etat_configuration];
  const cfg = e.config;

  /**
   * Le bulletin de cet enseignant a été classé et rien n'a été réouvert depuis.
   * On le déduit de l'absence de bulletin courant alors qu'il en existe des
   * archivés.
   *
   * Ne suffit pas à afficher le bandeau : il faut AUSSI une période ouverte.
   * Ce drapeau est un cumul de toute la vie de l'enseignant, il resterait vrai
   * à jamais une fois son premier bulletin classé.
   */
  const dejaArchive = !e.bulletin && e.nb_bulletins_archives > 0;

  return (
    <Card className={etat.carte}>
      <CardContent className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          {/* Identité */}
          <div className="lg:w-64 shrink-0">
            <div className="flex items-start gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium shrink-0 ${etat.pastille}`}
              >
                {etat.icone}
                {etat.label}
              </span>
            </div>
            <h2 className="font-semibold text-base mt-2 break-words">{e.nom}</h2>
            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
              {e.matricule && <div className="font-mono">{e.matricule}</div>}
              {e.email && (
                <div className="flex items-center gap-1 break-all">
                  <Mail className="h-3 w-3 shrink-0" />
                  {e.email}
                </div>
              )}
            </div>
          </div>

          {/* Configuration */}
          <div className="flex-1 min-w-0">
            {cfg ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
                  <Donnee label="Type" valeur={TYPE_LABELS[cfg.config_type] ?? cfg.config_type} fort />

                  {/* Seuls les champs QUI COMPTENT pour ce type sont montrés :
                      afficher « Taux horaire — » sur un salarié laisserait
                      croire à une donnée manquante. */}
                  {(cfg.config_type === "salary" || cfg.config_type === "mixed") && (
                    <Donnee
                      label="Salaire mensuel"
                      valeur={
                        cfg.monthly_salary != null
                          ? fmtMontant(cfg.monthly_salary)
                          : cfg.annual_salary != null
                            ? `${fmtMontant(cfg.annual_salary / 12)} (annuel ÷ 12)`
                            : "—"
                      }
                    />
                  )}
                  {(cfg.config_type === "hourly" || cfg.config_type === "mixed") && (
                    <Donnee label="Taux horaire" valeur={fmtMontant(cfg.default_hourly_rate)} />
                  )}
                  {cfg.config_type !== "salary" && (
                    <Donnee
                      label="Heures sup."
                      valeur={
                        cfg.overtime_threshold != null
                          ? `au-delà de ${cfg.overtime_threshold} h/sem. × ${cfg.overtime_multiplier ?? 1.5}`
                          : "—"
                      }
                    />
                  )}
                  {/* Les dates de validité ne sont plus affichées : la pastille
                      d'état les résume déjà là où elles comptent — « expirée »
                      ou « à venir » dit ce qu'elles impliquent, la plage brute
                      ne faisait que l'illustrer. */}
                </div>

                {/* Heures de la PÉRIODE COURANTE — la base du prochain calcul.
                    Sans période ouverte, le compteur est à zéro : le cycle est
                    terminé, l'écran attend qu'on en ouvre une nouvelle. */}
                <div className="mt-3 pt-3 border-t border-border">
                  {!periode ? (
                    <p className="text-xs text-muted-foreground">
                      Aucune période de paiement ouverte. Créez-en une pour voir les heures à
                      rémunérer.
                    </p>
                  ) : (
                    /* UNE SEULE LIGNE : la période et les heures qu'elle
                       contient. Elles se lisent ensemble — « combien, sur quel
                       exercice » — les empiler faisait chercher l'une pour
                       comprendre l'autre. `flex-wrap` les repasse l'une sous
                       l'autre sur écran étroit plutôt que de déborder : le
                       conteneur de l'application est en overflow-x-hidden, ce
                       qui rendrait le dépassement invisible et non défilable.

                       LA PÉRIODE N'APPARAÎT QU'ICI dans la carte. Elle était
                       répétée jusqu'à trois fois ; trois fois la même chose se
                       lit comme trois choses différentes. */
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <NomPeriode nom={periode.nom} />
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDate(periode.debut)} → {fmtDate(periode.fin)}
                        </span>
                      </div>

                      {e.heures.nb_seances === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Aucune séance validée sur cette période.
                        </p>
                      ) : (
                        /* Un seul chiffre : le cumul validé, tel que l'écran de
                           validation des séances le compte. Le découpage
                           « déjà payées / à payer » a été retiré — il incluait
                           des séances planifiées à des dates futures, donc
                           annonçait une dette qui n'existait pas. */
                        <Heure
                          label="Heures validées"
                          valeur={fmtHeures(e.heures.totales)}
                          hint={`${e.heures.nb_seances} séance(s)`}
                        />
                      )}
                    </div>
                  )}

                  {/* LE CAS DANGEREUX. « 0 heure » recouvre deux situations
                      opposées : l'enseignant qui n'a pas fait cours, et celui
                      dont les séances n'ont pas été validées. Le second sera
                      sauté de la paie en silence — d'où cet avertissement, à la
                      couleur de ce qui demande une action. */}
                  {periode && e.seances_a_valider > 0 && (
                    <p className="text-xs text-amber-400 mt-2 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      {e.seances_a_valider} séance(s) réalisée(s) non validée(s) sur cette
                      période : elles ne seront pas payées tant qu&apos;elles ne sont pas validées.
                    </p>
                  )}

                  {surSalaire(e) && e.heures.nb_seances > 0 && (
                    <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1">
                      <Info className="h-3 w-3 shrink-0 mt-0.5" />
                      Salaire fixe : ces heures sont constatées mais n'entrent pas dans le
                      calcul du montant.
                    </p>
                  )}
                </div>

                {/* Bulletin courant — consultable puis classable.

                    LE BANDEAU EST LIÉ À LA PÉRIODE, pas à l'enseignant. Sans
                    période ouverte, il n'y a rien à consulter ni à classer :
                    tout est archivé, et le bandeau disparaît entièrement.
                    Il restait auparavant en gris après le dernier archivage,
                    avec deux boutons inertes qui laissaient croire à une action
                    possible alors que le cycle était clos.

                    Pendant une période, en revanche, il reste affiché même
                    après archivage de CET enseignant : gris, il dit que sa part
                    est faite tandis que d'autres restent à classer. */}
                {periode && (e.bulletin || dejaArchive) && (
                  <div
                    className={`mt-3 rounded-lg border px-3 py-2 ${
                      e.bulletin
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-border bg-muted/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span
                        className={`font-semibold ${
                          e.bulletin ? "text-emerald-300" : "text-muted-foreground"
                        }`}
                      >
                        {e.bulletin
                          ? `Bulletin prêt — ${fmtMontant(e.bulletin.montant)}`
                          : "Bulletin archivé"}
                      </span>
                      {/* Pas de seconde pastille : la période est déjà affichée
                          en tête de section, et la répéter ici n'apprendrait
                          rien. Sauf dans le cas où le bulletin courant relève
                          d'une période ANTÉRIEURE — il reste au plan de travail
                          pendant qu'une nouvelle période est ouverte. Ce n'est
                          alors plus un doublon mais un écart, et c'est
                          précisément ce qu'il faut voir. */}
                      {e.bulletin ? (
                        e.bulletin.periode_nom !== periode?.nom && (
                          <NomPeriode nom={e.bulletin.periode_nom} />
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          consultable dans l&apos;historique
                        </span>
                      )}
                      {/* NI ARCHIVAGE NI PDF À LA CARTE.
                          Classer un bulletin isolé laissait la période à moitié
                          close, sans que rien ne dise lesquels restaient :
                          l'archivage est un geste unique, en tête d'écran.
                          Le PDF, lui, est parti à l'historique — c'est là qu'un
                          bulletin se consulte, une fois arrêté et versé. Le
                          proposer ici invitait à éditer un document avant même
                          que la période soit close. Cet écran sert à préparer
                          la paie, pas à distribuer des pièces. */}
                    </div>
                  </div>
                )}

                {e.etat_configuration !== "active" && (
                  <p className="text-xs text-amber-400 mt-3">{etat.aide}</p>
                )}
                {e.nb_configs > 1 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {e.nb_configs} configurations enregistrées — la plus pertinente est affichée.
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-start gap-2 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>{etat.aide}</p>
              </div>
            )}
          </div>

          {/* Action */}
          <div className="shrink-0 flex lg:flex-col gap-2">
            {/* Cette colonne ne porte plus que la CONFIGURATION. Les actions
                du bulletin — consulter, archiver — vivent dans leur bandeau,
                au plus près de l'objet qu'elles concernent. */}
            {/* Seul le cas MANQUANT appelle une action : un enseignant non
                configuré ne produira aucun bulletin, et c'est le seul défaut
                que cet écran doit faire corriger. Une configuration existante
                se modifie depuis son propre écran. */}
            {!cfg && (
              <Link
                href="/payments/teacher-configs/new"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                Configurer
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Un chiffre d'heures, sur une ligne compacte. */
/**
 * Le nom de la période, sorti du flux de texte.
 *
 * Il se lisait comme une donnée parmi d'autres, alors qu'il dit à quel exercice
 * TOUT le reste de la carte se rapporte — heures comptées, bulletin, montant.
 * Depuis que deux périodes peuvent couvrir les mêmes dates, savoir d'un coup
 * d'œil de laquelle on parle n'est plus un détail. La pastille le distingue
 * sans en faire un titre.
 */
function NomPeriode({ nom }: { nom: string }) {
  return (
    <span
      title={`Période de paiement : ${nom}`}
      className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-300 whitespace-nowrap"
    >
      <CalendarClock className="h-3 w-3 shrink-0" />
      {nom}
    </span>
  );
}

/* `accent` et `muet` ont disparu avec le bloc « Période de paiement » : ils n'ont
   plus aucun appelant. Le seul usage restant est le cumul d'heures validées. */
function Heure({ label, valeur, hint }: { label: string; valeur: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm mt-0.5 font-semibold">{valeur}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Donnee({
  label,
  valeur,
  fort,
}: {
  label: string;
  valeur: React.ReactNode;
  fort?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 break-words ${fort ? "font-semibold" : ""}`}>{valeur}</div>
    </div>
  );
}
