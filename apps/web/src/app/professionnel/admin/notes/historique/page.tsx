"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import {
  Layers,
  CalendarRange,
  Calendar,
  BookOpen,
  GraduationCap,
  Loader2,
  History,
  ArrowLeft,
  RotateCcw,
  Smile,
  Download,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportOptionsDialog } from "@/components/ExportOptionsDialog";
import {
  NOTES_EXPORT_CHOICES,
  NOTES_EXPORT_DEFAUT,
  downloadNotesReportDocx,
  openNotesReportPdf,
} from "@/lib/utils/notes-report";
import { ouvrirOngletPdf, POPUP_BLOQUEE } from "@/lib/utils/report-pdf";
import {
  useNotesFilieres,
  useNotesSemestres,
  useSemestreSessions,
  useSessionGrids,
  useSemestreConduite,
} from "@/lib/hooks/use-professional-bulletins";

/**
 * Historique des notes — Module Professionnel (admin).
 *
 * Consultation des notes saisies sur les cohortes TERMINÉES. La page de saisie
 * (`/professionnel/admin/notes`) ne montre au contraire que les cohortes encore
 * ouvertes ; c'est ici, et seulement ici, qu'on filtre par année scolaire,
 * puisque l'historique s'étale sur plusieurs années.
 *
 * Le semestre est la maille d'affichage : dès qu'il est choisi, TOUTES ses UE
 * terminées sont rendues dans UNE SEULE grille, côte à côte — une section de
 * colonnes par UE, la conduite fermant la marche à droite. Il n'y a donc pas de
 * sélecteur d'UE. La grille étant large, elle défile horizontalement, la colonne
 * « Étudiant » restant collée à gauche.
 *
 * Page STRICTEMENT en lecture seule : aucune note n'est modifiable ici, pas même
 * l'examen de Session 2 (rattrapage). La conduite est également affichée en
 * lecture, sa saisie restant sur la page dédiée
 * `/professionnel/admin/conduite`.
 */

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

/** Séparateur vertical entre deux sections d'UE. */
const UE_SEP = "border-l-2 border-border";

/**
 * Année scolaire (pivot septembre) dérivée de la date de début du semestre,
 * alignée sur le calcul côté API (professional-bulletin.service.ts) et sur les
 * autres pages : un semestre démarrant en septembre ou après appartient à
 * « AAAA-AAAA+1 », sinon « AAAA-1-AAAA ».
 */
