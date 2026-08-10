"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Card, CardContent, Button, Input } from "@ecoledigitale/ui";
import {
  Layers,
  CalendarRange,
  Calendar,
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
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useNotesFilieres,
  useNotesSemestres,
  useSemestreSessions,
  useSessionGrid,
  useSemestreConduite,
  useRecomputeSession,
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

/**
 * Année scolaire (pivot septembre) dérivée de la date de début du semestre,
 * alignée sur le calcul côté API (professional-bulletin.service.ts) et les autres
 * pages : un semestre démarrant en septembre ou après appartient à
 * « AAAA-AAAA+1 », sinon « AAAA-1-AAAA ».
 */
function anneeScolaireOf(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export default function NotesPage() {
  const [filiereId, setFiliereId] = useState("");
  const [annee, setAnnee] = useState("all");
  const [semestreId, setSemestreId] = useState("");
  const [sessionId, setSessionId] = useState("");
  // Session de saisie LMD : 1 = normale, 2 = rattrapage (examens uniquement).
  const [noteSession, setNoteSession] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const qc = useQueryClient();

  const { data: session } = useSession();
  const roles = ((session as any)?.roles ?? []) as string[];
  const isAdmin =
    Array.isArray(roles) && roles.some((r) => ["admin", "super_admin", "Administrateur"].includes(r));

  const programmesQuery = useNotesFilieres();
  const semestresQuery = useNotesSemestres(filiereId || null);
  const sessionsQuery = useSemestreSessions(semestreId || null);
  const gridQuery = useSessionGrid(sessionId || null);
  const conduiteQuery = useSemestreConduite(isAdmin && semestreId ? semestreId : null);
  const recomputeMut = useRecomputeSession();

  const filieres: any[] = (programmesQuery.data as any[]) ?? [];
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

  // Semestres filtrés par année scolaire sélectionnée.
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
    if (semestreId && !visibleSemestres.some((s) => s.id === semestreId)) {
      setSemestreId("");
      setSessionId("");
    }
  }, [visibleSemestres, semestreId]);

  // UE (sessions) du semestre, hors « Conduite » et sans inscrit.
  const sessions: any[] = ((sessionsQuery.data as any[]) ?? [])
    .filter((s) => !String(s.ue_libelle ?? "").toLowerCase().startsWith("conduite"))
    .filter((s) => Number(s.nb_inscrits ?? 0) > 0);
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
  function examenOf(eid: string, sid: string) {
    // La note d'examen de la Session 2 (rattrapage) remplace celle de Session 1.
    const exams = (grid?.notes ?? []).filter(
      (n: any) => n.ecue_id === eid && n.student_id === sid && n.nature === "examen"
    );
    if (exams.length === 0) return null;
    return exams.reduce((a: any, b: any) => ((b.session ?? 1) > (a.session ?? 1) ? b : a));
  }
  function evalSubsOf(eid: string, sid: string) {
    return (grid?.submissions ?? []).filter((s: any) => s.ecue_id === eid && s.student_id === sid);
  }

  // En Session 2 (rattrapage), on n'affiche que les étudiants ayant au moins un
  // ECUE non validé (à rattraper). En Session 1, tous les étudiants.
  const displayedStudents =
    noteSession === 2
      ? students.filter((s) =>
          ecues.some((e) => {
            const r = resultOf(e.ecue_id, s.student_id);
            return r != null && r.validee === false;
          })
        )
      : students;

  async function handleRecompute() {
    if (!sessionId) return;
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
   */
  async function handleSaveAndCompute() {
    if (!sessionId) return;
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <GraduationCap className="h-7 w-7 text-indigo-500" />
            Saisie des notes
          </h1>
          <p className="text-muted-foreground mt-2">
            Saisissez les notes de devoirs et d'examen par ECUE. Les notes des évaluations sont
            reprises automatiquement.
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Link href="/professionnel/admin/bulletins">
              <Button variant="outline">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Bulletins
              </Button>
            </Link>
          )}
          <Button
            onClick={handleRecompute}
            disabled={!sessionId || recomputeMut.isPending}
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

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Sélecteurs — deux en haut (filière, année), deux en bas (semestre, UE) */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={filiereId}
              onChange={(v) => {
                setFiliereId(v);
                setAnnee("all");
                setSemestreId("");
                setSessionId("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder={programmesQuery.isLoading ? "Chargement…" : "Filière"}
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
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={semestreId}
              onChange={(v) => {
                setSemestreId(v);
                setSessionId("");
              }}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={!filiereId ? "Choisir une filière" : "Semestre"}
              searchPlaceholder="Rechercher un semestre…"
              options={visibleSemestres.map((s) => ({ value: s.id, label: s.libelle }))}
            />
            <SearchableSelect
              value={sessionId}
              onChange={setSessionId}
              icon={<BookOpen className="h-4 w-4 text-gray-400" />}
              placeholder={
                !semestreId
                  ? "Choisir un semestre"
                  : sessionsQuery.isLoading
                  ? "Chargement…"
                  : sessions.length === 0
                  ? "Aucune UE"
                  : "UE"
              }
              searchPlaceholder="Rechercher une UE…"
              options={sessions.map((s) => ({
                value: s.id,
                label: `${s.ue_libelle ?? ""}${s.ue_code ? ` (${s.ue_code})` : ""}`.trim(),
              }))}
            />
          </div>
          {/* Session de saisie LMD (rattrapage = uniquement les examens) */}
          <div className="flex items-center gap-3 pt-1">
            <span className="text-sm font-medium text-muted-foreground">Session de saisie :</span>
            <div className="inline-flex rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setNoteSession(1)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  noteSession === 1
                    ? "bg-indigo-600 text-white"
                    : "bg-background hover:bg-muted text-muted-foreground"
                }`}
              >
                Session 1 (normale)
              </button>
              <button
                type="button"
                onClick={() => setNoteSession(2)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  noteSession === 2
                    ? "bg-amber-600 text-white"
                    : "bg-background hover:bg-muted text-muted-foreground"
                }`}
              >
                Session 2 (rattrapage)
              </button>
            </div>
            {noteSession === 2 && (
              <span className="text-xs text-amber-600">
                Les notes d'examen saisies remplaceront celles de Session 1 pour les ECUE concernées.
              </span>
            )}
          </div>
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
              Choisissez une filière, un semestre puis une UE pour saisir les notes.
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
      ) : noteSession === 2 && displayedStudents.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucun ECUE à rattraper dans cette UE : tous les étudiants ont validé.
          </CardContent>
        </Card>
      ) : (
        <>
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
              disabled={savingAll || recomputeMut.isPending}
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
            <table className="min-w-full text-[15px] border-collapse">
              <thead>
                {/* En-tête groupé : une ECUE = 3 sous-colonnes (Devoirs / Examen / Note) */}
                <tr className="bg-muted/60 border-b border-border">
                  <th
                    rowSpan={2}
                    className="sticky left-0 top-0 z-30 bg-muted/60 px-5 py-3 text-left font-medium border-r border-border whitespace-nowrap"
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
                {displayedStudents.map((s) => {
                  const cond = conduiteByStudent.get(s.student_id);
                  return (
                    <tr
                      key={s.student_id}
                      className="border-b border-border/60 align-middle hover:bg-muted/20"
                    >
                      <td className="sticky left-0 z-10 bg-background px-5 py-4 border-r border-border whitespace-nowrap">
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
                                readOnly={noteSession === 2}
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
                                noteSession={noteSession}
                                locked={
                                  noteSession === 2 &&
                                  (resultOf(e.ecue_id, s.student_id)?.moyenne ?? 0) >= 10
                                }
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
                            ecueId={conduite.ecue_id}
                            ueSessionId={conduite.ue_session_id}
                            onError={setError}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              Chaque ECUE : <span className="font-medium">Devoirs</span> (multiples) ·{" "}
              <span className="font-medium">Examen</span> (unique) ·{" "}
              <span className="font-medium">Note</span> = moyenne devoirs × 0,4 + examen × 0,6
              {showConduite && (
                <>
                  {" "}· <span className="font-medium">Conduite</span> = note unique /20 du semestre
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
  readOnly = false,
  onError,
}: {
  ecueId: string;
  sessionId: string;
  studentId: string;
  evalDevoirs: any[];
  devoirs: any[];
  readOnly?: boolean;
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
          {!readOnly && (
            <button
              type="button"
              onClick={() => removeNote(d.id)}
              className="text-indigo-400 hover:text-red-600"
              title="Supprimer ce devoir"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ))}
      {readOnly ? (
        // Session 2 (rattrapage) : devoirs de la Session 1 conservés, non
        // modifiables (seul l'examen se repasse). Rien d'autre n'est affiché.
        evalDevoirs.length === 0 && devoirs.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : null
      ) : (
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
      )}
    </div>
  );
}

/** Cellule Examen : note unique (manuelle prioritaire, sinon note d'évaluation). */
function ExamenCell({
  ecueId,
  sessionId,
  studentId,
  examen,
  evalExamen,
  noteSession,
  locked = false,
  onError,
}: {
  ecueId: string;
  sessionId: string;
  studentId: string;
  examen: any;
  evalExamen: any;
  noteSession: 1 | 2;
  locked?: boolean;
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
    if (locked) return; // ECUE déjà validé : pas de rattrapage
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
        session: noteSession,
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

  if (locked) {
    // Session 2 : ECUE déjà validé (≥ 10) → rattrapage inutile, saisie verrouillée.
    return (
      <div
        className="flex items-center gap-1.5 text-muted-foreground"
        title="ECUE déjà validé — le rattrapage (Session 2) ne concerne que les ECUE non validés (< 10)."
      >
        <span className="font-mono">{effExamNote != null ? fmt(effExamNote) : "—"}</span>
        <span className="rounded bg-green-100 px-1 text-[10px] font-semibold text-green-700">
          validé
        </span>
      </div>
    );
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
      {examen ? (
        <>
          {(examen.session ?? 1) === 2 && (
            <span
              className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700"
              title="Note de rattrapage (Session 2) — remplace la note de Session 1"
            >
              S2
            </span>
          )}
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

/** Cellule Conduite : note unique /20 par étudiant (portée par l'ECUE de conduite). */
function ConduiteCell({
  student,
  ecueId,
  ueSessionId,
  onError,
}: {
  student: any;
  ecueId: string;
  ueSessionId: string;
  onError: (m: string | null) => void;
}) {
  const [val, setVal] = useState(student.note != null ? String(student.note) : "");
  const upsert = useUpsertManualNote();
  const del = useDeleteManualNote();

  useEffect(() => {
    setVal(student.note != null ? String(student.note) : "");
  }, [student.note, student.note_id, student.student_id]);

  async function save() {
    const raw = val.trim();
    if (raw === "") return;
    const v = parseFloat(raw.replace(",", "."));
    if (isNaN(v)) return;
    if (student.note != null && Number(student.note) === v) return; // inchangé
    onError(null);
    try {
      await upsert.mutateAsync({
        ecueId,
        student_id: student.student_id,
        ue_session_id: ueSessionId,
        nature: "examen",
        note: v,
        note_max: 20,
      });
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de l'enregistrement de la conduite.");
    }
  }

  async function remove() {
    if (!student.note_id) return;
    onError(null);
    try {
      await del.mutateAsync(student.note_id);
      setVal("");
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de la suppression.");
    }
  }

  return (
    <div className="flex items-center justify-center gap-1.5">
      <Input
        type="number"
        min={0}
        max={20}
        step="0.25"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="—"
        className="h-9 w-24"
      />
      {student.note_id && (
        <button
          type="button"
          onClick={remove}
          className="text-gray-400 hover:text-red-600"
          title="Supprimer la note de conduite"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
