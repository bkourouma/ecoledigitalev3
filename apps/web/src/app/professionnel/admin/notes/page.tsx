"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function NotesPage() {
  const [filiereId, setFiliereId] = useState("");
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

  const programmesQuery = useNotesFilieres();
  const semestresQuery = useNotesSemestres(filiereId || null);
  const sessionsQuery = useSemestreSessions(semestreId || null);
  const gridQuery = useSessionGrid(sessionId || null);
  const conduiteQuery = useSemestreConduite(isAdmin && semestreId ? semestreId : null);
  const recomputeMut = useRecomputeSession();

  const filieres: any[] = (programmesQuery.data as any[]) ?? [];
  const semestres: any[] = useMemo(() => {
    const list = (semestresQuery.data as any[]) ?? [];
    return filiereId ? list : [];
  }, [semestresQuery.data, filiereId]);
  // La « Conduite » n'est pas une matière : on l'exclut du choix de session.
  // On masque aussi les sessions (UE) sans aucun étudiant inscrit.
  const sessions: any[] = ((sessionsQuery.data as any[]) ?? [])
    .filter((s) => !String(s.ue_libelle ?? "").toLowerCase().startsWith("conduite"))
    .filter((s) => Number(s.nb_inscrits ?? 0) > 0);
  const grid: any = gridQuery.data ?? null;
  const ecues: any[] = grid?.ecues ?? [];
  const students: any[] = grid?.students ?? [];

  const conduite: any = (conduiteQuery.data as any)?.conduite ?? null;
  const conduiteStudents: any[] = (conduiteQuery.data as any)?.students ?? [];

  function resultOf(eid: string, sid: string) {
    return grid?.results?.find((r: any) => r.ecue_id === eid && r.student_id === sid) ?? null;
  }
  function devoirsOf(eid: string, sid: string) {
    return (grid?.notes ?? []).filter(
      (n: any) => n.ecue_id === eid && n.student_id === sid && n.nature === "devoir"
    );
  }
  function examenOf(eid: string, sid: string) {
    return (
      (grid?.notes ?? []).find(
        (n: any) => n.ecue_id === eid && n.student_id === sid && n.nature === "examen"
      ) ?? null
    );
  }
  function evalSubsOf(eid: string, sid: string) {
    return (grid?.submissions ?? []).filter(
      (s: any) => s.ecue_id === eid && s.student_id === sid
    );
  }

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
   * Les notes sont sauvegardées au fil de la saisie ; ce bouton force la
   * validation du champ actif, attend la fin des enregistrements en cours,
   * puis recalcule les moyennes de la session.
   */
  async function handleSaveAndCompute() {
    if (!sessionId) return;
    setError(null);
    setSaved(false);
    setSavingAll(true);
    try {
      // Valide le champ actuellement en cours d'édition (déclenche sa sauvegarde).
      (document.activeElement as HTMLElement | null)?.blur?.();
      await new Promise((r) => setTimeout(r, 80));
      // Attend la fin de tous les enregistrements de notes en cours.
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
    <div className="space-y-6 max-w-7xl mx-auto p-6">
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

      {/* Sélecteurs */}
      <Card className="shadow-sm">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <SearchableSelect
            value={filiereId}
            onChange={(v) => {
              setFiliereId(v);
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
            value={semestreId}
            onChange={(v) => {
              setSemestreId(v);
              setSessionId("");
            }}
            icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
            placeholder={!filiereId ? "Choisir une filière" : "Semestre"}
            options={semestres.map((s) => ({ value: s.id, label: s.libelle }))}
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
                ? "Aucune session"
                : "Session"
            }
            searchPlaceholder="Rechercher une session…"
            options={sessions.map((s) => {
              // Remplace le code UE par le nom de l'UE dans le libellé de session
              // (ex. « Session Semestre 1 — L1DAF-S1-UE1 » → « … — Fondements du Droit »).
              const base = String(s.session_libelle ?? "");
              const label =
                s.ue_code && s.ue_libelle && base.includes(s.ue_code)
                  ? base.replace(s.ue_code, s.ue_libelle)
                  : base || s.ue_libelle || "";
              return { value: s.id, label };
            })}
          />
        </CardContent>
      </Card>

      {/* Grille de saisie — une table par ECUE */}
      {!sessionId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <GraduationCap className="h-8 w-8 text-indigo-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une filière, un semestre et une session pour saisir les notes.
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
            Aucun étudiant inscrit (confirmé) dans cette session.
          </CardContent>
        </Card>
      ) : ecues.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Cette UE n'a pas d'ECUE (hors Conduite).
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {ecues.map((ecue) => (
            <Card key={ecue.ecue_id} className="shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
                <BookOpen className="h-4 w-4 text-indigo-500 shrink-0" />
                <span className="font-mono text-xs opacity-70">{ecue.code}</span>
                <span className="font-semibold">{ecue.libelle}</span>
                {ecue.credits != null && (
                  <span className="text-xs text-muted-foreground">· {ecue.credits} cr.</span>
                )}
              </div>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border bg-muted/30">
                      <th className="px-4 py-3 font-medium">Étudiant</th>
                      <th className="px-4 py-3 font-medium">Devoirs (/20)</th>
                      <th className="px-3 py-3 font-medium w-40">Examen (/20)</th>
                      <th className="px-3 py-3 font-medium text-center w-24">Moy. dev.</th>
                      <th className="px-3 py-3 font-medium text-center w-24">Note ECUE</th>
                      <th className="px-4 py-3 font-medium text-right w-28">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const subs = evalSubsOf(ecue.ecue_id, s.student_id);
                      return (
                        <StudentNoteRow
                          key={`${ecue.ecue_id}-${s.student_id}`}
                          student={s}
                          ecueId={ecue.ecue_id}
                          sessionId={sessionId}
                          result={resultOf(ecue.ecue_id, s.student_id)}
                          devoirs={devoirsOf(ecue.ecue_id, s.student_id)}
                          examen={examenOf(ecue.ecue_id, s.student_id)}
                          evalDevoirs={subs.filter((x: any) => x.type !== "examen")}
                          evalExamen={subs.find((x: any) => x.type === "examen") ?? null}
                          onError={setError}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Conduite du semestre (note unique par étudiant, saisie admin) */}
      {isAdmin && semestreId && conduite && conduiteStudents.length > 0 && (
        <Card className="shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-amber-50 px-4 py-3">
            <Star className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="font-semibold">Conduite</span>
            <span className="text-xs text-muted-foreground">
              · {conduite.ecue_code}
              {conduite.credits != null ? ` · ${conduite.credits} cr.` : ""} · une note /20 par
              étudiant
            </span>
          </div>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-4 py-3 font-medium">Étudiant</th>
                  <th className="px-4 py-3 font-medium w-56">Conduite (/20)</th>
                </tr>
              </thead>
              <tbody>
                {conduiteStudents.map((s) => (
                  <ConduiteRow
                    key={s.student_id}
                    student={s}
                    ecueId={conduite.ecue_id}
                    ueSessionId={conduite.ue_session_id}
                    onError={setError}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {sessionId && ecues.length > 0 && students.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Note ECUE = moyenne des devoirs × 0,4 + note d'examen × 0,6. Une seule note d'examen par
          ECUE. Les notes issues des évaluations apparaissent automatiquement.
        </p>
      )}

      {/* Barre d'action : enregistrer les saisies + calculer */}
      {sessionId && ecues.length > 0 && students.length > 0 && (
        <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
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
      )}
    </div>
  );
}

const EVAL_FMT: Record<string, string> = {
  online: "en ligne",
  pdf: "sujet unique",
  ai_generated: "IA",
};

function StudentNoteRow({
  student,
  ecueId,
  sessionId,
  result,
  devoirs,
  examen,
  evalDevoirs,
  evalExamen,
  onError,
}: {
  student: any;
  ecueId: string;
  sessionId: string;
  result: any;
  devoirs: any[];
  examen: any;
  evalDevoirs: any[];
  evalExamen: any;
  onError: (m: string | null) => void;
}) {
  const [newDevoir, setNewDevoir] = useState("");
  // Valeur d'examen effective : note manuelle prioritaire, sinon note d'évaluation.
  const effExamNote = examen ? examen.note : evalExamen ? evalExamen.note : null;
  const [examInput, setExamInput] = useState(effExamNote != null ? String(effExamNote) : "");
  const upsert = useUpsertManualNote();
  const del = useDeleteManualNote();

  useEffect(() => {
    setExamInput(effExamNote != null ? String(effExamNote) : "");
  }, [examen?.id, examen?.note, evalExamen?.note, ecueId, student.student_id]);

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

  async function addDevoir() {
    const v = parseFloat(newDevoir.replace(",", "."));
    if (isNaN(v)) return;
    onError(null);
    try {
      await upsert.mutateAsync({
        ecueId,
        student_id: student.student_id,
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

  async function saveExamen() {
    const raw = examInput.trim();
    if (raw === "") return;
    const v = parseFloat(raw.replace(",", "."));
    if (isNaN(v)) return;
    // Inchangé (identique à la valeur effective) → ne rien créer.
    if (effExamNote != null && Number(effExamNote) === v) return;
    onError(null);
    try {
      await upsert.mutateAsync({
        ecueId,
        student_id: student.student_id,
        ue_session_id: sessionId,
        nature: "examen",
        note: v,
        note_max: 20,
      });
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de l'enregistrement de l'examen.");
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
    <tr className="border-b border-border/60 last:border-0 align-top">
      <td className="px-4 py-3">
        <div className="font-medium">
          {student.first_name} {student.last_name}
        </div>
        {student.matricule && (
          <div className="font-mono text-[11px] text-muted-foreground">{student.matricule}</div>
        )}
      </td>
      {/* Devoirs : notes d'évaluations (lecture seule) + notes manuelles */}
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {evalDevoirs.map((d) => (
            <span
              key={d.assignment_id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-xs font-mono"
              title={`${d.titre} — évaluation ${EVAL_FMT[d.evaluation_type] ?? d.evaluation_type}`}
            >
              <BookOpen className="h-3 w-3 opacity-70" />
              {fmt(d.note)}
            </span>
          ))}
          {devoirs.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-xs font-mono"
              title="Note saisie manuellement"
            >
              {fmt(d.note)}
              <button
                type="button"
                onClick={() => removeNote(d.id)}
                className="text-indigo-400 hover:text-red-600"
                title="Supprimer ce devoir"
              >
                <Trash2 className="h-3 w-3" />
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
              className="h-7 w-20 text-xs"
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
      </td>
      {/* Examen : saisie (manuelle prioritaire) + source */}
      <td className="px-3 py-3">
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
            className="h-8 w-20"
          />
          {examen ? (
            <>
              <span className="text-[10px] text-indigo-600" title="Note saisie manuellement">
                manuel
              </span>
              <button
                type="button"
                onClick={() => removeNote(examen.id)}
                className="text-gray-400 hover:text-red-600"
                title="Supprimer la note d'examen manuelle"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : evalExamen ? (
            <span
              className="text-[10px] text-slate-500"
              title={`${evalExamen.titre} — évaluation ${EVAL_FMT[evalExamen.evaluation_type] ?? evalExamen.evaluation_type}`}
            >
              éval
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-3 text-center font-mono">{fmt(result?.moyenne_devoirs)}</td>
      <td className="px-3 py-3 text-center font-mono font-semibold">{fmt(result?.moyenne)}</td>
      <td className="px-4 py-3 text-right">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statut.cls}`}>
          {statut.label}
        </span>
      </td>
    </tr>
  );
}

function ConduiteRow({
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
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-4 py-3">
        <div className="font-medium">
          {student.first_name} {student.last_name}
        </div>
        {student.matricule && (
          <div className="font-mono text-[11px] text-muted-foreground">{student.matricule}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
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
            className="h-8 w-24"
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
      </td>
    </tr>
  );
}
