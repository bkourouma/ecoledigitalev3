"use client";

import { useState } from "react";
import { Button, Input } from "@ecoledigitale/ui";
import {
  Loader2,
  X,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Save,
  Award,
} from "lucide-react";
import {
  useSubmissionDetail,
  useGradeQuestionAnswer,
} from "@/lib/hooks/use-professional-assignments";

interface Props {
  submissionId: string;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  mcq_single: "QCM unique",
  mcq_multi: "QCM multiple",
  true_false: "Vrai/Faux",
  short_answer: "Réponse courte",
  long_answer: "Réponse longue",
};

/**
 * Vue détaillée des réponses d'un étudiant à une évaluation en ligne.
 * Auto-grade affiché pour MCQ/TF, correction manuelle pour short/long.
 */
export function SubmissionAnswersReviewer({ submissionId, onClose }: Props) {
  const detailQuery = useSubmissionDetail(submissionId);
  const gradeMut = useGradeQuestionAnswer();
  const [error, setError] = useState<string | null>(null);
  // Local edits par answer_id : { points: string, feedback: string }
  const [edits, setEdits] = useState<Record<string, { points: string; feedback: string }>>({});

  if (detailQuery.isLoading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
        <div className="bg-background border border-border rounded-lg p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
        <div className="bg-background border border-border rounded-lg p-6 max-w-md">
          <p className="text-red-500 mb-3">
            {(detailQuery.error as Error)?.message ?? "Soumission introuvable."}
          </p>
          <Button onClick={onClose}>Fermer</Button>
        </div>
      </div>
    );
  }

  const data = detailQuery.data as any;
  const submission = data.submission;
  const questions = data.questions ?? [];
  const totals = data.totals ?? { earned: 0, max_questions: 0 };

  function getEdit(q: any) {
    return (
      edits[q.answer_id] ?? {
        points:
          q.points_earned != null
            ? String(q.points_earned)
            : q.answer_id
              ? ""
              : "0",
        feedback: q.feedback ?? "",
      }
    );
  }

  async function saveGrade(q: any) {
    setError(null);
    if (!q.answer_id) {
      setError("L'étudiant n'a pas répondu à cette question.");
      return;
    }
    const ed = getEdit(q);
    const pts = parseFloat(ed.points);
    if (Number.isNaN(pts)) {
      setError("Veuillez saisir des points numériques.");
      return;
    }
    const max = Number(q.points);
    if (pts < 0 || pts > max) {
      setError(`Points hors plage (0 → ${max}).`);
      return;
    }
    try {
      await gradeMut.mutateAsync({
        answerId: q.answer_id,
        points: pts,
        feedback: ed.feedback || undefined,
      });
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement.");
    }
  }

  // Affiche la sélection d'un MCQ comme texte lisible
  function renderSelectedOptions(q: any) {
    if (!q.selected_option_ids) return <span className="text-muted-foreground">—</span>;
    let ids: string[] = [];
    try {
      ids =
        typeof q.selected_option_ids === "string"
          ? JSON.parse(q.selected_option_ids)
          : q.selected_option_ids;
    } catch {
      ids = [];
    }
    const opts = (q.options ?? []).filter((o: any) => ids.includes(o.id));
    if (opts.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <ul className="space-y-0.5">
        {opts.map((o: any) => (
          <li key={o.id}>• {o.text}</li>
        ))}
      </ul>
    );
  }

  function renderCorrectAnswer(q: any) {
    if (q.type === "mcq_single" || q.type === "true_false") {
      const opt = (q.options ?? []).find((o: any) => o.id === q.correct_answer);
      return opt ? opt.text : q.correct_answer ?? "—";
    }
    if (q.type === "mcq_multi") {
      let ids: string[] = [];
      try {
        ids = q.correct_answer ? JSON.parse(q.correct_answer) : [];
      } catch {
        ids = [];
      }
      const opts = (q.options ?? []).filter((o: any) => ids.includes(o.id));
      return opts.map((o: any) => o.text).join(", ") || "—";
    }
    if (q.type === "short_answer") {
      return q.correct_answer ?? "(correction manuelle)";
    }
    return "(correction manuelle)";
  }

  const noteAffichee =
    submission.note != null
      ? `${submission.note} / ${submission.note_max ?? "?"}`
      : `${totals.earned} / ${totals.max_questions} (en cours)`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold">
              Copie de {submission.first_name} {submission.last_name}
            </h3>
            <p className="text-xs text-muted-foreground">
              {submission.titre} · soumise le{" "}
              {submission.submitted_at
                ? new Date(submission.submitted_at).toLocaleString("fr-FR")
                : "—"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">Note actuelle</p>
              <p className="font-semibold text-lg flex items-center gap-1.5">
                <Award className="h-4 w-4 text-green-500" />
                {noteAffichee}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}

          {questions.map((q: any, idx: number) => {
            const noAnswer = !q.answer_id;
            const isManual =
              q.type === "long_answer" || (q.type === "short_answer" && q.is_correct == null);
            const ed = getEdit(q);
            return (
              <div
                key={q.question_id}
                className="rounded-md border border-border bg-muted/30 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      <span className="text-muted-foreground mr-2">Q{idx + 1}.</span>
                      {q.question_text}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1 text-[11px]">
                      <span className="text-muted-foreground">
                        {TYPE_LABEL[q.type] ?? q.type} · {q.points} pt
                      </span>
                      {q.is_correct === true && (
                        <span className="text-green-500 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Auto-correction : OK
                        </span>
                      )}
                      {q.is_correct === false && (
                        <span className="text-red-500 flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          Auto-correction : KO
                        </span>
                      )}
                      {q.graded_manually && (
                        <span className="text-blue-500">Corrigé manuellement</span>
                      )}
                      {noAnswer && (
                        <span className="text-amber-500 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Pas de réponse
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-sm font-mono">
                      {q.points_earned != null ? q.points_earned : "—"} / {q.points}
                    </span>
                  </div>
                </div>

                {/* Réponse de l'étudiant */}
                <div className="text-sm bg-background border border-border rounded-md p-2.5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                    Réponse de l'étudiant
                  </p>
                  {q.type === "mcq_single" ||
                  q.type === "mcq_multi" ||
                  q.type === "true_false" ? (
                    renderSelectedOptions(q)
                  ) : (
                    <p className="whitespace-pre-line">
                      {q.answer_text || (
                        <span className="text-muted-foreground italic">(vide)</span>
                      )}
                    </p>
                  )}
                </div>

                {/* Bonne réponse attendue (pour comparaison) */}
                {(q.type !== "long_answer" || q.correct_answer) && (
                  <p className="text-xs">
                    <span className="font-medium">Bonne réponse :</span>{" "}
                    <span className="text-green-500">{renderCorrectAnswer(q)}</span>
                  </p>
                )}

                {q.explanation && (
                  <p className="text-xs text-muted-foreground italic">
                    Explication : {q.explanation}
                  </p>
                )}

                {/* Correction manuelle pour long_answer et short_answer non auto-jugée */}
                {isManual && q.answer_id && (
                  <div className="mt-2 pt-2 border-t border-border/50 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                    <div className="md:col-span-2 space-y-0.5">
                      <label className="text-[11px] font-medium text-muted-foreground">
                        Points (max {q.points})
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={Number(q.points)}
                        step="0.25"
                        value={ed.points}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [q.answer_id]: { ...ed, points: e.target.value },
                          }))
                        }
                        className="h-8"
                      />
                    </div>
                    <div className="md:col-span-8 space-y-0.5">
                      <label className="text-[11px] font-medium text-muted-foreground">
                        Commentaire (optionnel)
                      </label>
                      <Input
                        value={ed.feedback}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [q.answer_id]: { ...ed, feedback: e.target.value },
                          }))
                        }
                        placeholder="Retour à l'étudiant…"
                        className="h-8"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Button
                        size="sm"
                        onClick={() => saveGrade(q)}
                        disabled={gradeMut.isPending}
                        className="w-full"
                      >
                        {gradeMut.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3 mr-1.5" />
                        )}
                        Noter
                      </Button>
                    </div>
                  </div>
                )}

                {/* Permet de surcharger l'auto-correction si besoin */}
                {!isManual && q.answer_id && (
                  <details className="mt-1">
                    <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                      Forcer une autre note (manuelle)
                    </summary>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                      <div className="md:col-span-2 space-y-0.5">
                        <Input
                          type="number"
                          min={0}
                          max={Number(q.points)}
                          step="0.25"
                          value={ed.points}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [q.answer_id]: { ...ed, points: e.target.value },
                            }))
                          }
                          className="h-8"
                          placeholder="Pts"
                        />
                      </div>
                      <div className="md:col-span-8 space-y-0.5">
                        <Input
                          value={ed.feedback}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [q.answer_id]: { ...ed, feedback: e.target.value },
                            }))
                          }
                          placeholder="Commentaire (optionnel)"
                          className="h-8"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => saveGrade(q)}
                          disabled={gradeMut.isPending}
                          className="w-full"
                        >
                          Forcer la note
                        </Button>
                      </div>
                    </div>
                  </details>
                )}

                {q.feedback && (
                  <p className="text-xs text-blue-500 italic">
                    📝 Votre commentaire : « {q.feedback} »
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-between gap-2 px-4 py-3 border-t border-border bg-muted/40">
          <div className="text-xs text-muted-foreground">
            Statut soumission :{" "}
            <span className="font-medium">{submission.statut}</span> · Total :{" "}
            <span className="font-mono">{totals.earned}</span> /{" "}
            <span className="font-mono">{totals.max_questions}</span> pts cumulés
          </div>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
