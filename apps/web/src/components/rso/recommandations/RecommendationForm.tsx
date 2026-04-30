"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
  Input,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { useCreateRecommendation, useUpdateRecommendation } from "@/lib/rso/recommandations";
import { listRSOUsers } from "@/lib/rso/users";
import { useQuery } from "@tanstack/react-query";
import type {
  RSORecommendation,
  CreateRecommendationRequest,
  UpdateRecommendationRequest,
  RecommendationPriority,
} from "@ecoledigitale/contracts/rso/recommandations/recommandation.contracts";

const recommendationSchema = z.object({
  titre: z.string().min(10, "Le titre doit contenir au moins 10 caractères").max(255, "Le titre est trop long"),
  description: z.string().min(150, "La description doit contenir au moins 150 caractères"),
  priorite: z.enum(["basse", "moyenne", "haute", "critique"]),
  responsableId: z.number().int().positive().nullable().optional(),
  dateEcheance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)").nullable().optional(),
});

interface RecommendationFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  activiteId: number;
  installationId: number;
  recommendation?: RSORecommendation | null;
}

export function RecommendationForm({
  open,
  onClose,
  onSuccess,
  activiteId,
  installationId,
  recommendation,
}: RecommendationFormProps) {
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof recommendationSchema>>({
    resolver: zodResolver(recommendationSchema),
    defaultValues: {
      titre: recommendation?.titre || "",
      description: recommendation?.description || "",
      priorite: recommendation?.priorite || "moyenne",
      responsableId: recommendation?.responsableId || null,
      dateEcheance: recommendation?.dateEcheance || null,
    },
  });

  // Load PFSO agents for this installation
  const { data: pfsoAgents } = useQuery({
    queryKey: ["rso", "pfso-agents", installationId],
    queryFn: async () => {
      const response = await listRSOUsers({
        role: "agent_pfso",
        installationId,
        statut: "actif",
      });
      return response.users;
    },
  });

  const createMutation = useCreateRecommendation();
  const updateMutation = useUpdateRecommendation();

  const onSubmit = async (data: z.infer<typeof recommendationSchema>) => {
    try {
      setError(null);

      if (recommendation) {
        await updateMutation.mutateAsync({
          id: recommendation.id,
          data: data as UpdateRecommendationRequest,
        });
      } else {
        await createMutation.mutateAsync({
          activiteId,
          data: data as CreateRecommendationRequest,
        });
      }

      form.reset();
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err.message || "Erreur lors de la sauvegarde");
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {recommendation ? "Modifier la Recommandation" : "Créer une Recommandation"}
          </DialogTitle>
          <DialogDescription>
            {recommendation
              ? "Modifiez les informations de la recommandation"
              : "Créez une nouvelle recommandation pour cette activité"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="titre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Titre *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex: Améliorer la signalétique d'évacuation" />
                  </FormControl>
                  <FormDescription>Minimum 10 caractères</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description *</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={6}
                      placeholder="Décrivez en détail la recommandation, les points à améliorer, et les actions suggérées..."
                    />
                  </FormControl>
                  <FormDescription>Minimum 150 caractères</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="priorite"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priorité *</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => field.onChange(value as RecommendationPriority)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="basse">Basse</SelectItem>
                        <SelectItem value="moyenne">Moyenne</SelectItem>
                        <SelectItem value="haute">Haute</SelectItem>
                        <SelectItem value="critique">Critique</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dateEcheance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date d'échéance</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value || ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="responsableId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Responsable</FormLabel>
                  <Select
                    value={field.value?.toString() || ""}
                    onValueChange={(value) => field.onChange(value ? parseInt(value, 10) : null)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner un responsable (optionnel)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">Aucun responsable</SelectItem>
                      {pfsoAgents?.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id.toString()}>
                          {agent.prenoms} {agent.nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>Agent PFSO responsable de la mise en œuvre</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                Annuler
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Enregistrement...
                  </>
                ) : recommendation ? (
                  "Modifier"
                ) : (
                  "Créer"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

