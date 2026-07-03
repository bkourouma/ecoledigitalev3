"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "@ecoledigitale/ui";
import { Loader2, CheckCircle2, AlertCircle, Clock, X } from "lucide-react";
import {
  useAssignmentQuestions,
  useMyAnswers,
  useSubmitAssignmentAnswers,
} from "@/lib/hooks/use-professional-assignments";

interface Props {
  assignment: any;
  onClose: () => void;
  onSubmitted: () => void;
}

/**
 * Lecteur d'une évaluation en ligne pour un étudiant.
 * Charge les questions, recueille les réponses, et envoie le tout
 * d'un coup au serveur (auto-correction pour QCM / vrai-faux).
 */
export function OnlineEvaluationPlayer({ assignment, onClose, onSubmitted }: Props) {
  const questionsQuery = useAssignmentQuestions(assignment.id);
  const myAnswersQuery = useMyAnswers(assignment.id);
  const submitMut = useSubmitAssignmentAnswers();
  const [answers, setAnswers] = useState<
    Record<string, { answer_text?: string; selected_option_ids?: string[] }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const questions: any[] = questionsQuery.data ?? [];
  const myAnswersData: any = myAnswersQuery.data ?? null;
  const alreadySubmitted = !!myAnswersData?.submission;
  const subStatut = assignment.submission_statut ?? "en_attente";
  const readOnly =
    alreadySubmitted ||
    subStatut === "soumis" ||
    subStatut === "en_correction" ||
    subStatut === "note" ||
    subStatut === "rejete";

  // Initialise les réponses depuis l'état existant (mode lecture)
  useEffect(() => {
    if (myAnswersData?.answers?.length) {
      const init: Record<string, any> = {};
      for (const a of myAnswersData.answers) {
        init[a.question_id] = {
          answer_text: a.answer_text ?? "",
          selected_option_ids: a.selected_option_ids ?? [],
        };
      }
      setAnswers(init);
    }
  }, [myAnswersData]);

  const totalPoints = useMemo(
    () => questions.reduce((sum, q) => sum + Number(q.points || 0), 0),
    [questions]
  );

  function updateAnswer(qid: string, patch: any) {
    if (readOnly) return;
    setAnswers((prev) => ({ ...prev, [qid]: { ...(prev[qid] ?? {}), ...patch } }));
  }

  function toggleMcqMulti(qid: string, optionId: string) {
    if (readOnly) return;
    setAnswers((prev) => {
      const cur = prev[qid]?.selected_option_ids ?? [];
      const next = cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId];
      return { ...prev, [qid]: { ...(prev[qid] ?? {}), selected_option_ids: next } };
    });
  }

  function getAnswerByQuestionId(qid: string) {
    return myAnswersData?.answers?.find((a: any) => a.question_id === qid);
  }

  async function handleSubmit() {
    setError(null);
    const payload = questions.map((q) => ({
      question_id: q.id,
      answer_text: answers[q.id]?.answer_text ?? null,
      selected_option_ids: answers[q.id]?.selected_option_ids ?? null,
    }));
    try {
      const res: any = await submitMut.mutateAsync({
        assignmentId: assignment.id,
        answers: payload,
      });
      setConfirmOpen(false);
      onSubmitted();
      if (res?.max_auto > 0) {
        window.alert(
          `Évaluation soumise.\nNote automatique provisoire : ${res.auto_score} / ${res.max_auto} (les réponses rédigées seront corrigées manuellement par l'enseignant).`
        );
      }
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la soumission.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold">
              {readOnly ? "Ma copie — " : "Passer l'évaluation — "}
              {assignment.titre}
            </h3>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              {assignment.duration_minutes && (
                <>
                  <Clock className="w-3 h-3" />
                  Durée indicative : {assignment.duration_minutes} min ·
                </>
              )}
              <span>
                Total {totalPoints} pts · max_tentatives={assignment.max_attempts ?? 1}
              </span>
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {readOnly && (
            <div className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
              <span>
                Votre copie a déjà été soumise.{" "}
                {myAnswersData?.submission?.note != null
                  ? `Note finale : ${myAnswersData.submission.note}/${assignment.note_max}.`
                  : "Les réponses ouvertes seront notées par l'enseignant."}
              </span>
            </div>
          )}

          {questionsQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune question n'a encore été ajoutée à cette évaluation.
            </p>
          ) : (
            questions.map((q, idx) => {
              const ans = answers[q.id] ?? {};
              const persisted = readOnly ? getAnswerByQuestionId(q.id) : null;
              return (
                <div
                  key={q.id}
                  className="rounded-md border border-border bg-muted/30 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">
                      <span className="text-muted-foreground mr-2">Q{idx + 1}.</span>
                      {q.question_text}
                    </p>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                      {q.points} pt{Number(q.points) > 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* QCM choix unique + true/false */}
                  {(q.type === "mcq_single" || q.type === "true_false") && (
                    <div className="space-y-1.5">
                      {(q.options ?? []).map((opt: any) => {
                        const isSelected = (ans.selected_option_ids ?? [])[0] === opt.id;
                        return (
                          <label
                            key={opt.id}
                            className={`flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer border ${
                              isSelected ? "border-blue-500 bg-blue-500/10" : "border-transparent hover:border-border"
                            }`}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              checked={isSelected}
                              disabled={readOnly}
                              onChange={() =>
                                updateAnswer(q.id, { selected_option_ids: [opt.id] })
                              }
                              className="mt-0.5"
                            />
                            <span className="text-sm">{opt.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* QCM choix multiple */}
                  {q.type === "mcq_multi" && (
                    <div className="space-y-1.5">
                      {(q.options ?? []).map((opt: any) => {
                        const isSelected = (ans.selected_option_ids ?? []).includes(opt.id);
                        return (
                          <label
                            key={opt.id}
                            className={`flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer border ${
                              isSelected ? "border-blue-500 bg-blue-500/10" : "border-transparent hover:border-border"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={readOnly}
                              onChange={() => toggleMcqMulti(q.id, opt.id)}
                              className="mt-0.5"
                            />
                            <span className="text-sm">{opt.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* Réponse courte */}
                  {q.type === "short_answer" && (
                    <Input
                      value={ans.answer_text ?? ""}
                      onChange={(e) => updateAnswer(q.id, { answer_text: e.target.value })}
                      disabled={readOnly}
                      placeholder="Saisir votre réponse…"
                    />
                  )}

                  {/* Réponse longue */}
                  {q.type === "long_answer" && (
                    <textarea
                      value={ans.answer_text ?? ""}
                      onChange={(e) => updateAnswer(q.id, { answer_text: e.target.value })}
                      disabled={readOnly}
                      rows={6}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-70"
                      placeholder="Rédigez votre réponse ici…"
                    />
                  )}

                  {/* Feedback après correction */}
                  {readOnly && persisted && (
                    <div className="mt-1 text-xs space-y-1">
                      {persisted.is_correct != null && (
                        <p
                          className={
                            persisted.is_correct
                              ? "text-green-500"
                              : "text-red-500"
                          }
                        >
                          {persisted.is_correct ? "✓ Bonne réponse" : "✗ Mauvaise réponse"}
                          {persisted.points_earned != null && (
                            <> ({persisted.points_earned}/{q.points} pt)</>
                          )}
                        </p>
                      )}
                      {persisted.feedback && (
                        <p className="italic text-muted-foreground">
                          Commentaire enseignant : {persisted.feedback}
                        </p>
                      )}
                      {q.explanation && (
                        <p className="text-muted-foreground">
                          <span className="font-medium">Explication :</span> {q.explanation}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/40">
          <Button type="button" variant="outline" onClick={onClose}>
            {readOnly ? "Fermer" : "Annuler"}
          </Button>
          {!readOnly && questions.length > 0 && (
            <Button onClick={() => setConfirmOpen(true)} disabled={submitMut.isPending}>
              {submitMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Soumettre mes réponses
            </Button>
          )}
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="bg-background border border-border rounded-lg shadow-2xl w-full max-w-md p-5 space-y-3">
            <h4 className="font-semibold flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              Confirmer la soumission
            </h4>
            <p className="text-sm text-muted-foreground">
              Une fois soumise, votre copie ne pourra plus être modifiée. Vous avez répondu à{" "}
              {Object.keys(answers).filter((k) => {
                const a = answers[k];
                return (a.answer_text && a.answer_text.trim()) || (a.selected_option_ids && a.selected_option_ids.length > 0);
              }).length}
              {" / "}
              {questions.length} questions.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSubmit} disabled={submitMut.isPending}>
                {submitMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirmer et soumettre
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
