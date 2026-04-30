"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "@ecoledigitale/ui";
import { Loader2, AlertCircle } from "lucide-react";
import DatePickerFr from "@/components/DatePickerFr";
import { PaymentPeriod } from "@/lib/hooks/use-payment-periods";

const paymentPeriodFormSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(100, "Le nom est trop long"),
  description: z.string().optional(),
  periodStart: z.string().min(1, "La date de début est requise"),
  periodEnd: z.string().min(1, "La date de fin est requise"),
}).refine((data) => {
  if (data.periodStart && data.periodEnd) {
    return new Date(data.periodStart) <= new Date(data.periodEnd);
  }
  return true;
}, {
  message: "La date de fin doit être postérieure à la date de début",
  path: ["periodEnd"],
});

type PaymentPeriodFormData = z.infer<typeof paymentPeriodFormSchema>;

interface PaymentPeriodFormProps {
  period?: PaymentPeriod;
  onSubmit: (data: PaymentPeriodFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

// Helper: previous month first and last day as yyyy-MM-dd
function getPrevMonthRange() {
  const now = new Date();
  const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0);
  const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
  return {
    start: firstPrev.toISOString().split('T')[0],
    end: lastPrev.toISOString().split('T')[0],
  };
}

export function PaymentPeriodForm({ period, onSubmit, onCancel, isLoading = false }: PaymentPeriodFormProps) {
  const defaultDates = getPrevMonthRange();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<PaymentPeriodFormData>({
    resolver: zodResolver(paymentPeriodFormSchema),
    defaultValues: {
      name: period?.name || "",
      description: period?.description || "",
      periodStart: period?.periodStart || defaultDates.start,
      periodEnd: period?.periodEnd || defaultDates.end,
    },
  });

  const handleSubmit = async (data: PaymentPeriodFormData) => {
    setErrorMessage(null);
    try {
      await onSubmit(data);
    } catch (error) {
      console.error("Error submitting form:", error);
      const errorMsg = error instanceof Error ? error.message : "Erreur lors de l'enregistrement";
      
      // Traduire les messages d'erreur en français
      let displayMessage = errorMsg;
      if (errorMsg.includes("overlaps") || errorMsg.includes("chevauche") || errorMsg.includes("Overlapping Period")) {
        displayMessage = "Cette période chevauche avec une période existante. Veuillez choisir des dates différentes.";
      } else if (errorMsg.includes("must match format") || (errorMsg.includes("format") && errorMsg.includes("date"))) {
        displayMessage = "Le format de date est invalide. Veuillez sélectionner une date valide.";
      } else if (errorMsg.includes("Period start date must be before end date")) {
        displayMessage = "La date de début doit être antérieure à la date de fin.";
      } else if (errorMsg.includes("Failed to create") || errorMsg.includes("Failed to update")) {
        displayMessage = "Erreur lors de l'enregistrement. Vérifiez que tous les champs sont correctement remplis.";
      }
      
      setErrorMessage(displayMessage);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Error Message - Placed at the top for visibility */}
        {errorMessage && (
          <div 
            className="flex items-start gap-2 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-800 rounded-lg shadow-sm"
            role="alert"
            aria-live="polite"
            style={{ display: 'block' }}
          >
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">Erreur</p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nom de la période</FormLabel>
              <FormControl>
                <Input 
                  placeholder="ex: Janvier 2024" 
                  className="bg-background border-border text-foreground"
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description (optionnel)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Description de la période..."
                  className="min-h-[100px] resize-none bg-background border-border text-foreground"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Dates */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="periodStart"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date de début</FormLabel>
                <FormControl>
                  <DatePickerFr
                    value={field.value}
                    onChange={(iso) => {
                      field.onChange(iso);
                      setErrorMessage(null); // Clear error when user changes date
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="periodEnd"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date de fin</FormLabel>
                <FormControl>
                  <DatePickerFr
                    value={field.value}
                    onChange={(iso) => {
                      field.onChange(iso);
                      setErrorMessage(null); // Clear error when user changes date
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Form Actions */}
        <div className="flex gap-4 pt-6 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-6 py-3 border border-border rounded-lg text-foreground hover:bg-accent transition-all duration-200 font-medium bg-background"
            disabled={isLoading}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-lg hover:from-orange-600 hover:to-amber-700 transition-all duration-200 disabled:opacity-50 font-medium shadow-lg hover:shadow-xl"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enregistrement...
              </span>
            ) : (
              "Enregistrer"
            )}
          </button>
        </div>
      </form>
    </Form>
  );
}

