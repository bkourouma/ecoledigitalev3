"use client";

import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Input, Textarea, Label } from "@ecoledigitale/ui";
import { Edit, Trash2, GripVertical, CheckCircle, XCircle, Brain, Save, X } from "lucide-react";
import { useDeleteQuestion, useUpdateQuestion, type EvaluationQuestion } from "@/lib/hooks/use-evaluations";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import React from "react";

interface QuestionsListProps {
  assignmentId: string;
  questions: EvaluationQuestion[];
  inlineEditIds?: string[];
}

export default function QuestionsList({ assignmentId, questions, inlineEditIds = [] }: QuestionsListProps) {
  const deleteQuestionMutation = useDeleteQuestion();
  const updateQuestionMutation = useUpdateQuestion();

  const [editingIds, setEditingIds] = React.useState<string[]>(inlineEditIds);
  const [drafts, setDrafts] = React.useState<Record<string, Partial<EvaluationQuestion>>>({});

  // Bulk edit helpers
  const allIds = React.useMemo(() => (questions || []).map((q) => q.id), [questions]);
  const questionsById = React.useMemo(() => Object.fromEntries((questions || []).map((q) => [q.id, q])), [questions]);
  const allEditing = allIds.length > 0 && allIds.every((id) => editingIds.includes(id));
  const toggleAllEditing = () => {
    if (allEditing) {
      setEditingIds([]);
      setDrafts({});
    } else {
      setEditingIds(allIds);
      setDrafts((d) => {
        const next: Record<string, Partial<EvaluationQuestion>> = { ...d };
        for (const id of allIds) {
          if (!next[id]) {
            const q = questionsById[id] as EvaluationQuestion;
            next[id] = {
              type: q.type,
              question_text: q.question_text,
              options: q.options ? [...q.options] : undefined,
              correct_answer: q.correct_answer,
              points: q.points,
            } as any;
          }
        }
        return next;
      });
    }
  };

  const startEdit = (q: EvaluationQuestion) => {
    setEditingIds((ids) => Array.from(new Set([...ids, q.id])));
    setDrafts((d) => ({
      ...d,
      [q.id]: {
        type: q.type,
        question_text: q.question_text,
        options: q.options ? [...q.options] : undefined,
        correct_answer: q.correct_answer,
        points: q.points,
      } as any,
    }));
  };

  const cancelEdit = (id: string) => {
    setEditingIds((ids) => ids.filter((x) => x !== id));
    setDrafts((d) => {
      const copy = { ...d } as any;
      delete copy[id];
      return copy;
    });
  };

  const saveEdit = async (q: EvaluationQuestion) => {
    const payload = drafts[q.id];
    if (!payload) return cancelEdit(q.id);
    try {
      await updateQuestionMutation.mutateAsync({ assignmentId, questionId: q.id, data: payload as any });
      cancelEdit(q.id);
    } catch (e) {
      alert('Erreur lors de la sauvegarde: ' + String(e));
    }
  };

  const handleDelete = async (question: EvaluationQuestion) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer cette question ?`)) {
      return;
    }

    try {
      await deleteQuestionMutation.mutateAsync({
        assignmentId,
        questionId: question.id,
      });
    } catch (error) {
      alert('Erreur lors de la suppression: ' + String(error));
    }
  };

  const getQuestionTypeLabel = (type: string) => {
    const labels = {
      single_choice: "Choix unique",
      multiple_choice: "Choix multiples",
      true_false: "Vrai/Faux",
      short_text: "Texte court",
      fill_blank: "Texte à trous"
    };
    return labels[type as keyof typeof labels] || type;
  };

  const getQuestionTypeBadge = (type: string) => {
    const variants = {
      single_choice: "default",
      multiple_choice: "secondary",
      true_false: "outline",
      short_text: "destructive",
      fill_blank: "secondary"
    } as const;

    return (
      <Badge variant={variants[type as keyof typeof variants] || "default"}>
        {getQuestionTypeLabel(type)}
      </Badge>
    );
  };

  const renderQuestionPreview = (question: EvaluationQuestion) => {
    switch (question.type) {
      case 'single_choice':
      case 'multiple_choice':
        return (
          <div className="space-y-2">
            <p className="font-medium">{question.question_text}</p>
            {question.options && (
              <div className="space-y-1">
                {question.options.map((option, index) => {
                  const isCorrect = question.type === 'single_choice' 
                    ? question.correct_answer === index
                    : Array.isArray(question.correct_answer) && question.correct_answer.includes(index);
                  
                  return (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      {isCorrect ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={isCorrect ? "text-green-600 font-medium" : "text-muted-foreground"}>
                        {String.fromCharCode(65 + index)}. {option}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

      case 'true_false':
        return (
          <div className="space-y-2">
            <p className="font-medium">{question.question_text}</p>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                {question.correct_answer === true ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={question.correct_answer === true ? "text-green-600 font-medium" : "text-muted-foreground"}>
                  Vrai
                </span>
              </div>
              <div className="flex items-center gap-2">
                {question.correct_answer === false ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={question.correct_answer === false ? "text-green-600 font-medium" : "text-muted-foreground"}>
                  Faux
                </span>
              </div>
            </div>
          </div>
        );

      case 'short_text':
      case 'fill_blank':
        return (
          <div className="space-y-2">
            <p className="font-medium">{question.question_text}</p>
            <div className="bg-muted p-2 rounded text-sm">
              <span className="text-muted-foreground">Réponse attendue: </span>
              <span className="font-medium">{String(question.correct_answer)}</span>
            </div>
          </div>
        );

      default:
        return (
          <p className="font-medium">{question.question_text}</p>
        );
    }
  };

  if (questions.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 bg-muted rounded-full flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-medium">Aucune question</h3>
              <p className="text-muted-foreground">
                Commencez par ajouter des questions à votre évaluation.
              </p>
            </div>
            <Link href={`/academic/evaluations/${assignmentId}/questions/create`}>
              <Button>Ajouter la première question</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort questions by order_index
  const sortedQuestions = [...questions].sort((a, b) => a.order_index - b.order_index);

  return (
    <div className="space-y-4">
      {sortedQuestions.map((question, index) => {
        const isEditing = editingIds.includes(question.id);
        const draft = drafts[question.id] || ({} as any);
        return (
          <Card key={question.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                    <span className="text-sm font-medium text-muted-foreground">
                      Question {index + 1}
                    </span>
                  </div>
                  {getQuestionTypeBadge(question.type)}
                  {question.ai_generated && (
                    <Badge variant="outline" className="text-purple-600 border-purple-200">
                      <Brain className="h-3 w-3 mr-1" />
                      IA
                    </Badge>
                  )}
                </div>
                {/* Bulk edit toggle in first card header */}
                {index === 0 && (
                  <div className="mr-auto pl-3">
                    <Button variant="outline" size="sm" onClick={toggleAllEditing}>
                      {allEditing ? 'Fermer édition en masse' : 'Modifier tout en ligne'}
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {(isEditing ? draft.points ?? question.points : question.points)} point{(isEditing ? (draft.points ?? question.points) : question.points) > 1 ? 's' : ''}
                  </span>
                  {isEditing ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => saveEdit(question)} disabled={updateQuestionMutation.isPending}>
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => cancelEdit(question.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => startEdit(question)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(question)}
                    disabled={deleteQuestionMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-3">
                  {/* Question text */}
                  <Textarea
                    value={draft.question_text ?? question.question_text}
                    onChange={(e) => setDrafts((d) => ({ ...d, [question.id]: { ...(d[question.id] || {}), question_text: e.target.value } }))}
                    placeholder="Saisissez votre question..."
                    rows={3}
                  />

                  {/* Type-specific inline editor */}
                  {(question.type === 'single_choice' || question.type === 'multiple_choice') && (
                    <div className="space-y-2">
                      {Array.from(draft.options ?? question.options ?? []).map((opt, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          {question.type === 'single_choice' ? (
                            <RadioGroup
                              value={String((draft.correct_answer ?? question.correct_answer) as any)}
                              onValueChange={(val) => setDrafts((d) => ({ ...d, [question.id]: { ...(d[question.id] || {}), correct_answer: parseInt(val) } }))}
                            >
                              <RadioGroupItem value={String(idx)} id={`opt-${question.id}-${idx}`} />
                            </RadioGroup>
                          ) : (
                            <Checkbox
                              checked={Array.isArray(draft.correct_answer ?? question.correct_answer) && (draft.correct_answer ?? question.correct_answer).includes(idx)}
                              onCheckedChange={(checked) => {
                                const current = Array.isArray(draft.correct_answer ?? question.correct_answer) ? (draft.correct_answer ?? question.correct_answer) as number[] : [];
                                const next = checked ? Array.from(new Set([...current, idx])) : current.filter((i) => i !== idx);
                                setDrafts((d) => ({ ...d, [question.id]: { ...(d[question.id] || {}), correct_answer: next } }));
                              }}
                            />
                          )}
                          <Input
                            className="flex-1"
                            value={opt as string}
                            onChange={(e) => {
                              const nextOptions = Array.from(draft.options ?? question.options ?? []);
                              (nextOptions as any)[idx] = e.target.value;
                              setDrafts((d) => ({ ...d, [question.id]: { ...(d[question.id] || {}), options: nextOptions as any } }));
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {(question.type === 'true_false') && (
                    <RadioGroup
                      value={String(draft.correct_answer ?? question.correct_answer)}
                      onValueChange={(v) => setDrafts((d) => ({ ...d, [question.id]: { ...(d[question.id] || {}), correct_answer: v === 'true' } }))}
                    >
                      <div className="flex items-center gap-2"><RadioGroupItem value="true" id={`true-${question.id}`} /><Label htmlFor={`true-${question.id}`}>Vrai</Label></div>
                      <div className="flex items-center gap-2"><RadioGroupItem value="false" id={`false-${question.id}`} /><Label htmlFor={`false-${question.id}`}>Faux</Label></div>
                    </RadioGroup>
                  )}

                  {(question.type === 'short_text' || question.type === 'fill_blank') && (
                    <Input
                      value={String(draft.correct_answer ?? question.correct_answer ?? '')}
                      onChange={(e) => setDrafts((d) => ({ ...d, [question.id]: { ...(d[question.id] || {}), correct_answer: e.target.value } }))}
                      placeholder="Réponse attendue"
                    />
                  )}

                  {/* Points */}
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`points-${question.id}`}>Points</Label>
                    <Input
                      id={`points-${question.id}`}
                      type="number"
                      step="0.5"
                      className="w-24"
                      value={Number(draft.points ?? question.points)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [question.id]: { ...(d[question.id] || {}), points: parseFloat(e.target.value || '0') } }))}
                    />
                  </div>
                </div>
              ) : (
                renderQuestionPreview(question)
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Summary */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="flex justify-between items-center text-sm">
            <span>
              <strong>{questions.length}</strong> question{questions.length > 1 ? 's' : ''} au total
            </span>
            <span>
              <strong>{questions.reduce((sum, q) => sum + q.points, 0)}</strong> points au total
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
