"use client";

import { useState, useEffect } from "react";
import { IndividualEnrollmentRequest, CompanyEnrollmentRequest } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { Button, Card, CardContent } from "@ecoledigitale/ui";
import { ArrowLeft, Check, Building2 } from "lucide-react";
import { CodePromoInput } from "./CodePromoInput";
import { useSessionDetail } from "@/lib/hooks/use-sessions-pro";
import { useFormationDetail } from "@/lib/hooks/use-formations-pro";

interface Step2RecapitulatifFormProps {
  formData: IndividualEnrollmentRequest | CompanyEnrollmentRequest;
  mode?: "session" | "catalogue";
  sessionId?: string;
  formationSlug?: string;
  formationProId?: string;
  onComplete: (data: Partial<IndividualEnrollmentRequest | CompanyEnrollmentRequest>) => void;
  onBack: () => void;
}

export function Step2RecapitulatifForm({
  formData,
  mode = "session",
  sessionId,
  formationSlug,
  formationProId,
  onComplete,
  onBack,
}: Step2RecapitulatifFormProps) {
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [finalAmount, setFinalAmount] = useState(0);

  const { data: sessionData, isLoading: isLoadingSession } = useSessionDetail(
    mode === "session" ? sessionId ?? null : null
  );
  const { data: formationResponse, isLoading: isLoadingFormation } = useFormationDetail(
    mode === "catalogue" ? formationSlug ?? null : null
  );

  const session = sessionData?.data;
  const formation = formationResponse?.data as { prix_ttc?: number; titre?: string } | undefined;
  const baseAmount =
    mode === "catalogue" ? formation?.prix_ttc || 0 : session?.prix_ttc || 0;
  const isLoadingDetails =
    mode === "catalogue" ? isLoadingFormation : isLoadingSession;

  // Update final amount when base amount or discount changes
  useEffect(() => {
    setFinalAmount(Math.max(0, baseAmount - discountAmount));
  }, [baseAmount, discountAmount]);

  const handlePromoCodeValidated = (validation: {
    valide: boolean;
    reduction_montant: number;
    nouveau_montant: number;
    code_promo: string | null;
  }) => {
    if (validation.valide) {
      setPromoCode(validation.code_promo);
      setDiscountAmount(validation.reduction_montant);
      setFinalAmount(validation.nouveau_montant);
    } else {
      setPromoCode(null);
      setDiscountAmount(0);
      setFinalAmount(baseAmount);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onComplete({
      ...formData,
      cgv_accepte: true,
      code_promo: promoCode || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Récapitulatif</h2>
        <p className="text-muted-foreground">Vérifiez vos informations avant de continuer</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          {formData.type_inscription === "entreprise" && "entreprise" in formData && formData.entreprise && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Informations de l'entreprise</h3>
              </div>
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Raison sociale:</span> {formData.entreprise.raison_sociale}
                </p>
                {formData.entreprise.siret && (
                  <p>
                    <span className="text-muted-foreground">SIRET:</span> {formData.entreprise.siret}
                  </p>
                )}
                {formData.entreprise.adresse && (
                  <p>
                    <span className="text-muted-foreground">Adresse:</span> {formData.entreprise.adresse}
                  </p>
                )}
                {(formData.entreprise.code_postal || formData.entreprise.ville) && (
                  <p>
                    <span className="text-muted-foreground">Ville:</span>{" "}
                    {[formData.entreprise.code_postal, formData.entreprise.ville].filter(Boolean).join(" ")}
                  </p>
                )}
                {formData.entreprise.telephone && (
                  <p>
                    <span className="text-muted-foreground">Téléphone:</span> {formData.entreprise.telephone}
                  </p>
                )}
                {formData.entreprise.email && (
                  <p>
                    <span className="text-muted-foreground">Email:</span> {formData.entreprise.email}
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <h3 className="font-semibold mb-2">Informations de l'employé</h3>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Nom:</span> {formData.apprenant?.nom}
              </p>
              <p>
                <span className="text-muted-foreground">Prénom:</span> {formData.apprenant?.prenom}
              </p>
              <p>
                <span className="text-muted-foreground">Email:</span> {formData.apprenant?.email}
              </p>
              <p>
                <span className="text-muted-foreground">Téléphone:</span> {formData.apprenant?.telephone}
              </p>
              {formData.apprenant?.poste && (
                <p>
                  <span className="text-muted-foreground">Poste:</span> {formData.apprenant.poste}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session ou formation (catalogue) */}
      {isLoadingDetails ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Chargement des détails...</p>
          </CardContent>
        </Card>
      ) : mode === "catalogue" && formation ? (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Formation</h3>
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Titre:</span> {formation.titre}
                </p>
                <p>
                  <span className="text-muted-foreground">Accès:</span> contenu en ligne après paiement
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : session ? (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Détails de la session</h3>
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Formation:</span> {session.formation?.titre}
                </p>
                <p>
                  <span className="text-muted-foreground">Code session:</span> {session.code_session}
                </p>
                <p>
                  <span className="text-muted-foreground">Dates:</span>{" "}
                  {new Date(session.date_debut).toLocaleDateString("fr-FR")} -{" "}
                  {new Date(session.date_fin).toLocaleDateString("fr-FR")}
                </p>
                <p>
                  <span className="text-muted-foreground">Mode:</span> {session.mode_formation}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Pricing and Promo Code */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h3 className="font-semibold mb-2">Tarification</h3>

          {/* Promo Code Input */}
          <CodePromoInput
            sessionId={mode === "session" ? sessionId : undefined}
            formationId={
              mode === "catalogue" ? formationProId : session?.formation?.id
            }
            montant={baseAmount}
            onCodeValidated={handlePromoCodeValidated}
          />

          {/* Price Breakdown */}
          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Prix de base:</span>
              <span>{baseAmount.toFixed(2)} FCFA</span>
            </div>
            {discountAmount > 0 && (
              <>
                <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                  <span>Réduction ({promoCode}):</span>
                  <span>-{discountAmount.toFixed(2)} FCFA</span>
                </div>
              </>
            )}
            <div className="flex justify-between font-semibold text-lg pt-2 border-t">
              <span>Total à payer:</span>
              <span>{finalAmount.toFixed(2)} FCFA</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between pt-6">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour
        </Button>
        <Button type="submit">
          Confirmer l'inscription
          <Check className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}

