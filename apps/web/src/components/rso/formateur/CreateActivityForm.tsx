"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { createRSOActivity, getRSOActivityTypes } from "@/lib/rso/activities";
import { RSOInstallation } from "@/lib/rso/installations";

// Schema de validation pour activité
const activityFormSchema = z.object({
  installationId: z.number().min(1, "L'installation est requise"),
  type: z.string().min(1, "Le type d'activité est requis"),
  titre: z.string().min(1, "Le titre est requis").max(255, "Le titre est trop long"),
  description: z.string().optional(),
  dateActivite: z.string().min(1, "La date de l'activité est requise"),
  statut: z.enum(["planifie", "en_cours", "termine", "annule"]).optional(),
});

type ActivityFormData = z.infer<typeof activityFormSchema>;

interface CreateActivityFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  installations: RSOInstallation[];
}

export function CreateActivityForm({
  open,
  onOpenChange,
  onSuccess,
  installations,
}: CreateActivityFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityTypes, setActivityTypes] = useState<string[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);

  const form = useForm<ActivityFormData>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: {
      installationId: undefined,
      type: "",
      titre: "",
      description: "",
      dateActivite: new Date().toISOString().slice(0, 16), // Format datetime-local
      statut: "planifie",
    },
  });

  // Load activity types on mount
  useState(() => {
    const loadTypes = async () => {
      try {
        setLoadingTypes(true);
        const types = await getRSOActivityTypes();
        setActivityTypes(types);
      } catch (error: any) {
        console.error("Error loading activity types:", error);
        toast.error("Erreur lors du chargement des types d'activités");
      } finally {
        setLoadingTypes(false);
      }
    };
    loadTypes();
  });

  const onSubmit = async (data: ActivityFormData) => {
    try {
      setLoading(true);
      setError(null);

      await createRSOActivity({
        installationId: data.installationId,
        type: data.type,
        titre: data.titre,
        description: data.description || undefined,
        dateActivite: new Date(data.dateActivite).toISOString(),
        statut: data.statut || "planifie",
      });

      toast.success("Activité créée avec succès");
      form.reset();
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error("Error creating activity:", error);
      setError(error.message || "Erreur lors de la création de l'activité");
      toast.error(error.message || "Erreur lors de la création de l'activité");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Créer une nouvelle activité</DialogTitle>
          <DialogDescription>
            Remplissez les informations pour créer une nouvelle activité de sûreté portuaire
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="installationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Installation *</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(parseInt(value, 10))}
                    value={field.value?.toString()}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner une installation" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {installations.map((installation) => (
                        <SelectItem
                          key={installation.id}
                          value={installation.id.toString()}
                        >
                          {installation.nom} ({installation.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type d'activité *</FormLabel>
                  {loadingTypes ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">
                        Chargement des types...
                      </span>
                    </div>
                  ) : (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activityTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="titre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Titre *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Titre de l'activité" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dateActivite"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date de l'activité *</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="statut"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Statut</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value || "planifie"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner un statut" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="planifie">Planifié</SelectItem>
                      <SelectItem value="en_cours">En cours</SelectItem>
                      <SelectItem value="termine">Terminé</SelectItem>
                      <SelectItem value="annule">Annulé</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Description détaillée de l'activité"
                      rows={4}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Création...
                  </>
                ) : (
                  "Créer l'activité"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

