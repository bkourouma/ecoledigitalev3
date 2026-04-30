"use client";

import { useState } from "react";
import { Input } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { CheckCircle2, XCircle, Loader2, Tag } from "lucide-react";
import { useValidatePromoCode } from "@/lib/hooks/use-inscriptions-pro";
import { PromoCodeValidationRequest } from "@ecoledigitale/contracts/src/codes-promo";

interface CodePromoInputProps {
  sessionId?: string;
  formationId?: string;
  montant: number;
  onCodeValidated?: (validation: {
    valide: boolean;
    reduction_montant: number;
    nouveau_montant: number;
    code_promo: string | null;
  }) => void;
}

export function CodePromoInput({
  sessionId,
  formationId,
  montant,
  onCodeValidated,
}: CodePromoInputProps) {
  const [code, setCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const validatePromoCode = useValidatePromoCode();

  const handleValidate = async () => {
    if (!code.trim()) {
      return;
    }

    setIsValidating(true);
    try {
      const request: PromoCodeValidationRequest = {
        code: code.trim(),
        montant,
        ...(formationId && { formation_id: formationId }),
        ...(sessionId ? { session_id: sessionId } : {}),
      };

      const result = await validatePromoCode.mutateAsync(request);

      if (result.valide && onCodeValidated) {
        onCodeValidated({
          valide: true,
          reduction_montant: result.reduction_montant,
          nouveau_montant: result.nouveau_montant,
          code_promo: result.code_promo?.code || null,
        });
      } else if (!result.valide && onCodeValidated) {
        onCodeValidated({
          valide: false,
          reduction_montant: 0,
          nouveau_montant: montant,
          code_promo: null,
        });
      }
    } catch (error) {
      if (onCodeValidated) {
        onCodeValidated({
          valide: false,
          reduction_montant: 0,
          nouveau_montant: montant,
          code_promo: null,
        });
      }
    } finally {
      setIsValidating(false);
    }
  };

  const validationResult = validatePromoCode.data;
  const hasError = validatePromoCode.isError || (validationResult && !validationResult.valide);
  const hasSuccess = validationResult && validationResult.valide;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium flex items-center space-x-2">
        <Tag className="w-4 h-4" />
        <span>Code promotionnel (optionnel)</span>
      </label>
      <div className="flex space-x-2">
        <div className="flex-1">
          <Input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              // Reset validation when code changes
              if (validatePromoCode.data) {
                validatePromoCode.reset();
              }
            }}
            placeholder="Entrez votre code promo"
            className={hasError ? "border-destructive" : hasSuccess ? "border-green-500" : ""}
            disabled={isValidating}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleValidate();
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleValidate}
          disabled={!code.trim() || isValidating}
        >
          {isValidating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Validation...
            </>
          ) : (
            "Valider"
          )}
        </Button>
      </div>

      {/* Success message */}
      {hasSuccess && validationResult && (
        <div className="flex items-center space-x-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4" />
          <span>{validationResult.message}</span>
        </div>
      )}

      {/* Error message */}
      {hasError && (
        <div className="flex items-center space-x-2 text-sm text-destructive">
          <XCircle className="w-4 h-4" />
          <span>
            {validatePromoCode.error?.message ||
              (validationResult && !validationResult.valide
                ? validationResult.message
                : "Erreur lors de la validation du code")}
          </span>
        </div>
      )}
    </div>
  );
}

