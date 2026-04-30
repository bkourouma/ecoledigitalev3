"use client";

import { useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
} from "@ecoledigitale/ui";
import { Label } from "@ecoledigitale/ui";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import DatePickerFr from "@/components/DatePickerFr";
import { useFormations } from "@/lib/hooks/use-formations-pro";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { CreateSessionSchema } from "@ecoledigitale/contracts/src/sessions-pro";

type FormData = z.infer<typeof CreateSessionSchema>;

interface FormStep1GeneralInfoProps {
  form: UseFormReturn<FormData>;
  disabled?: boolean;
}

export function FormStep1GeneralInfo({ form, disabled = false }: FormStep1GeneralInfoProps) {
  const { data: formationsData, isLoading: isLoadingFormations } = useFormations({ limit: 100 });
  const formations = formationsData?.data?.formations || [];
  const modeFormation = form.watch("mode_formation");

  // Reset conditional fields when mode changes
  useEffect(() => {
    if (modeFormation === "presentiel") {
      // Clear lien_visio when switching to presentiel
      form.setValue("lien_visio", undefined, { shouldValidate: false });
    } else if (modeFormation === "distanciel" || modeFormation === "hybride") {
      // Clear lieu when switching to distanciel or hybride
      form.setValue("lieu", undefined, { shouldValidate: false });
    }
  }, [modeFormation, form]);

  return (
    <div className="space-y-6">
      {/* Formation selection */}
      <FormField
        control={form.control}
        name="formation_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Formation *</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value}
              disabled={disabled || isLoadingFormations}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une formation" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {isLoadingFormations ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                ) : (
                  formations.map((formation) => (
                    <SelectItem key={formation.id} value={formation.id}>
                      {formation.titre}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Mode de formation */}
      <FormField
        control={form.control}
        name="mode_formation"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Mode de formation *</FormLabel>
            <FormControl>
              <RadioGroup
                onValueChange={field.onChange}
                value={field.value}
                className="flex flex-row gap-6"
                disabled={disabled}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="presentiel" id="presentiel" />
                  <Label htmlFor="presentiel">Présentiel</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="distanciel" id="distanciel" />
                  <Label htmlFor="distanciel">Distanciel</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="hybride" id="hybride" />
                  <Label htmlFor="hybride">Hybride</Label>
                </div>
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Dates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="date_debut"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Date de début *</FormLabel>
              <FormControl>
                <DatePickerFr
                  value={field.value}
                  onChange={(iso) => field.onChange(iso)}
                  min={new Date().toISOString().split("T")[0]}
                  disabled={disabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="date_fin"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Date de fin *</FormLabel>
              <FormControl>
                <DatePickerFr
                  value={field.value}
                  onChange={(iso) => field.onChange(iso)}
                  min={form.watch("date_debut") || new Date().toISOString().split("T")[0]}
                  disabled={disabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Horaires */}
      <FormField
        control={form.control}
        name="horaires"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Horaires *</FormLabel>
            <FormControl>
              <Input
                placeholder="ex: 9h-17h"
                {...field}
                disabled={disabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Lieu (si présentiel) */}
      {modeFormation === "presentiel" && (
        <FormField
          control={form.control}
          name="lieu"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Lieu *</FormLabel>
              <FormControl>
                <Input
                  placeholder="Adresse complète du lieu de formation"
                  {...field}
                  disabled={disabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {/* Lien visio (si distanciel ou hybride) */}
      {(modeFormation === "distanciel" || modeFormation === "hybride") && (
        <FormField
          control={form.control}
          name="lien_visio"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Lien de visioconférence *</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  placeholder="https://..."
                  {...field}
                  disabled={disabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}

