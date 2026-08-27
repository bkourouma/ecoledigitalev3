"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@ecoledigitale/ui";
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Lock,
  Users,
  UserRound,
  RefreshCcw,
  ListPlus,
  Plus,
  Eye,
} from "lucide-react";
import {
  useSeancesPaie,
  useSeanceOverlaps,
  useSetSeanceStatut,
  useValidateSeances,
  useSetSeanceDuree,
  useCreateSeanceComptable,
  useSeancesManquantes,
  useEnseignantsATraiter,
  BLOCKER_LABELS,
  type SeancePaie,
  type SeanceStatut,
  type SeanceManquante,
} from "@/lib/hooks/use-professional-remuneration";
import { useSessionEcueTeachers } from "@/lib/hooks/use-professional-catalog-admin";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openSeancesPdf } from "@/lib/utils/seance-report";
import {
  AideStatuts,
  FILTRES_VIDES,
  PaginationTableau,
  STATUT_LABELS,
  STATUT_STYLES,
  StatCard,
  fmtDate,
  fmtHeures,
  isLocked,
  useCohortes,
  useEnseignants,
  versSeanceFilters,
  type FiltresSeances,
  type Indicateur,
} from "./_shared";

/**
 * Plan de travail de la validation des séances — Module Professionnel
 * (feature 031, US1). Ne montre QUE les séances non encore validées.
 *
 * Cet écran est la SOURCE des heures rémunérées. Il matérialise la distinction
 * qui fonde la feature : le `statut` constate un fait pédagogique (le cours a eu
 * lieu), la validation engage une dépense. Une séance simplement planifiée n'est
 * jamais payée.
 *
 * Les séances déjà validées n'y figurent pas : elles noyaient les quelques
 * lignes à traiter sous des mois d'archives.
 *
 * Les motifs de non-payabilité (`blockers`) sont affichés explicitement : griser
 * une ligne sans dire pourquoi laisse le gestionnaire deviner. Ils viennent du
 * serveur — le prédicat n'est jamais réécrit ici.
 */
/**
 * Fenêtre du rapprochement avec l'emploi du temps.
 *
 * `/seances/manquantes` EXIGE deux bornes, et l'écran n'a plus de filtre par
 * dates. Sans fenêtre implicite, le bandeau des séances oubliées ne
 * s'afficherait donc plus jamais — le hook ne s'active que si les deux dates
 * sont fournies.
 *
 * On prend l'année scolaire en cours (pivot septembre, même convention que le
 * reste de l'application) jusqu'à aujourd'hui : une séance encore à venir ne
 * peut pas déjà être « oubliée ».
 */
function periodeRapprochement(): { fromDate: string; toDate: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const debut = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    fromDate: `${debut}-09-01`,
    // Date LOCALE : `toISOString()` bascule en UTC et décalerait d'un jour en
    // soirée sur les fuseaux à l'ouest.
    toDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}

