"use client";

import { useEffect, useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Input,
} from "@ecoledigitale/ui";
import { FormateursMultiSelect } from "./FormateursMultiSelect";
import { SelectedFormateursList } from "./SelectedFormateursList";
import { useFormateursDisponibilite } from "@/lib/hooks/use-sessions-pro";
import { Alert, AlertDescription } from "@ecoledigitale/ui";
import { AlertCircle } from "lucide-react";
import { z } from "zod";
import { CreateSessionSchema } from "@ecoledigitale/contracts/src/sessions-pro";

type FormData = z.infer<typeof CreateSessionSchema>;

interface FormStep2FormateursProps {
  form: UseFormReturn<FormData>;
  disabled?: boolean;
}

export function FormStep2Formateurs({ form, disabled = false }: FormStep2FormateursProps) {
  const formateurIds = form.watch("formateur_ids") || [];
  const dateDebut = form.watch("date_debut");
  const dateFin = form.watch("date_fin");

  // Check availability when dates or trainers change
  const { data: availabilityData, isLoading: isLoadingAvailability, error: availabilityError } =
    useFormateursDisponibilite(
      dateDebut || null,
      dateFin || null,
      formateurIds,
      {
        enabled: !!dateDebut && !!dateFin && formateurIds.length > 0,
        retry: false, // Don't retry on error to avoid multiple redirects
      }
    );

  // Map availability data to formateurs
  const formateursWithAvailability = useMemo(() => {
    if (!availabilityData?.data?.formateurs) {
      return formateurIds.map((id) => ({
        id,
        nom: "",
        prenom: "",
        disponible: true,
      }));
    }

    return formateurIds.map((id) => {
      const availability = availabilityData.data.formateurs.find((f) => f.id === id);
      return {
        id,
        nom: availability?.nom || "",
        prenom: availability?.prenom || "",
        disponible: availability?.disponible ?? true,
        conflits: availability?.conflits,
      };
    });
  }, [formateurIds, availabilityData]);

  // Check for conflicts
  const hasConflicts = formateursWithAvailability.some(
    (f) => !f.disponible && f.conflits && f.conflits.length > 0
  );

  const handleSelectFormateur = (formateurId: string) => {
    const current = form.getValues("formateur_ids") || [];
    if (!current.includes(formateurId)) {
      form.setValue("formateur_ids", [...current, formateurId], {
        shouldValidate: true,
      });
    }
  };

  const handleRemoveFormateur = (formateurId: string) => {
    const current = form.getValues("formateur_ids") || [];
    form.setValue(
      "formateur_ids",
      current.filter((id) => id !== formateurId),
      { shouldValidate: true }
    );
  };

  return (
    <div className="space-y-6">
      {/* Capacity */}
      <FormField
        control={form.control}
        name="places_totales"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Nombre de places *</FormLabel>
            <FormControl>
              <Input
                type="number"
                min="1"
                placeholder="20"
                {...field}
                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                disabled={disabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Availability warning */}
      {hasConflicts && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Certains formateurs ont des conflits de disponibilité pour les dates sélectionnées.
            Veuillez vérifier les détails ci-dessous.
          </AlertDescription>
        </Alert>
      )}

      {/* Selected formateurs */}
      {formateurIds.length > 0 && (
        <div>
          <FormLabel className="mb-3 block">Formateurs sélectionnés *</FormLabel>
          <SelectedFormateursList
            formateurs={formateursWithAvailability}
            onRemove={handleRemoveFormateur}
          />
        </div>
      )}

      {/* Formateurs selection */}
      <FormField
        control={form.control}
        name="formateur_ids"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="mb-3 block">
              {formateurIds.length > 0
                ? "Ajouter d'autres formateurs"
                : "Sélectionner des formateurs *"}
            </FormLabel>
            <FormControl>
              <FormateursMultiSelect
                selectedIds={formateurIds}
                onSelect={handleSelectFormateur}
                onDeselect={handleRemoveFormateur}
                disabled={disabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

