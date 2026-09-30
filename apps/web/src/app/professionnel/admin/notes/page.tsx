"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Card, CardContent, Button, Input } from "@ecoledigitale/ui";
import {
  Layers,
  CalendarRange,
  BookOpen,
  GraduationCap,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  FileSpreadsheet,
  Save,
  CheckCircle2,
  Star,
  AlertTriangle,
  History,
  RotateCcw,
  Lock,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  useNotesNoms,
  useNotesSemestres,
  useSemestreSessions,
  useSessionGrid,
  useSemestreConduite,
  useRecomputeSession,
  useCloturerSemestre,
  useUpsertManualNote,
  useDeleteManualNote,
} from "@/lib/hooks/use-professional-bulletins";

const ECUE_STATUT: Record<string, { label: string; cls: string }> = {
  valide: { label: "Validé", cls: "bg-green-100 text-green-700" },
  compense: { label: "Compensé", cls: "bg-blue-100 text-blue-700" },
  insuffisant: { label: "Insuffisant", cls: "bg-amber-100 text-amber-700" },
  eliminatoire: { label: "Éliminatoire", cls: "bg-red-100 text-red-700" },
  en_cours: { label: "En attente", cls: "bg-gray-100 text-gray-600" },
};

function fmt(x: number | null | undefined): string {
  return x == null ? "—" : Number(x).toFixed(2).replace(".", ",");
}

/** Nom de classe porte par une session : son libelle sans le suffixe « — CODE UE ». */
function nomDeClasse(libelle?: string | null, ueCode?: string | null): string {
  const lib = String(libelle ?? "").trim();
  const code = String(ueCode ?? "").trim();
  if (code && lib.endsWith(code)) {
    return lib.slice(0, lib.length - code.length).replace(/[\s—–-]+$/u, "").trim() || lib;
  }
  return lib;
}

