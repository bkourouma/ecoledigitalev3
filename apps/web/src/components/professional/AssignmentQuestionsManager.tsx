"use client";

import { useState } from "react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  Plus,
  Loader2,
  X,
  Trash2,
  Edit2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
} from "lucide-react";
import {
  useAssignmentQuestions,
  useCreateAssignmentQuestion,
  useUpdateAssignmentQuestion,
  useDeleteAssignmentQuestion,
} from "@/lib/hooks/use-professional-assignments";

interface Props {
  assignment: any;
  onClose: () => void;
}

const QUESTION_TYPE_OPTIONS = [
  { value: "mcq_single", label: "QCM — choix unique" },
  { value: "mcq_multi", label: "QCM — choix multiple" },
  { value: "true_false", label: "Vrai / Faux" },
  { value: "short_answer", label: "Réponse courte" },
  { value: "long_answer", label: "Réponse longue" },
];

const TYPE_BADGE: Record<string, string> = {
  mcq_single: "bg-green-500/15 text-green-500 border-green-500/40",
  mcq_multi: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  true_false: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  short_answer: "bg-blue-500/15 text-blue-500 border-blue-500/40",
  long_answer: "bg-purple-500/15 text-purple-500 border-purple-500/40",
};

const TYPE_LABEL: Record<string, string> = {
  mcq_single: "QCM unique",
  mcq_multi: "QCM multiple",
  true_false: "Vrai/Faux",
  short_answer: "Courte",
  long_answer: "Longue",
};