export default function RemunerationSeancesPage() {
  const [filtres, setFiltres] = useState<FiltresSeances>(FILTRES_VIDES);
  const majFiltres = (patch: Partial<FiltresSeances>) =>
    setFiltres((prev) => ({ ...prev, ...patch }));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  // Pagination. 10 par défaut : l'écran se traite enseignant par enseignant,
  // et une page courte reste lisible sans défilement vertical.
  const [taillePage, setTaillePage] = useState(10);
  const [page, setPage] = useState(0);

  /**
   * L'identité de la page, pas des réglages : TOUTE séance pas encore validée,
   * quel que soit son statut.
   *
   * Le statut n'est volontairement PAS filtré. Il l'a été un temps sur
   * `realisee`, au motif qu'une séance planifiée n'est pas du travail en
   * attente. Mais c'est faux dans l'usage réel : l'enseignant fait l'appel sur
   * une séance restée « planifiée », et le comptable doit voir cette séance
   * arriver — sans elle, la présence saisie ne mène nulle part et le cours
   * n'est jamais payé. Le passage en « réalisée » se fait DEPUIS cet écran,
   * il ne peut donc pas en être la condition d'entrée.
   *
   * Aucune borne de dates non plus : une séance saisie hors de la fenêtre
   * regardée disparaîtrait silencieusement.
   */
  const filters = useMemo(
    () => ({
      ...versSeanceFilters(filtres, false),
      limit: taillePage,
      offset: page * taillePage,
    }),
    [filtres, taillePage, page]
  );

  // Changer de filtre remet en page 1 : rester en page 4 d'un résultat qui n'en
  // compte plus qu'une afficherait un tableau vide sans explication.
  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [filtres, taillePage]);

  const seancesQuery = useSeancesPaie(filters);
  // Sans bornes : un double paiement doit se signaler où qu'il soit, pas
  // seulement dans la fenêtre que l'utilisateur regarde.
  const overlapsQuery = useSeanceOverlaps({});
  const periode = useMemo(periodeRapprochement, []);
  const manquantesQuery = useSeancesManquantes(periode);
  const setStatutMutation = useSetSeanceStatut();
  const validateMutation = useValidateSeances();
  const setDureeMutation = useSetSeanceDuree();
  const createSeanceMutation = useCreateSeanceComptable();

  // Deux listes distinctes, volontairement : le FILTRE ne propose que les
  // enseignants ayant du travail en attente, le FORMULAIRE d'ajout doit pouvoir
  // désigner n'importe qui.
  const enseignantsATraiterQuery = useEnseignantsATraiter();
  const enseignantsATraiter = enseignantsATraiterQuery.data ?? [];
  const enseignants = useEnseignants();
  const { cohortes, isLoading: cohortesLoading } = useCohortes();

  const items = seancesQuery.data?.items ?? [];
  const total = seancesQuery.data?.total ?? items.length;
  const overlaps = overlapsQuery.data ?? [];
  const manquantes = manquantesQuery.data ?? [];
  const [showManquantes, setShowManquantes] = useState(false);

  /**
   * Indicateurs du périmètre AFFICHÉ.
   *
   * « Payable » vaut faux pour toutes les lignes de cette page : la validation
   * manque par construction. La question utile ici est donc « qu'est-ce qui
   * deviendra payable si je valide ? ».
   *
   * « Prêtes à valider » se lit sur les `blockers` renvoyés par l'API : une
   * séance dont le SEUL motif est NON_VALIDEE remplit déjà toutes les autres
   * conditions. Le prédicat n'est pas réécrit ici — le recopier avait déjà
   * produit un écran qui annonçait des séances que le serveur refusait.
   */
  const stats = useMemo<Indicateur[]>(() => {
    // Agrégats du SERVEUR : la liste est paginée, les calculer sur `items`
    // ne compterait que les 10 lignes de la page courante.
    const s = seancesQuery.data?.summary;

    return [
      {
        label: "Séances à traiter",
        value: String(total),
        hint: `${items.length} affichée(s) sur cette page`,
        icon: <Users className="h-5 w-5" />,
      },
      {
        label: "À valider",
        value: String(total),
        hint: "toutes séances, pas encore validées",
        icon: <Clock className="h-5 w-5" />,
      },
      {
        label: "Prêtes à valider",
        value: s ? String(s.pretes) : "—",
        hint: "aucun autre motif de blocage",
        icon: <CheckCircle2 className="h-5 w-5" />,
      },
      {
        label: "Heures à valider",
        value: s ? fmtHeures(s.heures_pretes) : "—",
        hint: "si vous validez les lignes prêtes",
        icon: <CalendarCheck className="h-5 w-5" />,
      },
    ];
  }, [items.length, total, seancesQuery.data?.summary]);

  /**
   * Périmètre exporté : les mêmes filtres que l'écran, mais SANS pagination —
   * le document reprend toutes les séances à valider, pas les 10 de la page.
   */
  const exportContexte = useMemo(
    () => ({
      filters: versSeanceFilters(filtres, false),
      perimetre: [
        [
          "Enseignant",
          filtres.enseignantId
            ? (enseignantsATraiter.find((t) => t.id === filtres.enseignantId)?.nom ??
              filtres.enseignantId)
            : "Tous les enseignants en attente",
        ],
        ["Portée", "Séances non encore validées"],
      ] as Array<[string, string]>,
    }),
    [filtres, enseignantsATraiter]
  );

  const selectionnables = useMemo(() => items.filter((s) => !isLocked(s)), [items]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    // Les lignes verrouillées sont exclues : les cocher promettrait une action
    // que le serveur refusera de toute façon.
    if (selected.size === selectionnables.length) setSelected(new Set());
    else setSelected(new Set(selectionnables.map((s) => s.id)));
  };

  const valider = async () => {
    if (selected.size === 0) return;
    setFeedback(null);
    try {
      const result = await validateMutation.mutateAsync({
        seanceIds: Array.from(selected),
        validated: true,
      });
      setSelected(new Set());
      if (result.rejected.length === 0) {
        setFeedback({
          kind: "ok",
          text: `${result.updated} séance(s) validée(s). Elles rejoignent l'historique.`,
        });
      } else {
        // Le lot est partiel : annoncer un succès global masquerait les rejets.
        const motifs = result.rejected.reduce<Record<string, number>>((acc, r) => {
          acc[r.reason] = (acc[r.reason] ?? 0) + 1;
          return acc;
        }, {});
        const detail = Object.entries(motifs)
          .map(([reason, n]) => `${n} × ${BLOCKER_LABELS[reason as keyof typeof BLOCKER_LABELS]}`)
          .join(", ");
        setFeedback({
          kind: "warn",
          text: `${result.updated} traitée(s), ${result.rejected.length} refusée(s) : ${detail}.`,
        });
      }
    } catch (error) {
      setFeedback({ kind: "warn", text: (error as Error).message });
    }
  };

  const changeStatut = async (id: string, next: SeanceStatut) => {
    setFeedback(null);
    try {
      await setStatutMutation.mutateAsync({ id, statut: next });
    } catch (error) {
      setFeedback({ kind: "warn", text: (error as Error).message });
    }
  };

  /**
   * Enregistre le volume horaire saisi. Une valeur égale à la durée planifiée
   * retire la dérogation plutôt que d'en poser une identique : marquer
   * « modifié » ce qui ne l'est pas rendrait le repère inutile.
   */
  const saveDuree = async (s: SeancePaie, raw: string) => {
    setFeedback(null);
    const trimmed = raw.trim().replace(",", ".");
    const valeur = trimmed === "" ? null : Number(trimmed);

    if (valeur !== null && (!Number.isFinite(valeur) || valeur <= 0)) {
      setFeedback({ kind: "warn", text: "Le volume horaire doit être un nombre positif." });
      return;
    }
    const identiqueAuPlanifie =
      valeur !== null &&
      s.duree_planifiee !== null &&
      Math.abs(valeur - s.duree_planifiee) < 0.005;
    const cible = identiqueAuPlanifie ? null : valeur;

    if ((s.duree_payee ?? null) === cible) return; // rien à écrire

    try {
      await setDureeMutation.mutateAsync({ id: s.id, duree: cible });
    } catch (error) {
      setFeedback({ kind: "warn", text: (error as Error).message });
    }
  };

  /* ------------------ Saisie libre d'une séance ------------------------ */

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    filiere_id: "",
    ue_session_id: "",
    ecue_id: "",
    enseignant_id: "",
    date: "",
    heure_debut: "",
    heure_fin: "",
    duree_payee: "",
    libelle: "",
  });

  // Les ECUE dépendent de la cohorte choisie, et portent l'enseignant affecté :
  // c'est ce qui permet de pré-remplir plutôt que de faire ressaisir.
  const ecuesQuery = useSessionEcueTeachers(form.ue_session_id || null);
  const ecuesDeLaCohorte = ecuesQuery.data ?? [];

  /**
   * Filières ayant au moins une session EN COURS.
   *
   * Déduites des sessions plutôt que chargées à part : proposer une filière
   * dont aucune session n'est ouverte mènerait à une liste de sessions vide,
   * sans expliquer pourquoi.
   */
  const filieresDuFormulaire = useMemo(() => {
    const parId = new Map<string, string>();
    for (const c of cohortes as any[]) {
      if (c.statut !== "en_cours") continue;
      if (c.filiere_id && !parId.has(c.filiere_id)) {
        parId.set(c.filiere_id, c.filiere_nom ?? c.filiere_code ?? "Filière");
      }
    }
    return Array.from(parId.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [cohortes]);

  /**
   * Sessions de la filière choisie, restreintes à celles EN COURS.
   *
   * Une session terminée ou annulée ne peut plus recevoir de séance : la
   * proposer inviterait à créer une séance qui ne serait jamais payée. Le
   * statut est tenu à jour côté API, qui bascule en « terminé » toute session
   * dont la date de fin est passée.
   */
  const sessionsDuFormulaire = useMemo(() => {
    if (!form.filiere_id) return [];
    return (cohortes as any[])
      .filter((c) => c.filiere_id === form.filiere_id && c.statut === "en_cours")
      .map((c) => ({ value: c.id, label: c.libelle }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [cohortes, form.filiere_id]);

  const resetForm = () =>
    setForm({
      filiere_id: "",
      ue_session_id: "",
      ecue_id: "",
      enseignant_id: "",
      date: "",
      heure_debut: "",
      heure_fin: "",
      duree_payee: "",
      libelle: "",
    });

  /** Choisir l'ECUE pré-remplit l'enseignant affecté, modifiable ensuite. */
  const choisirEcue = (ecueId: string) => {
    const ecue = ecuesDeLaCohorte.find((e: any) => e.ecue_id === ecueId);
    setForm((f) => ({
      ...f,
      ecue_id: ecueId,
      enseignant_id: ecue?.enseignant_id ?? f.enseignant_id,
    }));
  };

  const submitForm = async () => {
    setFeedback(null);
    const aHoraires = Boolean(form.heure_debut && form.heure_fin);
    const volume = form.duree_payee.trim().replace(",", ".");
    const aVolume = volume !== "" && Number(volume) > 0;

    if (!form.filiere_id || !form.ue_session_id || !form.ecue_id || !form.enseignant_id || !form.date) {
      setFeedback({
        kind: "warn",
        text: "Filière, session, ECUE, enseignant et date sont requis.",
      });
      return;
    }
    // Le libellé identifie la séance dans les écrans et sur le bulletin. Sur une
    // saisie manuelle — hors emploi du temps — c'est souvent le seul repère qui
    // dit de quoi il s'agit.
    if (!form.libelle.trim()) {
      setFeedback({ kind: "warn", text: "Le libellé de la séance est requis." });
      return;
    }
    if (!aHoraires && !aVolume) {
      setFeedback({
        kind: "warn",
        text: "Renseignez des horaires complets ou un volume horaire : sans durée, la séance ne peut pas être payée.",
      });
      return;
    }
    if (aHoraires && form.heure_fin <= form.heure_debut) {
      setFeedback({ kind: "warn", text: "L'heure de fin doit suivre l'heure de début." });
      return;
    }

    try {
      await createSeanceMutation.mutateAsync({
        ue_session_id: form.ue_session_id,
        ecue_id: form.ecue_id,
        enseignant_id: form.enseignant_id,
        date: form.date,
        heure_debut: aHoraires ? form.heure_debut : null,
        heure_fin: aHoraires ? form.heure_fin : null,
        duree_payee: aVolume ? Number(volume) : null,
        libelle: form.libelle.trim(),
      });
      resetForm();
      setShowForm(false);
      setFeedback({
        kind: "ok",
        text: "Séance ajoutée et marquée réalisée. Elle reste à valider pour être payée.",
      });
    } catch (error) {
      setFeedback({ kind: "warn", text: (error as Error).message });
    }
  };

  /** Crée la séance manquante à partir du créneau attendu, en un clic. */
  const ajouterDepuisCreneau = async (m: SeanceManquante) => {
    setFeedback(null);
    if (!m.enseignant_id) {
      setFeedback({
        kind: "warn",
        text: "Ce créneau n'a pas d'enseignant dans l'emploi du temps : complétez-le avant de l'ajouter.",
      });
      return;
    }
    try {
      await createSeanceMutation.mutateAsync({
        ue_session_id: m.ue_session_id,
        ecue_id: m.ecue_id,
        enseignant_id: m.enseignant_id,
        date: m.date,
        heure_debut: m.heure_debut,
        heure_fin: m.heure_fin,
      });
      setFeedback({
        kind: "ok",
        text: "Séance ajoutée et marquée réalisée. Elle reste à valider pour être payée.",
      });
    } catch (error) {
      setFeedback({ kind: "warn", text: (error as Error).message });
    }
  };

  const champ =
    "rounded-md border border-input bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <CalendarCheck className="h-7 w-7 text-indigo-500" />
            Validation des séances
          </h1>
          <p className="text-muted-foreground mt-2">
            Marquez les séances réellement effectuées, puis validez celles qui sont payables. Une
            séance planifiée, annulée ou non validée ne produit aucun montant lors du calcul.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButtons
            formats={["pdf"]}
            disabled={seancesQuery.isLoading || total === 0}
            onExportPdf={(win) => openSeancesPdf(exportContexte, win)}
            onError={(text) => setFeedback({ kind: "warn", text })}
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground -mt-3">
        Séances non encore validées : ce qui reste à décider. Une fois validées, elles passent
        dans l'historique.
      </p>

      {/* Chevauchements : à traiter avant validation, sinon double paiement. */}
      {overlaps.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-200">
              <p className="font-semibold">{overlaps.length} créneau(x) payé(s) deux fois</p>
              <p className="mt-1">
                Ces séances sont <strong>validées</strong> et se recoupent : le calcul paiera deux
                fois le même temps. Dévalidez-en une depuis l'historique, ou corrigez son volume
                horaire.
              </p>
              <ul className="mt-2 space-y-0.5">
                {overlaps.slice(0, 5).map((o: any, idx: number) => (
                  <li key={idx} className="text-xs">
                    <span className="font-medium">{o.enseignant_nom}</span> — {fmtDate(o.date)} :{" "}
                    <span className="font-mono">
                      {o.seance_a_debut?.slice(0, 5)}–{o.seance_a_fin?.slice(0, 5)}
                    </span>{" "}
                    ⟷{" "}
                    <span className="font-mono">
                      {o.seance_b_debut?.slice(0, 5)}–{o.seance_b_fin?.slice(0, 5)}
                    </span>
                  </li>
                ))}
                {overlaps.length > 5 && (
                  <li className="text-xs opacity-80">…et {overlaps.length - 5} autre(s).</li>
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rapprochement emploi du temps — séances attendues sans enregistrement.
          Sans ça, « ajouter une séance oubliée » suppose que le comptable sache
          déjà laquelle manque. */}
      {manquantes.length > 0 && (
        <Card className="border-indigo-500/40 bg-indigo-500/10">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <ListPlus className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-indigo-200 text-sm">
                  {manquantes.length} séance(s) attendue(s) à l'emploi du temps mais non
                  enregistrée(s)
                </p>
                <p className="text-sm text-indigo-200 mt-1">
                  Ces créneaux étaient planifiés sur la période et aucun enseignant n'a créé la
                  séance correspondante. Ajoutez-les pour qu'elles puissent être payées.
                </p>
                <button
                  onClick={() => setShowManquantes((v) => !v)}
                  className="mt-2 text-sm font-medium text-indigo-300 underline underline-offset-2"
                >
                  {showManquantes ? "Masquer la liste" : "Voir la liste"}
                </button>

                {showManquantes && (
                  <div className="mt-3 overflow-x-auto rounded-md border border-indigo-500/30 bg-card">
                    <table className="w-full text-sm">
                      <thead className="bg-indigo-500/15 text-indigo-200">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Date</th>
                          <th className="px-3 py-2 text-left font-medium">Horaires</th>
                          <th className="px-3 py-2 text-left font-medium">Volume</th>
                          <th className="px-3 py-2 text-left font-medium">Enseignant</th>
                          <th className="px-3 py-2 text-left font-medium">ECUE</th>
                          <th className="px-3 py-2 text-left font-medium">Cohorte</th>
                          <th className="px-3 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {manquantes.slice(0, 50).map((m, idx) => (
                          <tr key={`${m.ue_session_id}-${m.ecue_id}-${m.date}-${idx}`}>
                            <td className="px-3 py-2 whitespace-nowrap">{fmtDate(m.date)}</td>
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                              {m.heure_debut?.slice(0, 5)} – {m.heure_fin?.slice(0, 5)}
                            </td>
                            <td className="px-3 py-2 font-medium">{fmtHeures(m.duree_attendue)}</td>
                            <td className="px-3 py-2">{m.enseignant_nom ?? "—"}</td>
                            <td className="px-3 py-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                {m.ecue_code}
                              </span>{" "}
                              {m.ecue_libelle}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {m.cohorte_libelle ?? "—"}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => ajouterDepuisCreneau(m)}
                                disabled={createSeanceMutation.isPending}
                                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                              >
                                <Plus className="h-3 w-3" />
                                Ajouter
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {manquantes.length > 50 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        50 premières affichées sur {manquantes.length}. Réduisez l'intervalle de
                        dates pour traiter le reste.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Les compteurs d'abord, les filtres ensuite : on ouvre l'écran pour
          savoir ce qui reste à faire, puis on restreint pour le traiter. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>

      {/* Un seul filtre. L'écran est un plan de travail : on l'ouvre pour
          traiter un enseignant, pas pour explorer un catalogue. */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Enseignant</span>
            <SearchableSelect
              value={filtres.enseignantId}
              onChange={(v) => majFiltres({ enseignantId: v })}
              icon={<UserRound className="h-4 w-4 text-muted-foreground" />}
              placeholder={
                enseignantsATraiterQuery.isLoading
                  ? "Chargement…"
                  : enseignantsATraiter.length === 0
                    ? "Aucun enseignant en attente"
                    : "Tous les enseignants en attente"
              }
              searchPlaceholder="Rechercher un enseignant…"
              options={[
                { value: "", label: "Tous les enseignants en attente" },
                // Le compte évite d'ouvrir un enseignant pour découvrir
                // qu'il n'a qu'une ligne.
                ...enseignantsATraiter.map((t) => ({
                  value: t.id,
                  label: `${t.nom} (${t.nb_seances})`,
                })),
              ]}
            />
            <span className="text-xs text-muted-foreground">
              Seuls les enseignants ayant au moins une séance réalisée non validée sont proposés.
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Barre d'action */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={valider}
          disabled={selected.size === 0 || validateMutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white text-sm font-medium disabled:opacity-40"
        >
          <CheckCircle2 className="h-4 w-4" />
          Valider ({selected.size})
        </button>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setFeedback(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-300"
        >
          <Plus className="h-4 w-4" />
          Ajouter une séance
        </button>
        <button
          onClick={() => seancesQuery.refetch()}
          className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm"
        >
          <RefreshCcw className="h-4 w-4" />
          Actualiser
        </button>
        {feedback && (
          <span
            className={`text-sm ${feedback.kind === "ok" ? "text-emerald-400" : "text-amber-500"}`}
          >
            {feedback.text}
          </span>
        )}
      </div>

      {/* Saisie libre — pour une séance hors emploi du temps, que le
          rapprochement ne peut donc pas proposer. */}
      {showForm && (
        <Card className="border-indigo-500/40">
          <CardContent className="p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-lg">Ajouter une séance</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Pour une séance qui n'était pas à l'emploi du temps. Si elle y figurait, utilisez
                plutôt la liste des séances attendues ci-dessus : elle pré-remplit tout.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">Filière *</span>
                <SearchableSelect
                  value={form.filiere_id}
                  // Changer de filière invalide tout ce qui en dépend : la
                  // session, l'ECUE et l'enseignant pré-rempli. Les laisser en
                  // place produirait une séance rattachée à une autre filière.
                  onChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      filiere_id: v,
                      ue_session_id: "",
                      ecue_id: "",
                      enseignant_id: "",
                    }))
                  }
                  placeholder={cohortesLoading ? "Chargement…" : "Choisir une filière"}
                  searchPlaceholder="Rechercher une filière…"
                  options={filieresDuFormulaire}
                />
              </label>

              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">Session *</span>
                <SearchableSelect
                  value={form.ue_session_id}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, ue_session_id: v, ecue_id: "", enseignant_id: "" }))
                  }
                  placeholder={
                    !form.filiere_id
                      ? "Choisir une filière d'abord"
                      : sessionsDuFormulaire.length === 0
                        ? "Aucune session en cours pour cette filière"
                        : "Choisir une session"
                  }
                  searchPlaceholder="Rechercher une session…"
                  options={sessionsDuFormulaire}
                />
                <span className="text-xs text-muted-foreground">
                  Seules les sessions en cours sont proposées : une session terminée ne peut plus
                  recevoir de séance.
                </span>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Date *</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className={champ}
                />
              </label>

              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">ECUE *</span>
                <SearchableSelect
                  value={form.ecue_id}
                  onChange={choisirEcue}
                  placeholder={
                    !form.ue_session_id
                      ? "Choisir une cohorte d'abord"
                      : ecuesQuery.isLoading
                        ? "Chargement…"
                        : "Choisir une ECUE"
                  }
                  searchPlaceholder="Rechercher une ECUE…"
                  options={(ecuesDeLaCohorte as any[]).map((e: any) => ({
                    value: e.ecue_id,
                    label: `${e.ecue_code} — ${e.ecue_libelle}`,
                  }))}
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Enseignant *</span>
                <SearchableSelect
                  value={form.enseignant_id}
                  onChange={(v) => setForm((f) => ({ ...f, enseignant_id: v }))}
                  placeholder="Choisir un enseignant"
                  searchPlaceholder="Rechercher…"
                  options={enseignants.map((t) => ({ value: t.id, label: t.nom }))}
                />
              </label>
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium mb-1">Durée de la séance</p>
              <p className="text-sm text-muted-foreground mb-3">
                Renseignez les horaires <strong>ou</strong> directement le volume horaire. Sans
                l'un des deux, la séance ne pourra pas être payée.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Heure de début</span>
                  <input
                    type="time"
                    value={form.heure_debut}
                    onChange={(e) => setForm((f) => ({ ...f, heure_debut: e.target.value }))}
                    className={champ}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Heure de fin</span>
                  <input
                    type="time"
                    value={form.heure_fin}
                    onChange={(e) => setForm((f) => ({ ...f, heure_fin: e.target.value }))}
                    className={champ}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">
                    Volume horaire{" "}
                    {form.heure_debut && form.heure_fin && (
                      <span className="text-muted-foreground">(sinon déduit des horaires)</span>
                    )}
                  </span>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    placeholder="ex. 3"
                    value={form.duree_payee}
                    onChange={(e) => setForm((f) => ({ ...f, duree_payee: e.target.value }))}
                    className={champ}
                  />
                </label>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Libellé de la séance *</span>
              <input
                type="text"
                value={form.libelle}
                onChange={(e) => setForm((f) => ({ ...f, libelle: e.target.value }))}
                placeholder="ex. Rattrapage du 12 juillet"
                className={champ}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={submitForm}
                disabled={createSeanceMutation.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Enregistrer
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="rounded-lg border border-input px-4 py-2 text-sm"
              >
                Annuler
              </button>
              <span className="text-sm text-muted-foreground">
                La séance sera marquée « réalisée » et « ajoutée en comptabilité ». Elle reste à
                valider pour entrer dans un paiement.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Juste au-dessus du tableau : c'est là que la colonne Statut se
          manipule, donc là que la question se pose. */}
      <AideStatuts />

      {/* Tableau */}
      {seancesQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : seancesQuery.isError ? (
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 py-8 text-red-400">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(seancesQuery.error as Error)?.message ?? "Impossible de charger les séances."}</p>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucune séance à traiter sur ce périmètre : tout est validé.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Aucune colonne masquée : toutes sont demandées à l'écran. Le
              conteneur applicatif est en `overflow-x-hidden` et couperait ce
              qui dépasse — c'est donc la CARTE qui porte son propre
              défilement horizontal, avec sa barre en bas. */}
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm border-collapse">
              <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-2 py-2.5 w-9">
                    <input
                      type="checkbox"
                      checked={
                        selected.size === selectionnables.length && selectionnables.length > 0
                      }
                      onChange={toggleAll}
                      className="h-4 w-4 align-middle"
                    />
                  </th>
                  <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap">Date</th>
                  <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap">Horaires</th>
                  <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap">Volume</th>
                  <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap">
                    Enseignant
                  </th>
                  {/* ECUE, Libellé, Filière, Session, Semestre et Présences
                      sont sortis du tableau : six colonnes de contexte pour
                      quatre colonnes de décision rendaient chaque ligne
                      illisible. Elles vivent maintenant sur la fiche, accessible
                      par le bouton de fin de ligne. */}
                  <th className="px-2 py-2.5 text-left font-medium">Séance</th>
                  <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap">Statut</th>
                  <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap">Paie</th>
                  <th className="px-2 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((s) => {
                  const locked = isLocked(s);
                  return (
                    <tr key={s.id} className="hover:bg-muted/40">
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={() => toggle(s.id)}
                          disabled={locked}
                          title={
                            locked ? "Séance rattachée à un paiement approuvé ou payé" : undefined
                          }
                          className="h-4 w-4 disabled:opacity-30 mt-1"
                        />
                      </td>
                      <td className="px-2 py-2 align-top whitespace-nowrap">{fmtDate(s.date)}</td>
                      <td className="px-2 py-2 align-top whitespace-nowrap text-muted-foreground">
                        {s.heure_debut && s.heure_fin
                          ? `${s.heure_debut.slice(0, 5)} – ${s.heure_fin.slice(0, 5)}`
                          : "—"}
                      </td>
                      {/* Volume horaire : la valeur des horaires par défaut,
                          modifiable. La saisie ne réécrit jamais les horaires,
                          elle pose une dérogation lisible à côté du prévu. */}
                      <td className="px-2 py-2 align-top">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.25"
                            min="0"
                            defaultValue={s.duree_heures ?? ""}
                            key={`${s.id}-${s.duree_heures ?? "vide"}`}
                            disabled={locked}
                            onBlur={(e) => saveDuree(s, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            title={
                              locked
                                ? "Séance payée : volume non modifiable"
                                : "Volume retenu pour la paie. Videz le champ pour revenir aux horaires."
                            }
                            className="w-16 rounded-md border border-input bg-background text-foreground px-2 py-1 text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:bg-muted disabled:cursor-not-allowed"
                          />
                          <span className="text-xs text-muted-foreground">h</span>
                        </div>
                        {s.duree_payee != null && (
                          <div
                            className="text-[11px] text-amber-500 mt-0.5 whitespace-nowrap"
                            title={
                              s.duree_payee_par_nom
                                ? `Modifié par ${s.duree_payee_par_nom}`
                                : "Volume modifié"
                            }
                          >
                            modifié
                            {s.duree_planifiee != null && ` · prévu ${fmtHeures(s.duree_planifiee)}`}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="w-[9rem] line-clamp-2" title={s.enseignant_nom ?? undefined}>
                          {s.enseignant_nom ?? "—"}
                        </div>
                        {/* La personne qui saisit est aussi celle qui valide :
                            ce cumul doit rester visible en contrôle. */}
                        {s.saisie_comptable && (
                          <div
                            className="text-[11px] text-indigo-400 whitespace-nowrap"
                            title="Séance ajoutée depuis l'écran de paie"
                          >
                            ajoutée en compta.
                          </div>
                        )}
                      </td>
                      {/* Une seule colonne de contexte : l'intitulé de l'ECUE,
                          ce que le gestionnaire reconnaît. Filière, session,
                          semestre et pointages sont sur la fiche — les empiler
                          ici rendait la ligne illisible sans rien apporter à la
                          décision de valider. */}
                      <td className="px-2 py-2 align-top">
                        <div className="w-[16rem] line-clamp-2" title={s.ecue_libelle ?? undefined}>
                          {s.ecue_libelle ?? "—"}
                        </div>
                        {s.seance_libelle && (
                          <div
                            className="text-[11px] text-muted-foreground line-clamp-1"
                            title={s.seance_libelle}
                          >
                            {s.seance_libelle}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          value={s.statut}
                          onChange={(e) => changeStatut(s.id, e.target.value as SeanceStatut)}
                          disabled={locked}
                          className={`rounded-md border px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed ${STATUT_STYLES[s.statut]}`}
                        >
                          {/* On ne PROPOSE que « Réalisée » et « Annulée » :
                              l'appel fait déjà basculer la séance en réalisée,
                              repasser à « planifiée » depuis la paie n'a pas de
                              sens.

                              Mais le statut courant est toujours listé, même
                              s'il n'est pas proposé. Sans lui, la valeur du
                              select ne correspondrait à aucune option et le
                              navigateur afficherait la PREMIÈRE : une séance
                              planifiée s'affichait « Réalisée » sans l'être, en
                              contradiction avec son propre motif de blocage, et
                              aucun onChange ne partait puisque l'utilisateur
                              « choisissait » ce qui semblait déjà là. */}
                          {(Array.from(
                            new Set<SeanceStatut>(["realisee", "annulee", s.statut])
                          ) as SeanceStatut[]).map((v) => (
                            <option key={v} value={v} className="bg-background text-foreground">
                              {STATUT_LABELS[v]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        {locked ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                            <Lock className="h-3.5 w-3.5" />
                            Payée
                          </span>
                        ) : (
                          // Le motif, pas seulement l'absence : c'est ce qui
                          // permet à l'utilisateur de corriger.
                          <span className="text-xs text-muted-foreground">
                            {s.blockers.map((b) => BLOCKER_LABELS[b]).join(" · ")}
                          </span>
                        )}
                      </td>
                      {/* Accès à tout ce que la ligne ne montre plus. */}
                      <td className="px-2 py-2 align-top">
                        <Link
                          href={`/professionnel/admin/remuneration/seances/${s.id}`}
                          title="Voir la fiche complète de la séance"
                          className="inline-flex items-center justify-center rounded-md border border-input p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationTableau
            page={page}
            taillePage={taillePage}
            total={total}
            affichees={items.length}
            onPage={setPage}
            onTaillePage={setTaillePage}
          />
        </Card>
      )}
    </div>
  );
}
