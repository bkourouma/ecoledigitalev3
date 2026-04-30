"use client";

import { useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Input,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ecoledigitale/ui";
import { z } from "zod";
import { CreateSessionSchema } from "@ecoledigitale/contracts/src/sessions-pro";
import { useFormations } from "@/lib/hooks/use-formations-pro";

type FormData = z.infer<typeof CreateSessionSchema>;

interface FormStep3TarificationProps {
  form: UseFormReturn<FormData>;
  disabled?: boolean;
}

export function FormStep3Tarification({ form, disabled = false }: FormStep3TarificationProps) {
  const formationId = form.watch("formation_id");
  const prixHt = form.watch("prix_ht");
  const { data: formationsData } = useFormations({ limit: 100 });
  const formation = formationsData?.data?.formations?.find((f) => f.id === formationId);

  // Auto-calculate TTC from HT (18% VAT)
  useEffect(() => {
    if (prixHt && prixHt > 0) {
      const prixTtc = parseFloat((prixHt * 1.18).toFixed(2));
      const currentTtc = form.getValues("prix_ttc");
      const previousCalculatedTtc = parseFloat(((form.getValues("prix_ht") || 0) * 1.18).toFixed(2));
      
      // Only update if TTC is not manually set or is equal to previous calculated value
      // Also ensure TTC is always >= HT
      if (!currentTtc || Math.abs(currentTtc - previousCalculatedTtc) < 0.01) {
        form.setValue("prix_ttc", prixTtc, { shouldValidate: true });
      } else if (currentTtc < prixHt) {
        // If TTC is manually set but less than HT, auto-correct it
        form.setValue("prix_ttc", prixTtc, { shouldValidate: true });
      }
    } else if (prixHt === 0 || prixHt === null || prixHt === undefined) {
      // Clear TTC if HT is cleared
      const currentTtc = form.getValues("prix_ttc");
      if (currentTtc && currentTtc > 0) {
        form.setValue("prix_ttc", undefined, { shouldValidate: false });
      }
    }
  }, [prixHt, form]);

  // Pre-fill prices from formation if available
  useEffect(() => {
    if (formation && !prixHt) {
      if (formation.prix_ht) {
        form.setValue("prix_ht", formation.prix_ht);
      }
      if (formation.prix_ttc) {
        form.setValue("prix_ttc", formation.prix_ttc);
      }
    }
  }, [formation, form, prixHt]);

  // Recap data
  const recapData = {
    formation: formation?.titre || "Non sélectionnée",
    dateDebut: form.watch("date_debut"),
    dateFin: form.watch("date_fin"),
    horaires: form.watch("horaires"),
    mode: form.watch("mode_formation"),
    lieu: form.watch("lieu"),
    lienVisio: form.watch("lien_visio"),
    places: form.watch("places_totales"),
    formateursCount: form.watch("formateur_ids")?.length || 0,
    prixHt: form.watch("prix_ht"),
    prixTtc: form.watch("prix_ttc"),
    statut: form.watch("statut") || "ouverte",
  };

  return (
    <div className="space-y-6">
      {/* Pricing */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="prix_ht"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Prix HT (FCFA)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  {...field}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value) || 0;
                    field.onChange(value);
                  }}
                  value={field.value || ""}
                  disabled={disabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="prix_ttc"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Prix TTC (FCFA)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  {...field}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value) || 0;
                    field.onChange(value);
                  }}
                  value={field.value || ""}
                  disabled={disabled}
                />
              </FormControl>
              <FormMessage />
              <p className="text-xs text-gray-500 mt-1">
                TTC = HT × 1.18 (calculé automatiquement)
              </p>
            </FormItem>
          )}
        />
      </div>

      {/* Status */}
      <FormField
        control={form.control}
        name="statut"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Statut de publication</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value || "planifiee"}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="planifiee">Planifiée (non visible publiquement)</SelectItem>
                <SelectItem value="ouverte">Ouverte (visible et inscriptions ouvertes)</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Internal notes */}
      <FormField
        control={form.control}
        name="notes_internes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Notes internes</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Notes internes (non visibles publiquement)..."
                rows={4}
                {...field}
                disabled={disabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Recap card */}
      <Card>
        <CardHeader>
          <CardTitle>Récapitulatif</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="font-medium">Formation:</span>
            </div>
            <div>{recapData.formation}</div>

            <div>
              <span className="font-medium">Dates:</span>
            </div>
            <div>
              {recapData.dateDebut && recapData.dateFin
                ? `${recapData.dateDebut} au ${recapData.dateFin}`
                : "Non définies"}
            </div>

            <div>
              <span className="font-medium">Horaires:</span>
            </div>
            <div>{recapData.horaires || "Non définis"}</div>

            <div>
              <span className="font-medium">Mode:</span>
            </div>
            <div className="capitalize">{recapData.mode || "Non défini"}</div>

            {recapData.mode === "presentiel" && recapData.lieu && (
              <>
                <div>
                  <span className="font-medium">Lieu:</span>
                </div>
                <div>{recapData.lieu}</div>
              </>
            )}

            {(recapData.mode === "distanciel" || recapData.mode === "hybride") &&
              recapData.lienVisio && (
                <>
                  <div>
                    <span className="font-medium">Lien visio:</span>
                  </div>
                  <div className="truncate">{recapData.lienVisio}</div>
                </>
              )}

            <div>
              <span className="font-medium">Places:</span>
            </div>
            <div>{recapData.places || 0}</div>

            <div>
              <span className="font-medium">Formateurs:</span>
            </div>
            <div>{recapData.formateursCount}</div>

            <div>
              <span className="font-medium">Prix HT:</span>
            </div>
            <div>{recapData.prixHt ? `${recapData.prixHt} FCFA` : "Non défini"}</div>

            <div>
              <span className="font-medium">Prix TTC:</span>
            </div>
            <div>{recapData.prixTtc ? `${recapData.prixTtc} FCFA` : "Non défini"}</div>

            <div>
              <span className="font-medium">Statut:</span>
            </div>
            <div className="capitalize">
              {recapData.statut === "planifiee" ? "Planifiée" : "Ouverte"}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