export function AssignmentQuestionsManager({ assignment, onClose }: Props) {
  const questionsQuery = useAssignmentQuestions(assignment.id);
  const deleteMut = useDeleteAssignmentQuestion();

  const [editing, setEditing] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions: any[] = questionsQuery.data ?? [];
  const totalPoints = questions.reduce((s, q) => s + Number(q.points || 0), 0);

  async function handleDelete(id: string) {
    setError(null);
    if (!window.confirm("Supprimer définitivement cette question ?")) return;
    try {
      await deleteMut.mutateAsync(id);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la suppression.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold">Questions — {assignment.titre}</h3>
            <p className="text-xs text-muted-foreground">
              {questions.length} question{questions.length > 1 ? "s" : ""} ·{" "}
              <span className="font-medium">{totalPoints}</span> pt(s) cumulés · barème /{assignment.note_max}
              {totalPoints !== Number(assignment.note_max) && questions.length > 0 && (
                <span className="ml-2 text-amber-500">
                  ⚠ ne correspond pas au barème
                </span>
              )}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}

          {questionsQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : questions.length === 0 ? (
            <div className="text-center py-10">
              <HelpCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                Aucune question. Cliquez sur « Ajouter une question » pour commencer.
              </p>
            </div>
          ) : (
            questions.map((q, idx) => (
              <QuestionCard
                key={q.id}
                index={idx}
                question={q}
                onEdit={() => setEditing(q)}
                onDelete={() => handleDelete(q.id)}
                deleting={deleteMut.isPending}
              />
            ))
          )}
        </div>

        <div className="flex justify-between gap-2 px-4 py-3 border-t border-border bg-muted/40">
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Ajouter une question
          </Button>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>

      {(showCreate || editing) && (
        <QuestionFormModal
          assignmentId={assignment.id}
          initial={editing}
          nextPosition={questions.length + 1}
          onClose={() => {
            setShowCreate(false);
            setEditing(null);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function QuestionCard({
  index,
  question,
  onEdit,
  onDelete,
  deleting,
}: {
  index: number;
  question: any;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const correctLabel = (() => {
    if (question.type === "mcq_single" || question.type === "true_false") {
      const opt = (question.options ?? []).find((o: any) => o.id === question.correct_answer);
      return opt ? opt.text : question.correct_answer ?? "—";
    }
    if (question.type === "mcq_multi") {
      let ids: string[] = [];
      try {
        ids = JSON.parse(question.correct_answer ?? "[]");
      } catch {
        ids = [];
      }
      const opts = (question.options ?? []).filter((o: any) => ids.includes(o.id));
      return opts.map((o: any) => o.text).join(", ") || "—";
    }
    if (question.type === "short_answer") {
      return question.correct_answer ?? "(correction manuelle)";
    }
    return "(correction manuelle)";
  })();

  return (
    <div className="rounded-md border border-border bg-muted/20 overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="text-sm font-mono text-muted-foreground shrink-0 pt-0.5">
            Q{index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{question.question_text}</p>
            <div className="flex flex-wrap gap-2 mt-1.5 text-[11px]">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${TYPE_BADGE[question.type]}`}
              >
                {TYPE_LABEL[question.type] ?? question.type}
              </span>
              <span className="text-muted-foreground">
                {question.points} pt{Number(question.points) > 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Réduire" : "Voir le détail"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onDelete}
            disabled={deleting}
            className="text-red-500"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-background/40 px-3 py-2 text-xs space-y-2">
          {(question.type === "mcq_single" ||
            question.type === "mcq_multi" ||
            question.type === "true_false") && (
            <div className="space-y-1">
              <p className="font-medium">Options :</p>
              <ul className="space-y-0.5">
                {(question.options ?? []).map((opt: any) => {
                  let isCorrect = false;
                  if (question.type === "mcq_single" || question.type === "true_false") {
                    isCorrect = opt.id === question.correct_answer;
                  } else if (question.type === "mcq_multi") {
                    let ids: string[] = [];
                    try {
                      ids = JSON.parse(question.correct_answer ?? "[]");
                    } catch {
                      ids = [];
                    }
                    isCorrect = ids.includes(opt.id);
                  }
                  return (
                    <li
                      key={opt.id}
                      className={`flex items-center gap-2 ${
                        isCorrect ? "text-green-500 font-medium" : "text-muted-foreground"
                      }`}
                    >
                      {isCorrect ? "✓" : "·"} {opt.text}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {(question.type === "short_answer" || question.type === "long_answer") && (
            <p>
              <span className="font-medium">Réponse attendue :</span>{" "}
              <span className="text-muted-foreground">{correctLabel}</span>
            </p>
          )}
          {question.explanation && (
            <p>
              <span className="font-medium">Explication :</span>{" "}
              <span className="text-muted-foreground">{question.explanation}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Création / édition d'une question                                          */
/* -------------------------------------------------------------------------- */

function QuestionFormModal({
  assignmentId,
  initial,
  nextPosition,
  onClose,
  onError,
}: {
  assignmentId: string;
  initial: any | null;
  nextPosition: number;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const createMut = useCreateAssignmentQuestion();
  const updateMut = useUpdateAssignmentQuestion();

  const [type, setType] = useState<string>(initial?.type ?? "mcq_single");
  const [questionText, setQuestionText] = useState<string>(initial?.question_text ?? "");
  const [points, setPoints] = useState<number>(initial?.points ?? 1);
  const [explanation, setExplanation] = useState<string>(initial?.explanation ?? "");

  // Options pour QCM (et true_false initialisé)
  const buildInitialOptions = () => {
    if (initial?.options && Array.isArray(initial.options) && initial.options.length > 0) {
      return initial.options.map((o: any) => ({ id: o.id, text: o.text }));
    }
    if (initial?.type === "true_false") {
      return [
        { id: "true", text: "Vrai" },
        { id: "false", text: "Faux" },
      ];
    }
    return [
      { id: "a", text: "" },
      { id: "b", text: "" },
      { id: "c", text: "" },
      { id: "d", text: "" },
    ];
  };
  const [options, setOptions] = useState<Array<{ id: string; text: string }>>(
    buildInitialOptions()
  );

  // correct_answer :
  //  - mcq_single / true_false : string (id de l'option)
  //  - mcq_multi : string[] (ids des options)
  //  - short_answer : string (texte)
  //  - long_answer : null
  const [correctSingle, setCorrectSingle] = useState<string>(
    initial?.type === "mcq_single" || initial?.type === "true_false"
      ? (initial.correct_answer ?? "")
      : ""
  );
  const [correctMulti, setCorrectMulti] = useState<string[]>(() => {
    if (initial?.type === "mcq_multi") {
      try {
        const ids = JSON.parse(initial.correct_answer ?? "[]");
        return Array.isArray(ids) ? ids : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const [correctText, setCorrectText] = useState<string>(
    initial?.type === "short_answer" ? (initial.correct_answer ?? "") : ""
  );

  // Quand on change de type, ré-initialise options/correct
  function handleTypeChange(newType: string) {
    setType(newType);
    if (newType === "true_false") {
      setOptions([
        { id: "true", text: "Vrai" },
        { id: "false", text: "Faux" },
      ]);
      setCorrectSingle("true");
    } else if (newType === "mcq_single" || newType === "mcq_multi") {
      if (options.length < 2 || options[0]?.id === "true") {
        setOptions([
          { id: "a", text: "" },
          { id: "b", text: "" },
          { id: "c", text: "" },
          { id: "d", text: "" },
        ]);
      }
      setCorrectSingle("");
      setCorrectMulti([]);
    }
  }

  function updateOptionText(idx: number, text: string) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, text } : o)));
  }

  function addOption() {
    const nextId = String.fromCharCode("a".charCodeAt(0) + options.length);
    setOptions((prev) => [...prev, { id: nextId, text: "" }]);
  }

  function removeOption(idx: number) {
    const removed = options[idx];
    setOptions((prev) => prev.filter((_, i) => i !== idx));
    if (correctSingle === removed.id) setCorrectSingle("");
    setCorrectMulti((prev) => prev.filter((x) => x !== removed.id));
  }

  function toggleMultiCorrect(id: string) {
    setCorrectMulti((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function validate(): string | null {
    if (!questionText.trim()) return "Le libellé de la question est requis.";
    if (Number(points) <= 0) return "Le nombre de points doit être supérieur à 0.";
    if (type === "mcq_single" || type === "mcq_multi") {
      const filled = options.filter((o) => o.text.trim());
      if (filled.length < 2) return "Au moins 2 options sont requises.";
      if (type === "mcq_single" && !correctSingle)
        return "Sélectionnez la bonne réponse.";
      if (type === "mcq_multi" && correctMulti.length === 0)
        return "Cochez au moins une bonne réponse.";
    } else if (type === "true_false") {
      if (!correctSingle) return "Choisissez Vrai ou Faux.";
    } else if (type === "short_answer") {
      if (!correctText.trim())
        return "Saisissez la réponse attendue (utilisée pour l'auto-correction).";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      onError(err);
      return;
    }
    let payload: any = {
      type,
      question_text: questionText.trim(),
      points: Number(points),
      explanation: explanation.trim() || null,
    };
    if (!initial) payload.position = nextPosition;

    if (type === "mcq_single" || type === "mcq_multi" || type === "true_false") {
      payload.options = options.filter((o) => o.text.trim());
      payload.correct_answer =
        type === "mcq_multi" ? JSON.stringify(correctMulti) : correctSingle;
    } else if (type === "short_answer") {
      payload.options = null;
      payload.correct_answer = correctText.trim();
    } else {
      // long_answer
      payload.options = null;
      payload.correct_answer = null;
    }

    try {
      if (initial) {
        await updateMut.mutateAsync({ id: initial.id, data: payload });
      } else {
        await createMut.mutateAsync({ assignmentId, data: payload });
      }
      onClose();
    } catch (e: any) {
      onError(e?.message ?? "Erreur lors de l'enregistrement.");
    }
  }

  const isPending = createMut.isPending || updateMut.isPending;
  const isChoice = type === "mcq_single" || type === "mcq_multi";
  const isTF = type === "true_false";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold">
            {initial ? "Modifier la question" : "Nouvelle question"}
          </h4>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-1">
              <label className="text-sm font-medium">Type de question</label>
              <Select value={type} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Points</label>
              <Input
                type="number"
                min={0.25}
                step="0.25"
                value={points}
                onChange={(e) => setPoints(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Libellé de la question</label>
            <textarea
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Saisir l'énoncé de la question…"
            />
          </div>

          {/* Options de QCM ou Vrai/Faux */}
          {(isChoice || isTF) && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {isTF ? "Réponse correcte" : "Options de réponse"}
              </label>
              {options.map((opt, idx) => {
                const isSelected =
                  type === "mcq_multi" ? correctMulti.includes(opt.id) : correctSingle === opt.id;
                return (
                  <div key={opt.id} className="flex items-center gap-2">
                    {type === "mcq_multi" ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMultiCorrect(opt.id)}
                        title="Cocher si bonne réponse"
                      />
                    ) : (
                      <input
                        type="radio"
                        name="correct-option"
                        checked={isSelected}
                        onChange={() => setCorrectSingle(opt.id)}
                        title="Sélectionner la bonne réponse"
                      />
                    )}
                    <Input
                      value={opt.text}
                      onChange={(e) => updateOptionText(idx, e.target.value)}
                      placeholder={isTF ? "" : `Option ${idx + 1}`}
                      disabled={isTF}
                      className="flex-1"
                    />
                    {!isTF && options.length > 2 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeOption(idx)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
              {!isTF && (
                <Button type="button" variant="outline" size="sm" onClick={addOption}>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter une option
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                {type === "mcq_multi"
                  ? "Cochez toutes les bonnes réponses (au moins une)."
                  : "Sélectionnez l'unique bonne réponse en cliquant sur le bouton radio."}
              </p>
            </div>
          )}

          {/* Réponse courte */}
          {type === "short_answer" && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Réponse attendue</label>
              <Input
                value={correctText}
                onChange={(e) => setCorrectText(e.target.value)}
                placeholder="Ex : 300000"
              />
              <p className="text-[11px] text-muted-foreground">
                L'auto-correction compare en insensible à la casse et aux espaces multiples.
              </p>
            </div>
          )}

          {/* Réponse longue */}
          {type === "long_answer" && (
            <div className="rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs">
              Les réponses longues sont <strong>corrigées manuellement</strong> par l'enseignant
              dans l'écran de correction.
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium">Explication / Correction (optionnel)</label>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Affichée à l'étudiant après correction (mode 'after_correction')."
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/40">
          <Button type="button" variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            {initial ? "Enregistrer" : "Créer la question"}
          </Button>
        </div>
      </form>
    </div>
  );
}
