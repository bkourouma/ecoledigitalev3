"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Save, Plus, Trash2, CheckCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAssignment, useCreateQuestion, useQuestions, type CreateEvaluationQuestion } from "@/lib/hooks/use-evaluations";
import Link from "next/link";

export default function CreateQuestionPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.id as string;

  const { data: assignment } = useAssignment(assignmentId);
  const { data: questionsData } = useQuestions(assignmentId, {
    enabled: assignment?.type === 'evaluation'
  });
  const createQuestionMutation = useCreateQuestion();

  const questions = questionsData?.questions || [];
  const nextOrderIndex = questions.length;

  const [formData, setFormData] = useState<CreateEvaluationQuestion>({
    type: "single_choice",
    question_text: "",
    options: ["", "", "", ""],
    correct_answer: 0,
    points: 1,
    order_index: nextOrderIndex,
    ai_generated: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Update order_index when questions change
  useEffect(() => {
    setFormData(prev => ({ ...prev, order_index: questions.length }));
  }, [questions.length]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...(formData.options || [])];
    newOptions[index] = value;
    setFormData(prev => ({ ...prev, options: newOptions }));
  };

  const addOption = () => {
    const newOptions = [...(formData.options || []), ""];
    setFormData(prev => ({ ...prev, options: newOptions }));
  };

  const removeOption = (index: number) => {
    const newOptions = (formData.options || []).filter((_, i) => i !== index);
    setFormData(prev => ({ 
      ...prev, 
      options: newOptions,
      correct_answer: formData.type === 'single_choice' && formData.correct_answer === index 
        ? 0 
        : formData.correct_answer
    }));
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.question_text.trim()) {
      newErrors.question_text = "Le texte de la question est requis";
    }

    if (formData.type === 'single_choice' || formData.type === 'multiple_choice') {
      const filledOptions = (formData.options || []).filter(opt => opt.trim());
      if (filledOptions.length < 2) {
        newErrors.options = "Au moins 2 options sont requises";
      } else {
        // Validate that a correct answer is selected
        if (formData.type === 'single_choice') {
          const selectedIndex = typeof formData.correct_answer === 'number' ? formData.correct_answer : -1;
          const originalOptions = formData.options || [];
          if (selectedIndex < 0 || selectedIndex >= originalOptions.length || !originalOptions[selectedIndex]?.trim()) {
            newErrors.correct_answer = "Veuillez sélectionner la bonne réponse";
          }
        } else if (formData.type === 'multiple_choice') {
          const selectedIndices = Array.isArray(formData.correct_answer) ? formData.correct_answer : [];
          if (selectedIndices.length === 0) {
            newErrors.correct_answer = "Veuillez sélectionner au moins une bonne réponse";
          }
        }
      }
    } else if (formData.type === 'true_false') {
      // true_false always has a boolean value, so no validation needed
    } else if (formData.type === 'short_text' || formData.type === 'fill_blank') {
      const answer = typeof formData.correct_answer === 'string' ? formData.correct_answer : String(formData.correct_answer || '');
      if (!answer.trim()) {
        newErrors.correct_answer = "La réponse attendue est requise";
      }
    }

    if (!formData.points || formData.points <= 0 || isNaN(formData.points)) {
      newErrors.points = "Le nombre de points doit être supérieur à 0";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      // Prepare data for submission - ensure correct format
      const submitData: CreateEvaluationQuestion = {
        type: formData.type,
        question_text: formData.question_text.trim(),
        points: typeof formData.points === 'number' && !isNaN(formData.points) && formData.points > 0 ? formData.points : 1,
        order_index: questions.length,
        ai_generated: formData.ai_generated || false,
      };

      // Handle options and correct_answer based on question type
      if (formData.type === 'single_choice' || formData.type === 'multiple_choice') {
        // Filter out empty options and keep only filled ones
        const filledOptions = (formData.options || []).filter(opt => opt.trim());
        submitData.options = filledOptions;
        
        if (formData.type === 'single_choice') {
          const originalIndex = typeof formData.correct_answer === 'number' ? formData.correct_answer : 0;
          // Map the original index to the new index after filtering
          const originalOptions = formData.options || [];
          let newIndex = 0;
          let filledCount = 0;
          for (let i = 0; i < originalOptions.length; i++) {
            if (originalOptions[i].trim()) {
              if (i === originalIndex) {
                newIndex = filledCount;
                break;
              }
              filledCount++;
            }
          }
          submitData.correct_answer = newIndex;
        } else if (formData.type === 'multiple_choice') {
          // For multiple choice, map all selected indices
          const originalOptions = formData.options || [];
          const selectedIndices = Array.isArray(formData.correct_answer) ? formData.correct_answer : [];
          const mappedIndices: number[] = [];
          let filledCount = 0;
          for (let i = 0; i < originalOptions.length; i++) {
            if (originalOptions[i].trim()) {
              if (selectedIndices.includes(i)) {
                mappedIndices.push(filledCount);
              }
              filledCount++;
            }
          }
          submitData.correct_answer = mappedIndices.length > 0 ? mappedIndices : [];
        }
      } else if (formData.type === 'true_false') {
        // For true/false, ensure boolean value
        submitData.correct_answer = typeof formData.correct_answer === 'boolean' 
          ? formData.correct_answer 
          : (formData.correct_answer === true || formData.correct_answer === 1 || formData.correct_answer === 'true');
      } else if (formData.type === 'short_text' || formData.type === 'fill_blank') {
        // For text answers, ensure string value and include empty options array
        submitData.correct_answer = typeof formData.correct_answer === 'string' 
          ? formData.correct_answer.trim() 
          : String(formData.correct_answer || '').trim();
        submitData.options = []; // Explicitly set empty array for text question types
      }

      console.log('Submitting question data:', submitData);

      await createQuestionMutation.mutateAsync({
        assignmentId,
        data: submitData,
      });
      
      router.push(`/academic/evaluations/${assignmentId}?tab=questions`);
    } catch (error: any) {
      console.error('Error creating question:', error);
      const errorMessage = error?.message || error?.error || String(error);
      alert('Erreur lors de la création: ' + errorMessage);
    }
  };

  const renderQuestionTypeFields = () => {
    switch (formData.type) {
      case 'single_choice':
      case 'multiple_choice':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Options de réponse</Label>
              {(formData.options || []).map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  {formData.type === 'single_choice' ? (
                    <RadioGroup
                      value={typeof formData.correct_answer === 'number' && !isNaN(formData.correct_answer) ? String(formData.correct_answer) : "0"}
                      onValueChange={(value) => {
                        const parsed = parseInt(value, 10);
                        handleInputChange("correct_answer", isNaN(parsed) ? 0 : parsed);
                      }}
                    >
                      <RadioGroupItem value={String(index)} id={`option-${index}`} />
                    </RadioGroup>
                  ) : (
                    <Checkbox
                      checked={Array.isArray(formData.correct_answer) && formData.correct_answer.includes(index)}
                      onCheckedChange={(checked) => {
                        const currentAnswers = Array.isArray(formData.correct_answer) ? formData.correct_answer : [];
                        if (checked) {
                          handleInputChange("correct_answer", [...currentAnswers, index]);
                        } else {
                          handleInputChange("correct_answer", currentAnswers.filter(i => i !== index));
                        }
                      }}
                    />
                  )}
                  <Input
                    value={option}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                    placeholder={`Option ${index + 1}`}
                    className="flex-1"
                  />
                  {(formData.options || []).length > 2 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeOption(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {errors.options && <p className="text-sm text-red-600">{errors.options}</p>}
              {errors.correct_answer && <p className="text-sm text-red-600">{errors.correct_answer}</p>}
              
              <Button
                type="button"
                variant="outline"
                onClick={addOption}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Ajouter une option
              </Button>
              
              <p className="text-sm text-muted-foreground">
                {formData.type === 'single_choice' 
                  ? "Sélectionnez la bonne réponse en cochant le bouton radio correspondant."
                  : "Cochez toutes les bonnes réponses."
                }
              </p>
            </div>
          </div>
        );

      case 'true_false':
        const trueFalseValue = typeof formData.correct_answer === 'boolean' 
          ? formData.correct_answer 
          : (typeof formData.correct_answer === 'number' && !isNaN(formData.correct_answer) ? formData.correct_answer !== 0 : false);
        return (
          <div className="space-y-2">
            <Label>Réponse correcte</Label>
            <RadioGroup
              value={String(trueFalseValue)}
              onValueChange={(value) => handleInputChange("correct_answer", value === 'true')}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="true" />
                <Label htmlFor="true">Vrai</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="false" />
                <Label htmlFor="false">Faux</Label>
              </div>
            </RadioGroup>
          </div>
        );

      case 'short_text':
      case 'fill_blank':
        const answerValue = typeof formData.correct_answer === 'string' 
          ? formData.correct_answer 
          : (typeof formData.correct_answer === 'number' && !isNaN(formData.correct_answer) ? String(formData.correct_answer) : "");
        return (
          <div className="space-y-2">
            <Label htmlFor="correct_answer">Réponse attendue</Label>
            <Input
              id="correct_answer"
              value={answerValue}
              onChange={(e) => handleInputChange("correct_answer", e.target.value)}
              placeholder="Saisissez la réponse attendue..."
            />
            {errors.correct_answer && <p className="text-sm text-red-600">{errors.correct_answer}</p>}
            <p className="text-sm text-muted-foreground">
              {formData.type === 'short_text' 
                ? "La réponse sera évaluée par l'IA en tenant compte des variations possibles."
                : "Utilisez des underscores (_) dans la question pour indiquer les espaces à compléter."
              }
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/academic/evaluations/${assignmentId}?tab=questions`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-bold">Créer une question</h2>
          <p className="text-muted-foreground">
            Ajoutez une nouvelle question à votre évaluation
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Question Type */}
        <Card>
          <CardHeader>
            <CardTitle>Type de question</CardTitle>
            <CardDescription>
              Choisissez le type de question que vous souhaitez créer
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={formData.type} onValueChange={(value) => handleInputChange("type", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single_choice">Choix unique (QCM)</SelectItem>
                <SelectItem value="multiple_choice">Choix multiples</SelectItem>
                <SelectItem value="true_false">Vrai/Faux</SelectItem>
                <SelectItem value="short_text">Réponse courte</SelectItem>
                <SelectItem value="fill_blank">Texte à trous</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Question Content */}
        <Card>
          <CardHeader>
            <CardTitle>Contenu de la question</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Question Text */}
            <div className="space-y-2">
              <Label htmlFor="question_text">Texte de la question *</Label>
              <Textarea
                id="question_text"
                value={formData.question_text}
                onChange={(e) => handleInputChange("question_text", e.target.value)}
                placeholder="Saisissez votre question..."
                rows={3}
              />
              {errors.question_text && <p className="text-sm text-red-600">{errors.question_text}</p>}
            </div>

            {/* Type-specific fields */}
            {renderQuestionTypeFields()}

            {/* Points */}
            <div className="space-y-2">
              <Label htmlFor="points">Points attribués</Label>
              <Input
                id="points"
                type="number"
                min="0.5"
                step="0.5"
                value={typeof formData.points === 'number' && !isNaN(formData.points) ? formData.points : ""}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "") {
                    handleInputChange("points", 1);
                  } else {
                    const parsed = parseFloat(value);
                    handleInputChange("points", isNaN(parsed) ? 1 : parsed);
                  }
                }}
                className="w-32"
              />
              {errors.points && <p className="text-sm text-red-600">{errors.points}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Aperçu
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted p-4 rounded-md">
              <p className="font-medium mb-2">{formData.question_text || "Votre question apparaîtra ici..."}</p>
              
              {formData.type === 'single_choice' && formData.options && (
                <div className="space-y-1">
                  {formData.options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input type="radio" disabled />
                      <span className="text-sm">{option || `Option ${index + 1}`}</span>
                    </div>
                  ))}
                </div>
              )}

              {formData.type === 'multiple_choice' && formData.options && (
                <div className="space-y-1">
                  {formData.options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input type="checkbox" disabled />
                      <span className="text-sm">{option || `Option ${index + 1}`}</span>
                    </div>
                  ))}
                </div>
              )}

              {formData.type === 'true_false' && (
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <input type="radio" disabled />
                    <span className="text-sm">Vrai</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="radio" disabled />
                    <span className="text-sm">Faux</span>
                  </div>
                </div>
              )}

              {(formData.type === 'short_text' || formData.type === 'fill_blank') && (
                <input 
                  type="text" 
                  placeholder="Réponse de l'étudiant..." 
                  className="w-full p-2 border rounded" 
                  disabled 
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Link href={`/academic/evaluations/${assignmentId}?tab=questions`}>
            <Button variant="outline">Annuler</Button>
          </Link>
          <Button type="submit" disabled={createQuestionMutation.isPending}>
            {createQuestionMutation.isPending ? (
              <>Création en cours...</>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Créer la question
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
