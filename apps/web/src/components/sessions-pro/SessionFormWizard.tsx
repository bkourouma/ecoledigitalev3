"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Progress,
  Form,
} from "@ecoledigitale/ui";
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle } from "lucide-react";
import { CreateSessionSchema } from "@ecoledigitale/contracts/src/sessions-pro";
import { FormStep1GeneralInfo } from "./FormStep1GeneralInfo";
import { FormStep2Formateurs } from "./FormStep2Formateurs";
import { FormStep3Tarification } from "./FormStep3Tarification";
import { useCreateSession, useUpdateSession, useSessionDetail } from "@/lib/hooks/use-sessions-pro";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import toast from "react-hot-toast";

type FormData = z.infer<typeof CreateSessionSchema>;

type Step = 1 | 2 | 3;

interface SessionFormWizardProps {
  sessionId?: string; // If provided, edit mode with pre-filled data
  onSuccess?: (sessionId: string) => void;
  onCancel?: () => void;
}

const steps = [
  { number: 1, title: "Informations générales" },
  { number: 2, title: "Formateurs & Capacité" },
  { number: 3, title: "Tarification & Publication" },
];

export function SessionFormWizard({ sessionId, onSuccess, onCancel }: SessionFormWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string>("");
  const isEditMode = !!sessionId;
  const createSessionMutation = useCreateSession();
  const updateSessionMutation = useUpdateSession();
  const { data: sessionData, isLoading: isLoadingSession } = useSessionDetail(sessionId || null);

  const form = useForm<FormData>({
    resolver: zodResolver(CreateSessionSchema),
    defaultValues: {
      formation_id: "",
      date_debut: "",
      date_fin: "",
      horaires: "",
      mode_formation: "presentiel",
      lieu: "",
      lien_visio: "",
      places_totales: 20,
      prix_ht: undefined,
      prix_ttc: undefined,
      formateur_ids: [],
      statut: "ouverte",
      notes_internes: "",
    },
    mode: "onChange",
  });

  // Auto-save draft every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const formData = form.getValues();
      if (formData.formation_id || formData.date_debut) {
        // Save to localStorage
        localStorage.setItem("session-draft", JSON.stringify(formData));
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [form]);

  // Load draft on mount
  useEffect(() => {
    const draft = localStorage.getItem("session-draft");
    if (draft) {
      try {
        const draftData = JSON.parse(draft);
        Object.keys(draftData).forEach((key) => {
          if (draftData[key] !== undefined && draftData[key] !== null) {
            form.setValue(key as keyof FormData, draftData[key]);
          }
        });
      } catch (error) {
        console.error("Failed to load draft:", error);
      }
    }
  }, [form]);

  const canProceedToNextStep = (): boolean => {
    switch (currentStep) {
      case 1:
        const mode = form.watch("mode_formation");
        const formationId = form.watch("formation_id");
        const dateDebut = form.watch("date_debut");
        const dateFin = form.watch("date_fin");
        const horaires = form.watch("horaires");
        const lieu = form.watch("lieu");
        const lienVisio = form.watch("lien_visio");
        
        // Check required fields
        if (!formationId || !dateDebut || !dateFin || !horaires || !mode) {
          return false;
        }
        
        // Check horaires is not empty string
        if (horaires.trim() === "") {
          return false;
        }
        
        // Check conditional fields based on mode
        if (mode === "presentiel") {
          if (!lieu || lieu.trim() === "") {
            return false;
          }
        }
        
        if (mode === "distanciel" || mode === "hybride") {
          if (!lienVisio || lienVisio.trim() === "") {
            return false;
          }
        }
        
        return true;
      case 2:
        const placesTotales = form.watch("places_totales");
        const formateurIds = form.watch("formateur_ids");
        return (
          !!placesTotales &&
          placesTotales > 0 &&
          Array.isArray(formateurIds) &&
          formateurIds.length > 0
        );
      case 3:
        return true;
      default:
        return false;
    }
  };

  const handleNext = async (data?: FormData) => {
    if (currentStep === 3) {
      // Submit form - validate all fields
      const isValid = await form.trigger();
      if (!isValid) {
        const errors = form.formState.errors;
        const firstErrorField = Object.keys(errors)[0];
        const firstError = errors[firstErrorField as keyof typeof errors];
        toast.error(
          firstError?.message as string || 
          "Veuillez corriger les erreurs avant de soumettre"
        );
        return;
      }

      const formData = form.getValues();
      try {
        if (isEditMode && sessionId) {
          const result = await updateSessionMutation.mutateAsync({
            sessionId,
            data: formData,
          });
          toast.success("Session mise à jour avec succès !");
          onSuccess?.(result.data.id);
        } else {
          const result = await createSessionMutation.mutateAsync(formData);
          // Clear draft
          localStorage.removeItem("session-draft");
          // Reset form to default values
          form.reset({
            formation_id: "",
            date_debut: "",
            date_fin: "",
            horaires: "",
            mode_formation: "presentiel",
            lieu: "",
            lien_visio: "",
            places_totales: 20,
            prix_ht: undefined,
            prix_ttc: undefined,
            formateur_ids: [],
            statut: "ouverte",
            notes_internes: "",
          });
          // Reset to first step
          setCurrentStep(1);
          toast.success("Session créée avec succès !");
          onSuccess?.(result.data.id);
        }
      } catch (error: any) {
        let errorMessage = error.message || (isEditMode ? "Erreur lors de la mise à jour de la session" : "Erreur lors de la création de la session");
        
        // Format TRAINER_CONFLICT errors to be more user-friendly
        if (errorMessage.includes("TRAINER_CONFLICT:") || errorMessage.includes("TRAINER_CONFLICT")) {
          // Extract the actual conflict message after "TRAINER_CONFLICT:" or "TRAINER_CONFLICT"
          const conflictMsg = errorMessage.replace(/TRAINER_CONFLICT:?/i, "").trim();
          setConflictMessage(conflictMsg);
          setShowConflictDialog(true);
          // Also show a toast for visibility
          toast.error("Conflit de disponibilité détecté", {
            duration: 4000,
          });
        } else if (errorMessage.includes("INVALID_DATES:")) {
          // Format date validation errors
          const dateMessage = errorMessage.replace("INVALID_DATES:", "").trim();
          toast.error(`Erreur de dates: ${dateMessage}`, {
            duration: 5000,
          });
        } else if (errorMessage.includes("VALIDATION_ERROR:")) {
          // Format validation errors
          const validationMessage = errorMessage.replace("VALIDATION_ERROR:", "").trim();
          // Special handling for price validation errors
          if (validationMessage.includes("prix_ttc must be >= prix_ht") || validationMessage.includes("prix_ttc")) {
            toast.error("Le prix TTC doit être supérieur ou égal au prix HT", {
              duration: 6000,
            });
            // Focus on prix_ttc field
            form.setFocus("prix_ttc");
          } else {
            toast.error(`Erreur de validation: ${validationMessage}`, {
              duration: 5000,
            });
          }
        } else if (errorMessage.includes("prix_ttc must be >= prix_ht")) {
          // Direct price validation error (from Zod)
          toast.error("Le prix TTC doit être supérieur ou égal au prix HT", {
            duration: 6000,
          });
          form.setFocus("prix_ttc");
        } else {
          toast.error(errorMessage, {
            duration: 5000,
          });
        }
      }
    } else {
      // Validate current step - validate all fields for the current step including conditional ones
      const fieldsToValidate: (keyof FormData)[] =
        currentStep === 1
          ? ["formation_id", "date_debut", "date_fin", "horaires", "mode_formation", "lieu", "lien_visio"]
          : ["places_totales", "formateur_ids"];

      // Trigger validation for all fields in current step
      const isValid = await form.trigger(fieldsToValidate);
      
      // Also validate the entire form to catch conditional validations (refine) for current step only
      if (isValid && currentStep === 1) {
        // For step 1, validate all fields but filter errors to only show step 1 errors
        const fullValidation = await form.trigger();
        if (!fullValidation) {
          const errors = form.formState.errors;
          // Only check errors for fields in the current step
          const step1Fields = ["formation_id", "date_debut", "date_fin", "horaires", "mode_formation", "lieu", "lien_visio"];
          const step1Errors = Object.keys(errors).filter(field => step1Fields.includes(field));
          
          if (step1Errors.length > 0) {
            const firstErrorField = step1Errors[0];
            const firstError = errors[firstErrorField as keyof typeof errors];
            
            // Get the error message
            let errorMessage = "Veuillez remplir tous les champs requis";
            if (firstError) {
              if (typeof firstError === 'object' && 'message' in firstError) {
                errorMessage = firstError.message as string;
              } else if (Array.isArray(firstError)) {
                errorMessage = firstError[0]?.message || errorMessage;
              }
            }
            
            toast.error(errorMessage);
            return;
          }
          // If there are errors but not in step 1 fields, ignore them (they're for future steps)
        }
      } else if (isValid && currentStep === 2) {
        // For step 2, validate all fields but filter errors to only show step 2 errors
        const fullValidation = await form.trigger();
        if (!fullValidation) {
          const errors = form.formState.errors;
          // Only check errors for fields in the current step
          const step2Fields = ["places_totales", "formateur_ids"];
          const step2Errors = Object.keys(errors).filter(field => step2Fields.includes(field));
          
          if (step2Errors.length > 0) {
            const firstErrorField = step2Errors[0];
            const firstError = errors[firstErrorField as keyof typeof errors];
            
            // Get the error message
            let errorMessage = "Veuillez remplir tous les champs requis";
            if (firstError) {
              if (typeof firstError === 'object' && 'message' in firstError) {
                errorMessage = firstError.message as string;
              } else if (Array.isArray(firstError)) {
                errorMessage = firstError[0]?.message || errorMessage;
              }
            }
            
            // Provide specific messages for common errors
            if (firstErrorField === 'formateur_ids') {
              errorMessage = "Veuillez sélectionner au moins un formateur";
            } else if (firstErrorField === 'places_totales') {
              errorMessage = "Le nombre de places doit être au moins 1";
            }
            
            toast.error(errorMessage);
            return;
          }
          // If there are errors but not in step 2 fields, ignore them (they're for future steps)
        }
      }
      
      // Check if we can proceed based on business logic
      if (isValid && canProceedToNextStep()) {
        setCurrentStep((prev) => (prev + 1) as Step);
      } else {
        // Show more specific error messages
        const errors = form.formState.errors;
        const errorFields = Object.keys(errors);
        if (errorFields.length > 0) {
          const firstErrorField = errorFields[0];
          const firstError = errors[firstErrorField as keyof typeof errors];
          
          // Get the error message
          let errorMessage = "Veuillez remplir tous les champs requis";
          if (firstError) {
            if (typeof firstError === 'object' && 'message' in firstError) {
              errorMessage = firstError.message as string;
            } else if (Array.isArray(firstError)) {
              errorMessage = firstError[0]?.message || errorMessage;
            }
          }
          
          // Provide specific messages for common errors
          if (firstErrorField === 'formateur_ids') {
            errorMessage = "Veuillez sélectionner au moins un formateur";
          } else if (firstErrorField === 'places_totales') {
            errorMessage = "Le nombre de places doit être au moins 1";
          }
          
          toast.error(errorMessage);
        } else {
          // If no validation errors but can't proceed, check what's missing
          if (currentStep === 1) {
            const mode = form.watch("mode_formation");
            if (mode === "presentiel" && !form.watch("lieu")) {
              toast.error("Le lieu est requis pour le mode présentiel");
            } else if ((mode === "distanciel" || mode === "hybride") && !form.watch("lien_visio")) {
              toast.error("Le lien de visioconférence est requis pour ce mode");
            } else {
              toast.error("Veuillez remplir tous les champs requis");
            }
          } else if (currentStep === 2) {
            const formateurIds = form.watch("formateur_ids");
            if (!formateurIds || !Array.isArray(formateurIds) || formateurIds.length === 0) {
              toast.error("Veuillez sélectionner au moins un formateur");
            } else if (!form.watch("places_totales") || form.watch("places_totales") <= 0) {
              toast.error("Le nombre de places doit être au moins 1");
            } else {
              toast.error("Veuillez remplir tous les champs requis");
            }
          } else {
            toast.error("Veuillez remplir tous les champs requis");
          }
        }
      }
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as Step);
    }
  };

  const progress = ((currentStep / steps.length) * 100).toFixed(0);

  if (isEditMode && isLoadingSession) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement de la session...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>{isEditMode ? "Modifier la session" : "Créer une nouvelle session"}</CardTitle>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            {steps.map((step) => (
              <div
                key={step.number}
                className={`flex items-center ${
                  step.number < steps.length ? "flex-1" : ""
                }`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full ${
                    currentStep >= step.number
                      ? "bg-primary text-white"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {step.number}
                </div>
                {step.number < steps.length && (
                  <div
                    className={`flex-1 h-1 mx-2 ${
                      currentStep > step.number ? "bg-primary" : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="text-sm text-gray-600 mt-2">
            Étape {currentStep} sur {steps.length}: {steps[currentStep - 1].title}
          </div>
          <Progress value={parseInt(progress)} className="mt-2" />
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form 
            onSubmit={async (e) => {
              e.preventDefault();
              await handleNext();
            }} 
            className="space-y-6"
          >
            {/* Step content */}
            {currentStep === 1 && (
              <FormStep1GeneralInfo 
                form={form} 
                disabled={isEditMode && (sessionData?.data?.statut === "en_cours" || sessionData?.data?.statut === "terminee")}
              />
            )}
            {currentStep === 2 && (
              <FormStep2Formateurs 
                form={form} 
                disabled={isEditMode && (sessionData?.data?.statut === "en_cours" || sessionData?.data?.statut === "terminee")}
              />
            )}
            {currentStep === 3 && (
              <FormStep3Tarification 
                form={form} 
                disabled={isEditMode && (sessionData?.data?.statut === "en_cours" || sessionData?.data?.statut === "terminee")}
              />
            )}

            {/* Navigation buttons */}
            <div className="flex justify-between pt-6 border-t">
              <div>
                {onCancel && (
                  <Button type="button" variant="outline" onClick={onCancel}>
                    Annuler
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {currentStep > 1 && (
                  <Button type="button" variant="outline" onClick={handlePrevious}>
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Précédent
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={(createSessionMutation.isPending || updateSessionMutation.isPending) || !canProceedToNextStep()}
                >
                  {(createSessionMutation.isPending || updateSessionMutation.isPending) ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {isEditMode ? "Mise à jour..." : "Création..."}
                    </>
                  ) : currentStep === 3 ? (
                    isEditMode ? "Enregistrer les modifications" : "Créer la session"
                  ) : (
                    <>
                      Suivant
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>

    {/* Conflict Error Dialog */}
    <AlertDialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-destructive/10 p-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <AlertDialogTitle>Conflit de disponibilité</AlertDialogTitle>
          </div>
        </AlertDialogHeader>
        <div className="pt-4 space-y-3">
          <p className="font-medium text-foreground">{conflictMessage}</p>
          <p className="text-sm text-muted-foreground">
            Veuillez modifier les dates de la session ou choisir un autre formateur pour résoudre ce conflit.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setShowConflictDialog(false)}>
            Compris
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}


