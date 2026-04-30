"use client";

import { useState } from "react";
import { Step1InfosForm } from "./Step1InfosForm";
import { Step2RecapitulatifForm } from "./Step2RecapitulatifForm";
import { IndividualEnrollmentRequest } from "@ecoledigitale/contracts/src/inscriptions-pro";

interface InscriptionWizardProps {
  mode?: "session" | "catalogue";
  sessionId?: string;
  formationProId?: string;
  formationSlug?: string;
  onComplete: (enrollment: any) => void;
  onCancel?: () => void;
}

export function InscriptionWizard({
  mode = "session",
  sessionId,
  formationProId,
  formationSlug,
  onComplete,
  onCancel,
}: InscriptionWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<IndividualEnrollmentRequest>>(() =>
    mode === "catalogue" && formationProId
      ? {
          formation_pro_id: formationProId,
          type_inscription: "individuelle",
          cgv_accepte: false,
        }
      : {
          session_id: sessionId,
          type_inscription: "individuelle",
          cgv_accepte: false,
        }
  );

  const handleStep1Complete = (data: Partial<IndividualEnrollmentRequest>) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setCurrentStep(2);
  };

  const handleStep2Complete = (data: Partial<IndividualEnrollmentRequest>) => {
    const completeData = { ...formData, ...data } as IndividualEnrollmentRequest;
    onComplete(completeData);
  };

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-center space-x-4 mb-8">
        <div className={`flex items-center ${currentStep >= 1 ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 1 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
            {currentStep > 1 ? "✓" : "1"}
          </div>
          <span className="ml-2 font-medium">Informations</span>
        </div>
        <div className="w-16 h-0.5 bg-border" />
        <div className={`flex items-center ${currentStep >= 2 ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 2 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
            2
          </div>
          <span className="ml-2 font-medium">Récapitulatif</span>
        </div>
      </div>

      {/* Step content */}
      {currentStep === 1 && (
        <Step1InfosForm
          initialData={formData}
          onComplete={handleStep1Complete}
          onCancel={onCancel}
        />
      )}

      {currentStep === 2 && (
        <Step2RecapitulatifForm
          formData={formData as IndividualEnrollmentRequest}
          mode={mode}
          sessionId={sessionId}
          formationSlug={formationSlug}
          formationProId={formationProId}
          onComplete={handleStep2Complete}
          onBack={() => setCurrentStep(1)}
        />
      )}
    </div>
  );
}