export default function NotesPage() {
  // L'année scolaire commande la sélection : elle restreint les noms.
  const [annee, setAnnee] = useState("");
  // Sélection au grain du nom de classe : « classeId|nom ».
  const [nomKey, setNomKey] = useState("");
  const [semestreId, setSemestreId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const qc = useQueryClient();

  const { data: session } = useSession();
  const roles = ((session as any)?.roles ?? []) as string[];
  const isAdmin =
    Array.isArray(roles) && roles.some((r) => ["admin", "super_admin", "Administrateur"].includes(r));

  // Saisie = uniquement ce qui est encore ouvert. Les filières et semestres dont
  // toutes les cohortes sont terminées relèvent de la page Historique.
  const nomsQuery = useNotesNoms("actives");
  const filiereId = nomKey ? nomKey.split("|")[0] : "";
  const nomClasse = nomKey ? nomKey.split("|").slice(1).join("|") : "";
  const semestresQuery = useNotesSemestres(filiereId || null, "actives");
  const sessionsQuery = useSemestreSessions(semestreId || null);
  const gridQuery = useSessionGrid(sessionId || null);
  const conduiteQuery = useSemestreConduite(isAdmin && semestreId ? semestreId : null);
  const recomputeMut = useRecomputeSession();
  const cloturerMut = useCloturerSemestre();
  // Confirmation de clôture affichée dans la page (et non par window.confirm).
  const [confirmerCloture, setConfirmerCloture] = useState(false);

  // Années scolaires des classes accessibles. L'API restreint déjà ces
  // lignes aux cohortes de l'enseignant connecté : un enseignant ne voit
  // donc que les années où il enseigne.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of nomsQuery.data ?? []) if (n.annee_scolaire) set.add(n.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [nomsQuery.data]);

  // L'API renvoie une ligne par couple (nom, semestre) : on dédoublonne,
  // en ne gardant que l'année retenue.
  const nomOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nomsQuery.data ?? []) {
      if (annee && n.annee_scolaire !== annee) continue;
      map.set(`${n.classe_id}|${n.nom}`, n.nom);
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [nomsQuery.data, annee]);

  // Première année proposée par défaut.
  useEffect(() => {
    if (!annee && anneeOptions.length > 0) setAnnee(anneeOptions[0].value);
  }, [anneeOptions, annee]);

  // Changer d'année peut faire disparaître le nom retenu.
  useEffect(() => {
    if (nomKey && !nomOptions.some((o) => o.value === nomKey)) {
      setNomKey("");
      setSemestreId("");
      setSessionId("");
    }
  }, [nomOptions, nomKey]);
  // Semestres de la filière, restreints par l'API aux seuls encore actifs : il
  // n'y a donc plus de filtre d'année ici, l'historique vit sur sa propre page.
  const visibleSemestres: any[] = useMemo(
    () => (filiereId ? ((semestresQuery.data as any[]) ?? []) : []),
    [semestresQuery.data, filiereId]
  );

  // Clôture du semestre sélectionné : les bulletins sont arrêtés, le serveur
  // refuse désormais toute écriture de note. On le dit AVANT la frappe plutôt
  // que de laisser remplir un formulaire qui sera refusé ligne par ligne.
  const semestreClotureLe: string | null = useMemo(() => {
    const sem = visibleSemestres.find((x) => x.id === semestreId);
    return sem?.bulletins_clotures_at ?? null;
  }, [visibleSemestres, semestreId]);

  // Si le semestre sélectionné n'est plus dans la liste (changement de filière,
  // ou semestre qui vient de se terminer), on le désélectionne.
  useEffect(() => {
    if (semestreId && !visibleSemestres.some((s) => s.id === semestreId)) {
      setSemestreId("");
      setSessionId("");
    }
  }, [visibleSemestres, semestreId]);

  // UE (sessions) du semestre : hors « Conduite », sans inscrit, et hors cohortes
  // terminées ou annulées — la saisie ne concerne que ce qui est encore ouvert.
  const sessions: any[] = ((sessionsQuery.data as any[]) ?? [])
    .filter((s) => !String(s.ue_libelle ?? "").toLowerCase().startsWith("conduite"))
    .filter((s) => Number(s.nb_inscrits ?? 0) > 0)
    .filter((s) => !["termine", "annule"].includes(String(s.statut ?? "")))
    // Un semestre peut porter deux noms de classe : on ne garde que le sien.
    .filter((s) => !nomClasse || nomDeClasse(s.session_libelle, s.ue_code) === nomClasse);
  const grid: any = gridQuery.data ?? null;
  const ecues: any[] = grid?.ecues ?? [];
  const students: any[] = grid?.students ?? [];

  // Conduite : chargée au niveau SEMESTRE (indépendante de l'UE choisie), donc
  // la note déjà saisie reste affichée quelle que soit l'UE sélectionnée.
  const conduite: any = (conduiteQuery.data as any)?.conduite ?? null;
  const conduiteStudents: any[] = (conduiteQuery.data as any)?.students ?? [];
  const conduiteByStudent = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of conduiteStudents) m.set(s.student_id, s);
    return m;
  }, [conduiteStudents]);
  const showConduite = isAdmin && !!conduite;

  function resultOf(eid: string, sid: string) {
    return grid?.results?.find((r: any) => r.ecue_id === eid && r.student_id === sid) ?? null;
  }
  function devoirsOf(eid: string, sid: string) {
    return (grid?.notes ?? []).filter(
      (n: any) => n.ecue_id === eid && n.student_id === sid && n.nature === "devoir"
    );
  }
  /** Note d'examen de la Session 1 — la seule saisie sur cette page. */
  function examenOf(eid: string, sid: string) {
    return (
      (grid?.notes ?? []).find(
        (n: any) =>
          n.ecue_id === eid &&
          n.student_id === sid &&
          n.nature === "examen" &&
          (n.session ?? 1) === 1
      ) ?? null
    );
  }
  /**
   * Note d'examen de rattrapage (Session 2), saisie sur la page « Rattrapages ».
   * Simplement signalée ici : elle remplace la note de Session 1 dans le calcul.
   */
  function rattrapageOf(eid: string, sid: string) {
    return (
      (grid?.notes ?? []).find(
        (n: any) =>
          n.ecue_id === eid &&
          n.student_id === sid &&
          n.nature === "examen" &&
          (n.session ?? 1) === 2
      ) ?? null
    );
  }
  function evalSubsOf(eid: string, sid: string) {
    return (grid?.submissions ?? []).filter((s: any) => s.ecue_id === eid && s.student_id === sid);
  }

  /**
   * Clôture des notes du semestre : ses cohortes passent à « terminé », donc
   * le semestre quitte cet écran pour l'historique, en lecture seule. Geste
   * irréversible depuis l'interface — d'où la confirmation.
   */
  const libelleSemestreCloture =
    visibleSemestres.find((s) => s.id === semestreId)?.libelle ?? "ce semestre";

  async function handleCloturer() {
    setConfirmerCloture(false);
    setError(null);
    try {
      await cloturerMut.mutateAsync(semestreId);
      // Le semestre n'est plus dans cette liste : on repart d'une sélection vide.
      setSemestreId("");
      setSessionId("");
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la clôture du semestre.");
    }
  }

  /**
   * Étudiants affichés sans note de conduite : la conduite est saisie sur la
   * page « Conduite » et entre dans les moyennes du semestre.
   */
  const missingConduite = useMemo(
    () =>
      showConduite ? students.filter((s) => conduiteByStudent.get(s.student_id)?.note == null) : [],
    [showConduite, students, conduiteByStudent]
  );

  /**
   * Garde-fou : la conduite entre dans les moyennes du semestre, donc aucun
   * calcul n'est possible tant qu'un étudiant affiché n'a pas la sienne.
   * Renvoie `true` (et affiche le motif) quand le calcul doit être refusé.
   */
  function blockedByMissingConduite(): boolean {
    if (missingConduite.length === 0) return false;
    const noms = missingConduite
      .slice(0, 10)
      .map((s) => `${s.first_name} ${s.last_name}`)
      .join(", ");
    const reste = missingConduite.length > 10 ? `, et ${missingConduite.length - 10} autre(s)` : "";
    setError(
      `Calcul impossible : ${missingConduite.length} étudiant(s) n'ont pas de note de conduite ` +
        `(${noms}${reste}). Saisissez-les sur la page « Conduite », puis relancez le calcul.`
    );
    return true;
  }

  async function handleRecompute() {
    if (!sessionId) return;
    if (blockedByMissingConduite()) return;
    setError(null);
    try {
      await recomputeMut.mutateAsync(sessionId);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors du recalcul.");
    }
  }

  /**
   * Enregistre toutes les saisies en cours puis lance le calcul.
   * Force la validation du champ actif, attend la fin des enregistrements en
   * cours, puis recalcule les moyennes de l'UE sélectionnée.
   *
   * Refusé tant qu'une note de conduite manque (voir `blockedByMissingConduite`).
   */
  async function handleSaveAndCompute() {
    if (!sessionId) return;
    if (blockedByMissingConduite()) return;
    setError(null);
    setSaved(false);
    setSavingAll(true);
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
      await new Promise((r) => setTimeout(r, 80));
      let guard = 0;
      while (qc.isMutating() > 0 && guard < 200) {
        await new Promise((r) => setTimeout(r, 50));
        guard++;
      }
      await recomputeMut.mutateAsync(sessionId);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement / du calcul.");
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto p-6">
      <ConfirmationDialog
        open={confirmerCloture}
        onOpenChange={setConfirmerCloture}
        title={`Clôturer les notes de « ${libelleSemestreCloture} » ?`}
        description={
          `Ses ${sessions.length} UE passeront en « Terminé » : la saisie ne sera plus possible ` +
          `et le semestre basculera dans l'Historique des notes.`
        }
        confirmText="Clôturer"
        variant="destructive"
        loading={cloturerMut.isPending}
        onConfirm={() => void handleCloturer()}
      />
      {/* Header — actions sous le titre : à droite, cinq boutons écrasaient le titre. */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <GraduationCap className="h-7 w-7 text-indigo-500" />
            Saisie des notes
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Saisissez les notes de devoirs et d'examen par ECUE. Les notes des évaluations sont
            reprises automatiquement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/professionnel/admin/notes/rattrapages">
            <Button
              variant="outline"
              title="Saisir les examens de Session 2 des étudiants non validés"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Rattrapages
            </Button>
          </Link>
          <Link href="/professionnel/admin/notes/historique">
            <Button variant="outline" title="Consulter les notes des sessions terminées">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Button>
          </Link>
          {isAdmin && (
            <Link href="/professionnel/admin/bulletins">
              <Button variant="outline">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Bulletins
              </Button>
            </Link>
          )}
          {/* Clôture du semestre (admin uniquement) : bascule ses UE en « Terminé »,
              donc vers l'Historique — où se fait l'export. */}
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => setConfirmerCloture(true)}
              disabled={
                !semestreId ||
                sessions.length === 0 ||
                cloturerMut.isPending ||
                missingConduite.length > 0 ||
                !!semestreClotureLe
              }
              title={
                !semestreId
                  ? "Choisissez une classe et un semestre"
                  : missingConduite.length > 0
                    ? `Clôture bloquée : ${missingConduite.length} étudiant(s) sans note de conduite.`
                    : "Clôturer les notes du semestre et le basculer dans l'Historique"
              }
              className="bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-700 hover:text-amber-800"
            >
              {cloturerMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Lock className="h-4 w-4 mr-2" />
              )}
              Clôturer le semestre
            </Button>
          )}
          <Button
            onClick={handleRecompute}
            disabled={
              !sessionId ||
              recomputeMut.isPending ||
              missingConduite.length > 0 ||
              !!semestreClotureLe
            }
            title={
              semestreClotureLe
                ? "Semestre clôturé : les notes ne sont plus modifiables."
                : missingConduite.length > 0
                  ? `Calcul bloqué : ${missingConduite.length} étudiant(s) sans note de conduite.`
                  : undefined
            }
            className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
          >
            {recomputeMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Recalculer
          </Button>
        </div>
      </div>

      {semestreClotureLe && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <Lock className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>Semestre clôturé</strong> le{" "}
            {new Date(semestreClotureLe).toLocaleDateString("fr-FR")}. Les bulletins sont
            arrêtés : les notes ne sont plus modifiables et le calcul ne peut plus être relancé.
            La saisie reste visible en lecture.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Sélecteurs — classe, semestre, UE. Tous restreints aux cohortes encore
          ouvertes : les sessions terminées se consultent sur la page Historique. */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={annee}
              onChange={(v) => {
                setAnnee(v);
                setNomKey("");
                setSemestreId("");
                setSessionId("");
              }}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={nomsQuery.isLoading ? "Chargement…" : "Année scolaire"}
              searchPlaceholder="Rechercher une année…"
              options={anneeOptions}
            />
            <SearchableSelect
              value={nomKey}
              onChange={(v) => {
                setNomKey(v);
                setSemestreId("");
                setSessionId("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              disabled={!annee}
              placeholder="Nom de classe"
              searchPlaceholder="Rechercher un nom de classe…"
              options={nomOptions}
            />
            <SearchableSelect
              value={semestreId}
              onChange={(v) => {
                setSemestreId(v);
                setSessionId("");
              }}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              disabled={!nomKey}
              placeholder="Semestre"
              searchPlaceholder="Rechercher un semestre…"
              options={visibleSemestres.map((s) => ({ value: s.id, label: s.libelle }))}
            />
            <SearchableSelect
              value={sessionId}
              onChange={setSessionId}
              icon={<BookOpen className="h-4 w-4 text-gray-400" />}
              disabled={!semestreId}
              placeholder={sessionsQuery.isLoading ? "Chargement…" : "UE"}
              searchPlaceholder="Rechercher une UE…"
              options={sessions.map((s) => ({
                value: s.id,
                label: `${s.ue_libelle ?? ""}${s.ue_code ? ` (${s.ue_code})` : ""}`.trim(),
              }))}
            />
          </div>
          {/* La Session 2 (rattrapage) se saisit sur sa propre page : elle ne
              concerne que les étudiants non validés, examens uniquement. */}
          <p className="pt-1 text-xs text-muted-foreground">
            Saisie de la <span className="font-medium">Session 1 (normale)</span>. Les examens de{" "}
            <Link
              href="/professionnel/admin/notes/rattrapages"
              className="font-medium underline underline-offset-2"
            >
              Session 2 (rattrapage)
            </Link>{" "}
            se saisissent sur la page dédiée, qui ne liste que les étudiants non validés.
          </p>
        </CardContent>
      </Card>

      {/* Grille de saisie de l'UE sélectionnée (ECUE × étudiants + conduite) */}
      {!sessionId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <GraduationCap className="h-8 w-8 text-indigo-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une classe, un semestre puis une UE pour saisir les notes.
            </p>
          </CardContent>
        </Card>
      ) : gridQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : students.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucun étudiant inscrit (confirmé) dans cette UE.
          </CardContent>
        </Card>
      ) : ecues.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Cette UE n'a pas d'ECUE (hors Conduite).
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Conduites manquantes : le calcul est refusé tant qu'il en manque une. */}
          {missingConduite.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <span className="font-medium">Calcul bloqué</span> —{" "}
                <span className="font-medium">{missingConduite.length}</span> étudiant
                {missingConduite.length > 1 ? "s" : ""} sans note de conduite, alors qu'elle entre
                dans les moyennes du semestre.
              </span>
              <Link
                href="/professionnel/admin/conduite"
                className="font-medium underline underline-offset-2"
              >
                Saisir les conduites
              </Link>
            </div>
          )}

          {/* Barre d'action — juste au-dessus du tableau. */}
          <div className="flex items-center justify-end gap-3 rounded-xl border border-border bg-background px-4 py-3 shadow-sm">
            {saved && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Enregistré et calculé
              </span>
            )}
            <Button
              onClick={handleSaveAndCompute}
              disabled={savingAll || recomputeMut.isPending || missingConduite.length > 0}
              title={
                missingConduite.length > 0
                  ? `Calcul bloqué : ${missingConduite.length} étudiant(s) sans note de conduite.`
                  : undefined
              }
              className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
            >
              {savingAll || recomputeMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer et calculer
            </Button>
          </div>

        <Card className="shadow-sm">
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
            <BookOpen className="h-4 w-4 text-indigo-500 shrink-0" />
            <span className="font-semibold">{grid?.session?.ue_libelle ?? "Unité d'enseignement"}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              · {ecues.length} ECUE · {students.length} étudiant{students.length > 1 ? "s" : ""}
              {showConduite ? " · conduite incluse" : ""}
            </span>
          </div>
          <CardContent className="p-0 overflow-x-auto">
            {/* Semestre cloture : tout le tableau passe en lecture seule.
                Un <fieldset disabled> desactive nativement chaque champ et
                chaque bouton qu'il contient — y compris ceux qu'on ajoutera
                plus tard. Desactiver seulement les boutons d'action laissait
                les notes saisissables, et le refus n'arrivait qu'au serveur. */}
            <fieldset
              disabled={!!semestreClotureLe}
              className="m-0 border-0 p-0 disabled:opacity-100"
            >
            <table className="min-w-full text-[15px] border-collapse">
              <thead>
                {/* En-tête groupé : une ECUE = 3 sous-colonnes (Devoirs / Examen / Note) */}
                <tr className="bg-muted/60 border-b border-border">
                  <th
                    rowSpan={2}
                    className="md:sticky md:left-0 sticky top-0 z-30 bg-muted/60 px-5 py-3 text-left font-medium border-r border-border whitespace-nowrap"
                  >
                    Étudiant
                  </th>
                  {ecues.map((e) => (
                    <th
                      key={e.ecue_id}
                      colSpan={3}
                      className="sticky top-0 z-20 h-14 bg-muted/60 px-4 py-3 text-center font-semibold border-r border-border whitespace-nowrap"
                    >
                      <span className="font-mono text-xs opacity-70">{e.code}</span> {e.libelle}
                      {e.credits != null && <span className="opacity-70"> · {e.credits} cr.</span>}
                    </th>
                  ))}
                  {showConduite && (
                    <th
                      rowSpan={2}
                      className="sticky top-0 z-20 px-4 py-3 text-center font-semibold bg-amber-500/20 border-l border-border align-middle whitespace-nowrap"
                    >
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <Star className="h-4 w-4 text-amber-500" /> Conduite (/20)
                      </span>
                      <Link
                        href="/professionnel/admin/conduite"
                        className="mt-0.5 block text-[10px] font-normal text-muted-foreground underline"
                        title="La note de conduite se saisit sur la page Conduite"
                      >
                        saisie sur la page Conduite
                      </Link>
                    </th>
                  )}
                </tr>
                <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground">
                  {ecues.map((e) => (
                    <Fragment key={e.ecue_id}>
                      <th className="sticky top-14 z-20 bg-muted/40 px-4 py-2.5 font-medium whitespace-nowrap">
                        Devoirs (/20)
                      </th>
                      <th className="sticky top-14 z-20 bg-muted/40 px-4 py-2.5 font-medium whitespace-nowrap">
                        Examen (/20)
                      </th>
                      <th className="sticky top-14 z-20 bg-muted/40 px-4 py-2.5 font-medium text-center border-r border-border whitespace-nowrap">
                        Note
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const cond = conduiteByStudent.get(s.student_id);
                  return (
                    <tr
                      key={s.student_id}
                      className="border-b border-border/60 align-middle hover:bg-muted/20"
                    >
                      <td className="md:sticky md:left-0 z-10 bg-background px-5 py-4 border-r border-border whitespace-nowrap">
                        <div className="font-medium whitespace-nowrap">
                          {s.first_name} {s.last_name}
                        </div>
                        {s.matricule && (
                          <div className="font-mono text-xs text-muted-foreground mt-0.5">
                            {s.matricule}
                          </div>
                        )}
                      </td>
                      {ecues.map((e) => {
                        const subs = evalSubsOf(e.ecue_id, s.student_id);
                        return (
                          <Fragment key={e.ecue_id}>
                            <td className="px-4 py-4 align-middle whitespace-nowrap">
                              <DevoirsCell
                                ecueId={e.ecue_id}
                                sessionId={sessionId}
                                studentId={s.student_id}
                                evalDevoirs={subs.filter((x: any) => x.type !== "examen")}
                                devoirs={devoirsOf(e.ecue_id, s.student_id)}
                                onError={setError}
                              />
                            </td>
                            <td className="px-4 py-4 align-middle whitespace-nowrap">
                              <ExamenCell
                                ecueId={e.ecue_id}
                                sessionId={sessionId}
                                studentId={s.student_id}
                                examen={examenOf(e.ecue_id, s.student_id)}
                                evalExamen={subs.find((x: any) => x.type === "examen") ?? null}
                                rattrapage={rattrapageOf(e.ecue_id, s.student_id)}
                                onError={setError}
                              />
                            </td>
                            <td className="px-4 py-4 text-center border-r border-border align-middle whitespace-nowrap">
                              <NoteCell result={resultOf(e.ecue_id, s.student_id)} />
                            </td>
                          </Fragment>
                        );
                      })}
                      {showConduite && (
                        <td className="px-4 py-4 bg-amber-500/10 border-l border-border align-middle whitespace-nowrap text-center">
                          <ConduiteCell
                            student={cond ?? { student_id: s.student_id, note: null, note_id: null }}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </fieldset>
          </CardContent>
        </Card>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              Chaque ECUE : <span className="font-medium">Devoirs</span> (multiples) ·{" "}
              <span className="font-medium">Examen</span> (unique) ·{" "}
              <span className="font-medium">Note</span> = moyenne devoirs × 0,4 + examen × 0,6
              {showConduite && (
                <>
                  {" "}· <span className="font-medium">Conduite</span> = note unique /20 du semestre,
                  en lecture seule ici (saisie sur la page{" "}
                  <Link href="/professionnel/admin/conduite" className="underline">
                    Conduite
                  </Link>
                  )
                </>
              )}
              .
            </p>
            <p>
              Repères : <span className="font-mono">m</span> = note saisie manuellement ·{" "}
              <span className="font-mono">éval</span> = note issue d'une évaluation (copie notée,
              reprise automatiquement). La couleur de la Note indique le statut (validé / insuffisant /
              éliminatoire).
            </p>
          </div>
        </>
      )}
    </div>
  );
}

const EVAL_FMT: Record<string, string> = {
  online: "en ligne",
  pdf: "sujet unique",
  ai_generated: "IA",
};

/** Cellule Devoirs : notes d'évaluations (lecture seule) + notes manuelles + ajout. */
function DevoirsCell({
  ecueId,
  sessionId,
  studentId,
  evalDevoirs,
  devoirs,
  onError,
}: {
  ecueId: string;
  sessionId: string;
  studentId: string;
  evalDevoirs: any[];
  devoirs: any[];
  onError: (m: string | null) => void;
}) {
  const [newDevoir, setNewDevoir] = useState("");
  const upsert = useUpsertManualNote();
  const del = useDeleteManualNote();

  async function addDevoir() {
    const v = parseFloat(newDevoir.replace(",", "."));
    if (isNaN(v)) return;
    onError(null);
    try {
      await upsert.mutateAsync({
        ecueId,
        student_id: studentId,
        ue_session_id: sessionId,
        nature: "devoir",
        note: v,
        note_max: 20,
      });
      setNewDevoir("");
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de l'ajout du devoir.");
    }
  }

  async function removeNote(id: string) {
    onError(null);
    try {
      await del.mutateAsync(id);
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de la suppression.");
    }
  }

  return (
    <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
      {evalDevoirs.map((d) => (
        <span
          key={d.assignment_id}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-[13px] font-mono"
          title={`${d.titre} — évaluation ${EVAL_FMT[d.evaluation_type] ?? d.evaluation_type}`}
        >
          <BookOpen className="h-3.5 w-3.5 opacity-70" />
          {fmt(d.note)}
        </span>
      ))}
      {devoirs.map((d) => (
        <span
          key={d.id}
          className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-1 text-[13px] font-mono"
          title="Note saisie manuellement"
        >
          {fmt(d.note)}
          <button
            type="button"
            onClick={() => removeNote(d.id)}
            className="text-indigo-400 hover:text-red-600"
            title="Supprimer ce devoir"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={20}
          step="0.25"
          value={newDevoir}
          onChange={(e) => setNewDevoir(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addDevoir()}
          placeholder="+ note"
          className="h-9 w-20"
        />
        <button
          type="button"
          onClick={addDevoir}
          disabled={upsert.isPending}
          className="text-indigo-600 hover:text-indigo-800"
          title="Ajouter un devoir"
        >
          <Plus className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
}

/**
 * Cellule Examen — Session 1 : note unique (manuelle prioritaire, sinon note
 * d'évaluation). Une éventuelle note de rattrapage (`rattrapage`, Session 2)
 * n'est que signalée : elle se saisit sur la page « Rattrapages ».
 */
function ExamenCell({
  ecueId,
  sessionId,
  studentId,
  examen,
  evalExamen,
  rattrapage,
  onError,
}: {
  ecueId: string;
  sessionId: string;
  studentId: string;
  examen: any;
  evalExamen: any;
  rattrapage: any;
  onError: (m: string | null) => void;
}) {
  const effExamNote = examen ? examen.note : evalExamen ? evalExamen.note : null;
  const [examInput, setExamInput] = useState(effExamNote != null ? String(effExamNote) : "");
  const upsert = useUpsertManualNote();
  const del = useDeleteManualNote();

  useEffect(() => {
    setExamInput(effExamNote != null ? String(effExamNote) : "");
  }, [examen?.id, examen?.note, evalExamen?.note, ecueId, studentId]);

  async function saveExamen() {
    const raw = examInput.trim();
    if (raw === "") return;
    const v = parseFloat(raw.replace(",", "."));
    if (isNaN(v)) return;
    if (effExamNote != null && Number(effExamNote) === v) return;
    onError(null);
    try {
      await upsert.mutateAsync({
        ecueId,
        student_id: studentId,
        ue_session_id: sessionId,
        nature: "examen",
        note: v,
        note_max: 20,
        session: 1,
      });
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de l'enregistrement de l'examen.");
    }
  }

  async function removeExamen() {
    if (!examen?.id) return;
    onError(null);
    try {
      await del.mutateAsync(examen.id);
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de la suppression.");
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        max={20}
        step="0.25"
        value={examInput}
        onChange={(e) => setExamInput(e.target.value)}
        onBlur={saveExamen}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="—"
        className="h-9 w-20"
      />
      {rattrapage && (
        <span
          className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700"
          title={`Rattrapage saisi (Session 2) : ${fmt(
            rattrapage.note
          )}/20 — c'est cette note qui est retenue dans le calcul. Modification sur la page Rattrapages.`}
        >
          S2 {fmt(rattrapage.note)}
        </span>
      )}
      {examen ? (
        <>
          <span className="text-[11px] text-indigo-600" title="Note saisie manuellement">
            m
          </span>
          <button
            type="button"
            onClick={removeExamen}
            className="text-gray-400 hover:text-red-600"
            title="Supprimer la note d'examen manuelle"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      ) : evalExamen ? (
        <span
          className="text-[11px] text-slate-500"
          title={`${evalExamen.titre} — évaluation ${EVAL_FMT[evalExamen.evaluation_type] ?? evalExamen.evaluation_type}`}
        >
          éval
        </span>
      ) : null}
    </div>
  );
}

/** Cellule Note ECUE (lecture seule) : moyenne calculée + couleur de statut. */
function NoteCell({ result }: { result: any }) {
  const statutKey = result
    ? result.eliminee
      ? "eliminatoire"
      : result.validee
      ? "valide"
      : result.moyenne != null && result.moyenne >= 5
      ? "insuffisant"
      : result.moyenne != null
      ? "eliminatoire"
      : "en_cours"
    : "en_cours";
  const statut = ECUE_STATUT[statutKey] ?? ECUE_STATUT.en_cours;
  return (
    <span
      className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold ${statut.cls}`}
      title={statut.label}
    >
      {fmt(result?.moyenne)}
    </span>
  );
}

/**
 * Cellule Conduite (lecture seule) : la note /20 du semestre est saisie sur la
 * page « Conduite », au vu des présences. Elle n'est ici que reportée.
 */
function ConduiteCell({ student }: { student: any }) {
  if (student?.note == null) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700"
        title="Aucune note de conduite — à saisir sur la page Conduite."
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Non saisie
      </span>
    );
  }
  return (
    <span
      className="inline-block rounded bg-amber-100 px-2.5 py-1 text-sm font-mono font-semibold text-amber-800"
      title="Note de conduite du semestre — saisie sur la page Conduite."
    >
      {fmt(student.note)}
    </span>
  );
}