function anneeScolaireOf(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export default function NotesHistoriquePage() {
  const [filiereId, setFiliereId] = useState("");
  const [annee, setAnnee] = useState("all");
  const [semestreId, setSemestreId] = useState("");
  const [exportOuvert, setExportOuvert] = useState(false);
  const [exportChoix, setExportChoix] = useState<Set<string>>(new Set(NOTES_EXPORT_DEFAUT));
  const [exportErreur, setExportErreur] = useState<string | null>(null);

  // Portée « terminees » : seules les filières et semestres ayant au moins une
  // cohorte terminée ou annulée remontent ici.
  const filieresQuery = useNotesFilieres("terminees");
  const semestresQuery = useNotesSemestres(filiereId || null, "terminees");
  const sessionsQuery = useSemestreSessions(semestreId || null);
  // Conduite du semestre : saisie sur la page dédiée, affichée ici en lecture.
  const conduiteQuery = useSemestreConduite(semestreId || null);

  const filieres: any[] = (filieresQuery.data as any[]) ?? [];

  const semestres: any[] = useMemo(() => {
    const list = (semestresQuery.data as any[]) ?? [];
    return filiereId
      ? list.map((s) => ({ ...s, annee_scolaire: anneeScolaireOf(s.date_debut) }))
      : [];
  }, [semestresQuery.data, filiereId]);

  // Années scolaires disponibles pour la filière (plus récentes en premier).
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of semestres) if (s.annee_scolaire) set.add(s.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [semestres]);

  const visibleSemestres = useMemo(
    () => semestres.filter((s) => annee === "all" || s.annee_scolaire === annee),
    [semestres, annee]
  );

  // Si l'année sélectionnée n'existe plus (changement de filière), on réinitialise.
  useEffect(() => {
    if (annee !== "all" && !anneeOptions.some((o) => o.value === annee)) setAnnee("all");
  }, [anneeOptions, annee]);

  // Si le semestre sélectionné n'est plus visible (filtre année), on le désélectionne.
  useEffect(() => {
    if (semestreId && !visibleSemestres.some((s) => s.id === semestreId)) setSemestreId("");
  }, [visibleSemestres, semestreId]);

  // UE du semestre : hors « Conduite » (colonne à part, tout à droite), sans
  // inscrit, et UNIQUEMENT les cohortes terminées ou annulées — c'est la
  // contrepartie exacte de la page de saisie.
  const sessions: any[] = useMemo(
    () =>
      ((sessionsQuery.data as any[]) ?? [])
        .filter((s) => !String(s.ue_libelle ?? "").toLowerCase().startsWith("conduite"))
        .filter((s) => Number(s.nb_inscrits ?? 0) > 0)
        .filter((s) => ["termine", "annule"].includes(String(s.statut ?? ""))),
    [sessionsQuery.data]
  );

  // Une grille par UE, chargées en parallèle (clés de cache partagées avec la
  // page de saisie). L'ordre suit exactement celui de `sessions`.
  const gridQueries = useSessionGrids(sessions.map((s) => s.id));
  const gridsLoading = gridQueries.some((q) => q.isLoading);

  // Conduite du semestre : ECUE dédiée + note par étudiant.
  const conduite: any = (conduiteQuery.data as any) ?? null;
  const conduiteStudents: any[] = conduite?.students ?? [];
  const hasConduite = Boolean(conduite?.conduite) && conduiteStudents.length > 0;
  const conduiteNotes = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const s of conduiteStudents) m.set(String(s.student_id), s.note ?? null);
    return m;
  }, [conduiteStudents]);

  /**
   * Un bloc de colonnes par UE : ses ECUE et ses notes indexées par couple
   * (ECUE, étudiant), pour que le rendu d'une cellule reste en O(1) malgré le
   * nombre d'UE affichées d'un coup.
   */
  const blocks = sessions
    .map((session, i) => {
      const grid: any = gridQueries[i]?.data ?? null;
      const ecues: any[] = grid?.ecues ?? [];

      const results = new Map<string, any>();
      for (const r of grid?.results ?? []) results.set(`${r.ecue_id}|${r.student_id}`, r);

      const devoirs = new Map<string, any[]>();
      const examens = new Map<string, any>();
      for (const n of grid?.notes ?? []) {
        const key = `${n.ecue_id}|${n.student_id}`;
        if (n.nature === "devoir") {
          const list = devoirs.get(key);
          if (list) list.push(n);
          else devoirs.set(key, [n]);
        } else if (n.nature === "examen") {
          // La note de Session 2 prime sur celle de la Session 1.
          const prev = examens.get(key);
          if (!prev || (n.session ?? 1) > (prev.session ?? 1)) examens.set(key, n);
        }
      }

      // Inscrits de CETTE cohorte : un étudiant absent de la liste n'a pas
      // suivi l'UE, ses cellules restent vides plutôt que de valoir zéro.
      const enrolled = new Set<string>(
        (grid?.students ?? []).map((s: any) => String(s.student_id))
      );

      return {
        id: session.id,
        libelle: grid?.session?.ue_libelle ?? session.ue_libelle ?? "UE",
        code: grid?.session?.ue_code ?? session.ue_code ?? null,
        ecues,
        results,
        devoirs,
        examens,
        enrolled,
        students: (grid?.students ?? []) as any[],
      };
    })
    .filter((b) => b.ecues.length > 0);

  /**
   * Cohorte affichée : union des inscrits de toutes les UE du semestre, plus
   * les étudiants n'ayant qu'une conduite. Une ligne par étudiant, quelle que
   * soit la ou les UE qu'il a suivies.
   */
  const students = (() => {
    const m = new Map<string, any>();
    for (const b of blocks) {
      for (const s of b.students) if (!m.has(String(s.student_id))) m.set(String(s.student_id), s);
    }
    for (const s of conduiteStudents) {
      if (!m.has(String(s.student_id))) m.set(String(s.student_id), s);
    }
    return Array.from(m.values()).sort((a, b) =>
      `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
        `${b.last_name ?? ""} ${b.first_name ?? ""}`,
        "fr"
      )
    );
  })();

  const semestreLabel = visibleSemestres.find((s) => s.id === semestreId)?.libelle ?? "Semestre";

  /**
   * Périmètre exporté : toutes les UE terminées du semestre choisi — c'est
   * exactement ce que la page affiche, il n'y a pas de sélecteur d'UE ici. Les
   * grilles déjà chargées sont transmises telles quelles : inutile de les
   * redemander à l'API.
   */
  const exportContexte = useMemo(
    () => ({
      filiere: filieres.find((f) => f.id === filiereId)?.name ?? "—",
      semestre: semestreLabel,
      annee:
        annee !== "all"
          ? annee
          : (visibleSemestres.find((s) => s.id === semestreId)?.annee_scolaire ?? "—"),
      sessions,
      grilles: gridQueries.map((q) => q.data ?? null),
      conduite: conduiteStudents,
      porteeLibelle: "Cohortes terminées",
    }),
    [
      filieres,
      filiereId,
      semestreLabel,
      annee,
      visibleSemestres,
      semestreId,
      sessions,
      gridQueries,
      conduiteStudents,
    ]
  );

  function basculerChoixExport(key: string) {
    setExportChoix((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(key)) suivant.delete(key);
      else suivant.add(key);
      return suivant;
    });
  }

  async function handleExportNotes(format: "pdf" | "word") {
    setExportErreur(null);
    const contexte = { ...exportContexte, choix: exportChoix };
    try {
      if (format === "pdf") {
        // L'onglet s'ouvre dans le geste de clic, sinon la popup est bloquée.
        const win = ouvrirOngletPdf();
        if (!win) {
          setExportErreur(POPUP_BLOQUEE);
          return;
        }
        await openNotesReportPdf(contexte, win);
      } else {
        await downloadNotesReportDocx(contexte);
      }
      setExportOuvert(false);
    } catch (err: any) {
      setExportErreur(err?.message ?? "Erreur lors de l'export des notes.");
    }
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto p-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <History className="h-7 w-7 text-indigo-500" />
            Historique des notes
          </h1>
          <p className="text-muted-foreground mt-2">
            Toutes les UE terminées du semestre dans une seule grille — consultation seule.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setExportOuvert(true)}
            disabled={!semestreId || gridsLoading || students.length === 0}
            title={
              !semestreId
                ? "Choisissez une filière, une année et un semestre"
                : "Exporter les notes de ce semestre en PDF ou en Word"
            }
            className="bg-emerald-50 border-emerald-200 hover:bg-emerald-100 text-emerald-700 hover:text-emerald-800"
          >
            <Download className="h-4 w-4 mr-2" />
            Exporter
          </Button>
          <Link href="/professionnel/admin/notes/rattrapages">
            <Button
              variant="outline"
              title="Saisir les examens de Session 2 des étudiants non validés"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Rattrapages
            </Button>
          </Link>
          <Link href="/professionnel/admin/notes">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour à la saisie
            </Button>
          </Link>
        </div>
      </div>

      <ExportOptionsDialog
        open={exportOuvert}
        onClose={() => setExportOuvert(false)}
        title="Exporter l'historique des notes"
        description={`${exportContexte.filiere} · ${exportContexte.semestre} · ${exportContexte.annee}. Toutes les UE terminées du semestre sont exportées.`}
        groups={[
          {
            groupLabel: "Colonnes",
            choices: [
              { key: "_identite", label: "Étudiant et ECUE", hint: "Toujours inclus", locked: true },
              { key: "_note", label: "Note finale /20", hint: "Toujours incluse", locked: true },
              ...NOTES_EXPORT_CHOICES.map((c) => ({ ...c })),
            ],
          },
        ]}
        selected={exportChoix}
        onToggle={basculerChoixExport}
        onExport={handleExportNotes}
        disabled={!semestreId}
        disabledReason="Sélectionnez d'abord un semestre."
      />

      {exportErreur && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {exportErreur}
        </div>
      )}

      {/* Sélecteurs — filière, année scolaire, semestre (l'UE n'en est plus un) */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SearchableSelect
              value={filiereId}
              onChange={(v) => {
                setFiliereId(v);
                setAnnee("all");
                setSemestreId("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder={
                filieresQuery.isLoading
                  ? "Chargement…"
                  : filieres.length === 0
                  ? "Aucune session terminée"
                  : "Filière"
              }
              searchPlaceholder="Rechercher une filière…"
              options={filieres.map((f) => ({
                value: f.id,
                label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
              }))}
            />
            <SearchableSelect
              value={annee}
              onChange={setAnnee}
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              placeholder={!filiereId ? "Choisir une filière" : "Toutes les années"}
              searchPlaceholder="Rechercher une année…"
              options={[{ value: "all", label: "Toutes les années" }, ...anneeOptions]}
            />
            <SearchableSelect
              value={semestreId}
              onChange={setSemestreId}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={!filiereId ? "Choisir une filière" : "Semestre"}
              searchPlaceholder="Rechercher un semestre…"
              options={visibleSemestres.map((s) => ({ value: s.id, label: s.libelle }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Grille unique en lecture seule : toutes les UE côte à côte */}
      {!semestreId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <GraduationCap className="h-8 w-8 text-indigo-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une filière puis un semestre pour consulter les notes de toutes ses UE.
            </p>
          </CardContent>
        </Card>
      ) : sessionsQuery.isLoading || gridsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : blocks.length === 0 && !hasConduite ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucune UE terminée sur ce semestre.
          </CardContent>
        </Card>
      ) : students.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucun étudiant inscrit (confirmé) sur ce semestre.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <BookOpen className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="font-semibold">{semestreLabel}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                · {blocks.length} UE · {students.length} étudiant
                {students.length > 1 ? "s" : ""}
                {hasConduite ? " · conduite incluse" : ""}
              </span>
            </div>
            <CardContent className="p-0 overflow-x-auto">
              <table className="min-w-full text-[15px] border-collapse">
                <thead>
                  {/* Rangée 1 — une section par UE */}
                  <tr className="bg-muted/70 border-b border-border">
                    <th
                      rowSpan={3}
                      className="sticky left-0 z-20 bg-muted/70 px-5 py-3 text-left font-medium border-r-2 border-border whitespace-nowrap"
                    >
                      Étudiant
                    </th>
                    {blocks.map((b) => (
                      <th
                        key={b.id}
                        colSpan={b.ecues.length * 3}
                        className={`px-4 py-3 text-center font-bold text-indigo-700 whitespace-nowrap ${UE_SEP}`}
                        title={b.libelle}
                      >
                        {b.libelle}
                        {b.code ? ` (${b.code})` : ""}
                      </th>
                    ))}
                    {hasConduite && (
                      <th
                        rowSpan={3}
                        className={`px-4 py-3 text-center font-bold text-rose-700 whitespace-nowrap ${UE_SEP}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Smile className="h-4 w-4 text-rose-500" />
                          Conduite (/20)
                        </span>
                      </th>
                    )}
                  </tr>
                  {/* Rangée 2 — les ECUE de chaque UE */}
                  <tr className="bg-muted/60 border-b border-border">
                    {blocks.map((b) =>
                      b.ecues.map((e: any, i: number) => (
                        <th
                          key={`${b.id}|${e.ecue_id}`}
                          colSpan={3}
                          className={`px-4 py-2.5 text-center font-semibold whitespace-nowrap ${
                            i === 0 ? UE_SEP : "border-l border-border"
                          }`}
                        >
                          {e.libelle ?? e.code}
                        </th>
                      ))
                    )}
                  </tr>
                  {/* Rangée 3 — devoirs / examen / note, par ECUE */}
                  <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground">
                    {blocks.map((b) =>
                      b.ecues.map((e: any, i: number) => (
                        <Fragment key={`${b.id}|${e.ecue_id}`}>
                          <th
                            className={`px-4 py-2.5 font-medium whitespace-nowrap ${
                              i === 0 ? UE_SEP : "border-l border-border"
                            }`}
                          >
                            Devoirs (/20)
                          </th>
                          <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                            Examen (/20)
                          </th>
                          <th className="px-4 py-2.5 font-medium text-center whitespace-nowrap">
                            Note
                          </th>
                        </Fragment>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const sid = String(s.student_id);
                    return (
                      <tr
                        key={sid}
                        className="border-b border-border/60 align-middle hover:bg-muted/20"
                      >
                        <td className="sticky left-0 z-10 bg-background px-5 py-3 border-r-2 border-border whitespace-nowrap">
                          <span className="font-medium">
                            {s.first_name} {s.last_name}
                          </span>
                        </td>
                        {blocks.map((b) => {
                          const inscrit = b.enrolled.has(sid);
                          return b.ecues.map((e: any, i: number) => {
                            const key = `${e.ecue_id}|${sid}`;
                            const devoirs = b.devoirs.get(key) ?? [];
                            const examen = b.examens.get(key) ?? null;
                            const result = b.results.get(key) ?? null;
                            const statutKey = result
                              ? result.eliminee
                                ? "eliminatoire"
                                : result.validee === true
                                ? "valide"
                                : result.validee === false
                                ? "insuffisant"
                                : "en_cours"
                              : "en_cours";
                            const statut = ECUE_STATUT[statutKey] ?? ECUE_STATUT.en_cours;
                            const sep = i === 0 ? UE_SEP : "border-l border-border";

                            // Étudiant non inscrit à cette UE : bloc grisé.
                            if (!inscrit) {
                              return (
                                <td
                                  key={key}
                                  colSpan={3}
                                  className={`px-4 py-3 text-center align-middle text-xs text-muted-foreground bg-muted/20 whitespace-nowrap ${sep}`}
                                  title="Étudiant non inscrit à cette UE"
                                >
                                  non inscrit
                                </td>
                              );
                            }

                            return (
                              <Fragment key={key}>
                                <td
                                  className={`px-4 py-3 align-middle whitespace-nowrap ${sep}`}
                                >
                                  {devoirs.length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <span className="font-mono">
                                      {devoirs.map((d: any) => fmt(d.note)).join(" · ")}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 align-middle whitespace-nowrap font-mono">
                                  {examen ? (
                                    <>
                                      {fmt(examen.note)}
                                      {(examen.session ?? 1) === 2 && (
                                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                          S2
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                                  <span
                                    className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold ${statut.cls}`}
                                    title={statut.label}
                                  >
                                    {fmt(result?.moyenne)}
                                  </span>
                                </td>
                              </Fragment>
                            );
                          });
                        })}
                        {hasConduite &&
                          (() => {
                            const note = conduiteNotes.get(sid) ?? null;
                            return (
                              <td
                                className={`px-4 py-3 text-center align-middle whitespace-nowrap ${UE_SEP}`}
                              >
                                {note == null ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <span
                                    className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold ${
                                      Number(note) >= 10
                                        ? "bg-green-100 text-green-700"
                                        : "bg-amber-100 text-amber-700"
                                    }`}
                                  >
                                    {fmt(note)}
                                  </span>
                                )}
                              </td>
                            );
                          })()}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Toutes les UE terminées du semestre sont affichées côte à côte :{" "}
            <strong>faites défiler la grille horizontalement</strong> pour atteindre les dernières
            UE et la conduite, la colonne « Étudiant » restant visible à gauche. Les notes des
            sessions terminées ne sont plus modifiables : cette page est en{" "}
            <strong>consultation seule</strong>. La saisie se fait sur la page{" "}
            <Link
              href="/professionnel/admin/notes"
              className="font-medium underline underline-offset-2"
            >
              Notes
            </Link>
            , qui ne propose que les sessions encore ouvertes. Le badge{" "}
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              S2
            </span>{" "}
            signale une note d&apos;examen issue du rattrapage.
            {hasConduite && (
              <>
                {" "}
                La colonne <strong>Conduite</strong>, en fin de grille, reprend la note du semestre
                saisie sur la page{" "}
                <Link
                  href="/professionnel/admin/conduite"
                  className="font-medium underline underline-offset-2"
                >
                  Conduite
                </Link>
                .
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
